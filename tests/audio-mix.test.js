import test from 'node:test';
import assert from 'node:assert/strict';
import { audibleClips, envelopePoints, applyEnvelope } from '../src/audio-mix.js';

test('mute and solo decide which lines are heard', () => {
  const a = { id: 'a' }, b = { id: 'b', muted: true }, c = { id: 'c', solo: true }, d = { id: 'd' };
  assert.deepEqual(audibleClips([a, b, d]).map((x) => x.id), ['a', 'd']);                    // a muted line is silent
  assert.deepEqual(audibleClips([a, b, c, d]).map((x) => x.id), ['c']);                      // with a solo line, only the solo lines
  assert.deepEqual(audibleClips([a, { id: 'e', solo: true, muted: true }]).map((x) => x.id), []);   // muted wins over solo
});
test('the volume curve: level, fade in, fade out', () => {
  assert.deepEqual(envelopePoints({ length: 10 }), [[0, 1], [10, 1]]);                                   // untouched line
  assert.deepEqual(envelopePoints({ volume: 0.5, length: 10 }), [[0, 0.5], [10, 0.5]]);
  assert.deepEqual(envelopePoints({ fadeIn: 2, fadeOut: 3, length: 10 }), [[0, 0], [2, 1], [7, 1], [10, 0]]);
  // playback that starts in the middle of the fade-in begins part way up, and in the middle of the fade-out part way down
  assert.deepEqual(envelopePoints({ fadeIn: 2, length: 10 }, 1), [[1, 0.5], [2, 1], [10, 1]]);
  const down = envelopePoints({ fadeOut: 4, length: 10 }, 8); assert.deepEqual(down, [[8, 0.5], [10, 0]]);
  // fades that are longer than the line are shortened so they never overlap
  const pts = envelopePoints({ fadeIn: 8, fadeOut: 8, length: 10 }); assert.equal(pts[0][1], 0); assert.equal(pts.at(-1)[1], 0); assert.ok(pts.every(([x]) => x >= 0 && x <= 10));
  assert.equal(Math.max(...pts.map((p) => p[1])), 1);
});
test('applyEnvelope schedules the same curve on a GainNode', () => {
  const calls = [], gain = { gain: { setValueAtTime: (v, t) => calls.push(['set', v, t]), linearRampToValueAtTime: (v, t) => calls.push(['ramp', v, t]) } };
  applyEnvelope(gain, { start: 5, end: 15, volume: 2, fadeIn: 1, fadeOut: 2 }, 100, 0);          // played from the beginning at context time 100
  assert.deepEqual(calls, [['set', 0, 100], ['ramp', 2, 101], ['ramp', 2, 108], ['ramp', 0, 110]]);
});
