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
test('tracing: reference picture, pen dot to dot with curves, dot-to-dot selection, outline, smoothing', async ({ page }) => {
  test.setTimeout(240000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.stack?.slice(0, 400) || e.message));
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
  const pe = (fn, arg) => page.evaluate(([src, a]) => { const api = document.querySelector('.pe')._pe; return (0, eval)(`(${src})`)(api, a); }, [fn.toString(), arg]);
  const px = (x, y) => pe((api, [x, y]) => { const d = api.D.getContext('2d').getImageData(x, y, 1, 1).data; return [...d]; }, [x, y]);
  const sig = () => pe((api) => { const d = api.D.getContext('2d').getImageData(0, 0, api.D.width, api.D.height).data; let h = 0; for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7 + d[i + 3] * 13) | 0; return h; });
  const canvasBox = async () => page.locator('.pe-canvas').boundingBox();
  const at = async (fx, fy) => { const b = await canvasBox(), s = await pe((api) => ({ s: api.state.scale, ox: api.state.ox, oy: api.state.oy, w: api.D.width, h: api.D.height })); return { x: b.x + s.ox + s.s * s.w * fx, y: b.y + s.oy + s.s * s.h * fy }; };
  const drag = async (a, b, steps = 8) => { const p = await at(...a), q = await at(...b); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(q.x, q.y, { steps }); await page.mouse.up(); };
  // the layer row has an Edit button that opens the editor over the page
  await page.locator('.cs-crow').first().locator('.cs-edit').click();
  await expect(page.locator('.pe')).toBeVisible(); await page.waitForTimeout(300);
  const A = (fn, arg) => page.evaluate(([src, a]) => (0, eval)(`(${src})`)(document.querySelector('.pe')._pe, a), [fn.toString(), arg]);
  const box = () => page.locator('.pe-canvas').boundingBox();
  const at3 = async (fx, fy) => { const b = await box(), s = await A((api) => ({ s: api.state.scale, ox: api.state.ox, oy: api.state.oy, w: api.D.width, h: api.D.height })); return { x: b.x + s.ox + s.s * s.w * fx, y: b.y + s.oy + s.s * s.h * fy }; };
  const alphaAt = (x, y) => A((api, [x, y]) => api.D.getContext('2d').getImageData(x, y, 1, 1).data[3], [x, y]);
  // tools exist
  for (const t of ['pen', 'poly', 'ref']) await expect(page.locator(`.pe-tool[data-tool="${t}"]`)).toHaveCount(1);
  // every tool has its own mouse pointer: a pen nib, a bucket, an eyedropper, a wand, arrows, a hand; brushes show a ring of their size
  const cur = () => page.locator('.pe-canvas').evaluate((el) => el.style.cursor);
  for (const t of ['pen', 'bucket', 'dropper', 'wand', 'poly']) { await page.locator(`.pe-tool[data-tool="${t}"]`).click(); expect(await cur(), t).toContain('data:image/svg+xml'); }
  await page.locator('.pe-tool[data-tool="move"]').click(); expect(await cur()).toBe('move');
  await page.locator('.pe-tool[data-tool="hand"]').click(); expect(await cur()).toBe('grab');
  await page.locator('.pe-tool[data-tool="rect"]').click(); expect(await cur()).toBe('crosshair');
  await page.locator('.pe-tool[data-tool="brush"]').click(); const cb0 = await page.locator('.pe-canvas').boundingBox(); await page.mouse.move(cb0.x + 200, cb0.y + 200); await page.mouse.move(cb0.x + 210, cb0.y + 205);
  expect(await cur()).toBe('none'); await expect(page.locator('.pe-cursor')).toBeVisible();
  await page.locator('.pe-brush[data-style="marker"]').click(); await page.mouse.move(cb0.x + 220, cb0.y + 210); await expect(page.locator('.pe-cursor.mk')).toBeVisible();
  await page.locator('.pe-tool[data-tool="eraser"]').click(); await page.mouse.move(cb0.x + 230, cb0.y + 215); await expect(page.locator('.pe-cursor.er')).toBeVisible();
  await page.locator('.pe-tool[data-tool="brush"]').click(); await page.locator('.pe-brush[data-style="soft"]').click();
  // the Trace tab: add a reference picture; it is faint, "keep transparent" goes off, the picture opacity can be lowered
  await page.locator('.pe-ptabs button', { hasText: 'Trace' }).click();
  await page.locator('.pe-panel input[type=file]').setInputFiles({ name: 'ref.png', mimeType: 'image/png', buffer: PNG });
  await expect.poll(() => A((api) => !!api.ref)).toBe(true);
  expect(await A((api) => [api.ref.opacity, api.state.lock])).toEqual([45, false]);
  await page.locator('.pe-panel .pe-s', { hasText: 'Reference opacity' }).locator('input').evaluate((el) => { el.value = '20'; el.dispatchEvent(new Event('input', { bubbles: true })); }); expect(await A((api) => api.ref.opacity)).toBe(20);
  await page.locator('.pe-panel .pe-s', { hasText: 'My picture opacity' }).locator('input').evaluate((el) => { el.value = '35'; el.dispatchEvent(new Event('input', { bubbles: true })); }); expect(await A((api) => api.state.picOpacity)).toBe(35);
  await page.getByRole('button', { name: 'Flip' }).click(); expect(await A((api) => api.ref.flip)).toBe(true);
  await page.locator('.pe-ck', { hasText: 'Lock position' }).locator('input').check(); expect(await A((api) => api.ref.locked)).toBe(true);
  await page.locator('.pe-ck', { hasText: 'Lock position' }).locator('input').uncheck();
  await page.getByRole('button', { name: 'Move reference' }).first().click(); const c0 = await A((api) => [api.ref.cx, api.ref.cy]);
  const p = await at3(0.5, 0.5), q = await at3(0.6, 0.55); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(q.x, q.y, { steps: 5 }); await page.mouse.up();
  const c1 = await A((api) => [api.ref.cx, api.ref.cy]); expect(c1[0]).toBeGreaterThan(c0[0]);
  // erase the working picture so we can see what the pen draws
  await A((api) => { const g = api.D.getContext('2d'); g.clearRect(0, 0, api.D.width, api.D.height); api.state.picOpacity = 100; api.draw(); });
  // pen: tap three dots, close by tapping the first, stroke the line (works on an empty layer)
  await page.locator('.pe-tool[data-tool="pen"]').click(); await page.locator('.pe-opts .pe-s', { hasText: 'Line width' }).locator('input').evaluate((el) => { el.value = '6'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await A((api) => { api.state.fg = [200, 0, 0]; });
  const d1 = await at3(0.2, 0.2), d2 = await at3(0.8, 0.2), d3 = await at3(0.5, 0.8);
  await page.mouse.click(d1.x, d1.y); await page.mouse.click(d2.x, d2.y); await page.mouse.click(d3.x, d3.y); expect(await A((api) => api.pen.pts.length)).toBe(3);
  await page.mouse.click(d1.x, d1.y); expect(await A((api) => api.pen.closed)).toBe(true);
  await page.getByRole('button', { name: 'Stroke line' }).click();
  expect(await alphaAt(32, 13)).toBeGreaterThan(200);                // on the top edge of the triangle
  expect(await alphaAt(32, 32)).toBe(0);                             // the inside is not filled by a stroke
  await page.getByRole('button', { name: 'Fill shape' }).click(); expect(await alphaAt(32, 32)).toBeGreaterThan(200);
  await page.screenshot({ path: '/tmp/claude-0/-home-user-a/3967a7cb-7154-561f-8d0c-7184bb9946ac/scratchpad/pe-trace.png' });
  // dragging while tapping makes a curve; the dot can be moved; round corners makes handles; undo dot
  await page.getByRole('button', { name: 'Clear', exact: true }).click(); expect(await A((api) => api.pen.pts.length)).toBe(0);
  const e1 = await at3(0.2, 0.7), e2 = await at3(0.6, 0.7), e2b = await at3(0.75, 0.5);
  await page.mouse.click(e1.x, e1.y); await page.mouse.move(e2.x, e2.y); await page.mouse.down(); await page.mouse.move(e2b.x, e2b.y, { steps: 5 }); await page.mouse.up();
  expect(await A((api) => !!(api.pen.pts[1].o && api.pen.pts[1].i))).toBe(true);
  const before = await A((api) => api.pen.pts[1].x); await page.mouse.move(e2.x, e2.y); await page.mouse.down(); await page.mouse.move(e2.x + 30, e2.y, { steps: 4 }); await page.mouse.up(); expect(await A((api) => api.pen.pts[1].x)).toBeGreaterThan(before);
  const e3 = await at3(0.3, 0.3); await page.mouse.click(e3.x, e3.y); await page.getByRole('button', { name: 'Round corners' }).click(); expect(await A((api) => api.pen.pts.filter((q) => q.i && q.o).length)).toBeGreaterThanOrEqual(1);
  await page.getByRole('button', { name: 'Undo dot' }).click(); expect(await A((api) => api.pen.pts.length)).toBe(2);
  // the shape becomes a selection
  await A((api) => api.pen.pts.push({ x: 40, y: 10, i: null, o: null })); await page.getByRole('button', { name: 'Make selection' }).click(); expect(await A((api) => !!api.state.sel)).toBe(true);
  await A((api) => api.setSel(null));
  // dot-to-dot selection: four taps then Enter; the selection is the polygon
  await page.locator('.pe-tool[data-tool="poly"]').click();
  for (const [fx, fy] of [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5], [0.1, 0.5]]) { const t = await at3(fx, fy); await page.mouse.click(t.x, t.y); }
  expect(await A((api) => api.poly.pts.length)).toBe(4); await page.keyboard.press('Enter');
  const n = await A((api) => { let k = 0; for (const v of api.state.sel || []) if (v > 127) k++; return k; }); expect(n).toBeGreaterThan(64 * 64 * 0.12); expect(n).toBeLessThan(64 * 64 * 0.2);
  // outline of that selection
  await A((api) => { api.D.getContext('2d').clearRect(0, 0, 64, 64); }); await page.locator('.pe-ptabs button', { hasText: 'Selection' }).click();
  await page.getByRole('button', { name: 'Draw outline' }).click(); expect(await alphaAt(32, 6)).toBeGreaterThan(200); expect(await alphaAt(20, 20)).toBe(0);
  // brush smoothing: a wobbly drag makes a smoother line than the same drag without smoothing
  await A((api) => { api.setSel(null); api.D.getContext('2d').clearRect(0, 0, 64, 64); api.state.lock = false; }); await page.locator('.pe-tool[data-tool="brush"]').click();
  const wob = async () => { const pts = [[0.1, 0.5], [0.2, 0.4], [0.3, 0.6], [0.4, 0.4], [0.5, 0.6], [0.6, 0.4], [0.7, 0.6], [0.8, 0.5]]; const P = await Promise.all(pts.map((q) => at3(...q))); await page.mouse.move(P[0].x, P[0].y); await page.mouse.down(); for (const t of P.slice(1)) await page.mouse.move(t.x, t.y, { steps: 3 }); await page.mouse.up(); return A((api) => { const d = api.D.getContext('2d').getImageData(0, 0, 64, 64).data; let y0 = 64, y1 = 0; for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (d[(y * 64 + x) * 4 + 3] > 128) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return y1 - y0; }); };
  await A((api) => { api.state.smooth = 0; api.state.size = 4; }); const rough = await wob();
  await A((api) => { api.D.getContext('2d').clearRect(0, 0, 64, 64); api.state.smooth = 90; }); const smooth = await wob();
  expect(smooth).toBeLessThan(rough);
  expect(errors).toEqual([]);
});
