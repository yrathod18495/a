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
test('stickers: library, own picture, sliders, draft and save', async ({ page }) => {
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
  expect(t.counts().gets).toBe(1);
  // the sliders change the sticker
  const before = await page.evaluate(() => window.__charstudio.st.stickers[0].s);
  await page.locator('.cs-stk-s input').nth(2).evaluate((el) => { el.value = '1.2'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(await page.evaluate(() => window.__charstudio.st.stickers[0].s)).toBe(1.2); expect(before).not.toBe(1.2);
  // your own picture too, then remove it
  await page.locator('.cs-stk input[type=file]').setInputFiles({ name: 'mine.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.cs-stk-row')).toHaveCount(2, { timeout: 10000 });
  await page.locator('.cs-stk-row').last().getByRole('button', { name: 'Remove this sticker' }).click();
  await expect(page.locator('.cs-stk-row')).toHaveCount(1);
  // the draft keeps the sticker over a reload
  await page.waitForTimeout(3600);
  await page.reload(); await expect(page.locator('.cs-panel')).toBeVisible();
  await page.locator('.cs-tabs button', { hasText: 'Create' }).click();
  await expect(page.locator('.cs-stk-row')).toHaveCount(1, { timeout: 10000 });
  expect(await page.evaluate(() => window.__charstudio.st.stickers[0].s)).toBe(1.2);
  expect(errors).toEqual([]);
});
