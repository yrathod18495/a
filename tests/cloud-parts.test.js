import test from 'node:test';
import assert from 'node:assert/strict';
import { initParts, claimPart, beatParts, finishPart, partsSummary, hasFreeParts, PART_LEASE_MS } from '../server/cloud-export-store.js';
// a store that behaves like the Realtime Database: the first call of a transaction gets null, `undefined` aborts, anything else is checked against the real value and the function is called again with it
const makeStore = () => { const data = new Map(); return { data, transact: async (path, fn) => {
  const real = data.has(path) ? structuredClone(data.get(path)) : null; let next = fn(null);
  if (next === undefined) return { committed: false, value: real };
  if (real !== null) { next = fn(real); if (next === undefined) return { committed: false, value: real }; }
  if (next === null) data.delete(path); else data.set(path, structuredClone(next));
  return { committed: true, value: next }; } }; };
const slices = [{ id: 0, from: 0, to: 160 }, { id: 1, from: 160, to: 320 }, { id: 2, from: 320, to: 400 }];

test('exactly one machine becomes the leader', async () => {
  const s = makeStore();
  const first = await initParts(s, 'u', 'j', { frames: 400, fps: 40, slices });
  const second = await initParts(s, 'u', 'j', { frames: 400, fps: 40, slices });
  assert.equal(first.leader, true); assert.equal(second.leader, false);
});
test('slices are handed out once each, in order, to different machines', async () => {
  const s = makeStore(); await initParts(s, 'u', 'j', { frames: 400, fps: 40, slices });
  const a = await claimPart(s, 'u', 'j', 'A', 1000), b = await claimPart(s, 'u', 'j', 'B', 1000), c = await claimPart(s, 'u', 'j', 'A', 1000), d = await claimPart(s, 'u', 'j', 'B', 1000);
  assert.deepEqual([a.id, b.id, c.id, d], [0, 1, 2, null]);
});
test('a slice whose machine disappeared is given to someone else after the lease; a beat keeps it', async () => {
  const s = makeStore(); await initParts(s, 'u', 'j', { frames: 400, fps: 40, slices: slices.slice(0, 1) });
  await claimPart(s, 'u', 'j', 'A', 0);
  assert.equal(await claimPart(s, 'u', 'j', 'B', PART_LEASE_MS - 1), null);
  await beatParts(s, 'u', 'j', 'A', [{ id: 0, frames: 50 }], PART_LEASE_MS - 1);                       // A is still alive
  assert.equal(await claimPart(s, 'u', 'j', 'B', PART_LEASE_MS + 5), null);
  const stolen = await claimPart(s, 'u', 'j', 'B', 2 * PART_LEASE_MS + 10);                              // A went silent
  assert.equal(stolen.id, 0);
});
test('the first hand-in wins; progress counts finished and running frames; the list says when all are done', async () => {
  const s = makeStore(); await initParts(s, 'u', 'j', { frames: 400, fps: 40, slices });
  await claimPart(s, 'u', 'j', 'A', 1); await claimPart(s, 'u', 'j', 'B', 1);
  await beatParts(s, 'u', 'j', 'B', [{ id: 1, frames: 40 }], 2);
  assert.equal((await finishPart(s, 'u', 'j', 'A', { part: 0, local: true })).accepted, true);
  assert.equal((await finishPart(s, 'u', 'j', 'B', { part: 0, size: 5 })).accepted, false);
  let sum = partsSummary(s.data.get('cloudExports/u/j/parts'));
  assert.equal(sum.done, 1); assert.equal(sum.allDone, false); assert.ok(Math.abs(sum.progress - (160 + 40) / 400) < 1e-9);
  assert.equal(hasFreeParts(s.data.get('cloudExports/u/j/parts'), 3), true);                            // slice 2 is still open
  await claimPart(s, 'u', 'j', 'A', 3);
  await finishPart(s, 'u', 'j', 'B', { part: 1, size: 9 }); await finishPart(s, 'u', 'j', 'A', { part: 2, local: true });
  sum = partsSummary(s.data.get('cloudExports/u/j/parts')); assert.equal(sum.allDone, true); assert.equal(sum.items[1].local, false); assert.equal(sum.items[1].size, 9);
});
