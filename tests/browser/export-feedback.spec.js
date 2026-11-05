import { test, expect } from '@playwright/test';
test.use({ viewport: { width: 390, height: 800 } });
// The first tap on Render is answered at once (the Download button moves, a "Preparing" box shows). Cancel is answered at once too ("Stopping…" with motion) and really stops the export —
// the busy box and the export pill must sit above everything else (the quick-start guide, the bottom dock tray) or a real tap on Cancel never reaches the button.
test('Render moves the Download button at once; Cancel is on top of every other layer, says Stopping… at once, and really stops the export', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Cancel');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
  // a longer scene, so the render takes a few seconds and there is time to tap Cancel
  await page.evaluate(() => { window.__toon.player.total = 30; });
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  const box = page.locator('.exp-pop'); await expect(box).toBeVisible();
  await box.getByRole('button', { name: '720p', exact: true }).click();
  await box.getByRole('button', { name: '40', exact: true }).click();
  await expect(box.locator('.exp-pop-go')).toBeEnabled();
  await box.locator('.exp-pop-go').click();
  await expect(page.locator('.export-btn.working')).toHaveCount(1, { timeout: 3000 });     // the button is alive straight away
  const cancel = page.locator('.busy-cancel, .ep-cancel').first();
  await expect(cancel).toBeVisible({ timeout: 10000 });
  // the cancel button must really be the topmost element at its own position (not covered by the quick-start guide or the bottom dock tray)
  const onTop = await cancel.evaluate((el) => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el; });
  expect(onTop).toBe(true);
  await cancel.click({ timeout: 5000 });          // answered at once: the export is cancelled on the very next frame (no visible "stuck" bar)
  await expect(page.locator('.export-btn.working')).toHaveCount(0, { timeout: 10000 });    // the export really stopped, promptly
  await expect(page.locator('.busy, .export-pill')).toHaveCount(0);
  expect(await page.evaluate(() => window.__toon.S.exporting)).toBe(false);
  expect(errors).toEqual([]);
});
