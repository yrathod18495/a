#!/usr/bin/env node
// Tells Telegram where to send the bot's messages (so a Reply in Telegram reaches the user's live chat). Run it once after the first deploy,
// and again if the site address changes. Needs the same two values that are set on the server:
//   TELEGRAM_BOT_TOKEN='123456:ABC...' TELEGRAM_WEBHOOK_SECRET='the-same-secret-as-on-the-server' node scripts/telegram-webhook.mjs https://YOUR-DOMAIN/api/telegram
// Check what is set:   TELEGRAM_BOT_TOKEN='...' node scripts/telegram-webhook.mjs --info      Remove it:   ... node scripts/telegram-webhook.mjs --remove
const token = process.env.TELEGRAM_BOT_TOKEN, secret = process.env.TELEGRAM_WEBHOOK_SECRET, arg = process.argv[2];
if (!token || !arg) { console.error('Usage: TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... node scripts/telegram-webhook.mjs https://YOUR-DOMAIN/api/telegram   (or --info / --remove)'); process.exit(1); }
const call = async (method, body) => { const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); return r.json(); };
const show = (r) => console.log(JSON.stringify(r, null, 2).replace(token, '<token>'));
if (arg === '--info') show(await call('getWebhookInfo'));
else if (arg === '--remove') show(await call('deleteWebhook'));
else {
  if (!/^https:\/\/[^\s]+\/api\/telegram$/.test(arg)) { console.error('The address must be https and end with /api/telegram'); process.exit(1); }
  if (!secret || !/^[A-Za-z0-9_-]{16,256}$/.test(secret)) { console.error('TELEGRAM_WEBHOOK_SECRET must be 16 to 256 characters: letters, numbers, _ and - only.'); process.exit(1); }
  show(await call('setWebhook', { url: arg, secret_token: secret, allowed_updates: ['message'], drop_pending_updates: true }));
}
