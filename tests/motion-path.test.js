import test from 'node:test';
import assert from 'node:assert/strict';
import { pathLength, thin, pointAt, pathKeys } from '../shared/motion-path.js';

const line = [{ x: 0.1, y: 0.2 }, { x: 0.5, y: 0.2 }, { x: 0.5, y: 0.6 }];

test('path length and the point at a share of the line', () => {
  assert.ok(Math.abs(pathLength(line) - 0.8) < 1e-9);
  assert.deepEqual(pointAt(line, 0), { x: 0.1, y: 0.2 });
  assert.ok(Math.abs(pointAt(line, 0.5).x - 0.5) < 1e-9 && Math.abs(pointAt(line, 0.5).y - 0.2) < 1e-9);
  assert.deepEqual(pointAt(line, 1), { x: 0.5, y: 0.6 });
});

test('thin keeps the first and last point and drops the crowd in between', () => {
  const dense = Array.from({ length: 200 }, (_, i) => ({ x: i / 1000, y: 0.3 }));
  const out = thin(dense, 0.01);
  assert.deepEqual(out[0], dense[0]); assert.deepEqual(out.at(-1), dense.at(-1)); assert.ok(out.length < 30);
});

test('keys run from start to end, start and end on the line, even speed, size kept', () => {
  const keys = pathKeys({ pts: line, start: 2, dur: 4, face: false }, 1.5);
  assert.equal(keys[0].t, 2); assert.equal(keys.at(-1).t, 6);
  assert.deepEqual([keys[0].x, keys[0].y], [0.1, 0.2]); assert.deepEqual([keys.at(-1).x, keys.at(-1).y], [0.5, 0.6]);
  assert.ok(keys.every((k) => k.mul === 1.5 && k.ease === 'linear' && k.pathKey));
  assert.deepEqual(pathKeys({ pts: [line[0]], start: 0, dur: 3 }), []);
});

test('the character turns to the walking direction when asked', () => {
  const left = [{ x: 0.8, y: 0.3 }, { x: 0.2, y: 0.3 }];
  assert.ok(pathKeys({ pts: left, start: 0, dur: 3, face: true }).every((k) => k.flip === true));
  const right = [{ x: 0.2, y: 0.3 }, { x: 0.8, y: 0.3 }];
  assert.ok(pathKeys({ pts: right, start: 0, dur: 3, face: true }).every((k) => k.flip === false));
  assert.ok(pathKeys({ pts: left, start: 0, dur: 3, face: false }).every((k) => k.flip === false));
});
