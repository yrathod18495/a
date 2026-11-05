import { test, expect } from '@playwright/test';
// An animated GIF becomes a sprite sheet (so it plays in the studio and the video); a held prop can be selected on the canvas, shows in the Props tab and on the timeline.
async function open(page, width = 1366, height = 800) {
  await page.setViewportSize({ width, height });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Gif');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  const guide = page.locator('.start-close'); if (await guide.count()) await guide.first().click();
  if (await page.locator('.panel.open').count()) await page.locator('.panel.open .sheet-close button').click();
}
// a 4 frame GIF (red, green, blue, yellow; 10 frames per second), made with the app's own encoder
const makeGif = () => page => page.evaluate(async () => {
  const { encodeFrames } = await import('/src/gifEncode.js'), size = 96, cols = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]];
  const frames = cols.map((c) => { const a = new Uint8ClampedArray(size * size * 4); for (let i = 0; i < size * size; i++) { a[i * 4] = c[0]; a[i * 4 + 1] = c[1]; a[i * 4 + 2] = c[2]; a[i * 4 + 3] = 255; } return a.buffer; });
  return [...encodeFrames(frames, { size, fps: 10 })];
});
test('an animated GIF becomes a sprite sheet with its grid and speed; a still picture is left alone', async ({ page }) => {
  await open(page);
  const bytes = await makeGif()(page);
  const r = await page.evaluate(async (arr) => {
    const { animatedToSheet } = await import('/src/animated-image.js');
    const res = await animatedToSheet(new File([new Uint8Array(arr)], 'torch.gif', { type: 'image/gif' }));
    const still = await animatedToSheet(new File([new Uint8Array(arr.slice(0, 0))], 'x.png', { type: 'image/png' }));
    if (!res) return { still: still === null, none: true };
    const bmp = await createImageBitmap(res.file), c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
    const cw = bmp.width / res.sheet.cols, ch = bmp.height / res.sheet.rows, px = (i) => [...g.getImageData(Math.floor((i % res.sheet.cols) * cw + cw / 2), Math.floor(Math.floor(i / res.sheet.cols) * ch + ch / 2), 1, 1).data].slice(0, 3);
    return { sheet: res.sheet, type: res.file.type, name: res.file.name, frameW: res.frameW, frameH: res.frameH, cells: [0, 1, 2, 3].map(px), still: still === null };
  }, bytes);
  expect(r.none).toBeUndefined();
  expect(r.sheet).toMatchObject({ cols: 2, rows: 2, frames: 4 }); expect(r.sheet.fps).toBeGreaterThan(8); expect(r.sheet.fps).toBeLessThan(12);
  expect(r.type).toBe('image/png'); expect(r.name).toBe('torch-sheet.png'); expect([r.frameW, r.frameH]).toEqual([96, 96]);
  expect(r.cells[0][0]).toBeGreaterThan(200); expect(r.cells[1][1]).toBeGreaterThan(200); expect(r.cells[2][2]).toBeGreaterThan(200); expect(r.cells[3][0]).toBeGreaterThan(200);          // the four frames are in the four cells
  expect(r.still).toBe(true);
});
test('a GIF added as an own prop plays on the stage (the picture changes with time) and keeps the shape of one frame', async ({ page }) => {
  await open(page);
  const bytes = await makeGif()(page);
  await page.evaluate(() => window.__toon.openTab('props'));
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.tile.add').first().click()]);
  await chooser.setFiles({ name: 'torch.gif', mimeType: 'image/gif', buffer: Buffer.from(bytes) });
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.length), { timeout: 15000 }).toBe(1);
  const p = await page.evaluate(() => { const q = window.__toon.S.props[0]; return { sheet: q.sheet, w: q.w, h: q.h, type: q.blob.type }; });
  expect(p.sheet).toMatchObject({ cols: 2, rows: 2 }); expect(p.type).toBe('image/png'); expect(Math.abs(p.w / p.h - 9 / 16)).toBeLessThan(0.02);          // a square frame on a 16:9 canvas
  const at = (t) => page.evaluate((time) => {
    const { stage, S } = window.__toon, q = S.props[0]; q.x = 0.5; q.y = 0.5; stage.render(time, 0, [], []);
    const c = document.createElement('canvas'); c.width = stage.out.width; c.height = stage.out.height; const g = c.getContext('2d'); g.drawImage(stage.out, 0, 0);
    return [...g.getImageData(c.width >> 1, c.height >> 1, 1, 1).data].slice(0, 3);
  }, t);
  const f0 = await at(0.01), f1 = await at(0.12), f2 = await at(0.22);
  expect(f0[0]).toBeGreaterThan(200); expect(f1[1]).toBeGreaterThan(200); expect(f2[2]).toBeGreaterThan(200);          // red, then green, then blue
});
test('a prop in a hand can be selected on the canvas, shows in the Props tab (In the scene) and on the timeline, and keeps the hand choice', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const { S, sharedBlobs, stage } = window.__toon, c = document.createElement('canvas'); c.width = 20; c.height = 60; const g = c.getContext('2d'); g.fillStyle = '#c80'; g.fillRect(6, 0, 8, 60);
    const blob = await new Promise((r) => c.toBlob(r)); sharedBlobs.set('torch', blob);
    S.sharedAssets.push({ id: 'torch', type: 'prop', name: 'Mashal', group: 'hand', access: 'free', updatedAt: '1' });
    S.speakers.push({ key: 'actor1', name: 'Asha', color: '#f00', charId: 'lib:test', visible: true }); S.order.push('actor1');
    stage.layers.push({ key: 'actor1', visible: true, arm: { getBone: () => null }, mat: [1, 0, 0, 1, 0, 0], anchor: { x: 100, y: 300 }, box: { x0: 60, x1: 140, y0: 100, y1: 300 }, anim: new Set() });
    S.sel = 'actor1'; window.__toon.openTab('handprops');
  });
  await page.locator('.hand-card').click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.length)).toBe(1);
  expect(await page.evaluate(() => window.__toon.S.props[0].attach)).toEqual({ key: 'actor1', hand: 'R' });
  // its layer is on the timeline at once
  await expect(page.locator('.lane2.prop .tclip.prop')).toHaveCount(1);
  // the Props tab still offers the hand (the character stays remembered) and lists the prop in the scene
  await page.evaluate(() => window.__toon.openTab('handprops'));
  await expect(page.locator('.in-scene .tile', { hasText: 'Mashal' })).toBeVisible(); await expect(page.locator('.hand-card')).toHaveCount(1);
  // select it on the canvas by tapping it: its box and its tools (Edit) appear
  await page.evaluate(() => { const { S } = window.__toon; S.propSel = null; S.selectedPropId = null; window.__toon.drawClipBar(); window.__toon.drawTimeline(); });
  const at = await page.evaluate(() => { const { stage, S } = window.__toon, p = S.props[0], pl = stage.propPlacement(p, 0), o = stage.out.getBoundingClientRect(); return { x: o.left + pl.cx / stage.W * o.width, y: o.top + pl.cy / stage.H * o.height }; });
  await page.mouse.click(at.x, at.y);
  expect(await page.evaluate(() => [window.__toon.S.propSel, window.__toon.S.selectedPropId])).toEqual([await page.evaluate(() => window.__toon.S.props[0].id), await page.evaluate(() => window.__toon.S.props[0].id)]);
  await expect(page.locator('.prop-sel')).toBeVisible();
});
