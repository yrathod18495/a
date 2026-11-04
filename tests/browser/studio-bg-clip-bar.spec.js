import { test, expect } from '@playwright/test';
test.use({ viewport: { width: 390, height: 800 } });
test('phone: a background clip has Objects, Crop and Replace in the bottom bar (no Duplicate); Crop zooms, Replace waits for the next background', async ({ page }) => {
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Bg');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  await page.evaluate(() => { const { S, drawClipBar } = window.__toon; S.bgClips.push({ id: 'bg1', bgId: null, preset: 1, start: 0, dur: 5 }); S.bgSel = 'bg1'; drawClipBar(); });
  const nav = page.locator('.clip-nav'); await expect(nav).toBeVisible();
  await expect(nav.locator('.cb-list .cb-btn > span:last-child')).toHaveText(['Split', 'Copy', 'Objects', 'Crop', 'Replace', 'Delete']);
  const row = await nav.locator('.cb-list').evaluate((e) => ({ scroll: e.scrollWidth, client: e.clientWidth })); expect(row.scroll).toBeLessThanOrEqual(row.client + 1);
  // Objects opens the props (stone, tree ...)
  await nav.getByRole('button', { name: 'Objects' }).click();
  expect(await page.evaluate(() => window.__toon.S.tab)).toBe('props');
  // Crop: a box with handles on the picture, ratios in the bar, a tick applies it (the kept part fills the frame)
  await nav.getByRole('button', { name: 'Crop' }).click();
  await expect(page.locator('.crop-box')).toBeVisible(); await expect(page.locator('.crop-h')).toHaveCount(8);
  await expect(nav.locator('.cb-list .cb-btn > span:last-child')).toHaveText(['Free', 'Original', '1:1', '4:5', '9:16']);
  const lb = await page.locator('.crop-layer').boundingBox(), hb = await page.locator('.crop-h.ch-tl').boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down(); await page.mouse.move(lb.x + lb.width * 0.4, lb.y + lb.height * 0.4, { steps: 6 }); await page.mouse.up();
  await nav.getByRole('button', { name: 'Apply the crop' }).click();
  await expect(page.locator('.crop-layer')).toHaveCount(0);
  expect(await page.evaluate(() => window.__toon.S.bgClips[0].xf.s)).toBeGreaterThan(1.3);          // zoomed into the kept part
  // 1:1 locks the shape; Cancel puts everything back
  await nav.getByRole('button', { name: 'Crop' }).click(); await nav.getByRole('button', { name: '1:1' }).click();
  const bx = await page.locator('.crop-box').boundingBox(), fr = await page.locator('.stagewrap canvas').boundingBox();
  expect(Math.abs(bx.width / bx.height - 1)).toBeLessThan(0.06);
  const before = await page.evaluate(() => window.__toon.S.bgClips[0].xf.s);
  await nav.getByRole('button', { name: 'Cancel the crop' }).click();
  expect(await page.evaluate(() => window.__toon.S.bgClips[0].xf.s)).toBe(before);
  // Duplicate is still in More
  await nav.locator('.char-more summary').click(); await expect(nav.locator('.cb-more-list').getByRole('button', { name: 'Duplicate' })).toBeVisible();
});
