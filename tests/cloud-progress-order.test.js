import test from 'node:test';
import assert from 'node:assert/strict';
import { applyProgress, jobPath } from '../server/cloud-export-store.js';
// behaves like the Realtime Database: the first call gets null (empty cache); returning undefined aborts, anything else is checked against the real value and the function is called again with it
const store = (initial) => { let v = initial; return { get v() { return v; }, transact: async (_p, fn) => { const first = fn(null); if (first === undefined) return; const next = fn(v); if (next !== undefined) v = next; } }; };
test('an older progress update that arrives late is ignored; the percentage never goes down', async () => {
  const s = store({ status: 'pending', progress: 0, seq: 0, secret: 'x' });
  await applyProgress(s, 'u', 'j', { phase: 'loading', seq: 1 });
  await applyProgress(s, 'u', 'j', { progress: 0.4, phase: 'rendering', seq: 3 });
  await applyProgress(s, 'u', 'j', { phase: 'preparing', seq: 2 });          // sent before #3, arrived after it
  assert.equal(s.v.phase, 'rendering'); assert.equal(s.v.progress, 0.4);
  await applyProgress(s, 'u', 'j', { progress: 0.3, phase: 'rendering', seq: 4 });
  assert.equal(s.v.progress, 0.4);
  await applyProgress(s, 'u', 'j', { progress: 0.7, phase: 'rendering', seq: 5 });
  assert.equal(s.v.progress, 0.7); assert.equal(s.v.secret, 'x'); assert.equal(jobPath('u', 'j'), 'cloudExports/u/j');
});
test('a finished job is not touched by a late progress update', async () => {
  const s = store({ status: 'done', progress: 1, seq: 9 });
  await applyProgress(s, 'u', 'j', { progress: 0.5, seq: 10 });
  assert.equal(s.v.status, 'done'); assert.equal(s.v.progress, 1);
});
