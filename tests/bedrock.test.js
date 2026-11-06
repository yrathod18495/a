import test from 'node:test';
import assert from 'node:assert/strict';
const { converse, bedrockConfigured, BEDROCK_MODEL } = await import('../server/bedrock.js');

test('Bedrock is off without a key and the error is plain English', async () => {
  delete process.env.AWS_BEARER_TOKEN_BEDROCK;
  assert.equal(bedrockConfigured(), false);
  await assert.rejects(converse({ user: 'hi' }), (e) => e.status === 503 && /not set up/.test(e.message));
});

test('Converse request is built correctly and the text is returned', async () => {
  process.env.AWS_BEARER_TOKEN_BEDROCK = 'test-key'; process.env.BEDROCK_REGION = 'ap-south-1';
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init, body: JSON.parse(init.body) }; return { ok: true, status: 200, json: async () => ({ output: { message: { content: [{ text: '{"ok":1}' }] } } }) }; };
  assert.equal(await converse({ system: 'be brief', user: 'go', json: true, fetchImpl }), '{"ok":1}');
  assert.equal(seen.url, 'https://bedrock-runtime.ap-south-1.amazonaws.com/model/global.anthropic.claude-haiku-4-5-20251001-v1%3A0/converse');
  assert.equal(seen.init.headers.Authorization, 'Bearer test-key');
  assert.match(seen.body.system[0].text, /JSON object only/);
  assert.equal(seen.body.messages[0].content[0].text, 'go');
  assert.equal(BEDROCK_MODEL(), 'global.anthropic.claude-haiku-4-5-20251001-v1:0');
});

test('throttling and failures become friendly errors; the key is never in them', async () => {
  process.env.AWS_BEARER_TOKEN_BEDROCK = 'secret-key-123';
  const mk = (status, data) => async () => ({ ok: status < 300, status, json: async () => data });
  await assert.rejects(converse({ user: 'x', fetchImpl: mk(429, {}) }), (e) => e.status === 429);
  await assert.rejects(converse({ user: 'x', fetchImpl: mk(500, { message: 'boom secret-key-123' }) }), (e) => e.status === 502 && !/secret-key/.test(e.message));
  await assert.rejects(converse({ user: 'x', fetchImpl: mk(200, { output: { message: { content: [] } } }) }), (e) => e.code === 'ai_empty');
  await assert.rejects(converse({ user: '', fetchImpl: mk(200, {}) }), (e) => e.code === 'invalid_prompt');
});
