import test from 'node:test';
import assert from 'node:assert/strict';
import { patchRig, dragToEdit, reorderSlots, worldMatrices, bakeSke } from '../src/rigedit.js';

const rig = (rotation = 0) => ({ armature: [{
  name: 'a', bone: [{ name: 'root', transform: {} }, { name: 'arm', parent: 'root', transform: { x: 50, y: 20, skX: rotation, skY: rotation } }],
  slot: [{ name: 'back', parent: 'root' }, { name: 'hand', parent: 'arm' }, { name: 'front', parent: 'root' }],
  skin: [{ name: 'default', slot: [{ name: 'hand', display: [{ type: 'image', name: 'palm', transform: { x: 3, y: 4 } }] }] }],
}] });
/** where the picture ends up in the armature (world), after the edit */
const worldOf = (ske) => { const arm = ske.armature[0], m = worldMatrices(arm).get('arm'), t = arm.skin[0].slot[0].display[0].transform; return { x: m.a * t.x + m.c * t.y + m.tx, y: m.b * t.x + m.d * t.y + m.ty }; };

test('dragging a picture on the screen moves it exactly that far, also when its bone is turned', () => {
  for (const rotation of [0, 90, 180, -35]) {
    const ske = rig(rotation), before = worldOf(ske);
    const edit = dragToEdit(ske.armature[0], 'hand', 12, -7);                        // 12 right, 7 up on the screen
    const after = worldOf(patchRig(ske, { xf: { 'hand|palm': edit } }));
    assert.ok(Math.abs(after.x - before.x - 12) < 1e-6 && Math.abs(after.y - before.y + 7) < 1e-6, `rotation ${rotation}: ${JSON.stringify(after)} from ${JSON.stringify(before)}`);
  }
});
test('forward / back changes the draw order only, and survives baking', () => {
  const slots = rig().armature[0].slot;
  assert.deepEqual(reorderSlots(slots, { back: 1 }).map((s) => s.name), ['hand', 'back', 'front']);
  assert.deepEqual(reorderSlots(slots, { back: 9 }).map((s) => s.name), ['hand', 'front', 'back']);       // cannot go past the front
  assert.deepEqual(reorderSlots(slots, { front: -1 }).map((s) => s.name), ['back', 'front', 'hand']);
  assert.deepEqual(reorderSlots(slots, { front: -9 }).map((s) => s.name), ['front', 'back', 'hand']);
  assert.deepEqual(reorderSlots(slots, {}).map((s) => s.name), ['back', 'hand', 'front']);
  assert.deepEqual(bakeSke(rig(), { order: { hand: 1 } }).armature[0].slot.map((s) => s.name), ['back', 'front', 'hand']);
  assert.equal(slots[0].name, 'back');                                                                // the template is not changed
});

test('forward / back and the choice of a picture together: both are kept', () => {
  const out = patchRig(rig(), { order: { back: 2 }, attach: { hand: 'palm' } }).armature[0].slot;
  assert.deepEqual(out.map((s) => s.name), ['hand', 'front', 'back']);
  assert.equal(out.find((s) => s.name === 'hand')._defaultAtt, 'palm');
});
