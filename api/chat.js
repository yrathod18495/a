import { services } from '../server/firebase-admin.js';
import { access, bodyOf, send, failure } from '../server/access.js';
import { AccessError } from '../server/security-policy.js';
// Temporarily disabled until Firebase Web Push VAPID is configured.
// import { sendSupportReplyPush } from '../server/support-push.js';

const validUid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{10,128}$/.test(value);
const cleanText = value => {
  if (typeof value !== 'string') throw new AccessError('invalid_message', 'Please enter a message first.', 400);
  const text = value.trim();
  if (!text || text.length > 2000) throw new AccessError('invalid_message', 'The message must be between 1 and 2000 characters.', 400);
  return text;
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'This request is not valid. Please reload the page and try again.' });
  try {
    const b = await bodyOf(req, 12000);
    const isAdminAction = ['adminList', 'adminMessages', 'adminReply'].includes(b.action);
    const isWrite = ['send', 'adminReply'].includes(b.action);
    const who = await access(req, { admin: isAdminAction, write: isWrite });
    const { db } = services();
    if (process.env.MAINTENANCE_MODE !== 'false' && !who.admin) throw new AccessError('maintenance', '12toons is under maintenance right now. Please try again shortly.', 503);

    if (b.action === 'send') {
      const message = cleanText(b.message), ref = db.collection('supportChats').doc(who.uid);
      const chat = await ref.get();
      const data = chat.data() || {};
      const now = Date.now();
      if (data.lastUserMessageAt && now - data.lastUserMessageAt < 800) throw new AccessError('rate_limited', 'Please wait a moment before sending another message.', 429);
      const row = { sender: 'user', message, createdAt: now };
      const summary = { uid: who.uid, email: String(who.claims.email || '').slice(0, 254), displayName: String(who.claims.name || '').slice(0, 120), updatedAt: now, lastMessage: message, lastSender: 'user', unreadAdmin: true, lastUserMessageAt: now };
      const messageRef = ref.collection('messages').doc();
      if (typeof db.batch === 'function') { const batch = db.batch(); batch.set(messageRef, row); batch.set(ref, summary, { merge: true }); await batch.commit(); }
      else { await messageRef.set(row); await ref.set(summary, { merge: true }); }
      return send(res, 200, { message: row });
    }
    if (b.action === 'messages' || b.action === 'adminMessages') {
      const uid = b.action === 'messages' ? who.uid : b.uid;
      if (!validUid(uid)) throw new AccessError('invalid_user', 'This chat is not valid.', 400);
      const ref = db.collection('supportChats').doc(uid);
      const thread = await ref.get();
      // Opening a user's inbox must not create an empty conversation record.
      if (!thread.exists) {
        if (b.action === 'adminMessages') throw new AccessError('chat_not_found', 'This conversation no longer exists.', 404);
        return send(res, 200, { messages: [], unreadUser: false });
      }
      if (b.action === 'adminMessages' ? thread.data()?.unreadAdmin === true : thread.data()?.unreadUser === true) {
        await ref.set(b.action === 'adminMessages' ? { unreadAdmin: false } : { unreadUser: false }, { merge: true });
      }
      // after the first load the browser only asks for what came after its newest message, so a quiet chat costs two reads, not two hundred
      let query = ref.collection('messages').orderBy('createdAt', 'asc');
      if (Number.isFinite(b.since) && b.since > 0) query = query.where('createdAt', '>', b.since);
      const snap = await query.limit(200).get();
      return send(res, 200, { incremental: Number.isFinite(b.since) && b.since > 0, messages: snap.docs.map(d => ({ id: d.id, ...d.data() })), unreadUser: b.action === 'messages' && thread.data()?.unreadUser === true });
    }
    if (b.action === 'adminList') {
      const snap = await db.collection('supportChats').orderBy('updatedAt', 'desc').limit(100).get();
      return send(res, 200, { chats: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
    }
    if (b.action === 'adminReply') {
      if (!validUid(b.uid)) throw new AccessError('invalid_user', 'Please choose a user\'s conversation.', 400);
      const message = cleanText(b.message), ref = db.collection('supportChats').doc(b.uid), chat = await ref.get();
      if (!chat.exists) throw new AccessError('chat_not_found', 'This conversation no longer exists.', 404);
      const now = Date.now(), row = { sender: 'admin', message, createdAt: now };
      const summary = { updatedAt: now, lastMessage: message, lastSender: 'admin', unreadAdmin: false, unreadUser: true };
      const messageRef = ref.collection('messages').doc();
      if (typeof db.batch === 'function') { const batch = db.batch(); batch.set(messageRef, row); batch.set(ref, summary, { merge: true }); await batch.commit(); }
      else { await messageRef.set(row); await ref.set(summary, { merge: true }); }
      // Temporarily disabled until Firebase Web Push VAPID is configured.
      // Keep this call for re-enabling after VAPID setup.
      // try { await sendSupportReplyPush(db, services().messaging, b.uid); }
      // catch (error) { console.warn('Could not send support reply notification:', error.code || error.message); }
      return send(res, 200, { message: row });
    }
    throw new AccessError('invalid_action', 'This chat action is not supported.', 400);
  } catch (e) { return failure(res, e); }
}
