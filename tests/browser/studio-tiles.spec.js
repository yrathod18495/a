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
  await page.getByLabel('Search props by name').fill('lam');
  expect(await names()).toEqual(['Lamp']);
});
