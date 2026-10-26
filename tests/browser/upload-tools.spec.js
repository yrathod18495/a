import { test, expect } from '@playwright/test';

test('Upload groups Audio, Background and Props without changing the timeline layout', async ({ page }, info) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.route('**/api/security', route => route.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', route => route.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Upload toolbar');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready)).toBe(true);
  const rail = page.locator('#app .tabs.big');
  const upload = rail.locator('.upload-tools');
  const summary = upload.locator('summary');
  const panel = page.locator('#app .panel');
  await expect(rail.locator(':scope > button')).not.toContainText(['Audio', 'Background', 'Props']);
  await expect(upload.locator('button')).toHaveText(['🎙Audio', '🖼Background', '🧸Props']);
  for (const [width, height] of [[1366, 768], [390, 844], [500, 620], [844, 390]]) {
    await page.setViewportSize({ width, height });
    for (const name of ['Audio', 'Background', 'Props', 'Audio']) {
      await summary.click();
      await expect(upload).toHaveAttribute('open', '');
      await expect.poll(() => upload.locator('.upload-tools-list').evaluate(menu => {
        const box = menu.getBoundingClientRect();
        return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
      })).toBe(true);
      await upload.getByRole('button', { name, exact: true }).click();
      await expect(upload).not.toHaveAttribute('open', '');
      await expect(panel).toHaveClass(/open/);
      await expect(panel.locator('.sheet-close b')).toHaveText(name);
    }
    await summary.click(); await page.keyboard.press('Escape');
    await expect(upload).not.toHaveAttribute('open', ''); await expect(summary).toBeFocused();
    await summary.click(); await page.locator('#app .topbar').click({ position: { x: 2, y: 2 } });
    await expect(upload).not.toHaveAttribute('open', '');
    await page.screenshot({ path: info.outputPath(`upload-${width}.png`) });
  }
});
