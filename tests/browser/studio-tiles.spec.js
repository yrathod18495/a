import { test, expect } from '@playwright/test';
// Props and Backgrounds are picture tiles like the animation cards: "+" first (opens the device files), then the pictures.
async function open(page, width) {
  await page.setViewportSize({ width, height: 800 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Tiles');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNkYPhfz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC', 'base64');
for (const tab of ['props', 'canvas']) test(`${tab}: the first tile is "+", it opens the device files, and tiles do not overlap (390px)`, async ({ page }) => {
  await open(page, 390);
  await page.evaluate((t) => window.__toon.openTab(t), tab);
  const add = page.locator('.tile.add').first();
  await expect(add).toBeVisible();
  const first = await page.evaluate(() => document.querySelector('.tile-grid').firstElementChild.classList.contains('add'));
  expect(first).toBe(true);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), add.click()]);
  await chooser.setFiles({ name: 'my pic.png', mimeType: 'image/png', buffer: PNG });
  // a background joins the list as a tile; a prop is placed in the scene and listed under "In scene"
  await expect(page.locator('.tile:not(.add)').first()).toBeVisible({ timeout: 15000 });
  const boxes = await page.evaluate(() => [...document.querySelectorAll('.tile')].map((e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; }));
  expect(boxes.length).toBeGreaterThanOrEqual(2);
  for (const b of boxes) { expect(b[0]).toBeGreaterThanOrEqual(0); expect(b[2]).toBeLessThanOrEqual(390); }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], c = boxes[j]; expect(a[2] <= c[0] + 0.5 || c[2] <= a[0] + 0.5 || a[3] <= c[1] + 0.5 || c[3] <= a[1] + 0.5, `tiles ${i} and ${j} overlap`).toBe(true); }
  expect(new Set(boxes.map((b) => Math.round(b[0]))).size).toBe(2);       // two columns
  await page.locator('.tile-grid').first().screenshot({ path: `/tmp/claude-0/-home-user-a/3967a7cb-7154-561f-8d0c-7184bb9946ac/scratchpad/tiles-${tab}.png` });
});

test('phone: no floating toolbar over the character; the timeline has a thick scrollbar of its own and no extra bar', async ({ page }) => {
  await open(page, 390);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.sel-tools')).display)).toBe('none');
  expect(await page.locator('.tl-slide').count()).toBe(0);
  await page.evaluate(() => { window.__toon.S.pps = 120; window.__toon.drawTimeline(); });
  // the test browser hides scrollbars, so the style is checked instead of the painted size
  const bar = await page.evaluate(() => { const t = document.querySelector('.tl-scroll'); return { h: getComputedStyle(t, '::-webkit-scrollbar').height, width: getComputedStyle(t).scrollbarWidth, room: t.scrollWidth - t.clientWidth }; });
  expect(parseFloat(bar.h)).toBeGreaterThanOrEqual(14); expect(bar.width).toBe('auto'); expect(bar.room).toBeGreaterThan(50);
});

test('Background tab: "+" and the backgrounds, then the plain colours; a picture or colour becomes a 5 s clip at the playhead (no questions)', async ({ page }) => {
  await open(page, 390);
  await page.evaluate(() => window.__toon.openTab('canvas'));
  await expect(page.getByText('Where should the background be applied?')).toHaveCount(0);
  await expect(page.locator('.tile-search')).toHaveCount(0);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.tile.add').first().click()]);
  await chooser.setFiles({ name: 'pic.png', mimeType: 'image/png', buffer: PNG });
  await expect.poll(() => page.evaluate(() => window.__toon.S.bgClips.length), { timeout: 15000 }).toBe(1);
  const c = await page.evaluate(() => window.__toon.S.bgClips[0]); expect(c.dur).toBe(5); expect(c.bgId).toBeTruthy(); expect(c.start).toBe(0);
  await expect(page.locator('.tile:not(.add) .eye')).toHaveCount(0);                      // no eye on a background: it is a clip on the timeline
  await page.locator('.bg-swatch').first().click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.bgClips.length)).toBe(2);
  expect((await page.evaluate(() => window.__toon.S.bgClips[1])).dur).toBe(5);
});

