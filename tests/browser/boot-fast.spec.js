import { test, expect } from '@playwright/test';
// The first screen never waits for the server: even when every API call hangs for ever, a visitor sees the home page at once
// (this runs the real start-up path, not the ?debug shortcut).
test('the home page opens at once while the server does not answer at all', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const asked = [];
  await page.route('**/api/**', () => { asked.push(1); /* never answered */ });
  const t0 = Date.now();
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Open my studio/ }).first()).toBeVisible({ timeout: 8000 });
  expect(Date.now() - t0).toBeLessThan(8000);
  await expect.poll(() => page.evaluate(() => (window.__12toonsBoot || []).map((s) => s[0]))).toContain('page opened');
  await expect(page.locator('.loading-splash')).toHaveCount(0);
  expect(await page.evaluate(() => (window.__12toonsBoot || []).map((s) => s[0]))).toContain('sign-in state known (signed out)');
  expect(errors).toEqual([]);
});
