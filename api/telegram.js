// Telegram calls this address (the bot's webhook) for every message sent to the bot. A Reply to a live-chat message in the owner's chat
// becomes the admin reply in that user's live chat. Everything else gets a short hint. Always answers 200, so Telegram does not retry.
import { timingSafeEqual } from 'node:crypto';
import { services } from '../server/firebase-admin.js';
import { addAdminReply } from '../server/support-chat.js';
import { chatUidFromReply, sendTelegram, telegramConfigured, clean } from '../server/telegram.js';
import { send } from '../server/access.js';

const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
// answers go back to the chat the message came from, as a reply to it
const reply = (update, text) => sendTelegram(text, { timeoutMs: 3000, chatId: update.message.chat.id, extra: { reply_to_message_id: update.message.message_id } });

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'This request is not valid.' });
  const secret = clean(process.env.TELEGRAM_WEBHOOK_SECRET);
  if (!telegramConfigured() || !secret) return send(res, 503, { error: 'The Telegram bot is not set up.' });
  // only Telegram knows the secret it was told to send with every call
  if (!same(req.headers['x-telegram-bot-api-secret-token'] || '', secret)) return send(res, 401, { error: 'The request is not valid.' });
  try {
    const update = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}), message = update.message;
    if (!message || message.from?.is_bot) return send(res, 200, { ok: true });
    const owner = String(message.chat?.id) === clean(process.env.TELEGRAM_CHAT_ID), command = typeof message.text === 'string' ? message.text.trim().split(/[\s@]/)[0].toLowerCase() : '';
    if (!owner) {
      // a stranger (or the wrong chat id in the settings): never answers a user, but /status and /start say what is wrong, with that chat's own id only
      if (command === '/status' || command === '/start') await reply(update, `This chat is not allowed to answer support messages.\nThis chat's ID is <code>${String(message.chat.id).replace(/[^0-9-]/g, '')}</code>. If this is your own chat, set <b>TELEGRAM_CHAT_ID</b> on the server to this number.`);
      else console.warn('Telegram message ignored: not from the configured chat.');
      return send(res, 200, { ok: true });
    }
    if (command === '/status' || command === '/start') { await reply(update, `✅ The webhook works. This chat is allowed to answer support messages (chat ID <code>${String(message.chat.id).replace(/[^0-9-]/g, '')}</code>).\nTo answer a user, use <b>Reply</b> on their 💬 Live chat message.`); return send(res, 200, { ok: true }); }
    const uid = chatUidFromReply(update);
    if (!uid) {
      console.warn('Telegram message ignored: no live-chat message was replied to.');
      await reply(update, message.reply_to_message ? 'I could not tell which user that message belongs to. Please use <b>Reply</b> on a 💬 Live chat message from this bot.' : 'To answer a user, use <b>Reply</b> on their live-chat message here.');
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
