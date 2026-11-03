import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryFirestore } from './fake-firestore.js';
import { FEATURES, getFeatures, setFeature } from '../server/maintenance.js';

test('the hub cards an admin can switch: Animator Studio, Character Editor and Background Generator, all on until hidden', async () => {
  assert.deepEqual([...FEATURES], ['animator', 'character', 'background']);
  const db = memoryFirestore();
  assert.deepEqual(await getFeatures(db), { animator: true, character: true, background: true });
});
test('hiding the Background Generator leaves the other cards alone, and it can be turned back on', async () => {
  const db = memoryFirestore();
  assert.deepEqual(await setFeature(db, 'background', false, 'admin-1'), { animator: true, character: true, background: false });
  assert.equal(db.data.get('config/features').updatedBy, 'admin-1');
  assert.deepEqual(await getFeatures(db), { animator: true, character: true, background: false });
  assert.deepEqual(await setFeature(db, 'animator', false, 'admin-1'), { animator: false, character: true, background: false });
  assert.deepEqual(await setFeature(db, 'background', true, 'admin-1'), { animator: false, character: true, background: true });
});
test('an unknown card name is refused', async () => {
  const db = memoryFirestore();
  await assert.rejects(setFeature(db, 'payments', false, 'admin-1'), (e) => e.code === 'invalid_feature' && e.status === 400);
  assert.equal(db.data.has('config/features'), false);
});
