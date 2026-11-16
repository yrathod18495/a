import test from 'node:test';
import assert from 'node:assert/strict';
import { floodMask, combineMask, invertMask, maskCount, growMask, blurMask, blurRGBA, adjustBrightnessContrast, adjustHSL, fillMask, clearMask, edgeShadow, maskEdge, blurFilter } from '../src/photo-tools.js';
const px = (w, h, f) => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(f(x, y), (y * w + x) * 4); return d; };
// a 10 x 10 picture: red left half, blue right half, a see-through column at x = 9
const pic = px(10, 10, (x) => (x === 9 ? [0, 0, 0, 0] : x < 5 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
test('magic wand picks the like-coloured connected area', () => {
  const m = floodMask(pic, 10, 10, 1, 1, 10, true);
  assert.equal(maskCount(m), 50); assert.equal(m[0 * 10 + 4], 255); assert.equal(m[0 * 10 + 5], 0);
  assert.equal(maskCount(floodMask(pic, 10, 10, 7, 3, 10, true)), 40);                  // blue, without the see-through column
  assert.equal(maskCount(floodMask(pic, 10, 10, 9, 3, 10, true)), 10);                  // the see-through column
  assert.equal(maskCount(floodMask(pic, 10, 10, 1, 1, 100, true)), 100);                // everything at full tolerance
});
test('magic wand is limited to the connected area unless "global"', () => {
  const two = px(9, 3, (x) => (x === 4 ? [0, 255, 0, 255] : [255, 0, 0, 255]));       // red | green | red
  assert.equal(maskCount(floodMask(two, 9, 3, 0, 0, 5, true)), 12); assert.equal(maskCount(floodMask(two, 9, 3, 0, 0, 5, false)), 24);
});
test('selections combine', () => {
  const a = floodMask(pic, 10, 10, 1, 1, 10), b = floodMask(pic, 10, 10, 7, 3, 10);
  assert.equal(maskCount(combineMask(a, b, 'add')), 90); assert.equal(maskCount(combineMask(a, a, 'subtract')), 0); assert.equal(maskCount(combineMask(a, b, 'intersect')), 0);
  assert.equal(maskCount(invertMask(a)), 50); assert.equal(combineMask(null, a, 'add'), a);
});
test('grow and shrink a selection', () => {
  const a = floodMask(pic, 10, 10, 1, 1, 10);
  assert.ok(maskCount(growMask(a, 10, 10, 2)) > 50); assert.ok(maskCount(growMask(a, 10, 10, -2)) < 50);
});
test('fill and clear only inside the mask', () => {
  const d = Uint8ClampedArray.from(pic), m = floodMask(d, 10, 10, 1, 1, 10);
  fillMask(d, m, [0, 255, 0], 1);
  assert.deepEqual([...d.slice(0, 4)], [0, 255, 0, 255]); assert.deepEqual([...d.slice(5 * 4, 5 * 4 + 4)], [0, 0, 255, 255]);
  clearMask(d, m); assert.equal(d[3], 0); assert.equal(d[5 * 4 + 3], 255);
  const d2 = Uint8ClampedArray.from(pic); fillMask(d2, null, [9, 9, 9], 1, true);                       // "only where there is picture": the empty column stays empty
  assert.equal(d2[9 * 4 + 3], 0); assert.deepEqual([...d2.slice(0, 3)], [9, 9, 9]);
});
test('blur keeps see-through pixels free of dark fringes and spreads the colour', () => {
  const b = blurRGBA(pic, 10, 10, 1); assert.ok(b[(5 * 10 + 8) * 4 + 3] > 0 && b[(5 * 10 + 9) * 4 + 3] > 0);
  assert.ok(b[(5 * 10 + 9) * 4 + 2] > 200);                                                              // still blue, not grey
  const m = blurMask(floodMask(pic, 10, 10, 1, 1, 10), 10, 10, 2); assert.ok(m[5] > 0 && m[5] < 255);
  const d = Uint8ClampedArray.from(pic); blurFilter(d, 10, 10, 2, floodMask(pic, 10, 10, 1, 1, 10)); assert.notDeepEqual([...d.slice(4 * 4, 4 * 4 + 3)], [255, 0, 0]);
});
test('colour adjustments', () => {
  const d = Uint8ClampedArray.from([100, 100, 100, 255]); adjustBrightnessContrast(d, 20, 0); assert.ok(d[0] > 140);
  const e = Uint8ClampedArray.from([255, 0, 0, 255]); adjustHSL(e, 120, 0, 0); assert.ok(e[1] > 200 && e[0] < 60);
  const f = Uint8ClampedArray.from([200, 50, 50, 0]); adjustHSL(f, 120, 0, 0); assert.deepEqual([...f], [200, 50, 50, 0]);                // see-through pixels are left alone
});
test('edge shadow darkens the edge but not the middle', () => {
  const d = px(40, 40, () => [200, 200, 200, 255]); edgeShadow(d, 40, 40, 12, 80, [0, 0, 0]);
  assert.ok(d[(20 * 40 + 1) * 4] < d[(20 * 40 + 20) * 4]); assert.ok(d[(20 * 40 + 20) * 4] > 185);
});
test('mask edge marks the border only', () => {
  const m = new Uint8Array(25).fill(255); const e = maskEdge(m, 5, 5); assert.equal(e[12], 0); assert.equal(e[0], 1);
});
