import test from 'node:test';
import assert from 'node:assert/strict';
import { bindAnimation } from '../src/db/prep.js';

// a draw-order key whose slots come in another order than the armature's (Maya's "both hip" does that) must be sent sorted,
// otherwise the DragonBones parser loops forever ("Invalid array length")
test('draw-order pairs are put in slot order before DragonBones reads them', () => {
  const p = { arm: { frameRate: 30, slot: [] }, ske: {}, bones: new Set(), disp: new Map(), slotIndex: new Map([['shadow', 0], ['left_hand_fx', 3], ['right_hand_fx', 9]]) };
  const out = bindAnimation(p, 'both_hip', { duration: 10, zOrder: { frame: [{ duration: 10, zOrderByName: [['right_hand_fx', 4], ['left_hand_fx', 23], ['unknown_slot', 2]] }, { duration: 0, zOrderByName: [] }] } });
  assert.deepEqual(out.zOrder.frame, [{ duration: 10, zOrder: [3, 23, 9, 4] }, { duration: 0 }]);
});
