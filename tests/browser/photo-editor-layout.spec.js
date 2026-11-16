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
test('phone and tablet layout: header fits, nothing slides sideways, the picture keeps room, zoom bar on the picture, colour picker fits', async ({ page }) => {
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
  test.setTimeout(150000);
  await page.evaluate(async () => { const m = await import('/src/credits-badge.js'); m.setCoinUser('u-test'); m.setCoinBalance(500); });
  await page.locator('.cs-crow').first().locator('.cs-edit').click(); await page.waitForTimeout(300);
  for (const [w, h] of [[360, 640], [390, 844], [412, 915], [768, 1024]]) {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(400);
    const m = await page.evaluate(() => { const r = (q) => document.querySelector(q)?.getBoundingClientRect(); const a = r('.pe-head .pri'), c = r('.pe-canvas'), z = r('.pe-zoombar'), cb = r('.pe-head .credit-badge');
      const tools = [...document.querySelectorAll('.pe-tool')];
      return { applyRight: a?.right, applyLeft: a?.left, coinsRight: cb?.right, canvasH: c?.height, zoomShown: !!z && z.width > 0, scrollW: document.querySelector('.pe').scrollWidth,
        noSlide: ['.pe-tools', '.pe-optwrap'].every((q) => { const e = document.querySelector(q); return e.scrollWidth <= e.clientWidth + 1; }) && tools.every((b) => { const x = b.getBoundingClientRect(); return x.left >= 0 && x.right <= innerWidth && x.width > 0; }) }; });
    expect(m.applyRight, `Apply fits at ${w}`).toBeLessThanOrEqual(w); expect(m.applyLeft).toBeGreaterThan(m.coinsRight);
    expect(m.canvasH, `picture area at ${w}`).toBeGreaterThan(160); expect(m.zoomShown).toBe(true); expect(m.noSlide, `nothing slides sideways at ${w}`).toBe(true); expect(m.scrollW).toBeLessThanOrEqual(w);
    await page.locator('.pe-opts .pe-cbtn, .pe-panel .pe-cbtn').first().click(); const r = await page.locator('.pe-pick').boundingBox();
    expect(r.x).toBeGreaterThanOrEqual(0); expect(r.x + r.width).toBeLessThanOrEqual(w); expect(r.y + r.height).toBeLessThanOrEqual(h); await page.keyboard.press('Escape');
    await page.screenshot({ path: `/tmp/claude-0/-home-user-a/3967a7cb-7154-561f-8d0c-7184bb9946ac/scratchpad/pel-${w}.png` });
  }
  expect(errors).toEqual([]);
});
