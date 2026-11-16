import test from 'node:test';
import assert from 'node:assert/strict';
import { fxWeight, newFx } from '../shared/fx.js';
test('an effect that starts at 0:00.0 is at full strength from the very first frame', () => {
  const fx = newFx('night', { id: 'a', start: 0, end: 5, ramp: 0.3 });
  assert.equal(fxWeight(fx, 0), 1); assert.equal(fxWeight(fx, 0.01), 1); assert.equal(fxWeight(fx, 2), 1);
  assert.ok(fxWeight(fx, 4.95) < 1);                                       // the fade-out at the end still works
  const mid = newFx('night', { id: 'b', start: 1, end: 5, ramp: 0.3 });
  assert.equal(fxWeight(mid, 1), 0); assert.ok(fxWeight(mid, 1.1) > 0 && fxWeight(mid, 1.1) < 1);   // a later effect still fades in
});
