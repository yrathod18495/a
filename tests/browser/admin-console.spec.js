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
  const names = await tabs.allTextContents();          // the text itself (the tabs are shown in capitals by CSS)
  expect(names.map((n) => n.trim())).toEqual(['Overview', 'Users', 'Live Chat', 'Payments', 'Studio Controls', 'Find Project', 'Props & Effects', 'Add Assets', 'Characters', 'Affiliates']);
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
  for (const name of ['Users', 'Props & Effects', 'Add Assets']) {
    await tabs.filter({ hasText: new RegExp(`^${name.replace('&', '&')}$`) }).click();
    await expect(page.locator('.admin-console-tab.active')).toHaveText(name);
    await page.getByRole('button', { name: /Back to [Aa]dmin/ }).first().click();
    await expect(page.locator('.admin-console-tab.active')).toHaveText('Overview');
    await expect(page.locator('.admin-overview')).toBeVisible();
  }
  // switching quickly never leaves a half-loaded page behind
  await tabs.nth(3).click(); await tabs.nth(6).click(); await tabs.nth(2).click();
  await expect(page.locator('.admin-console-tab.active')).toHaveText('Live Chat');
  await expect(page.locator('.admin-console-host > *')).toHaveCount(1);
});

test('Add Assets opens at once (it no longer waits for the old character catalog), has no "Add Character" tab, and a button leads to the Characters section', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await console_(page);
  // a slow server must not hold the page back
  await page.route('**/api/studio-assets', async (r) => { await new Promise((res) => setTimeout(res, 3000)); await r.fulfill({ json: { assets: [], characters: [] } }); });
  const tabs = page.locator('.admin-console-tab');
  const started = Date.now();
  await tabs.filter({ hasText: /^Add Assets$/ }).click();
  await expect(page.locator('.admin-assets-tab').first()).toBeVisible({ timeout: 1500 });
  expect(Date.now() - started).toBeLessThan(1500);
  await expect(page.locator('.admin-assets-tab')).toHaveText(['🖼 Add Background', '🧸 Add Props', '🎬 Add Animation', '🎭 Characters →']);
  await expect(page.getByText('Loading the character catalog')).toHaveCount(0);
  await page.locator('.admin-assets-tab', { hasText: 'Characters →' }).click();
  await expect(page.locator('.admin-console-tab.active')).toHaveText('Characters');
  await expect(page.getByRole('heading', { name: 'Characters', level: 1 })).toBeVisible({ timeout: 1500 });          // also shown before the saved list arrives
  expect(errors).toEqual([]);
});
