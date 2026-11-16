import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
const ZIP = process.env.CHARACTER_ZIP || '/home/user/a/deliver/dayan.zip';
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const PNG = (() => { const w = 64, h = 64, raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 4 + 1) + 1 + x * 4; raw[o] = 255; raw[o + 1] = 0; raw[o + 2] = 0; raw[o + 3] = 255; } const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); })();
// A real character: choosing a layer hides all the others, the handles sit exactly on the drawn sticker, and a drag moves it.
test('real character: only the chosen layer shows; the handles sit on the sticker; dragging moves it', async ({ page }) => {
  test.skip(!existsSync(ZIP), 'needs a character ZIP (CHARACTER_ZIP)');
  test.setTimeout(180000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.route('**/api/studio-assets', (r) => r.fulfill({ json: { assets: [] } }));
  await page.route('**/12toons/*.json', (r) => r.fulfill({ json: r.request().url().endsWith('/groups.json') ? [] : { characters: [] } }));
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.goto('/?debug#/toons');
  const zip = readFileSync(ZIP);
  const id = await page.evaluate(async (bytes) => {
    const s = await import('/src/store.js'), m = await import('/src/admin-characters.js'), { faceDefaults } = await import('/src/rigedit.js');
    const p = await s.createProject('debug', 'character', 'Real'); s.selectProject('debug', p.id);
    const pkg = await m.readCharacterZip(new File([new Uint8Array(bytes)], 'd.zip')), def = await m.viewDef(pkg, pkg.manifest.views[0]);
    await s.put('draft', { id: 'current', def, state: { hide: [], locked: [], xf: {}, attach: {}, face: faceDefaults(), skins: null, name: 'Draft', tab: 'create', zoom: 'wide' }, edits: [] });
    return p.id;
  }, Array.from(zip));
  await page.goto('/?debug#/characters/' + id); await page.reload();
  await expect(page.locator('.cs-panel')).toBeVisible({ timeout: 30000 });
  await page.locator('.cs-tabs button', { hasText: 'Create' }).click();
  const row = page.locator('.cs-crow', { hasText: /upper.?hand|upper.?arm/i }).first();
  await row.scrollIntoViewIfNeeded(); await row.click();
  await page.locator('.cs-stk input[type=file]').setInputFiles({ name: 'mark.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('.cs-stk-row')).toHaveCount(1, { timeout: 30000 });
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => { const L = window.__charstudio.stage.layers[0]; return { hidden: L.hide.size, slots: L.arm.getSlots().length, zoom: window.__charstudio.stage.userCam?.zoom }; });
  expect(info.hidden).toBeGreaterThan(info.slots / 2);           // every other layer is hidden
  expect(info.zoom).toBeGreaterThan(1.5);                         // and the layer fills the picture
  // the red sticker pixels and the handle box are in the same place
  const where = await page.evaluate(() => {
    const st = window.__charstudio.stage; st.render(performance.now() / 1000, 0, [], [{ start: 0, end: 1e9, speaker: 'c', type: 'wide', focus: 'auto' }]); const c = document.createElement('canvas'); c.width = st.W; c.height = st.H; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(st.out, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; let sx = 0, sy = 0, n = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const i = (y * c.width + x) * 4; if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) { sx += x; sy += y; n++; } }
    const r = st.out.getBoundingClientRect(), b = document.querySelector('.cs-stk-box').getBoundingClientRect();
    return { n, cx: r.left + (sx / n) * r.width / st.W, cy: r.top + (sy / n) * r.height / st.H, bx: b.left + b.width / 2, by: b.top + b.height / 2, bw: b.width };
  });
  await page.locator('.cs-stage').screenshot({ path: '/tmp/claude-0/-home-user-a/3967a7cb-7154-561f-8d0c-7184bb9946ac/scratchpad/stk-real.png' });
  expect(where.n).toBeGreaterThan(100);
  expect(Math.hypot(where.cx - where.bx, where.cy - where.by)).toBeLessThan(Math.max(30, where.bw * 0.35));
  await page.locator('.cs-stage').screenshot({ path: '/tmp/claude-0/-home-user-a/3967a7cb-7154-561f-8d0c-7184bb9946ac/scratchpad/stk-real.png' });
  const before = await page.evaluate(() => ({ x: window.__charstudio.st.stickers[0].x, y: window.__charstudio.st.stickers[0].y }));
  await page.mouse.move(where.bx, where.by); await page.mouse.down(); await page.mouse.move(where.bx + 50, where.by + 30, { steps: 8 }); await page.mouse.up();
  const after = await page.evaluate(() => ({ x: window.__charstudio.st.stickers[0].x, y: window.__charstudio.st.stickers[0].y }));
  expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeGreaterThan(3);
  // unchecking the solo view brings the whole character back
  await page.locator('.cs-stk-solo input').uncheck();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__charstudio.stage.layers[0].hide.size)).toBe(0);
  expect(errors).toEqual([]);
});
