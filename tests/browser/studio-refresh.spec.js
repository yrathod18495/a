import { test, expect } from '@playwright/test';
// The "..." menu has Refresh the page (reloads the site) and Reset this project, both as full-width rows.
test('the ... menu: Refresh the page reloads the site', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 860 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Refresh');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
  await page.locator('.studio-menu summary').click();
  const refresh = page.getByRole('button', { name: 'Refresh the page' }), reset = page.getByRole('button', { name: /Reset this project/ });
  await expect(refresh).toBeVisible(); await expect(reset).toBeVisible();
  const rb = await refresh.boundingBox(), eb = await reset.boundingBox(), panel = await page.locator('.studio-menu-panel').boundingBox();
  expect(rb.height).toBeLessThan(60); expect(eb.height).toBeLessThan(60);                    // one line each (the reset text no longer wraps over three lines)
  expect(rb.x + rb.width).toBeLessThanOrEqual(panel.x + panel.width + 1); expect(rb.y + rb.height).toBeLessThanOrEqual(eb.y + 1);
  await page.evaluate(() => { window.__marker = 'before'; });
  await Promise.all([page.waitForEvent('load'), refresh.click()]);                            // the site reloads
  await page.waitForLoadState('domcontentloaded');
  expect(await page.evaluate(() => window.__marker ?? null)).toBeNull();                      // a new page: the old script state is gone
});
