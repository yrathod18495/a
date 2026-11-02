import test from 'node:test';
import assert from 'node:assert/strict';
import { resizeClip, contentLength, snap, snapDelta, MIN_CLIP } from '../shared/timeline-edit.js';
import { sceneDuration, lineLength, emptyScene } from '../src/scenes.js';

test('dragging a clip: move, lengthen / shorten from the right, trim the head from the left', () => {
  const clip = { start: 2, dur: 8, off: 0 };
  assert.deepEqual(resizeClip({ ...clip, mode: 'move', delta: 1.234 }), { start: 3.25, dur: 8, off: 0 });
  assert.equal(resizeClip({ ...clip, mode: 'move', delta: -5 }).start, 0);
  assert.deepEqual(resizeClip({ ...clip, mode: 'right', delta: -3.02 }), { start: 2, dur: 5, off: 0 });          // 8 s → 5 s
  assert.equal(resizeClip({ ...clip, mode: 'right', delta: -50 }).dur, MIN_CLIP);
  assert.equal(resizeClip({ ...clip, mode: 'right', delta: 4 }).dur, 12);
  // trimming the head: starts later, plays from further into the animation, ends where it ended
  assert.deepEqual(resizeClip({ ...clip, mode: 'left', delta: 1.5 }), { start: 3.5, dur: 6.5, off: 1.5 });
  const trimmed = { start: 3.5, dur: 6.5, off: 1.5 };
  assert.deepEqual(resizeClip({ ...trimmed, mode: 'left', delta: -1 }), { start: 2.5, dur: 7.5, off: 0.5 });
  assert.deepEqual(resizeClip({ ...trimmed, mode: 'left', delta: -9 }), { start: 2, dur: 8, off: 0 });          // cannot go back past the animation's own start
  assert.equal(resizeClip({ ...clip, mode: 'left', delta: 99 }).dur, MIN_CLIP);                                   // never shorter than the minimum
  // a background or a prop range has no media start: the head can go back as far as 0
  assert.deepEqual(resizeClip({ start: 4, dur: 2, off: 0, mode: 'left', delta: -10, room: Infinity }), { start: 0, dur: 6, off: 0 });
  assert.equal(snap(1.23), 1.25); assert.equal(snap(1.02), 1);
});
test('a scene is as long as its clips; an empty scene is 8 s; keys only stretch', () => {
  const doc = (extra) => ({ ...emptyScene(), speakers: [{ key: 'hero', charId: 'c' }], ...extra });
  assert.equal(contentLength(emptyScene()), 8);
  assert.equal(contentLength(doc({ manual: { hero: [{ start: 0, dur: 5 }] } })), 5);                               // trimmed to 5 s → the scene is 5 s
  assert.equal(contentLength(doc({ manual: { hero: [{ start: 9, dur: 3 }] } })), 12);
  assert.equal(contentLength(doc({ manual: { hero: [{ start: 0, dur: 5 }] }, bgClips: [{ start: 3, dur: 6 }] })), 9);
  assert.equal(contentLength(doc({ props: [{ end: 4 }, { start: 1 }, {}] })), 4);                                   // props without an end do not set the length
  assert.equal(contentLength(doc({ props: [{ end: 4 }], camKeys: [{ t: 2 }] })), 4);
  assert.equal(contentLength(doc({ manual: { hero: [{ start: 0, dur: 3 }] }, camKeys: [{ t: 6 }] })), 6.5);
  assert.equal(contentLength(emptyScene()) , 8); assert.equal(contentLength({ ...emptyScene(), camKeys: [{ t: 2 }] }), 8);
  assert.equal(contentLength(doc({ solo: { hero: { bodyLen: 2.67 }, ghost: { bodyLen: 90 } } })), 2.67);
});
test('audio lines can be trimmed; the scene is as long as the trimmed lines', () => {
  assert.equal(lineLength({ duration: 6 }, {}), 6); assert.equal(lineLength({ duration: 6 }, { trimStart: 1, trimEnd: 2.5 }), 2.5); assert.equal(lineLength({ duration: 1 }, { trimStart: 5 }), 0.2);
  const audio = new Map([['a', { buffer: { duration: 4 } }], ['b', { buffer: { duration: 3 } }]]);
  const plain = { ...emptyScene(), lines: [{ id: 'a' }, { id: 'b' }] }, cut = { ...emptyScene(), lines: [{ id: 'a', trimEnd: 1.5 }, { id: 'b', trimStart: 1 }] };
  assert.equal(sceneDuration(cut, audio), sceneDuration(plain, audio) - 2.5);
});

test('snapDelta pulls the moving edges to the closest point within reach, and leaves the delta alone when nothing is near', () => {
  const points = [0, 3, 8];
  // moving a clip (1 s .. 3 s) a little: its end at 3.03 snaps to 3, so the delta shrinks by 0.03
  assert.deepEqual(snapDelta({ mode: 'move', start: 1, dur: 2, delta: 0.03, points, within: 0.1 }), { delta: 0, at: 3 });
  // the start edge can snap too (a clip 5 .. 7 moved to start at 3.04)
  assert.deepEqual(snapDelta({ mode: 'move', start: 5, dur: 2, delta: -1.96, points, within: 0.1 }), { delta: -2, at: 3 });
  // trimming the head only looks at the start; dragging the tail only at the end
  assert.equal(snapDelta({ mode: 'left', start: 2.9, dur: 2, delta: 0.06, points, within: 0.1 }).at, 3);
  assert.equal(snapDelta({ mode: 'right', start: 0, dur: 2.95, delta: 0.02, points, within: 0.1 }).at, 3);
  assert.equal(snapDelta({ mode: 'left', start: 2.9, dur: 2, delta: 1.5, points, within: 0.1 }).at, null);       // far from any point
  // outside the reach nothing changes
  assert.deepEqual(snapDelta({ mode: 'move', start: 4, dur: 1, delta: 0.3, points, within: 0.1 }), { delta: 0.3, at: null });
});
test('resizeClip with a fine step keeps a snapped position exact', () => {
  assert.equal(resizeClip({ mode: 'move', start: 1, dur: 2, delta: 2.03 - 1, step: 0.01 }).start, 2.03);
  assert.equal(resizeClip({ mode: 'move', start: 1, dur: 2, delta: 1.03 }).start, 2.05);      // the normal 0.05 grid
});
