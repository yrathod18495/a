import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_GRADE, GRADE_CONTROLS, GRADE_PRESETS, cleanGrade, gradeActive, presetGrade, presetOf, hexToRgb } from '../shared/color-grade.js';

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
