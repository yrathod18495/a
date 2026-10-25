import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_GRADE, GRADE_CONTROLS, GRADE_PRESETS, cleanGrade, gradeActive, presetGrade, presetOf, hexToRgb, gradeAt } from '../shared/color-grade.js';

test('the neutral grade changes nothing and any edited control switches the grade pass on', () => {
  assert.equal(gradeActive(DEFAULT_GRADE), false); assert.equal(gradeActive(null), false);
  for (const c of GRADE_CONTROLS) assert.equal(gradeActive({ ...DEFAULT_GRADE, [c.key]: c.neutral + (c.max - c.neutral) / 2 }), true, c.key);
});

test('cleanGrade clamps, drops junk and keeps a valid tint colour only', () => {
  const g = cleanGrade({ brightness: 9, contrast: 'x', hue: -999, tint: 'red', evil: 1 });
  assert.equal(g.brightness, 2); assert.equal(g.contrast, 0); assert.equal(g.hue, -180); assert.equal(g.tint, '#ffffff'); assert.equal('evil' in g, false);
  assert.equal(cleanGrade({ tint: '#FFB86B' }).tint, '#ffb86b');
});

test('every preset is valid, Normal is neutral and the others change the picture', () => {
  for (const p of GRADE_PRESETS) assert.equal(gradeActive(presetGrade(p.id)), p.id !== 'normal', p.id);
  assert.equal(presetOf(presetGrade('vintage')), 'vintage'); assert.equal(presetOf(DEFAULT_GRADE), 'normal'); assert.equal(presetOf({ ...DEFAULT_GRADE, hue: 5 }), null);
  assert.deepEqual(hexToRgb('#ff0000'), [1, 0, 0]);
});

test('a grade keyed over time holds before / after its keys and glides between them', () => {
  const night = presetGrade('night'), day = presetGrade('normal'), keys = [{ t: 2, grade: day }, { t: 6, grade: night }];
  assert.equal(gradeAt([], 3, day), day);
  assert.equal(gradeAt(keys, 0, day).brightness, 1); assert.equal(gradeAt(keys, 9, day).brightness, night.brightness);
  const mid = gradeAt(keys, 4, day);
  assert.ok(Math.abs(mid.brightness - (1 + night.brightness) / 2) < 1e-9);
  assert.match(mid.tint, /^#[0-9a-f]{6}$/);
  assert.ok(gradeAt(keys, 3, day).brightness > mid.brightness && gradeAt(keys, 5, day).brightness < mid.brightness);
});
