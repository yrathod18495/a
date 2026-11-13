import { services } from '../server/firebase-admin.js';
import { maintenanceOn } from '../server/maintenance.js';
import { access, bodyOf, send, failure } from '../server/access.js';
import { AccessError } from '../server/security-policy.js';
import { tierOf, peekTier } from '../server/entitlements.js';
import { PHOTO_LABEL, addAdminReply, writeChat, signalWrites } from '../server/support-chat.js';
import { notifyChatMessage } from '../server/telegram.js';
// Temporarily disabled until Firebase Web Push VAPID is configured.
// import { sendSupportReplyPush } from '../server/support-push.js';

const validUid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{10,128}$/.test(value);
const validMessageId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{3,64}$/.test(value);
const cleanText = (value, { optional = false } = {}) => {
  if (value == null && optional) return '';
  if (typeof value !== 'string') throw new AccessError('invalid_message', 'Please enter a message first.', 400);
  const text = value.trim();
  if (text.length > 2000 || (!text && !optional)) throw new AccessError('invalid_message', 'The message must be between 1 and 2000 characters.', 400);
  return text;
};
/** a picture sent by an admin is a small data URL (the browser shrinks it first), kept inside the message */
const IMAGE_MAX_CHARS = 150000;
const cleanImage = value => {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || value.length > IMAGE_MAX_CHARS || !/^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(value)) throw new AccessError('invalid_image', 'Please attach a smaller picture (JPG, PNG or WebP).', 400);
  return value;
};
const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
/** after an edit or a delete: the inbox preview must show the newest message that is still there (the list order is not changed) */
async function refreshSummary(db, ref, revision) {
  const rows = (await ref.collection('messages').get()).docs.map(d => d.data()).sort((a, b) => a.createdAt - b.createdAt), last = rows.at(-1);
  await ref.set({ lastMessage: last ? (last.message || (last.image ? PHOTO_LABEL : '')) : '', lastSender: last?.sender || '', revision }, { merge: true });
}
const signal = async (db, uid) => { for (const [r, d] of signalWrites(db, uid, 'admin')) await r.set(d).catch(() => {}); };
async function deleteMessages(db, ref) {
  const docs = (await ref.collection('messages').get()).docs;
  for (let i = 0; i < docs.length; i += 400) {
    if (typeof db.batch === 'function') { const batch = db.batch(); docs.slice(i, i + 400).forEach(d => batch.delete(d.ref)); await batch.commit(); }
    else await Promise.all(docs.slice(i, i + 400).map(d => d.ref.delete()));
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'This request is not valid. Please reload the page and try again.' });
  try {
    const b = await bodyOf(req, 170000);
    const isAdminAction = ['adminList', 'adminMessages', 'adminReply', 'adminEditMessage', 'adminDeleteMessage', 'adminDeleteChats', 'adminNewChat'].includes(b.action);
    const isWrite = ['send', 'adminReply', 'adminEditMessage', 'adminDeleteMessage', 'adminDeleteChats', 'adminNewChat'].includes(b.action);
    const who = await access(req, { admin: isAdminAction, write: isWrite });
    const { db } = services();
    if (!who.admin && await maintenanceOn(db)) throw new AccessError('maintenance', '12toons is under maintenance right now. Please try again shortly.', 503);

    if (b.action === 'send') {
      const message = cleanText(b.message), ref = db.collection('supportChats').doc(who.uid);
      const chat = await ref.get();
      const data = chat.data() || {};
      const now = Date.now();
      if (data.lastUserMessageAt && now - data.lastUserMessageAt < 800) throw new AccessError('rate_limited', 'Please wait a moment before sending another message.', 429);
      const row = { sender: 'user', message, createdAt: now };
      const summary = { uid: who.uid, email: String(who.claims.email || '').slice(0, 254), displayName: String(who.claims.name || '').slice(0, 120), updatedAt: now, lastMessage: message, lastSender: 'user', unreadAdmin: true, lastUserMessageAt: now };
      await writeChat(db, ref, ref.collection('messages').doc(), row, summary, { by: 'user' });
      // the owner's Telegram: the message arrives there and a Reply to it answers this user (see api/telegram.js). It must not hold the user's reply up:
      // we wait for it at most a moment (a serverless function can be stopped once the answer is sent)
      const notify = peekTier(db, who.uid).catch(() => '').then((plan) => notifyChatMessage({ uid: who.uid, name: summary.displayName, email: summary.email, message, paid: plan === 'paid' })).catch(() => {});
      await Promise.race([notify, new Promise((r) => setTimeout(r, 1200))]);
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
      const chat = thread.data(), now = Date.now();
      // reading is recorded: the admin's "seen" ticks come from userSeenAt
      if (b.action === 'adminMessages' ? chat.unreadAdmin === true : chat.unreadUser === true) {
        await ref.set(b.action === 'adminMessages' ? { unreadAdmin: false } : { unreadUser: false, userSeenAt: now }, { merge: true });
      }
      // after the first load the browser only asks for what came after its newest message, so a quiet chat costs two reads, not two hundred;
      // an edit or a delete changes the revision, and then the whole conversation is sent again
      const revision = Number(chat.revision || 0), incremental = Number.isFinite(b.since) && b.since > 0 && Number(b.revision || 0) === revision;
      let query = ref.collection('messages').orderBy('createdAt', 'asc');
      if (incremental) query = query.where('createdAt', '>', b.since);
      const snap = await query.limit(200).get();
      return send(res, 200, { incremental, revision, messages: snap.docs.map(d => ({ id: d.id, ...d.data() })), unreadUser: b.action === 'messages' && chat.unreadUser === true, ...(b.action === 'adminMessages' ? { userSeenAt: Number(chat.userSeenAt || 0) } : {}) });
    }
    if (b.action === 'adminList') {
      const snap = await db.collection('supportChats').orderBy('updatedAt', 'desc').limit(100).get(), chats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // a paid account gets a diamond badge: the tier comes from entitlements (set by a captured purchase, or by an admin); an account with no record yet is worked out once and remembered
      const tiers = chats.length ? await db.getAll(...chats.map(c => db.doc(`entitlements/${c.id}`))) : [];
      const premium = await Promise.all(chats.map(async (c, i) => { const tier = tiers[i].data()?.tier; return (tier === 'paid' || tier === 'free') ? tier === 'paid' : (await tierOf(db, c.id)) === 'paid'; }));
      return send(res, 200, { chats: chats.map((c, i) => ({ ...c, premium: premium[i] })) });
    }
    if (b.action === 'adminReply') {
      if (!validUid(b.uid)) throw new AccessError('invalid_user', 'Please choose a user\'s conversation.', 400);
      const image = cleanImage(b.image), message = cleanText(b.message, { optional: !!image });
      const { row } = await addAdminReply(db, b.uid, message, { image });
      // Temporarily disabled until Firebase Web Push VAPID is configured.
      // Keep this call for re-enabling after VAPID setup.
      // try { await sendSupportReplyPush(db, services().messaging, b.uid); }
      // catch (error) { console.warn('Could not send support reply notification:', error.code || error.message); }
      return send(res, 200, { message: row });
    }
    if (b.action === 'adminEditMessage' || b.action === 'adminDeleteMessage') {
      // an admin can change or remove only their own replies; what a user wrote is never altered
      if (!validUid(b.uid) || !validMessageId(b.messageId)) throw new AccessError('invalid_message', 'This message is not valid.', 400);
      const ref = db.collection('supportChats').doc(b.uid), chat = await ref.get(), messageRef = ref.collection('messages').doc(b.messageId), message = await messageRef.get();
      if (!chat.exists || !message.exists) throw new AccessError('message_not_found', 'This message no longer exists.', 404);
      if (message.data().sender !== 'admin') throw new AccessError('not_your_message', 'Only an admin reply can be changed or deleted.', 403);
      const revision = Number(chat.data().revision || 0) + 1;
      if (b.action === 'adminEditMessage') {
        const text = cleanText(b.message, { optional: !!message.data().image });
        await messageRef.set({ message: text, editedAt: Date.now() }, { merge: true });
        await refreshSummary(db, ref, revision); await signal(db, b.uid);
        return send(res, 200, { edited: true, revision });
      }
      await messageRef.delete();
      await refreshSummary(db, ref, revision); await signal(db, b.uid);
      return send(res, 200, { deleted: true, revision });
    }
    if (b.action === 'adminDeleteChats') {
      const uids = [...new Set(Array.isArray(b.uids) ? b.uids : [])];
      if (!uids.length || uids.length > 50 || !uids.every(validUid)) throw new AccessError('invalid_selection', 'Please select between 1 and 50 conversations.', 400);
      let deleted = 0;
      for (const uid of uids) {
        const ref = db.collection('supportChats').doc(uid);
        if (!(await ref.get()).exists) continue;
        await deleteMessages(db, ref); await ref.delete(); deleted++;
      }
      if (deleted) await db.collection('securityAudit').add({ admin: who.uid, action: 'chats_deleted', count: deleted, at: Date.now() });
      return send(res, 200, { deleted });
    }
    if (b.action === 'adminNewChat') {
      // the admin starts a conversation with an existing account; nothing is sent until the admin writes the first message
      const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
      if (!validEmail(email)) throw new AccessError('invalid_email', 'Please enter a valid email address.', 400);
      let account;
      try { account = await services().auth.getUserByEmail(email); }
      catch { throw new AccessError('user_not_found', 'No 12toons account uses this email address.', 404); }
      const ref = db.collection('supportChats').doc(account.uid), existing = await ref.get();
      if (existing.exists) return send(res, 200, { existing: true, chat: { id: account.uid, ...existing.data() } });
      const now = Date.now(), chat = { uid: account.uid, email: String(account.email || email).slice(0, 254), displayName: String(account.displayName || '').slice(0, 120), updatedAt: now, lastMessage: '', lastSender: '', unreadAdmin: false, unreadUser: false };
      await ref.set(chat);
      return send(res, 200, { existing: false, chat: { id: account.uid, ...chat } });
    }
    throw new AccessError('invalid_action', 'This chat action is not supported.', 400);
  } catch (e) { return failure(res, e); }
}
