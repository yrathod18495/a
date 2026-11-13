// Writing into a user's support chat from the server side: used by the admin panel's reply and by the Telegram bot (api/telegram.js).
import { AccessError } from './security-policy.js';

export const PHOTO_LABEL = '📷 Photo';
/**
 * "Something changed in this chat": a tiny document that the user's browser (chatSignals/<uid>) and the admins' browsers (chatSignals/_staff) listen to,
 * so a new message shows up at once instead of at the next check. `by` tells who wrote (so a closed chat can light its unread dot without any request).
 */
export const signalWrites = (db, uid, by, at = Date.now()) => [[db.doc(`chatSignals/${uid}`), { at, by }], [db.doc('chatSignals/_staff'), { at, by, uid }]];
export const writeChat = async (db, ref, messageRef, row, summary, { by = row?.sender || 'admin' } = {}) => {
  const signals = signalWrites(db, ref.id, by, row?.createdAt || Date.now());
  if (typeof db.batch === 'function') { const batch = db.batch(); batch.set(messageRef, row); batch.set(ref, summary, { merge: true }); for (const [r, d] of signals) batch.set(r, d); await batch.commit(); }
  else { await messageRef.set(row); await ref.set(summary, { merge: true }); for (const [r, d] of signals) await r.set(d); }
};

/** an admin's reply in the chat of `uid`; the user sees it in their live chat. Throws chat_not_found (404) when that chat does not exist. */
export async function addAdminReply(db, uid, message, { image = '' } = {}) {
  const ref = db.collection('supportChats').doc(uid), chat = await ref.get();
  if (!chat.exists) throw new AccessError('chat_not_found', 'This conversation no longer exists.', 404);
  const now = Date.now(), row = { sender: 'admin', message, createdAt: now, ...(image ? { image } : {}) };
  const summary = { updatedAt: now, lastMessage: message || PHOTO_LABEL, lastSender: 'admin', unreadAdmin: false, unreadUser: true };
  await writeChat(db, ref, ref.collection('messages').doc(), row, summary);
  return { row, chat: chat.data() || {} };
}
