import test from 'node:test';
import assert from 'node:assert/strict';
import { presetKeys, withPreset, SHAKE } from '../shared/camera-presets.js';

const from = { zoom: 1, cx: 0.5, cy: 0.5 };
test('slow zoom in and out start where the camera is and end 35% closer / farther', () => {
  const zi = presetKeys('zoom-in', { t: 2, dur: 3, from });
  assert.deepEqual(zi.map((k) => [k.t, k.zoom]), [[2, 1], [5, 1.35]]);
  const zo = presetKeys('zoom-out', { t: 2, dur: 3, from: { zoom: 2, cx: 0.4, cy: 0.5 } });
  assert.deepEqual(zo.map((k) => [k.t, +k.zoom.toFixed(2)]), [[2, 2], [5, 1.48]]);
  assert.equal(presetKeys('zoom-out', { t: 0, dur: 1, from }).at(-1).zoom, 1);              // never below 1 (the whole picture)
  assert.equal(zi[1].cx, 0.5);                                                               // stays on the same spot
});
test('pans travel across the picture and never ask for a position the camera cannot reach', () => {
  const r = presetKeys('pan-right', { t: 0, dur: 2, from }), z = r.at(-1).zoom, half = 0.5 / z, go = r.slice(-2);
  assert.ok(z >= 1.4); assert.equal(go[0].zoom, go[1].zoom);                                  // a pan needs a zoom, it stays the same during the move
  assert.ok(Math.abs(go[0].cx - half) < 1e-3 && Math.abs(go[1].cx - (1 - half)) < 1e-3);    // from the left edge of what is reachable to the right edge
  assert.ok(go[1].cx > go[0].cx);                                                            // PAN RIGHT: the camera goes to the right (it ends further right than it starts)
  const l = presetKeys('pan-left', { t: 0, dur: 2, from }).slice(-2); assert.ok(l[0].cx > l[1].cx);       // PAN LEFT: the camera goes to the left
  const d = presetKeys('pan-down', { t: 0, dur: 2, from }).slice(-2); assert.ok(d[0].cy < d[1].cy); assert.equal(d[0].cx, 0.5);
  const u = presetKeys('pan-up', { t: 0, dur: 2, from }); assert.ok(u.at(-2).cy > u.at(-1).cy);
  assert.ok(u.every((k) => k.cy >= 0 && k.cy <= 1));
});
test('a pan starts from what the camera shows now: no jump at the playhead, a short glide into the pan position when needed', () => {
  const r = presetKeys('pan-right', { t: 3, dur: 2, from });
  assert.deepEqual(r[0], { t: 3, zoom: 1, cx: 0.5, cy: 0.5, ease: 'smooth' });              // the first point is exactly the current view
  assert.equal(r.length, 3); assert.equal(r[1].t, 3.5); assert.ok(r[1].zoom >= 1.4); assert.equal(r[2].t, 5);
  const already = presetKeys('pan-right', { t: 0, dur: 2, from: { zoom: 1.4, cx: 0.5 / 1.4, cy: 0.5 } });
  assert.equal(already.length, 2);                                                          // already at the start of the pan: just the two points
  const tilted = presetKeys('pan-right', { t: 0, dur: 2, from: { zoom: 2, cx: 0.5, cy: 0.99 } });
  assert.ok(tilted.slice(1).every((k) => k.cy <= 1 - 0.5 / 2 + 1e-9));                                // the sideways position is kept reachable
});
test('shake: many small jumps around the camera, the same for the same seed, and the camera is handed back at the end', () => {
  const to = { zoom: 1.5, cx: 0.6, cy: 0.4 }, k = presetKeys('shake', { t: 1, dur: 1, from, to, strength: 'strong', seed: 7 });
  assert.ok(k.length >= 12);
  assert.deepEqual(k[0], { t: 1, zoom: 1, cx: 0.5, cy: 0.5, ease: 'smooth' });                // starts exactly where the camera was: no jump
  assert.deepEqual([k.at(-1).zoom, k.at(-1).cx, k.at(-1).cy, k.at(-1).t], [1.5, 0.6, 0.4, 2]);   // ends exactly where it would have been
  for (const x of k.slice(1, -1)) { assert.ok(Math.abs(x.cx - 0.5) <= SHAKE.strong.amp + 1e-9 && Math.abs(x.cy - 0.5) <= SHAKE.strong.amp + 1e-9); assert.equal(x.ease, 'linear'); }
  assert.deepEqual(presetKeys('shake', { t: 1, dur: 1, from, to, strength: 'strong', seed: 7 }), k);          // repeatable
  assert.notDeepEqual(presetKeys('shake', { t: 1, dur: 1, from, to, strength: 'strong', seed: 8 }), k);
  const small = presetKeys('shake', { t: 0, dur: 1, from, strength: 'small' }), strong = presetKeys('shake', { t: 0, dur: 1, from, strength: 'strong' });
  assert.ok(Math.max(...strong.map((x) => Math.abs(x.cx - 0.5))) > Math.max(...small.map((x) => Math.abs(x.cx - 0.5))));      // stronger = bigger jumps
});
test('withPreset replaces the keys inside the preset time and keeps the others', () => {
  const existing = [{ t: 0.5, id: 'a' }, { t: 2, id: 'b' }, { t: 3, id: 'c' }, { t: 6, id: 'd' }];
  const out = withPreset(existing, [{ t: 2 }, { t: 4 }]);
  assert.deepEqual(out.map((k) => k.id ?? `new${k.t}`), ['a', 'd', 'new2', 'new4']);
});
