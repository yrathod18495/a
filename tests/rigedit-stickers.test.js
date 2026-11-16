import test from 'node:test';
import assert from 'node:assert/strict';
import { addStickers, bakeSke, stickerAtlasJson, STICKER_PAGE } from '../src/rigedit.js';

const ske = () => ({ armature: [{ name: 'A', bone: [{ name: 'root', transform: {} }, { name: 'arm', parent: 'root', transform: {} }], slot: [{ name: 'body', parent: 'root', displayIndex: 0 }, { name: 'sleeve', parent: 'arm', displayIndex: 0 }, { name: 'head', parent: 'root', displayIndex: 0 }],
  skin: [{ name: 'default', slot: [{ name: 'sleeve', display: [{ name: 'sleeve', type: 'image', transform: { x: 5, y: 6 } }] }] }, { name: 'Saree', slot: [] }], animation: [] }] });
const stk = [{ name: 'stk_a1', slot: 'sleeve', x: 5, y: 6, s: 1.5, rot: 20, a: 0.8 }];

test('a sticker is a new slot right above the layer it was put on, on the same bone, with its own picture, size, turn and opacity', () => {
  const out = addStickers(ske(), stk).armature[0];
  assert.deepEqual(out.slot.map((x) => x.name), ['body', 'sleeve', 'stk_stk_a1', 'head']);
  const slot = out.slot[2]; assert.equal(slot.parent, 'arm'); assert.equal(slot.displayIndex, 0); assert.equal(slot.color.aM, 80);
  const d = out.skin[0].slot.find((x) => x.name === 'stk_stk_a1').display[0];
  assert.deepEqual([d.name, d.type, d.transform.x, d.transform.y, d.transform.scX, d.transform.skX], ['stk_a1', 'image', 5, 6, 1.5, 20]);
  assert.equal(out.skin[1].slot.length, 0);                                           // other outfits are not touched
});
test('no stickers, or a sticker on a layer that does not exist, changes nothing; the original skeleton is never modified', () => {
  const a = ske(); assert.equal(addStickers(a, []), a);
  assert.equal(addStickers(a, [{ ...stk[0], slot: 'gone' }]), a);
  addStickers(a, stk); assert.equal(a.armature[0].slot.length, 3);
});
test('the baked skeleton keeps the stickers, and the sticker page has an atlas description', () => {
  const baked = bakeSke(ske(), { stickers: stk });
  assert.ok(baked.armature[0].slot.some((x) => x.name === 'stk_stk_a1'));
  const j = stickerAtlasJson({ w: 128, h: 64, regs: { stk_a1: { x: 0, y: 0, w: 128, h: 64 } } });
  assert.deepEqual([j.imagePath, j.width, j.height, j.SubTexture[0].name], [STICKER_PAGE, 128, 64, 'stk_a1']);
});
