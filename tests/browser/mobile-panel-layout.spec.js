import { test, expect } from '@playwright/test';

test('closing and reopening tools keeps the mobile toolbar below the timeline', async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 620 });
  await page.route('**/api/security', route => route.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', route => route.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Mobile panel layout');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);

  const rail = page.locator('#app .tabs.big');
  const close = page.locator('.sheet-close').getByRole('button', { name: 'Close', exact: true });
  for (const [width, height] of [[500, 620], [390, 844], [320, 640], [768, 700], [844, 390], [390, 480]]) {
    await page.setViewportSize({ width, height });
    if (await page.evaluate(() => window.__toon.S.panelOpen)) await close.click();
    for (let cycle = 0; cycle < 2; cycle++) {
      await rail.getByRole('button', { name: 'Effects', exact: true }).click();
      await expect(page.locator('.panel.open')).toBeVisible();
      await close.click();
      await expect(page.locator('.panel.open')).toHaveCount(0);
      const bounds = await page.evaluate(() => {
        const rail = document.querySelector('#app .tabs.big');
        const a = rail.getBoundingClientRect();
        const b = document.querySelector('#app .tlwrap').getBoundingClientRect();
        return {
          area: getComputedStyle(rail).gridArea,
          overlaps: a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top,
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      expect(bounds, `${width} × ${height}, cycle ${cycle}`).toEqual({ area: 'rail', overlaps: false, horizontalOverflow: false });
      await expect(page.getByRole('tab', { name: 'Scene 1', exact: true })).toBeVisible();
    }
  }
});
