import test from 'node:test';
import assert from 'node:assert/strict';
import { pathLength, thin, pointAt, pathKeys, simplify, insertAt, anchorPath } from '../shared/motion-path.js';

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

test('a path leaves the way the character faces unchanged', () => {
  const left = [{ x: 0.8, y: 0.3 }, { x: 0.2, y: 0.3 }];
  assert.ok(pathKeys({ pts: left, start: 0, dur: 3, face: true }).every((k) => k.flip === false));
  const right = [{ x: 0.2, y: 0.3 }, { x: 0.8, y: 0.3 }];
  assert.ok(pathKeys({ pts: right, start: 0, dur: 3, face: true }).every((k) => k.flip === false));
  assert.ok(pathKeys({ pts: left, start: 0, dur: 3, face: false }).every((k) => k.flip === false));
});

test('simplify keeps the ends and the shape with few points; insertAt finds the segment for a new point', () => {
  const curve = Array.from({ length: 200 }, (_, i) => ({ x: i / 199, y: 0.5 + 0.2 * Math.sin(i / 199 * Math.PI * 2) }));
  const few = simplify(curve, 10);
  assert.ok(few.length <= 10 && few.length >= 4); assert.deepEqual(few[0], curve[0]); assert.deepEqual(few.at(-1), curve.at(-1));
  assert.deepEqual(simplify(line, 12), line);
  const hit = insertAt(line, { x: 0.52, y: 0.4 });
  assert.equal(hit.index, 2); assert.ok(Math.abs(hit.point.x - 0.5) < 1e-9 && Math.abs(hit.point.y - 0.4) < 1e-9);
});

test('facing: a path never turns the character (left, right or wobbly)', () => {
  const wobble = [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.2 }, { x: 0.29, y: 0.3 }, { x: 0.5, y: 0.3 }, { x: 0.49, y: 0.2 }, { x: 0.9, y: 0.2 }];
  for (const pts of [wobble, [...wobble].reverse()]) {
    assert.ok(pathKeys({ pts, start: 0, dur: 6, face: true, flipBase: false }, 1, 'w').every((k) => k.flip === false));      // even an old path saved with "face" does not flip
    assert.ok(pathKeys({ pts, start: 0, dur: 6, flipBase: true }, 1, 'w').every((k) => k.flip === true));                  // it keeps the way the character already faces
  }
});

test('a path starts where the character stands (even half below the frame) and keeps its drawn shape', () => {
  const drawn = [{ x: 0.2, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.8, y: 0.6 }];
  const at = { x: 0.4, y: -0.1 };                                            // feet below the bottom edge: the character is only half in the picture
  const p = anchorPath(drawn, at);
  assert.deepEqual(p[0], at);                                                // starts exactly there: no jump
  assert.ok(Math.abs((p[2].x - p[0].x) - 0.6) < 1e-9 && Math.abs((p[2].y - p[0].y) - 0.1) < 1e-9);   // same distance and direction as drawn
  const keys = pathKeys({ pts: p, start: 0, dur: 3, smooth: false, flipBase: false }, 1, 'a');
  assert.ok(Math.abs(keys[0].x - 0.4) < 1e-3 && Math.abs(keys[0].y + 0.1) < 1e-3);
  assert.deepEqual(anchorPath(drawn, null), drawn);                          // unknown position: as drawn
});
