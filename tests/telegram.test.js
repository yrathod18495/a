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

test('a live-chat message for the owner names the sender, the plan and the chat to answer, and escapes the user\'s text', async () => {
  const { chatMessageText } = await import('../server/telegram.js');
  const text = chatMessageText({ uid: 'user_abcdefghij123456', name: 'Asha', email: 'asha@example.com', message: 'Help <b>me</b> & fast', paid: true });
  assert.match(text, /^💬 <b>Live chat<\/b> · ⭐ Paid/); assert.match(text, /<b>From:<\/b> Asha \(asha@example\.com\)/);
  assert.match(text, /Help &lt;b&gt;me&lt;\/b&gt; &amp; fast/); assert.match(text, /Reply to this message to answer/);
  assert.ok(text.trimEnd().endsWith('<code>chat:user_abcdefghij123456</code>'));
  assert.match(chatMessageText({ uid: 'user_abcdefghij123456', message: 'x' }), /Free/);
});
test('a Reply is matched to the right user: only the bot\'s own message in the owner\'s chat counts, and the last chat tag wins', async () => {
  const { chatUidFromReply } = await import('../server/telegram.js');
  const env = { TELEGRAM_CHAT_ID: '-1001' };
  const update = (over = {}, original = {}) => ({ message: { chat: { id: -1001 }, text: 'ok', reply_to_message: { from: { is_bot: true }, text: 'Hello\nchat:real_user_1234567890', ...original }, ...over } });
  assert.equal(chatUidFromReply(update(), env), 'real_user_1234567890');
  // a user who types a fake tag in their own message cannot redirect the answer: the bot's tag comes last
  assert.equal(chatUidFromReply(update({}, { text: 'please chat:victim_user_1234567890 thanks\n\nReply to this message to answer.\nchat:real_user_1234567890' }), env), 'real_user_1234567890');
  assert.equal(chatUidFromReply(update({ chat: { id: -999 } }), env), null);                         // another chat
  assert.equal(chatUidFromReply(update({}, { from: { is_bot: false } }), env), null);                 // a message of a person, not of the bot
  assert.equal(chatUidFromReply(update({}, { text: 'no tag here' }), env), null);
  assert.equal(chatUidFromReply({ message: { chat: { id: -1001 }, text: 'x' } }, env), null);         // not a reply
  assert.equal(chatUidFromReply(null, env), null);
});

test('TELEGRAM_CHAT_ID can hold several chats; spaces, commas, line breaks and junk are cleaned, duplicates dropped', async () => {
  const { chatIds, isOwnerChat, telegramConfigured: configured } = await import('../server/telegram.js');
  assert.deepEqual(chatIds({ TELEGRAM_CHAT_ID: '993332413' }), ['993332413']);
  assert.deepEqual(chatIds({ TELEGRAM_CHAT_ID: ' 993332413 , 1122334455;\n-1001234567890  993332413 ' }), ['993332413', '1122334455', '-1001234567890']);
  assert.deepEqual(chatIds({ TELEGRAM_CHAT_ID: 'abc, @channel, 12' }), []);                 // not numbers: never used
  assert.deepEqual(chatIds({}), []);
  assert.equal(isOwnerChat(1122334455, { TELEGRAM_CHAT_ID: '993332413,1122334455' }), true);
  assert.equal(isOwnerChat('-1001234567890', { TELEGRAM_CHAT_ID: '993332413,-1001234567890' }), true);
  assert.equal(isOwnerChat(5, { TELEGRAM_CHAT_ID: '993332413,1122334455' }), false);
  assert.equal(configured({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: 'abc' }), false);
});
test('a message goes to every chat in the list, and one chat failing does not stop the others', async () => {
  const calls = [];
  const env = { TELEGRAM_BOT_TOKEN: '1:T', TELEGRAM_CHAT_ID: '111111,222222,333333' };
  const fetchImpl = async (url, init) => { const body = JSON.parse(init.body); calls.push(body.chat_id); if (body.chat_id === '222222') throw new Error('blocked the bot'); return { ok: true, status: 200 }; };
  const warn = console.warn; console.warn = () => {};
  try { assert.equal(await sendTelegram('hi', { env, fetchImpl }), true); } finally { console.warn = warn; }
  assert.deepEqual(calls.sort(), ['111111', '222222', '333333']);
  assert.equal(await sendTelegram('hi', { env, fetchImpl, chatId: 333333 }), true);          // one chat only, when asked
  assert.equal(calls.at(-1), 333333);
});
