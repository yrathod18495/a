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
  expect(names.map((n) => n.trim())).toEqual(['Overview', 'Users', 'Live Chat', 'Payments', 'Studio Controls', 'Find Project', 'Add Assets', 'Characters', 'Affiliates']);
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
  for (const name of ['Users', 'Add Assets']) {
    await tabs.filter({ hasText: new RegExp(`^${name.replace('&', '&')}$`) }).click();
    await expect(page.locator('.admin-console-tab.active')).toHaveText(name);
    await page.getByRole('button', { name: /Back to [Aa]dmin/ }).first().click();
    await expect(page.locator('.admin-console-tab.active')).toHaveText('Overview');
    await expect(page.locator('.admin-overview')).toBeVisible();
  }
  // switching quickly never leaves a half-loaded page behind
  await tabs.nth(3).click(); await tabs.nth(6).click(); await tabs.nth(2).click();      // Payments, Add Assets, Live Chat
  await expect(page.locator('.admin-console-tab.active')).toHaveText('Live Chat');
  await expect(page.locator('.admin-console-host > *')).toHaveCount(1);
});

test('Add Assets opens at once and has the sub-tabs Background, Props, Effects, Animation (no Characters button, no separate Props & Effects tab)', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await console_(page);
  // a slow server must not hold the page back
  await page.route('**/api/studio-assets', async (r) => { await new Promise((res) => setTimeout(res, 3000)); await r.fulfill({ json: { assets: [], characters: [] } }); });
  const tabs = page.locator('.admin-console-tab');
  const started = Date.now();
  await tabs.filter({ hasText: /^Add Assets$/ }).click();
  await expect(page.locator('.admin-assets-tab').first()).toBeVisible({ timeout: 1500 });
  expect(Date.now() - started).toBeLessThan(1500);
  await expect(page.locator('.admin-assets-tab')).toHaveText(['🖼 Add Background', '🧸 Add Props', '💫 Add Effects', '🎬 Add Animation']);
  await expect(page.getByText('Characters →')).toHaveCount(0);
  await expect(tabs.filter({ hasText: /Props & Effects/ })).toHaveCount(0);
  await expect(tabs.filter({ hasText: /^Characters$/ })).toHaveCount(1);                    // Characters stays a main tab
  expect(errors).toEqual([]);
});

test('Add Assets → Add Effects shows the effect form (blend, placement, sprite sheet) and Add Props the prop form (prop type, category)', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await console_(page);
  await page.locator('.admin-console-tab').filter({ hasText: /^Add Assets$/ }).click();
  await page.locator('.admin-assets-tab', { hasText: 'Add Effects' }).click();
  await expect(page.getByRole('heading', { name: 'Effects', level: 1 })).toBeVisible({ timeout: 5000 });
  await expect(page.getByLabel('Blend mode')).toBeVisible(); await expect(page.getByLabel('Placement')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish effect' })).toBeVisible();
  await expect(page.locator('.admin-assets-tab').filter({ hasText: 'Add Effects' })).toHaveClass(/active/);
  await expect(page.locator('.admin-console-host > *')).toHaveCount(1);                       // still one page inside the console
  await page.locator('.admin-assets-tab', { hasText: 'Add Props' }).click();
  await expect(page.getByRole('heading', { name: 'Props', level: 1 })).toBeVisible({ timeout: 5000 });
  await expect(page.getByLabel('Prop type')).toBeVisible(); await expect(page.getByRole('button', { name: 'Publish prop' })).toBeVisible();
  await page.locator('.admin-assets-tab', { hasText: 'Add Background' }).click();
  await expect(page.getByRole('heading', { name: 'Add Backgrounds', level: 1 })).toBeVisible();
  await page.locator('.admin-assets-tab', { hasText: 'Add Effects' }).click();
  await expect(page.getByRole('button', { name: 'Publish effect' })).toBeVisible();          // back to the same effects screen
  expect(errors).toEqual([]);
});
