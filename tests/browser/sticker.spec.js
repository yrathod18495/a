import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
const ZIP = process.env.CHARACTER_ZIP || '/home/user/a/deliver/dayan.zip';
// A sticker (a blood mark ...) placed on a layer shows on the character: it is drawn from its own slot on the same bone.
test('a sticker placed on a layer is drawn on the character', async ({ page }) => {
  test.skip(!existsSync(ZIP), 'needs a character ZIP (CHARACTER_ZIP)');
  test.setTimeout(120000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text().slice(0, 200)); });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug#/hub');
  const zip = readFileSync(ZIP);
  const out = await page.evaluate(async (bytes) => {
    const m = await import('/src/admin-characters.js'), { Stage } = await import('/src/db/stage.js'), R = await import('/src/rigedit.js');
    const pkg = await m.readCharacterZip(new File([new Uint8Array(bytes)], 'd.zip')); const view = pkg.manifest.views[0], def = await m.viewDef(pkg, view);
    const stage = new Stage({ maxTex: 2048 }); stage.setSize('9:16', 640); stage.fullView = false; await stage.loadCharacter(def);
    // a blood-mark picture
    const img = document.createElement('canvas'); img.width = img.height = 128; const g = img.getContext('2d'); g.fillStyle = '#b00010'; for (const [x, y, r] of [[64, 60, 34], [30, 90, 14], [98, 96, 18], [70, 20, 9], [100, 40, 11]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); } g.fillRect(58, 70, 12, 50);
    const atlas = { w: 128, h: 128, regs: { stk_a1: { x: 0, y: 0, w: 128, h: 128 } } };
    const slots = def.ske.armature[0].slot.map((s) => s.name).filter((n) => /upper_hand/.test(n));
    const slot = slots.find((n) => /^left_upper_hand$/.test(n)) || slots[0];
    const sk = def.ske.armature[0].skin[0].slot.find((x) => x.name === slot), d = sk.display[0].transform || {};
    const ske = R.patchRig(def.ske, { stickers: [{ name: 'stk_a1', slot, x: d.x || 0, y: d.y || 0, s: 1.6, rot: 0, a: 1 }] });
    const blob = await new Promise((r) => img.toBlob(r, 'image/png'));
    stage.setRig(def.id, ske, [...def.tex, { json: R.stickerAtlasJson(atlas), image: blob }]);
    const key = { page: R.STICKER_PAGE }; await stage.loadArtworkCanvas(key, img);
    const a = def.rig.animList?.find?.((x) => /walk/i.test(x.name));
    const shots = []; const res = { slot };
    for (const t of [0, 0.8]) {
      stage.setLayers([{ key: 'c', charId: def.id, artworkPages: { [R.STICKER_PAGE]: key }, skins: null, swap: null, anims: {}, clips: [], present: null, flip: false, xf: null, mask: null, maskKeys: [], maskFollow: '', slot: 0, visible: true, keys: [] }]);
      stage.render(t, 0, [], []); if (t === 0) { const L = stage.layers[0], sl = L.arm.getSlot('stk_stk_a1'); const list = []; sl && sl.collect && sl.collect(list); res.dbg = { hasSlot: !!sl, idx: L.prep.slotIndex.get('stk_stk_a1'), disp: sl && sl.displayIndex, n: list.length, cur: sl && sl.displayData && sl.displayData.name, texOk: L.tex.has('stickers.png') }; } const c = document.createElement('canvas'); c.width = stage.W; c.height = stage.H; c.getContext('2d').drawImage(stage.out, 0, 0); shots.push(c.toDataURL('image/png').split(',')[1]);
    }
    const c2 = document.createElement('canvas'); c2.width = stage.W; c2.height = stage.H; const x2 = c2.getContext('2d', { willReadFrequently: true }); x2.drawImage(stage.out, 0, 0); const px = x2.getImageData(0, 0, c2.width, c2.height).data; let red = 0; for (let i = 0; i < px.length; i += 4) if (px[i] > 150 && px[i + 1] < 40 && px[i + 2] < 50) red++;
    res.red = red; res.shots = shots; return res;
  }, Array.from(zip));
  expect(out.red).toBeGreaterThan(300);
});
