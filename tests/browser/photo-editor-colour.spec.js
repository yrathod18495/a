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
test('colour picker: mix any colour with the square, hue, R G B, a colour code; save it; it is offered wherever a colour is used', async ({ page }) => {
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
  await page.evaluate(async () => { const m = await import('/src/credits-badge.js'); m.setCoinUser('u-test'); m.setCoinBalance(500); });
  await page.locator('.cs-crow').first().locator('.cs-edit').click();
  await expect(page.locator('.pe')).toBeVisible(); await page.waitForTimeout(300);
  // 12toons branding and the user's Coins are in the editor header
  await expect(page.locator('.pe-head .pe-brand')).toContainText('12'); await expect(page.locator('.pe-head .pe-brand')).toContainText('toons');
  await expect(page.locator('.pe-head .credit-badge')).toBeVisible(); await expect(page.locator('.pe-head .credit-badge')).toContainText('500');
  await page.screenshot({ path: '/tmp/claude-0/-home-user-a/3967a7cb-7154-561f-8d0c-7184bb9946ac/scratchpad/pe-brand.png', clip: { x: 0, y: 0, width: 1280, height: 60 } });
  const fg = () => page.evaluate(() => document.querySelector('.pe')._pe.state.fg);
  // the "Custom colour" button is on the brush bar, on Fill, on Gradient (front and back) and on the Selection tab
  await expect(page.locator('.pe-opts .pe-cbtn')).toHaveCount(1);
  await page.locator('.pe-tool[data-tool="bucket"]').click(); await expect(page.locator('.pe-opts .pe-cbtn')).toHaveCount(1);
  await page.locator('.pe-tool[data-tool="gradient"]').click(); await expect(page.locator('.pe-opts .pe-cbtn')).toHaveCount(2);
  await page.locator('.pe-ptabs button', { hasText: 'Selection' }).click(); await expect(page.locator('.pe-panel .pe-cbtn')).toHaveCount(2);
  await page.locator('.pe-ptabs button', { hasText: 'Brushes' }).click();
  await page.locator('.pe-tool[data-tool="brush"]').click();
  await page.locator('.pe-opts .pe-cbtn').click(); await expect(page.locator('.pe-pick')).toBeVisible();
  // a colour code
  await page.locator('.pe-hex').fill('#336699'); expect(await fg()).toEqual([51, 102, 153]);
  // the red number and the red slider
  await page.locator('.pe-ch').nth(0).locator('input[type=number]').fill('200'); expect((await fg())[0]).toBe(200);
  await page.locator('.pe-ch').nth(1).locator('input[type=range]').evaluate((el) => { el.value = '10'; el.dispatchEvent(new Event('input', { bubbles: true })); }); expect((await fg())[1]).toBe(10);
  expect(await page.locator('.pe-hex').inputValue()).toBe('#c80a99');
  // the square: top-left corner is white, bottom is black, right edge is the full hue
  const sv = await page.locator('.pe-sv').boundingBox();
  await page.mouse.click(sv.x + 2, sv.y + 2); expect((await fg()).every((v) => v > 240)).toBe(true);
  await page.mouse.click(sv.x + sv.width / 2, sv.y + sv.height - 1); expect((await fg()).every((v) => v < 12)).toBe(true);
  await page.locator('.pe-hue').evaluate((el) => { el.value = '120'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.mouse.click(sv.x + sv.width - 2, sv.y + 2); const g = await fg(); expect(g[1]).toBeGreaterThan(240); expect(g[0]).toBeLessThan(20);
  // not a colour: nothing changes
  await page.locator('.pe-hex').fill('zzz'); expect(await fg()).toEqual(g);
  // the back colour
  await page.locator('.pe-pick .pe-seg button', { hasText: 'Back colour' }).click(); await page.locator('.pe-hex').fill('#112233');
  expect(await page.evaluate(() => document.querySelector('.pe')._pe.state.bg)).toEqual([17, 34, 51]);
  // save it, it is in "My colours" (also after closing and opening the editor again) and can be removed
  await page.locator('.pe-pick .pe-seg button', { hasText: 'Front colour' }).click(); await page.locator('.pe-hex').fill('#ff8800');
  await page.getByRole('button', { name: 'Save to my colours' }).click(); await expect(page.locator('.pe-pick .pe-sw[aria-label="My colour #ff8800"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Done' }).click(); await expect(page.locator('.pe-pick')).toHaveCount(0);
  await expect(page.locator('.pe-colours .pe-sw[aria-label="Colour #ff8800"]')).toHaveCount(2);                   // in the My colours row and in Recent
  expect(await page.evaluate(() => localStorage.getItem('12toons-pe-colours'))).toContain('#ff8800');
  // the colour paints: a brush stroke uses it
  await page.locator('.pe-brush[data-style="hard"]').click();
  const cb = await page.locator('.pe-canvas').boundingBox(), st = await page.evaluate(() => { const a = document.querySelector('.pe')._pe; return { s: a.state.scale, ox: a.state.ox, oy: a.state.oy, w: a.D.width, h: a.D.height }; });
  const at2 = (fx, fy) => ({ x: cb.x + st.ox + st.s * st.w * fx, y: cb.y + st.oy + st.s * st.h * fy });
  const a = at2(0.2, 0.5), b = at2(0.8, 0.5); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
  const px2 = await page.evaluate(() => [...document.querySelector('.pe')._pe.D.getContext('2d').getImageData(32, 32, 1, 1).data]); expect(px2[0]).toBeGreaterThan(240); expect(px2[1]).toBeGreaterThan(120); expect(px2[1]).toBeLessThan(150); expect(px2[2]).toBeLessThan(20);
  // Escape closes the picker first, then the editor stays
  await page.locator('.pe-opts .pe-cbtn').click(); await expect(page.locator('.pe-pick')).toBeVisible(); await page.keyboard.press('Escape'); await expect(page.locator('.pe-pick')).toHaveCount(0); await expect(page.locator('.pe')).toBeVisible();
  await page.locator('.pe-opts .pe-cbtn').click(); await page.locator('.pe-hex').fill('#cc3366'); await page.screenshot({ path: '/tmp/claude-0/-home-user-a/3967a7cb-7154-561f-8d0c-7184bb9946ac/scratchpad/pe-pick-pc.png' }); await page.keyboard.press('Escape');
  // phone size: the picker fits on the screen
  await page.setViewportSize({ width: 390, height: 760 }); await page.waitForTimeout(300);
  await page.locator('.pe-opts .pe-cbtn').click(); const r = await page.locator('.pe-pick').boundingBox(); expect(r.x).toBeGreaterThanOrEqual(0); expect(r.x + r.width).toBeLessThanOrEqual(390); expect(r.y + r.height).toBeLessThanOrEqual(760);
  await page.screenshot({ path: '/tmp/claude-0/-home-user-a/3967a7cb-7154-561f-8d0c-7184bb9946ac/scratchpad/pe-pick.png' });
  expect(errors).toEqual([]);
});
