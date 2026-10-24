import { test, expect } from '@playwright/test';

// The admin console is mounted straight from its module with a stub user: the data calls fail (no sign-in), which every page must survive.
async function console_(page) {
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.route('**/api/security', r => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', r => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug#/');
  await page.evaluate(async () => {
    const m = await import('/src/admin.js');
    document.body.innerHTML = '';
    document.body.append(await m.view({ user: { uid: 'u1', email: 'admin@example.com', displayName: 'Admin' }, home() {}, toast(text) { (window.__toasts ||= []).push(text); } }));
  });
}

test('every admin section opens inside the console: the top bar and tabs never disappear', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await console_(page);
  const tabs = page.locator('.admin-console-tab');
  const names = await tabs.allInnerTexts();
  expect(names).toEqual(['Overview', 'Users', 'Live Chat', 'Payments', 'Studio Controls', 'Tester Requests', 'Tester Permissions', 'Props & Effects', 'Add Assets', 'Affiliates']);
  for (const [index, name] of names.entries()) {
    await tabs.nth(index).click();
    await expect(page.locator('.admin-console-tab.active')).toHaveText(name);
    await expect(page.locator('.admin-console-nav')).toBeVisible();
    await expect(page.locator('.admin-console-topbar')).toBeVisible();
    await expect(page.locator('.admin-console-host > *')).toHaveCount(1);
    await expect(page.locator('.admin-console-host')).not.toContainText(/^null$|\bnull\b/);
  }
  expect(errors).toEqual([]);
});

test('the back buttons inside admin sections return to the Overview', async ({ page }) => {
  await console_(page);
  const tabs = page.locator('.admin-console-tab');
  for (const name of ['Users', 'Tester Requests', 'Props & Effects', 'Add Assets']) {
    await tabs.filter({ hasText: new RegExp(`^${name.replace('&', '&')}$`) }).click();
    await expect(page.locator('.admin-console-tab.active')).toHaveText(name);
    await page.getByRole('button', { name: /Back to [Aa]dmin/ }).first().click();
    await expect(page.locator('.admin-console-tab.active')).toHaveText('Overview');
    await expect(page.locator('.admin-overview')).toBeVisible();
  }
  // switching quickly never leaves a half-loaded page behind
  await tabs.nth(3).click(); await tabs.nth(8).click(); await tabs.nth(2).click();
  await expect(page.locator('.admin-console-tab.active')).toHaveText('Live Chat');
  await expect(page.locator('.admin-console-host > *')).toHaveCount(1);
});
