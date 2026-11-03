// Telegram notifications for the owner: a message from the 12toons bot to one chat (the owner's chat or a group).
// Set these two environment variables on the server (Vercel -> Settings -> Environment Variables), then redeploy:
//   TELEGRAM_BOT_TOKEN   the token BotFather gave for the bot
//   TELEGRAM_CHAT_ID     the chat the messages go to (your own chat id, or a group's id, which starts with a minus sign)
// Without them nothing is sent and nothing fails. A notification never stops or slows what the user is doing for more than a moment.
const escapeHtml = (value) => String(value ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const clip = (value, max) => { const s = String(value ?? '').replace(/\s+/g, ' ').trim(); return s.length > max ? s.slice(0, max - 1) + '…' : s; };
export const telegramConfigured = (env = process.env) => !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);

/** send an HTML message; resolves to true when Telegram accepted it, false otherwise (never throws, never logs the token) */
export async function sendTelegram(html, { env = process.env, timeoutMs = 4000, fetchImpl = globalThis.fetch } = {}) {
  if (!telegramConfigured(env) || typeof fetchImpl !== 'function') return false;
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (!response.ok) console.warn('Telegram notification was not accepted (HTTP ' + response.status + ').');
    return response.ok;
  } catch (error) { console.warn('Telegram notification failed:', error?.name || 'error'); return false; }
}

const KIND_LABEL = { animation: 'Animator Studio', character: 'Character Editor' };
/** the message for a newly created project */
export function newProjectMessage({ id, kind, name, owner = {} }) {
  const who = [owner.name, owner.email && `(${owner.email})`].filter(Boolean).map((x) => clip(x, 80)).join(' ') || 'an account';
  return [
    '🆕 <b>New project</b>',
    `<b>Name:</b> ${escapeHtml(clip(name, 100) || 'Untitled project')}`,
    `<b>Tool:</b> ${escapeHtml(KIND_LABEL[kind] || kind)}`,
    `<b>Project ID:</b> <code>${escapeHtml(id)}</code>`,
    `<b>By:</b> ${escapeHtml(who)}`,
  ].join('\n');
}

/** tell the owner about a new project, waiting at most `waitMs` for Telegram so the user's request is not held up */
export async function notifyNewProject(project, { waitMs = 1500, ...options } = {}) {
  if (!telegramConfigured(options.env)) return false;
  const sending = sendTelegram(newProjectMessage(project), options);
  return Promise.race([sending, new Promise((resolve) => setTimeout(() => resolve(false), waitMs))]);
}
