import test from 'node:test';
import assert from 'node:assert/strict';
import { sendTelegram, newProjectMessage, notifyNewProject, telegramConfigured } from '../server/telegram.js';

const env = { TELEGRAM_BOT_TOKEN: '123456:SECRET-TOKEN', TELEGRAM_CHAT_ID: '-1001234567890' };
const recorder = (reply = { ok: true, status: 200 }) => { const calls = []; return { calls, fetchImpl: async (url, init) => { calls.push([url, JSON.parse(init.body), init.method]); return reply; } }; };

test('without the bot token and chat id nothing is sent and nothing fails', async () => {
  const r = recorder();
  assert.equal(telegramConfigured({}), false); assert.equal(telegramConfigured({ TELEGRAM_BOT_TOKEN: 'x' }), false);
  assert.equal(await sendTelegram('hi', { env: {}, fetchImpl: r.fetchImpl }), false);
  assert.equal(await notifyNewProject({ id: '1', kind: 'animation', name: 'x' }, { env: {}, fetchImpl: r.fetchImpl }), false);
  assert.equal(r.calls.length, 0);
});
test('a message goes to the bot API with the chat id, as HTML, without link previews', async () => {
  const r = recorder();
  assert.equal(await sendTelegram('<b>hello</b>', { env, fetchImpl: r.fetchImpl }), true);
  assert.equal(r.calls.length, 1);
  const [url, body, method] = r.calls[0];
  assert.equal(url, 'https://api.telegram.org/bot123456:SECRET-TOKEN/sendMessage'); assert.equal(method, 'POST');
  assert.deepEqual(body, { chat_id: '-1001234567890', text: '<b>hello</b>', parse_mode: 'HTML', disable_web_page_preview: true });
});
test('a rejected message, a network error and a hang never throw, and the token is never logged', async () => {
  const logs = []; const warn = console.warn; console.warn = (...a) => logs.push(a.join(' '));
  try {
    assert.equal(await sendTelegram('x', { env, fetchImpl: async () => ({ ok: false, status: 401 }) }), false);
    assert.equal(await sendTelegram('x', { env, fetchImpl: async () => { throw Object.assign(Error('connect ECONNREFUSED https://api.telegram.org/bot123456:SECRET-TOKEN/sendMessage'), { name: 'TypeError' }); } }), false);
    const started = Date.now();
    assert.equal(await notifyNewProject({ id: '1', kind: 'animation', name: 'x' }, { env, waitMs: 80, fetchImpl: () => new Promise(() => {}) }), false);   // a hanging Telegram holds the request for only a moment
    assert.ok(Date.now() - started < 1000);
  } finally { console.warn = warn; }
  assert.ok(logs.length >= 2); assert.ok(logs.every((l) => !l.includes('SECRET-TOKEN')), logs.join('|'));
});
test('the new-project message names the project, tool, ID and owner, and cannot be broken by the user\'s text', () => {
  const text = newProjectMessage({ id: '502674123', kind: 'animation', name: 'My <b>cool</b> & "film"', owner: { name: 'Asha <script>', email: 'asha@example.com' } });
  assert.match(text, /^🆕 <b>New project<\/b>/);
  assert.match(text, /<b>Name:<\/b> My &lt;b&gt;cool&lt;\/b&gt; &amp; "film"/);
  assert.match(text, /<b>Tool:<\/b> Animator Studio/); assert.match(text, /<code>502674123<\/code>/);
  assert.match(text, /<b>By:<\/b> Asha &lt;script&gt; \(asha@example\.com\)/);
  assert.doesNotMatch(text, /<script>/);
  assert.match(newProjectMessage({ id: '1', kind: 'character', name: '', owner: {} }), /Character Editor[\s\S]*By:<\/b> an account/);
  assert.ok(newProjectMessage({ id: '1', kind: 'animation', name: 'x'.repeat(500), owner: {} }).length < 400);                  // long names are cut
});
