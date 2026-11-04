import { test, expect } from '@playwright/test';
test('the X in the corner asks first, in a small drop under it; Stay keeps the studio, tapping outside closes the drop, Close leaves', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Close');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  const x = page.locator('.close-studio'), pop = page.locator('.close-pop');
  await expect(pop).toBeHidden();
  await x.click(); await expect(pop).toBeVisible(); await expect(pop).toContainText('Close the studio?');
  const xb = await x.boundingBox(), pb = await pop.boundingBox();
  expect(pb.y).toBeGreaterThanOrEqual(xb.y + xb.height - 2); expect(Math.abs((pb.x + pb.width) - (xb.x + xb.width))).toBeLessThan(14); expect(pb.x).toBeGreaterThanOrEqual(0);          // right under the X, inside the screen
  await pop.getByRole('button', { name: 'Stay' }).click(); await expect(pop).toBeHidden(); await expect(page.locator('#app .stagebox canvas')).toBeVisible();
  await x.click(); await expect(pop).toBeVisible(); await page.locator('.stagebox').click({ position: { x: 20, y: 20 } }); await expect(pop).toBeHidden();
  await x.click(); await pop.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('#app')).toBeHidden({ timeout: 10000 });
});
