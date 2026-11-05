import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
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
    const { stage, S } = window.__toon, q = S.props[0]; q.x = 0.5; q.y = 0.5; stage.propClock = null; stage.render(time, 0, [], []);
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
  await expect(page.locator('.edit-dock .ed-title')).toContainText('which hand');                                  // it asks first
  expect(await page.evaluate(() => window.__toon.S.props.length)).toBe(0);
  await page.locator('.edit-dock .ed-hand[data-hand="L"]').click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.length)).toBe(1);
  expect(await page.evaluate(() => window.__toon.S.props[0].attach)).toEqual({ key: 'actor1', hand: 'L' });          // that palm
  await expect(page.locator('.edit-dock .ed-chip', { hasText: 'Forward / back' })).toBeVisible();                      // and its editor opens: forward / back, up / down, size ...
  const dock = page.locator('.edit-dock');
  await dock.locator('input[aria-label="Forward / back"]').evaluate((el) => { el.value = 20; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await dock.locator('.ed-chip', { hasText: 'Up / down' }).click();
  await dock.locator('input[aria-label="Up / down"]').evaluate((el) => { el.value = -10; el.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(await page.evaluate(() => window.__toon.S.props[0].holdOff)).toEqual({ x: 0.2, y: -0.1 });
  await dock.locator('.ed-chip[data-hand="R"]').click();
  expect(await page.evaluate(() => window.__toon.S.props[0].attach.hand)).toBe('R');                                    // the hand can be changed
  await dock.getByRole('button', { name: 'Done' }).click();
  // its layer is on the timeline at once
  await expect(page.locator('.lane2.prop .tclip.prop')).toHaveCount(1);
  // the Props tab still offers the hand (the character stays remembered) and lists the prop in the scene
  await page.evaluate(() => window.__toon.openTab('handprops'));
  await expect(page.locator('.in-scene .tile', { hasText: 'Mashal' })).toBeVisible(); await expect(page.locator('.hand-card')).toHaveCount(1);
  // select it on the canvas by tapping it: its box and its tools (Edit) appear
  await page.evaluate(() => { const { S } = window.__toon; S.propSel = null; S.selectedPropId = null; window.__toon.drawClipBar(); window.__toon.drawTimeline(); });
  const at = await page.evaluate(() => { const { stage, S } = window.__toon, p = S.props[0], pl = stage.propPlacement(p, 0), o = stage.out.getBoundingClientRect(); return { x: o.left + pl.cx / stage.W * o.width, y: o.top + pl.cy / stage.H * o.height }; });
  // dragging it on the picture moves it relative to the hand (forward / back / up / down)
  const before = await page.evaluate(() => ({ ...window.__toon.S.props[0].holdOff }));
  await page.mouse.move(at.x, at.y); await page.mouse.down(); await page.mouse.move(at.x + 40, at.y - 20, { steps: 5 }); await page.mouse.up();
  const moved = await page.evaluate(() => ({ ...window.__toon.S.props[0].holdOff }));
  expect(moved.x).toBeGreaterThan(before.x); expect(moved.y).toBeGreaterThan(before.y);
  await page.mouse.click(at.x, at.y);
  expect(await page.evaluate(() => [window.__toon.S.propSel, window.__toon.S.selectedPropId])).toEqual([await page.evaluate(() => window.__toon.S.props[0].id), await page.evaluate(() => window.__toon.S.props[0].id)]);
  await expect(page.locator('.prop-sel')).toBeVisible();
});

test('the Props tab lists the hand props even when no character is selected; a tap asks the character (if there are several) and then the hand', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const { S, sharedBlobs, stage } = window.__toon, c = document.createElement('canvas'); c.width = c.height = 8; const g = c.getContext('2d'); g.fillStyle = '#c80'; g.fillRect(0, 0, 8, 8);
    sharedBlobs.set('torch', await new Promise((r) => c.toBlob(r)));
    S.sharedAssets.push({ id: 'torch', type: 'prop', name: 'Mashal', group: 'hand', access: 'free', updatedAt: '1' });
    for (const [key, name] of [['actor1', 'Asha'], ['actor2', 'Ravi']]) { S.speakers.push({ key, name, color: '#f00', charId: 'lib:test', visible: true }); S.order.push(key); stage.layers.push({ key, visible: true, arm: { getBone: () => null }, mat: [1, 0, 0, 1, 0, 0], anchor: { x: 100, y: 300 }, box: { x0: 60, x1: 140, y0: 100, y1: 300 }, anim: new Set() }); }
    S.sel = null; S.handHolder = null; window.__toon.openTab('handprops');
  });
  await expect(page.locator('.hand-card', { hasText: 'Mashal' })).toBeVisible();          // shown with nobody selected
  await page.locator('.hand-card').click();
  await expect(page.locator('.edit-dock .ed-who')).toHaveCount(2);                          // which character?
  await page.locator('.edit-dock .ed-who[data-who="actor2"]').click();
  await expect(page.locator('.edit-dock .ed-title')).toContainText('Ravi');
  await page.locator('.edit-dock .ed-hand[data-hand="R"]').click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props[0]?.attach)).toEqual({ key: 'actor2', hand: 'R' });
});

