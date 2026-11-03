import { test, expect } from '@playwright/test';

async function visit(page, hash) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.route('**/api/chat', (r) => r.fulfill({ json: { messages: [], revision: 0 } }));
  await page.goto('/' + hash);
}

test('a signed-out visitor sees the live chat button on the home page, also after coming back from the login page', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await visit(page, '#/login');
  await expect(page.getByRole('button', { name: /Continue with Google/ })).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.support-launch')).toHaveCount(0);                    // not on the login page
  await page.getByRole('button', { name: /Back to home/ }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.locator('.support-launch')).toBeVisible();                     // the bug: it used to stay missing here
  await expect(page.locator('.support-widget')).toHaveCount(1);
  await page.evaluate(() => { location.hash = '#/login'; });
  await expect(page.locator('.support-launch')).toHaveCount(0);
  await page.evaluate(() => { location.hash = '#/'; });
  await expect(page.locator('.support-launch')).toBeVisible();
  await expect(page.locator('.support-widget')).toHaveCount(1);                     // never two buttons
  expect(errors).toEqual([]);
});

test('opening the home page directly shows the live chat button', async ({ page }) => {
  await visit(page, '#/');
  await expect(page.locator('.support-launch')).toBeVisible({ timeout: 20000 });
});