test('props: one picture is added once (tapping it again selects it); a background tile shows the whole 16:9 picture; custom colour makes a background', async ({ page }) => {
  await open(page, 390);
  // a shared prop that is already in the scene
  await page.evaluate(async () => {
    const { S } = window.__toon;
    S.sharedAssets = [{ id: 'a1', type: 'prop', access: 'free', name: 'Lamp', thumb: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==' }];
    const blob = await (await fetch(S.sharedAssets[0].thumb)).blob();
    S.props.push({ id: 'p1', assetId: 'a1', kind: 'prop', name: 'Lamp', blob, natW: 1, natH: 1, x: .5, y: .5, w: .1, h: .1, rotation: 0, visible: true });
    await window.__toon.stage.setProps(S.props);
    window.__toon.openTab('props');
  });
  const tile = page.locator('.tile', { hasText: 'Lamp' }); await expect(tile).toBeVisible(); await expect(tile).toHaveClass(/on|tile/);
  await expect(tile.locator('.eye')).toBeVisible(); await expect(tile.locator('.x')).toBeVisible();
  await tile.click({ position: { x: 60, y: 40 } }); await page.waitForTimeout(300);
  expect(await page.evaluate(() => ({ n: window.__toon.S.props.length, sel: window.__toon.S.selectedPropId }))).toEqual({ n: 1, sel: 'p1' });      // nothing was added twice
  // no editor in the panel
  await expect(page.locator('.studio-prop-editor, .prop-hold, .lib-onstage')).toHaveCount(0);
  const pic = await tile.locator('.tile-pic').boundingBox(); expect(Math.abs(pic.width / pic.height - 16 / 9)).toBeLessThan(0.05);      // 16:9
  // eye hides it, X takes it out
  await tile.locator('.eye').click(); expect(await page.evaluate(() => window.__toon.S.props[0].visible)).toBe(false);
  await page.locator('.tile', { hasText: 'Lamp' }).locator('.x').click(); await expect.poll(() => page.evaluate(() => window.__toon.S.props.length)).toBe(0);
  // backgrounds: plain colours on top and small, then a custom colour
  await page.evaluate(() => window.__toon.openTab('canvas'));
  await expect(page.locator('.studio-bg-editor, .card:has-text("Move and resize")')).toHaveCount(0);
  const sw = await page.locator('.bg-swatch').first().boundingBox(); expect(sw.width).toBeLessThanOrEqual(32);
  await page.locator('.bg-swatch.custom input').evaluate((el) => { el.value = '#ff0000'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect(page.locator('.tile', { hasText: 'Colour #ff0000' })).toBeVisible({ timeout: 10000 });
  expect(await page.evaluate(() => window.__toon.S.bgClips.length)).toBeGreaterThan(0);
});

test('search by name hides the other pictures in Props (Backgrounds has no search)', async ({ page }) => {
  await open(page, 390);
  await page.evaluate(async () => {
    const { S } = window.__toon, png = await (await fetch('data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==')).blob();
    S.myBgs.push({ id: 'g1', name: 'Forest village.png', blob: png }, { id: 'g2', name: 'Palace hall.png', blob: png });
    window.__toon.openTab('canvas');
  });
  const names = () => page.locator('.tile:not(.add):visible .tile-name').allTextContents();
  expect((await names()).sort()).toEqual(['Forest village', 'Palace hall']);
  await page.evaluate(() => { window.__toon.S.sharedAssets = [{ id: 'a1', type: 'prop', access: 'free', name: 'Lamp' }, { id: 'a2', type: 'prop', access: 'free', name: 'Chair' }]; window.__toon.openTab('props'); });
  await page.getByLabel('Search objects by name').fill('lam');
  expect(await names()).toEqual(['Lamp']);
});

test('hold a background tile: effects (None, Night second ...) apply to it, and Delete removes it', async ({ page }) => {
  await open(page, 390);
  await page.evaluate(async () => {
    const { S } = window.__toon, png = await (await fetch('data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==')).blob();
    S.myBgs.push({ id: 'g1', name: 'Forest village.png', blob: png }, { id: 'g2', name: 'Palace hall.png', blob: png });
    window.__toon.openTab('canvas');
  });
  const tile = page.locator('.tile', { hasText: 'Forest village' }); await expect(tile).toBeVisible();
  await expect(tile.locator('.x')).toHaveCount(0);                      // no cross on the tile: Delete is in the hold sheet
  await page.waitForTimeout(300);
  const b = await tile.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.waitForTimeout(800); await page.mouse.up();
  const sheet = page.locator('.modal'); await expect(sheet).toBeVisible();
  await expect(sheet.locator('.bg-fx')).toHaveText(['None', 'Night', 'Evening', 'Dawn', 'Gloomy']);          // Night is second
  expect(await page.evaluate(() => window.__toon.S.bgClips.length)).toBe(0);          // holding did not add it
  await sheet.locator('.bg-fx[data-fx="night"]').click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.bgClips.map((c) => [c.bgId, c.fx, c.dur]))).toEqual([['g1', 'night', 5]]);
  // a normal tap still adds a plain 5 s clip
  await page.locator('.tile', { hasText: 'Palace hall' }).click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.bgClips.length)).toBe(2);
  expect(await page.evaluate(() => window.__toon.S.bgClips[1].fx)).toBeUndefined();
  // Delete from the same sheet
  await expect(page.locator('.tile', { hasText: 'Palace hall' })).toBeVisible(); await page.waitForTimeout(400);          // the list is drawn again after a tap
  const b2 = await page.locator('.tile', { hasText: 'Palace hall' }).boundingBox();
  await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2); await page.mouse.down(); await page.waitForTimeout(800); await page.mouse.up();
  await page.locator('.modal .bg-delete').click();
  await expect(page.locator('.tile', { hasText: 'Palace hall' })).toHaveCount(0);
  expect(await page.evaluate(() => window.__toon.S.myBgs.map((r) => r.id))).toEqual(['g1']);
});

