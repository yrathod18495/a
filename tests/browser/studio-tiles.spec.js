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
  await expect(tab === 'props' ? page.locator('.lib-row').first() : page.locator('.tile:not(.add)').first()).toBeVisible({ timeout: 15000 });
  const boxes = await page.evaluate(() => [...document.querySelectorAll('.tile')].map((e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; }));
  expect(boxes.length).toBeGreaterThanOrEqual(tab === 'props' ? 1 : 2);
  for (const b of boxes) { expect(b[0]).toBeGreaterThanOrEqual(0); expect(b[2]).toBeLessThanOrEqual(390); }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], c = boxes[j]; expect(a[2] <= c[0] + 0.5 || c[2] <= a[0] + 0.5 || a[3] <= c[1] + 0.5 || c[3] <= a[1] + 0.5, `tiles ${i} and ${j} overlap`).toBe(true); }
  if (tab === 'canvas') expect(new Set(boxes.map((b) => Math.round(b[0]))).size).toBe(2);       // two columns
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

test('background tile: the eye button shows or hides it (eye / crossed eye, no emoji)', async ({ page }) => {
  await open(page, 390);
  await page.evaluate(() => window.__toon.openTab('canvas'));
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.tile.add').first().click()]);
  await chooser.setFiles({ name: 'pic.png', mimeType: 'image/png', buffer: PNG });
  const eye = page.locator('.tile:not(.add) .eye').first();
  await expect(eye).toBeVisible({ timeout: 15000 });
  await expect(eye).toHaveClass(/on/);                                   // just added = showing
  expect(await page.evaluate(() => !!window.__toon.S.bgId)).toBe(true);
  await eye.click();
  await expect(page.locator('.tile:not(.add) .eye').first()).not.toHaveClass(/on/);
  expect(await page.evaluate(() => window.__toon.S.bgId)).toBeFalsy();
  expect(await page.locator('.tile .eye').first().textContent()).not.toContain('🚫');
  await page.locator('.tile:not(.add) .eye').first().click();
  await expect(page.locator('.tile:not(.add) .eye').first()).toHaveClass(/on/);
  const eb = await page.locator('.tile:not(.add) .eye').first().boundingBox(), xb = await page.locator('.tile:not(.add) .x').first().boundingBox();
  expect(eb.x + eb.width).toBeLessThanOrEqual(xb.x);                    // the eye and the delete button do not overlap
});
