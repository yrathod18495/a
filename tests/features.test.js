import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryFirestore } from './fake-firestore.js';
import { FEATURES, getFeatures, setFeature } from '../server/maintenance.js';
import { STUDIO_TOOLS, toolFeature } from '../shared/studio-tools.js';
const TOOLS = Object.fromEntries(STUDIO_TOOLS.map(([k]) => [toolFeature(k), true]));

test('the hub cards an admin can switch: Animator Studio, Character Editor and Background Generator, all on until hidden', async () => {
  assert.deepEqual([...FEATURES].slice(0, 3), ['animator', 'character', 'background']); assert.deepEqual([...FEATURES].slice(3), STUDIO_TOOLS.map(([k]) => toolFeature(k)));          // then every tool of the studio's tool bar
  const db = memoryFirestore();
  assert.deepEqual(await getFeatures(db), { animator: true, character: true, background: true, ...TOOLS });
});
test('hiding the Background Generator leaves the other cards alone, and it can be turned back on', async () => {
  const db = memoryFirestore();
  assert.deepEqual(await setFeature(db, 'background', false, 'admin-1'), { animator: true, character: true, background: false, ...TOOLS });
  assert.equal(db.data.get('config/features').updatedBy, 'admin-1');
  assert.deepEqual(await getFeatures(db), { animator: true, character: true, background: false, ...TOOLS });
  assert.deepEqual(await setFeature(db, 'animator', false, 'admin-1'), { animator: false, character: true, background: false, ...TOOLS });
  assert.deepEqual(await setFeature(db, 'background', true, 'admin-1'), { animator: false, character: true, background: true, ...TOOLS });
});
test('an unknown card name is refused', async () => {
  const db = memoryFirestore();
  await assert.rejects(setFeature(db, 'payments', false, 'admin-1'), (e) => e.code === 'invalid_feature' && e.status === 400);
  assert.equal(db.data.has('config/features'), false);
});

test('a studio tool (Tears, Export ...) can be switched off for users and on again, and the other tools stay on', async () => {
  const db = memoryFirestore();
  const off = await setFeature(db, 'tool_tears', false, 'admin-1');
  assert.equal(off.tool_tears, false); assert.equal(off.tool_export, true); assert.equal(off.animator, true);
  assert.equal((await getFeatures(db)).tool_tears, false);
  assert.equal((await setFeature(db, 'tool_tears', true, 'admin-1')).tool_tears, true);
  await assert.rejects(setFeature(db, 'tool_nothing', false, 'admin-1'), (e) => e.code === 'invalid_feature');
});
