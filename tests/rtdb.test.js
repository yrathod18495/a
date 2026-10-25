import test from 'node:test';
import assert from 'node:assert/strict';
import { kv, hasRtdb, rtdbOf } from '../server/rtdb.js';
import { memoryRtdb } from './fake-rtdb.js';

test('kv reads, writes, updates and removes by path; empty parents disappear like in the real database', async () => {
  const store = kv({ rtdb: memoryRtdb() });
  assert.equal(await store.get('projects/u1/p1'), null);
  await store.set('projects/u1/p1', { name: 'A', revision: 1 });
  await store.update('projects/u1/p1', { revision: 2 });
  assert.deepEqual(await store.get('projects/u1/p1'), { name: 'A', revision: 2 });
  await store.remove('projects/u1/p1');
  assert.equal(await store.get('projects/u1'), null);
});

test('transact retries nothing but serialises: two increments both land, returning undefined leaves the value alone', async () => {
  const store = kv({ rtdb: memoryRtdb() });
  await Promise.all([1, 2, 3].map(() => store.transact('usage/u1', (c) => ({ bytes: (c?.bytes || 0) + 10 }))));
  assert.equal((await store.get('usage/u1')).bytes, 30);
  const skipped = await store.transact('usage/u1', () => undefined);
  assert.equal(skipped.committed, false); assert.equal(skipped.value.bytes, 30);
});

test('without FIREBASE_DATABASE_URL the helper says so in Hinglish', () => {
  assert.equal(hasRtdb({}), false);
  assert.throws(() => rtdbOf({}), (e) => e.code === 'rtdb_missing' && e.status === 503 && /Realtime Database/.test(e.message));
});
