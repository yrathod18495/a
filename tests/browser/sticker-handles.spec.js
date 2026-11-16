import { test, expect } from '@playwright/test';
import { deflateSync } from 'node:zlib';
// a valid 8x8 red PNG
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const PNG = (() => { const w = 8, h = 8, raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 4 + 1) + 1 + x * 4; raw[o] = 190; raw[o + 1] = 0; raw[o + 2] = 20; raw[o + 3] = 255; } const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); })();
// Character Editor stickers, end to end on a tiny fixture character: the library (thumbnails from the one cached list, the file from R2 once), a picture of your own,
// the sliders, a draft that survives a reload, and the saved character that carries its sticker page.
async function setup(page, listed) {
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.route('**/12toons/*.json', (r) => r.fulfill({ json: r.request().url().endsWith('/groups.json') ? [] : { characters: [] } }));
  let lists = 0, gets = 0;
  await page.route('**/api/studio-assets', async (r) => {
    const b = r.request().postDataJSON();
    if (b.action === 'list') { lists++; return r.fulfill({ json: { assets: listed } }); }
    if (b.action === 'get') { gets++; return r.fulfill({ json: { url: 'https://r2.fake/get/sticker', size: listed[0].size, type: 'image/png' } }); }
    return r.fulfill({ json: { assets: [] } });
  });
  const png = PNG;
  await page.context().route('https://r2.fake/**', (r) => r.fulfill({ status: 200, body: png, headers: { 'access-control-allow-origin': '*', 'content-type': 'image/png' } }));
  await page.goto('/?debug#/toons');
  return { counts: () => ({ lists, gets }), png };
}
test('stickers on the picture: only the chosen layer, drag / resize / turn with mouse and fingers, faint cut-away part', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const png = PNG;
  const listed = [{ id: 'sticker_a_1234567', type: 'sticker', name: 'Cut', category: 'Wounds', key: 'assets/' + 'd'.repeat(64), size: png.length, mime: 'image/png', access: 'free', thumb: 'data:image/webp;base64,UklGRhYAAABXRUJQVlA4TAoAAAAvAAAAAAfQ//73/w==' },
    { id: 'sticker_b_1234567', type: 'sticker', name: 'Paid mark', category: 'Marks', key: 'assets/' + 'e'.repeat(64), size: png.length, mime: 'image/png', thumb: 'data:image/webp;base64,UklGRhYAAABXRUJQVlA4TAoAAAAvAAAAAAfQ//73/w==' }];
  const t = await setup(page, listed);
  const id = await page.evaluate(async () => {
    const s = await import('/src/store.js'), { rigInfo } = await import('/src/db/info.js'), { faceDefaults } = await import('/src/rigedit.js');
    const p = await s.createProject('debug', 'character', 'Sticker test'); s.selectProject('debug', p.id);
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.fillStyle = '#d9b38c'; g.fillRect(0, 0, 64, 64);
    const image = await new Promise((r) => c.toBlob(r, 'image/png'));
    const ske = { version: '5.5', compatibleVersion: '5.5', name: 'Fixture', frameRate: 24, armature: [{ name: 'Fixture', type: 'Armature', frameRate: 24, bone: [{ name: 'root', transform: {} }], slot: [{ name: 'body', parent: 'root', displayIndex: 0 }], skin: [{ name: 'default', slot: [{ name: 'body', display: [{ name: 'body', path: 'body', type: 'image', transform: {} }] }] }], animation: [] }] };
    const def = { id: 'draft-fixture', name: 'Fixture', ske, rig: rigInfo(ske), tex: [{ json: { name: 'Fixture', imagePath: 'texture.png', width: 64, height: 64, SubTexture: [{ name: 'body', x: 0, y: 0, width: 64, height: 64 }] }, image }], anims: [] };
    await s.put('draft', { id: 'current', def, state: { hide: [], locked: [], xf: {}, attach: {}, face: faceDefaults(), skins: null, name: 'Draft', tab: 'create', zoom: 'wide' }, edits: [] });
    return p.id;
  });
  await page.goto('/?debug#/characters/' + id); await page.reload();
  await expect(page.locator('.cs-panel')).toBeVisible();
  await page.locator('.cs-tabs button', { hasText: 'Create' }).click();
  // the library shows thumbnails (one list read); the paid one is locked for a free account
  await expect(page.locator('.cs-stk-tile')).toHaveCount(2);
  await expect(page.locator('.cs-stk-tile.locked')).toHaveCount(1);
  expect(t.counts().lists).toBe(1);
  // no layer chosen yet: a clear hint, nothing is added
  await page.locator('.cs-stk-tile').first().click();
  await expect(page.locator('.cs-stk-row')).toHaveCount(0);
  // choose the layer, then the library sticker
  await page.locator('.cs-crow').first().click();
  await page.locator('.cs-stk-tile:not(.locked)').first().click();
  await expect(page.locator('.cs-stk-row')).toHaveCount(1, { timeout: 10000 });
  const st = () => page.evaluate(() => { const k = window.__charstudio.st.stickers[0]; return { x: k.x, y: k.y, s: k.s, rot: k.rot }; });
  // solo view: on by default, the picture is zoomed in on the chosen layer
  await expect(page.locator('.cs-stk-solo input')).toBeChecked();
  await expect.poll(() => page.evaluate(() => window.__charstudio.stage.userCam?.zoom || 0)).toBeGreaterThan(0.3);
  // handles are on the picture
  const box = page.locator('.cs-stk-box'); await expect(box).toBeVisible();
  await expect(page.locator('.cs-stk-h.rs')).toBeVisible(); await expect(page.locator('.cs-stk-h.rot')).toBeVisible();
  const before = await st();
  // mouse: drag the sticker
  let b = await box.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2 + 20, { steps: 6 }); await page.mouse.up();
  const moved = await st(); expect(Math.abs(moved.x - before.x) + Math.abs(moved.y - before.y)).toBeGreaterThan(1);
  expect(Math.abs(+(await page.locator('.cs-stk-s input[data-k="x"]').inputValue()) - moved.x)).toBeLessThan(1);        // the sliders follow
  // corner: resize
  const rs = await page.locator('.cs-stk-h.rs').boundingBox();
  await page.mouse.move(rs.x + rs.width / 2, rs.y + rs.height / 2); await page.mouse.down(); await page.mouse.move(rs.x + rs.width / 2 + 60, rs.y + rs.height / 2 + 60, { steps: 6 }); await page.mouse.up();
  expect((await st()).s).toBeGreaterThan(moved.s);
  // knob: turn
  const kn = await page.locator('.cs-stk-h.rot').boundingBox(), r0 = (await st()).rot;
  await page.mouse.move(kn.x + kn.width / 2, kn.y + kn.height / 2); await page.mouse.down(); await page.mouse.move(kn.x + kn.width / 2 + 80, kn.y + kn.height / 2 + 30, { steps: 6 }); await page.mouse.up();
  expect(Math.abs((await st()).rot - r0)).toBeGreaterThan(5);
  // two fingers on the sticker: resize and turn (touch pointer events)
  await page.evaluate(() => { window.__charstudio.st.stickers[0].s = 0.8; }); await page.waitForTimeout(200);
  const p0 = await st(); b = await box.boundingBox();
  await page.evaluate(({ x, y, w }) => {
    const el = document.querySelector('.cs-stk-box'), fire = (type, id, cx, cy) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: cx, clientY: cy, bubbles: true, cancelable: true, isPrimary: id === 1 }));
    const cx = x + w / 2, cy = y + w / 2;
    fire('pointerdown', 1, cx - 10, cy); fire('pointerdown', 2, cx + 10, cy);
    for (let i = 1; i <= 6; i++) { fire('pointermove', 1, cx - 10 - i * 6, cy - i * 3); fire('pointermove', 2, cx + 10 + i * 6, cy + i * 3); }
    fire('pointerup', 1, cx - 46, cy - 18); fire('pointerup', 2, cx + 46, cy + 18);
  }, { x: b.x, y: b.y, w: Math.min(b.width, b.height) });
  const p1 = await st(); expect(p1.s).toBeGreaterThan(p0.s); expect(Math.abs(p1.rot - p0.rot)).toBeGreaterThan(1);
  // the overlay canvas shows a faint blurred picture only where the sticker leaves the body part: drag far out and it appears
  const faint = () => page.evaluate(() => { const c = document.querySelector('.cs-stk-over'), g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 20 && d[i] < 200) n++; return n; });
  let best = 0;
  for (const dx of [0, 12, 24, 36, 48]) { await page.evaluate((d) => { const k = window.__charstudio.st.stickers[0]; k.s = 1; k.rot = 0; k.x = d; k.y = 32; }, dx); await page.waitForTimeout(350); best = Math.max(best, await faint()); }
  expect(best).toBeGreaterThan(50);
  await page.evaluate(() => { const k = window.__charstudio.st.stickers[0]; k.s = 1; k.rot = 25; k.x = 30; k.y = 32; }); await page.waitForTimeout(500); await page.locator('.cs-stage').screenshot({ path: '/tmp/claude-0/-home-user-a/3967a7cb-7154-561f-8d0c-7184bb9946ac/scratchpad/stk-handles.png' });
  // other tabs: the solo view is gone and the handles too
  await page.locator('.cs-tabs button', { hasText: /Start/ }).first().click();
  await expect(box).toBeHidden();
  expect(errors).toEqual([]);
});
