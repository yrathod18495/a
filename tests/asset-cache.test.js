import test from 'node:test';
import assert from 'node:assert/strict';
import { AssetCache } from '../src/asset-cache.js';

test('concurrent requests share a loader, failures can retry', async () => {
  const cache = new AssetCache(); let calls = 0;
  const load = async () => { calls++; return { bone: [1] }; };
  const [a, b] = await Promise.all([cache.load('walk', load), cache.load('walk', load)]);
  assert.equal(calls, 1); assert.strictEqual(a, b);
  await assert.rejects(cache.load('bad', async () => { throw Error('offline'); }));
  assert.equal(await cache.load('bad', async () => 'recovered'), 'recovered');
  assert.equal(cache.pending.size, 0);
});
test('least recently used data is evicted without invalidating active references', async () => {
  const cache = new AssetCache({ maxEntries: 2 });
  const a = await cache.load('a', async () => ({ bone: [1] }));
  await cache.load('b', async () => 'b');
  await cache.load('a', () => assert.fail('cached'));
  await cache.load('c', async () => 'c');
  assert.deepEqual([...cache.entries.keys()], ['a', 'c']);
  assert.deepEqual(a.bone, [1]);
});
test('byte budget bounds retained JSON and oversized assets are not cached', async () => {
  const cache = new AssetCache({ maxBytes: 100 });
  for (let i = 0; i < 20; i++) await cache.load(i, async () => '1234567890');
  assert.ok(cache.bytes <= 100); assert.ok(cache.entries.size <= 2);
  const value = await cache.load('large', async () => 'x'.repeat(100));
  assert.equal(value.length, 100); assert.equal(cache.entries.has('large'), false);
});
