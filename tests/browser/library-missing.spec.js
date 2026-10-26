import { test, expect } from '@playwright/test';

test('when the character library cannot be loaded the picker says so in simple Hinglish instead of showing nothing', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.route('**/12toons/characters.json', (r) => r.fulfill({ status: 404, body: 'not found' }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('No library');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
  await page.getByRole('button', { name: 'Add character' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /Character library/ })).toBeVisible();
  await expect(page.locator('.cp-card')).toHaveCount(0);
});
