import { test, expect } from '@playwright/test';
async function open(page, width) {
  await page.setViewportSize({ width, height: 860 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Menus');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
  if (await page.locator('.panel.open').count()) await page.locator('.panel.open .sheet-close button').click();
}
test('phone: Play is the first button of the timeline tools row; on a wide screen it is back in the player controls', async ({ page }) => {
  await open(page, 390);
  await expect(page.locator('.tltools .play-btn')).toHaveCount(1); await expect(page.locator('.controls .play-btn')).toHaveCount(0);
  await expect(page.locator('.tltools > :first-child')).toHaveClass(/play-btn/);
  await page.setViewportSize({ width: 1366, height: 860 }); await page.waitForTimeout(300);
  await expect(page.locator('.controls .play-btn')).toHaveCount(1); await expect(page.locator('.tltools .play-btn')).toHaveCount(0);
});
test('phone: pop-up menus close when you tap elsewhere or pick something', async ({ page }) => {
  await open(page, 390);
  await page.locator('.scene-menu summary').first().click(); await expect(page.locator('.scene-menu').first()).toHaveJSProperty('open', true);
  await page.locator('.stagebox').click({ position: { x: 20, y: 20 } }); await expect(page.locator('.scene-menu').first()).toHaveJSProperty('open', false);
  await page.locator('.advanced-tools summary').click(); await expect(page.locator('.advanced-tools')).toHaveJSProperty('open', true);
  await page.locator('.stagebox').click({ position: { x: 20, y: 20 } }); await expect(page.locator('.advanced-tools')).toHaveJSProperty('open', false);
  await page.locator('.advanced-tools summary').click(); await page.locator('.advanced-tools-list button').first().click();
  await expect(page.locator('.advanced-tools')).toHaveJSProperty('open', false);                            // choosing a tool closes the list
  await page.locator('.studio-menu summary').click(); await expect(page.locator('.studio-menu')).toHaveJSProperty('open', true);
  await page.locator('.stagebox').click({ position: { x: 20, y: 20 } }); await expect(page.locator('.studio-menu')).toHaveJSProperty('open', false);
});
