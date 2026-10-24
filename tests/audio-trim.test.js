import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, LEAD, GAP, TAIL } from '../src/player.js';

const line = (id, seconds, extra = {}) => ({ id, buffer: { duration: seconds }, visemes: new Array(Math.round(seconds / 0.02)).fill(1), ...extra });

test('trimmed voice lines are shorter on the timeline, later lines slide up and the head trim cuts the lip-sync with it', () => {
  const plain = buildTimeline([line('a', 4), line('b', 2)]);
  assert.equal(plain.clips[0].end - plain.clips[0].start, 4); assert.equal(plain.total, LEAD + 4 + GAP + 2 + TAIL);
  const cut = buildTimeline([line('a', 4, { trimStart: 1, trimEnd: 1 }), line('b', 2)]);
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
  near(cut.clips[0].end - cut.clips[0].start, 2); near(cut.clips[1].start, LEAD + 2 + GAP);
  assert.equal(cut.clips[0].trimStart, 1); assert.equal(cut.clips[0].visemes.length, 200 - 50);
  near(cut.total, plain.total - 2);
});

test('a line can never be trimmed to nothing', () => {
  const tl = buildTimeline([line('a', 1, { trimStart: 5, trimEnd: 5 })]);
  assert.ok(tl.clips[0].end - tl.clips[0].start >= 0.2); assert.ok(tl.clips[0].trimStart <= 0.8);
});
