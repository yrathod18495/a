// Telegram calls this address (the bot's webhook) for every message sent to the bot. A Reply to a live-chat message in the owner's chat
// becomes the admin reply in that user's live chat. Everything else gets a short hint. Always answers 200, so Telegram does not retry.
import { timingSafeEqual } from 'node:crypto';
import { services } from '../server/firebase-admin.js';
import { addAdminReply } from '../server/support-chat.js';
import { chatUidFromReply, sendTelegram, telegramConfigured } from '../server/telegram.js';
import { send } from '../server/access.js';

const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
const reply = (update, text) => sendTelegram(text, { timeoutMs: 3000, extra: { reply_to_message_id: update.message.message_id } });

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'This request is not valid.' });
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!telegramConfigured() || !secret) return send(res, 503, { error: 'The Telegram bot is not set up.' });
  // only Telegram knows the secret it was told to send with every call
  if (!same(req.headers['x-telegram-bot-api-secret-token'] || '', secret)) return send(res, 401, { error: 'The request is not valid.' });
  try {
    const update = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}), message = update.message;
    if (!message || message.from?.is_bot || String(message.chat?.id) !== String(process.env.TELEGRAM_CHAT_ID)) return send(res, 200, { ok: true });   // not from the owner's chat: ignored
    const uid = chatUidFromReply(update);
    if (!uid) {
      if (typeof message.text === 'string' && !message.reply_to_message) await reply(update, 'To answer a user, use <b>Reply</b> on their live-chat message here.');
      return send(res, 200, { ok: true });
    }
    const text = typeof message.text === 'string' ? message.text.trim() : '';
    if (!text) { await reply(update, 'Only text replies can be sent to the user for now. Please type your reply.'); return send(res, 200, { ok: true }); }
    if (text.length > 2000) { await reply(update, 'That reply is too long (2000 characters at most). Please shorten it.'); return send(res, 200, { ok: true }); }
    try {
      const { chat } = await addAdminReply(services().db, uid, text);
      await reply(update, `✅ Sent to ${(chat.displayName || chat.email || 'the user').replace(/[&<>]/g, '')}.`);
    } catch (error) {
      if (error.code === 'chat_not_found') await reply(update, 'This conversation no longer exists, so the reply was not sent.');
      else { console.error('Telegram reply could not be saved:', error?.code || error?.message); await reply(update, 'The reply could not be saved. Please try again.'); }
    }
    return send(res, 200, { ok: true });
  } catch (error) { console.error('Telegram webhook error:', error?.message); return send(res, 200, { ok: true }); }
}
