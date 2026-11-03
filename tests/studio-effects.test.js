import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanAssetMeta, sheetUv, propFromAsset, propActive, isEffect, EFFECT_BLENDS, actualPropSize, placeProp } from '../shared/studio-effects.js';

test('effect metadata is cleaned and validated', () => {
  assert.deepEqual(cleanAssetMeta('prop', { category: '  Furniture  ' }), { category: 'Furniture' });
  assert.deepEqual(cleanAssetMeta('effect', {}), { blend: 'normal', placement: 'full', opacity: 1 });
  const meta = cleanAssetMeta('effect', { blend: 'screen', placement: 'sticker', opacity: 5, sheet: { cols: 4, rows: 2, fps: 12 }, category: 'Light' });
  assert.deepEqual(meta, { category: 'Light', blend: 'screen', placement: 'sticker', opacity: 1, sheet: { cols: 4, rows: 2, fps: 12 } });
  for (const bad of [{ blend: 'multiply2' }, { placement: 'corner' }, { sheet: { cols: 1, rows: 1, fps: 10 } }, { sheet: { cols: 20, rows: 2, fps: 10 } }, { sheet: { cols: 2, rows: 2, fps: 0 } }, { thumb: 'javascript:alert(1)' }, { thumb: 'data:image/svg+xml;base64,AAAA' }])
    assert.throws(() => cleanAssetMeta('effect', bad), /not valid|valid/);
  assert.throws(() => cleanAssetMeta('prop', { thumb: 'data:image/webp;base64,' + 'A'.repeat(9100) }), /thumbnail/i);
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

import { heldAt, heldPlacement, isHeld, HAND_BONES } from '../shared/studio-effects.js';
const layer = (mat, bones, extra = {}) => ({ mat, arm: { getBone: (name) => bones[name] ? { globalTransformMatrix: bones[name] } : null }, ...extra });
test('a held prop sits in the palm of the chosen hand and turns with it', () => {
  assert.deepEqual(HAND_BONES, { L: 'L_Palm', R: 'R_Palm' });
  assert.equal(isHeld({ attach: { key: 'a', hand: 'L' } }), true);
  assert.equal(isHeld({ attach: { key: 'a', hand: 'X' } }), false);
  assert.equal(isHeld({}), false);
  const l = layer([1, 0, 0, 1, 10, 20], { L_Palm: { a: 0, b: 1, tx: 90, ty: 180 }, R_Palm: { a: 1, b: 0, tx: 300, ty: 180 } });
  const left = heldAt(l, 'L');                       // character space → canvas pixels (+10, +20); the hand hangs down
  assert.deepEqual([left.x, left.y, left.mirrored], [100, 200, false]);
  assert.ok(Math.abs(left.angle - Math.PI / 2) < 1e-9);
  assert.equal(heldAt(l, 'R').angle, 0);
  // an upright prop (rotation −90° offset, grip at its bottom) stands in a hanging hand
  const at = heldPlacement({ rotation: -90, grip: { x: 0.5, y: 1 } }, left, 10, 100);
  assert.ok(Math.abs(at.cx - 100) < 1e-9 && Math.abs(at.cy - 150) < 1e-9 && Math.abs(at.angle) < 1e-9);
  // turning off "follow the hand" keeps the prop's own rotation
  assert.ok(Math.abs(heldPlacement({ follow: false, rotation: 30 }, left, 10, 10).angle - Math.PI / 6) < 1e-9);
});
test('a mirrored character mirrors the held prop; an absent or hidden character does not draw it', () => {
  const mirrored = layer([-1, 0, 0, 1, 500, 0], { L_Palm: { a: 0, b: 1, tx: 100, ty: 200 } });
  const held = heldAt(mirrored, 'L');
  assert.deepEqual([held.x, held.y, held.mirrored], [400, 200, true]);
  assert.ok(Math.abs(heldPlacement({ rotation: -90 }, held, 10, 10).angle) < 1e-9);   // still upright
  assert.equal(heldAt(layer([1, 0, 0, 1, 0, 0], {}), 'L'), null);                    // a rig without that hand
  assert.equal(heldAt(null, 'L'), 'hidden');
  assert.equal(heldAt(layer([1, 0, 0, 1, 0, 0], { L_Palm: { a: 1, b: 0, tx: 0, ty: 0 } }, { shown: false }), 'L'), 'hidden');
});

test('a prop is placed at the real size and shape of its picture, on a 4K reference canvas', () => {
  const wide = { w: 16, h: 9 }, tall = { w: 9, h: 16 };
  assert.deepEqual(actualPropSize(700, 2000, wide), { w: 0.1823, h: 0.9259 });          // a tall lamp keeps its proportions (not squeezed into a box)
  assert.deepEqual(actualPropSize(3840, 2160, wide), { w: 1, h: 1 });                   // a full 4K picture fills the canvas
  assert.deepEqual(actualPropSize(1920, 1080, wide), { w: 0.5, h: 0.5 });
  assert.deepEqual(actualPropSize(5000, 3000, wide), { w: 0.9375, h: 1 });               // bigger than the canvas: shrunk to fit, same shape
  const unfitted = actualPropSize(700, 4000, wide, { fit: false }); assert.equal(unfitted.h > 1, true);
  assert.deepEqual(actualPropSize(1080, 1920, tall), { w: 0.5, h: 0.5 });              // the reference follows the canvas shape
  const ratio = (size, canvas) => (size.w * canvas.w) / (size.h * canvas.h);
  assert.ok(Math.abs(ratio(actualPropSize(700, 2000, wide), wide) - 0.35) < 0.001);     // 700 / 2000 = the shape of the picture
  assert.deepEqual(actualPropSize(1, 1, wide), { w: 0.02, h: 0.02 });                   // never vanishing
});
test('placing a prop also keeps it inside the frame', () => {
  const lamp = placeProp({ id: 'p', kind: 'prop', x: 0.5, y: 0.66, w: 0.18, h: 0.18 }, 700, 2000, { w: 16, h: 9 });
  assert.equal(lamp.natW, 700); assert.equal(lamp.natH, 2000); assert.equal(lamp.h, 0.9259);
  assert.ok(lamp.y + lamp.h / 2 <= 1 + 1e-9 && lamp.y - lamp.h / 2 >= -1e-9);           // the tall lamp is moved up so its bottom is not cut off
  const small = placeProp({ id: 's', kind: 'prop', x: 0.5, y: 0.66, w: 0.18, h: 0.18 }, 384, 216, { w: 16, h: 9 });
  assert.equal(small.y, 0.66); assert.deepEqual([small.w, small.h], [0.1, 0.1]);          // a small one stays where it was put
  assert.equal(placeProp({ id: 'x', w: 0.18 }, 0, 0, { w: 16, h: 9 }).w, 0.18);          // an unreadable picture keeps the old default
});

test('a prop can be a hand prop; general is the default and is stored as nothing', async () => {
  const { cleanAssetMeta, isHandAsset, propFromAsset } = await import('../shared/studio-effects.js');
  assert.deepEqual(cleanAssetMeta('prop', { category: 'Tools', group: 'hand' }), { category: 'Tools', group: 'hand' });
  assert.deepEqual(cleanAssetMeta('prop', { group: 'general' }), {});
  assert.deepEqual(cleanAssetMeta('prop', {}), {});
  assert.throws(() => cleanAssetMeta('prop', { group: 'foot' }), /Hand/);
  assert.deepEqual(cleanAssetMeta('effect', { group: 'hand' }).group, undefined);
  assert.equal(isHandAsset({ type: 'prop', group: 'hand' }), true);
  assert.equal(isHandAsset({ type: 'prop' }), false);
  assert.equal(isHandAsset({ type: 'effect', group: 'hand' }), false);
  assert.equal(propFromAsset({ id: 'a', type: 'prop', name: 'Cup', group: 'hand' }, 'b', 'p').group, 'hand');
});

test('"who can use it": paid accounts only unless marked free; only free is stored; anything else is refused', async () => {
  const { cleanAssetMeta } = await import('../shared/studio-effects.js');
  const { isFreeAsset, lockedFor, PAID_MESSAGE } = await import('../shared/asset-access.js');
  assert.deepEqual(cleanAssetMeta('prop', { access: 'free' }), { access: 'free' });
  assert.deepEqual(cleanAssetMeta('prop', { access: 'paid' }), {});
  assert.deepEqual(cleanAssetMeta('background', { access: 'free', category: 'Sky' }), { category: 'Sky', access: 'free' });
  assert.equal(cleanAssetMeta('effect', { access: 'free' }).access, 'free');
  assert.throws(() => cleanAssetMeta('prop', { access: 'everyone' }), /Paid only or Free for everyone/);
  assert.equal(isFreeAsset({ access: 'free' }), true); assert.equal(isFreeAsset({}), false); assert.equal(isFreeAsset(null), false);
  // free account: locked unless marked free; paid account and admin (counted as paid): never locked; animations are not affected
  for (const type of ['prop', 'effect', 'background']) { assert.equal(lockedFor({ type }, 'free'), true); assert.equal(lockedFor({ type, access: 'free' }, 'free'), false); assert.equal(lockedFor({ type }, 'paid'), false); }
  assert.equal(lockedFor({ type: 'animation' }, 'free'), false);
  assert.equal(lockedFor(undefined, 'free'), false);
  assert.match(PAID_MESSAGE, /paid accounts/); assert.match(PAID_MESSAGE, /Buy Coins/);
});