test('wide screen: the selected character\'s bar is in the side panel, so the canvas keeps its size when a character is picked and dropped', async ({ page }) => {
  await open(page, 1366, 800);
  await page.evaluate(() => {
    const { S, stage } = window.__toon;
    S.speakers.push({ key: 'actor1', name: 'Asha', color: '#f00', charId: 'lib:test', visible: true }); S.order.push('actor1');
    stage.layers.push({ key: 'actor1', visible: true, mul: 1, arm: { getBone: () => null }, mat: [1, 0, 0, 1, 0, 0], anchor: { x: 100, y: 300 }, box: { x0: 60, x1: 140, y0: 100, y1: 300 }, anim: new Set() });
    window.__toon.openTab('handprops');
  });
  const size = () => page.locator('.stagebox').boundingBox();
  const before = await size();
  await page.evaluate(() => window.__toon.openCharTool('actor1', 'handprops'));
  await expect(page.locator('.panel .selbar')).toBeVisible();                                       // in the side panel ...
  const after = await size(); expect(Math.abs(after.height - before.height)).toBeLessThan(2); expect(Math.abs(after.width - before.width)).toBeLessThan(2);          // ... the canvas did not change
  await page.evaluate(() => { window.__toon.S.sel = null; window.__toon.S.dirty = true; window.__toon.openTab('handprops'); });
  const dropped = await size(); expect(Math.abs(dropped.height - before.height)).toBeLessThan(2);
});

test('an animated prop keeps playing in the editor while the timeline is paused, and stops being live when it is hidden', async ({ page }) => {
  await open(page);
  const bytes = await makeGif()(page);
  await page.evaluate(() => window.__toon.openTab('props'));
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.tile.add').first().click()]);
  await chooser.setFiles({ name: 'torch.gif', mimeType: 'image/gif', buffer: Buffer.from(bytes) });
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.length), { timeout: 15000 }).toBe(1);
  await page.evaluate(() => { const T = window.__toon; T.S.props[0].x = 0.5; T.S.props[0].y = 0.5; T.S.props[0].w = 0.3; T.S.props[0].h = 0.5; T.S.propSel = null; T.S.selectedPropId = null; T.S.dirty = true; });
  expect(await page.evaluate(() => window.__toon.player?.playing ?? false)).toBe(false);          // paused
  const seen = new Set();
  for (let i = 0; i < 8; i++) { await page.waitForTimeout(110); seen.add(createHash('md5').update(await page.locator('.stagewrap canvas').screenshot()).digest('hex')); }
  expect(seen.size).toBeGreaterThan(2);                                                            // the picture changed several times with nobody pressing Play
});