test('a background with the Night effect is really drawn darker and bluer', async ({ page }) => {
  await open(page, 390);
  const px = await page.evaluate(async () => {
    const { S, stage, player, drawTimeline } = window.__toon;
    const c = document.createElement('canvas'); c.width = c.height = 8; const g = c.getContext('2d'); g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, 8, 8);
    const blob = await new Promise((r) => c.toBlob(r)); S.myBgs.push({ id: 'g1', name: 'Grey.png', blob });
    S.bgClips.push({ id: 'b1', bgId: 'g1', preset: 0, start: 0, dur: 5 });
    const sample = async () => { await stage.setBackgroundClips(S.bgClips.map((k) => ({ fx: k.fx || null, start: k.start, dur: k.dur, preset: 0, blob })), true); stage.render(1, 0, [], []); const t = document.createElement('canvas'); t.width = stage.out.width; t.height = stage.out.height; const x = t.getContext('2d'); x.drawImage(stage.out, 0, 0); return [...x.getImageData(t.width >> 1, 4, 1, 1).data].slice(0, 3); };
    const plain = await sample(); S.bgClips[0].fx = 'night'; const night = await sample();
    return { plain, night };
  });
  expect(px.night[0]).toBeLessThan(px.plain[0] * 0.6); expect(px.night[2]).toBeGreaterThan(px.night[0]);          // darker and bluer
});

test('with the playhead on the very last second the last background is still shown (not black)', async ({ page }) => {
  await open(page, 390);
  const px = await page.evaluate(async () => {
    const { S, stage } = window.__toon;
    const c = document.createElement('canvas'); c.width = c.height = 8; const g = c.getContext('2d'); g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, 8, 8);
    const blob = await new Promise((r) => c.toBlob(r));
    await stage.setBackgroundClips([{ start: 0, dur: 5, preset: 0, blob }], true);
    const at = (t) => { stage.render(t, 0, [], []); const x = document.createElement('canvas'); x.width = stage.out.width; x.height = stage.out.height; const k = x.getContext('2d'); k.drawImage(stage.out, 0, 0); return [...k.getImageData(x.width >> 1, 4, 1, 1).data].slice(0, 3); };
    return { inside: at(4.9), end: at(5), after: at(5.5) };
  });
  expect(px.inside[0]).toBeGreaterThan(100); expect(px.end[0]).toBeGreaterThan(100);          // the last second keeps the picture
  expect(px.after[0]).toBeLessThan(40);                                                       // well after the end there is nothing (outside the clips the canvas is black)
});

test('background clips: two overlapping updates never put an older list back (the newest wins) and the same file keeps one picture', async ({ page }) => {
  await open(page, 390);
  const r = await page.evaluate(async () => {
    const { stage } = window.__toon, mk = async (col, n) => { const c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d'); g.fillStyle = col; g.fillRect(0, 0, n, n); return new Promise((res) => c.toBlob(res)); };
    const big = await mk('#ff0000', 900), small = await mk('#00ff00', 8);
    const a = stage.setBackgroundClips([{ start: 0, dur: 5, preset: 0, blob: big }], true);          // older call, slow to decode
    const b = stage.setBackgroundClips([{ start: 0, dur: 5, preset: 0, blob: small }, { start: 5, dur: 5, preset: 1, blob: small }], true);          // newer call
    await Promise.all([a, b]);
    const same = stage.bgClips[0].image === stage.bgClips[1].image;
    return { n: stage.bgClips.length, same };
  });
  expect(r.n).toBe(2);              // the newer list stayed
  expect(r.same).toBe(true);        // the same file is decoded once
});
