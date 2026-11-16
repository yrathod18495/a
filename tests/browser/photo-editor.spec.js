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
test('picture editor: brushes, fill, selections, adjustments, undo, touch, apply', async ({ page }) => {
  test.setTimeout(240000);
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
  const pe = (fn, arg) => page.evaluate(([src, a]) => { const api = document.querySelector('.pe')._pe; return (0, eval)(`(${src})`)(api, a); }, [fn.toString(), arg]);
  const px = (x, y) => pe((api, [x, y]) => { const d = api.D.getContext('2d').getImageData(x, y, 1, 1).data; return [...d]; }, [x, y]);
  const sig = () => pe((api) => { const d = api.D.getContext('2d').getImageData(0, 0, api.D.width, api.D.height).data; let h = 0; for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7 + d[i + 3] * 13) | 0; return h; });
  const canvasBox = async () => page.locator('.pe-canvas').boundingBox();
  const at = async (fx, fy) => { const b = await canvasBox(), s = await pe((api) => ({ s: api.state.scale, ox: api.state.ox, oy: api.state.oy, w: api.D.width, h: api.D.height })); return { x: b.x + s.ox + s.s * s.w * fx, y: b.y + s.oy + s.s * s.h * fy }; };
  const drag = async (a, b, steps = 8) => { const p = await at(...a), q = await at(...b); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(q.x, q.y, { steps }); await page.mouse.up(); };
  // the layer row has an Edit button that opens the editor over the page
  await page.locator('.cs-crow').first().locator('.cs-edit').click();
  await expect(page.locator('.pe')).toBeVisible(); await expect(page.locator('.pe-tool')).toHaveCount(17); await expect(page.locator('.pe-brush')).toHaveCount(14);
  await page.waitForTimeout(300);
  const start = await sig();
  const setFg = (hex) => pe((api, c) => { const v = parseInt(c.slice(1), 16); api.state.fg = [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }, hex);
  // every brush look paints something
  await setFg('#cc0000');
  for (const id of ['soft', 'hard', 'pencil', 'ink', 'marker', 'air', 'water', 'chalk', 'spray', 'hatch', 'shadow', 'light', 'burn', 'dodge']) {
    await pe((api) => { api.setTool('brush'); }); await page.locator(`.pe-brush[data-style="${id}"]`).click();
    await pe((api) => { api.state.size = 30; api.state.opacity = 100; });
    const before = await sig(); await drag([0.15, 0.3], [0.85, 0.5]); expect(await sig(), `brush ${id} changes the picture`).not.toBe(before);
  }
  expect(await pe((api) => api.state.undo.length)).toBe(14);
  // undo / redo
  const afterBrushes = await sig(); await pe((api) => api.undo()); expect(await sig()).not.toBe(afterBrushes); await pe((api) => api.redo()); expect(await sig()).toBe(afterBrushes);
  // start from a clean picture again for exact colours
  page.once('dialog', (d) => d.accept()); await page.getByRole('button', { name: 'Start again' }).click();
  await page.waitForTimeout(200);
  expect(await sig()).toBe(start);
  // hard red brush gives red; the eraser removes it again
  await setFg('#ff0000'); await page.locator('.pe-brush[data-style="hard"]').click(); await pe((api) => { api.state.size = 24; });
  await drag([0.2, 0.5], [0.8, 0.5]); const mid = await px(32, 32); expect(mid[0]).toBeGreaterThan(200); expect(mid[1]).toBeLessThan(40);
  await page.locator('.pe-tool[data-tool="eraser"]').click(); await drag([0.2, 0.5], [0.8, 0.5]); expect((await px(32, 32))[3]).toBe(0);
  await pe((api) => api.undo());
  // keep transparent areas: painting outside the erased part never fills the hole
  // magic select the red stripe, fill it blue, then the bucket and the edge shadow
  await page.locator('.pe-tool[data-tool="wand"]').click(); const c = await at(0.5, 0.5); await page.mouse.click(c.x, c.y);
  const selected = await pe((api) => { let n = 0; for (const v of api.state.sel || []) if (v > 127) n++; return n; }); expect(selected).toBeGreaterThan(100); expect(selected).toBeLessThan(64 * 64 * 0.6);
  await page.locator('.pe-ptabs button', { hasText: 'Selection' }).click(); await setFg('#0000ff'); await page.getByRole('button', { name: 'Fill colour' }).click();
  expect((await px(32, 32))[2]).toBeGreaterThan(200); expect((await px(2, 2))[2]).toBeLessThan(200);                    // blue inside, the skin colour outside
  await page.getByRole('button', { name: 'Invert', exact: true }).click(); await page.getByRole('button', { name: 'Delete', exact: true }).click();
  expect((await px(2, 2))[3]).toBe(0); expect((await px(32, 32))[3]).toBe(255);                                          // outside deleted, the stripe stays
  await page.getByRole('button', { name: 'None', exact: true }).click(); await pe((api) => api.undo()); await pe((api) => api.undo());
  await pe((api) => api.setSel(null)); await page.locator('.pe-tool[data-tool="bucket"]').click(); await setFg('#00ff00'); const b2 = await at(0.05, 0.05); await page.mouse.click(b2.x, b2.y);
  expect((await px(2, 2))[1]).toBeGreaterThan(200); expect((await px(2, 2))[0]).toBeLessThan(60);
  // rectangle / ellipse / freehand selections
  for (const [tool, expectMin] of [['rect', 300], ['ellipse', 200], ['lasso', 100]]) {
    await page.locator(`.pe-tool[data-tool="${tool}"]`).click();
    if (tool === 'lasso') { const pts = [[0.2, 0.2], [0.8, 0.25], [0.7, 0.8], [0.25, 0.75], [0.2, 0.22]].map((p) => at(...p)); const P = await Promise.all(pts); await page.mouse.move(P[0].x, P[0].y); await page.mouse.down(); for (const q of P.slice(1)) await page.mouse.move(q.x, q.y, { steps: 4 }); await page.mouse.up(); }
    else await drag([0.2, 0.2], [0.8, 0.8]);
    expect(await pe((api) => { let n = 0; for (const v of api.state.sel || []) if (v > 127) n++; return n; }), `${tool} selection`).toBeGreaterThan(expectMin);
  }
  // add / take away
  await page.locator('.pe-tool[data-tool="rect"]').click(); await page.locator('.pe-seg button', { hasText: 'Take away' }).click(); const before2 = await pe((api) => { let n = 0; for (const v of api.state.sel) if (v > 127) n++; return n; });
  await drag([0.4, 0.4], [0.6, 0.6]); expect(await pe((api) => { let n = 0; for (const v of api.state.sel) if (v > 127) n++; return n; })).toBeLessThan(before2);
  // move pixels inside a selection
  await page.locator('.pe-seg button', { hasText: 'New' }).click(); await drag([0.1, 0.1], [0.4, 0.4]);
  await setFg('#ff00ff'); await pe((api) => { const g = api.D.getContext('2d'); g.fillStyle = '#ff00ff'; g.fillRect(8, 8, 8, 8); });
  await page.locator('.pe-tool[data-tool="move"]').click(); await drag([0.18, 0.18], [0.58, 0.58]);
  const moved = await pe((api) => { const g = api.D.getContext('2d'); return { old: [...g.getImageData(10, 10, 1, 1).data], now: [...g.getImageData(10 + 25, 10 + 25, 1, 1).data] }; });
  expect(moved.now[0]).toBeGreaterThan(200); expect(moved.now[2]).toBeGreaterThan(200); expect(moved.old[1]).toBeGreaterThan(moved.old[0] === 255 && moved.old[2] === 255 ? 0 : -1);
  await page.locator('.pe-ptabs button', { hasText: 'Selection' }).click(); await page.getByRole('button', { name: 'None', exact: true }).click();
  // smudge, blur, clone and gradient change the picture
  for (const tool of ['smudge', 'blur']) { await page.locator(`.pe-tool[data-tool="${tool}"]`).click(); const s0 = await sig(); await drag([0.1, 0.3], [0.9, 0.35]); expect(await sig(), tool).not.toBe(s0); }
  await page.locator('.pe-tool[data-tool="clone"]').click(); await page.getByRole('button', { name: 'Set source' }).click(); const src = await at(0.2, 0.2); await page.mouse.click(src.x, src.y);
  const s1 = await sig(); await drag([0.6, 0.6], [0.8, 0.65]); expect(await sig(), 'clone').not.toBe(s1);
  await page.locator('.pe-tool[data-tool="gradient"]').click(); const s2 = await sig(); await drag([0.1, 0.1], [0.9, 0.9]); expect(await sig(), 'gradient').not.toBe(s2);
  // adjust: brightness and edge shadow
  await page.locator('.pe-ptabs button', { hasText: 'Adjust' }).click();
  await page.locator('input[data-k="shSize"]').evaluate((el) => { el.value = '20'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  const edgeBefore = await px(1, 32), midBefore = await px(32, 32);
  await page.getByRole('button', { name: 'Add edge shadow' }).click();
  const edgeAfter = await px(1, 32); expect(edgeAfter[0] + edgeAfter[1] + edgeAfter[2]).toBeLessThan(edgeBefore[0] + edgeBefore[1] + edgeBefore[2]);
  await page.locator('input[data-k="bright"]').evaluate((el) => { el.value = '40'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  const lumBefore = await px(32, 20); await page.getByRole('button', { name: 'Apply brightness / contrast' }).click(); const lumAfter = await px(32, 20);
  expect(lumAfter[0] + lumAfter[1] + lumAfter[2]).toBeGreaterThan(lumBefore[0] + lumBefore[1] + lumBefore[2]);
  // two fingers zoom the picture (touch)
  const z0 = await pe((api) => api.state.scale), bx = await canvasBox();
  await page.evaluate(({ x, y }) => { const el = document.querySelector('.pe-canvas'), f = (t, id, cx, cy) => el.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: 'touch', clientX: cx, clientY: cy, bubbles: true, cancelable: true })); f('pointerdown', 11, x - 20, y); f('pointerdown', 12, x + 20, y); for (let i = 1; i <= 6; i++) { f('pointermove', 11, x - 20 - i * 8, y); f('pointermove', 12, x + 20 + i * 8, y); } f('pointerup', 11, x - 68, y); f('pointerup', 12, x + 68, y); }, { x: bx.x + bx.width / 2, y: bx.y + bx.height / 2 });
  await page.waitForTimeout(100); expect(await pe((api) => api.state.scale)).toBeGreaterThan(z0 * 1.5);
  // a fingertip draws too
  await pe((api) => { api.setTool('brush'); }); await setFg('#123456');
  const t0 = await sig(); const tp = await at(0.5, 0.2);
  await page.evaluate(({ x, y }) => { const el = document.querySelector('.pe-canvas'), f = (t, cx, cy) => el.dispatchEvent(new PointerEvent(t, { pointerId: 21, pointerType: 'touch', clientX: cx, clientY: cy, bubbles: true, cancelable: true })); f('pointerdown', x, y); for (let i = 1; i <= 6; i++) f('pointermove', x + i * 10, y); f('pointerup', x + 60, y); }, tp);
  expect(await sig()).not.toBe(t0);
  // apply: the layer's picture is the edited one
  await page.screenshot({ path: '/tmp/claude-0/-home-user-a/3967a7cb-7154-561f-8d0c-7184bb9946ac/scratchpad/pe.png' });
  await page.getByRole('button', { name: 'Apply', exact: true }).click(); await expect(page.locator('.pe')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => { const e = [...window.__charstudio.st.edit.values()][0]; return !!(e && e.img && e.img.width === 64); })).toBe(true);
  expect(errors).toEqual([]);
});
