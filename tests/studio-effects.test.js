import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanAssetMeta, sheetUv, propFromAsset, propActive, isEffect, EFFECT_BLENDS } from '../shared/studio-effects.js';

test('effect metadata is cleaned and validated', () => {
  assert.deepEqual(cleanAssetMeta('prop', { category: '  Furniture  ' }), { category: 'Furniture' });
  assert.deepEqual(cleanAssetMeta('effect', {}), { blend: 'normal', placement: 'full', opacity: 1 });
  const meta = cleanAssetMeta('effect', { blend: 'screen', placement: 'sticker', opacity: 5, sheet: { cols: 4, rows: 2, fps: 12 }, category: 'Light' });
  assert.deepEqual(meta, { category: 'Light', blend: 'screen', placement: 'sticker', opacity: 1, sheet: { cols: 4, rows: 2, fps: 12 } });
  for (const bad of [{ blend: 'multiply2' }, { placement: 'corner' }, { sheet: { cols: 1, rows: 1, fps: 10 } }, { sheet: { cols: 20, rows: 2, fps: 10 } }, { sheet: { cols: 2, rows: 2, fps: 0 } }, { thumb: 'javascript:alert(1)' }, { thumb: 'data:image/svg+xml;base64,AAAA' }])
    assert.throws(() => cleanAssetMeta('effect', bad), /sahi/);
  assert.throws(() => cleanAssetMeta('prop', { thumb: 'data:image/webp;base64,' + 'A'.repeat(9100) }), /Thumbnail/);
  assert.equal(cleanAssetMeta('prop', { thumb: 'data:image/webp;base64,AAAA' }).thumb, 'data:image/webp;base64,AAAA');
  assert.deepEqual(Object.keys(EFFECT_BLENDS), ['normal', 'add', 'screen']);
});
test('a sprite sheet plays its frames in order and loops', () => {
  const sheet = { cols: 4, rows: 2, fps: 8 };
  assert.deepEqual(sheetUv(null, 3), [0, 0, 1, 1]);
  assert.deepEqual(sheetUv(sheet, 0), [0, 0, 0.25, 0.5]);
  assert.deepEqual(sheetUv(sheet, 3 / 8 + 0.001), [0.75, 0, 1, 0.5]);
  assert.deepEqual(sheetUv(sheet, 4 / 8 + 0.001), [0, 0.5, 0.25, 1]);
  assert.deepEqual(sheetUv(sheet, 1 + 0.001), sheetUv(sheet, 0));
});
test('library assets become scene props; effects cover the frame', () => {
  const prop = propFromAsset({ id: 'a1', type: 'prop', name: 'Chair', category: 'Furniture' }, 'blob', 'p1');
  assert.deepEqual([prop.kind, prop.w, prop.h, prop.category, isEffect(prop)], ['prop', 0.18, 0.18, 'Furniture', false]);
  const effect = propFromAsset({ id: 'e1', type: 'effect', name: 'Rain', blend: 'screen', opacity: 0.6, sheet: { cols: 2, rows: 2, fps: 6 } }, 'blob', 'p2');
  assert.deepEqual([effect.kind, effect.x, effect.y, effect.w, effect.h, effect.blend, effect.opacity, isEffect(effect)], ['effect', 0.5, 0.5, 1, 1, 'screen', 0.6, true]);
  assert.deepEqual(effect.sheet, { cols: 2, rows: 2, fps: 6 });
  const sticker = propFromAsset({ id: 'e2', type: 'effect', name: 'Spark', placement: 'sticker' }, 'blob', 'p3');
  assert.deepEqual([sticker.w, sticker.h], [0.3, 0.3]);
});
test('props and effects can be limited to a time range', () => {
  const prop = { visible: true, start: 2, end: 5 };
  assert.deepEqual([1.9, 2, 4.99, 5].map((t) => propActive(prop, t)), [false, true, true, false]);
  assert.equal(propActive({ visible: true }, 100), true);
  assert.equal(propActive({ visible: false }, 1), false);
});
