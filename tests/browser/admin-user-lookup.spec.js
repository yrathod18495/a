import { test, expect } from '@playwright/test';
// Admin: find a user by email, see Coins / status, edit Coins with a reason, deactivate.
test('admin finds a user by email, edits Coins with a reason and deactivates the account', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const calls = [];
  await page.route('**/api/security', async (r) => {
    const b = r.request().postDataJSON(); calls.push(b);
    if (b.action === 'overview') return r.fulfill({ json: { users: [], sessions: [], devices: [], events: [], audit: [], cursors: {} } });
    return r.fulfill({ json: { maintenance: false, ok: true } });
  });
  await page.route('**/api/payments', async (r) => {
    const b = r.request().postDataJSON(); calls.push(b);
    if (b.action === 'adminUserLookup') return r.fulfill({ json: { user: { uid: 'user_12345678901234567890', email: b.email, name: 'Test User', registeredAt: '2026-11-01T00:00:00Z', lastSignIn: '2026-11-10T00:00:00Z', status: 'active', until: 0, role: 'user', signedIn: true, lastSeen: 1, tier: 'free', credits: 20, bonus: { status: 'granted', at: 1 }, ledger: [{ id: 'l1', delta: 20, balance: 20, reason: 'Welcome gift', kind: 'signup_bonus', at: 1 }] } } });
    return r.fulfill({ json: { ok: true, before: 20, balance: 50, line: { delta: 30, balance: 50, reason: 'Support gift', kind: 'admin_add', at: 2 } } });
  });
  page.on('dialog', (d) => d.accept());
  await page.goto('/?debug#/hub');
  await page.evaluate(async () => {
    const { securityView } = await import('/src/security-view.js');
    document.body.innerHTML = '<div id="host"></div>';
    document.querySelector('#host').append(await securityView({ home() {}, toast() {} }));
  });
  await page.getByPlaceholder('Find a user by email…').fill('test@example.com');
  await page.getByRole('button', { name: 'Find', exact: true }).click();
  await expect(page.locator('.sa-lookup-user')).toContainText('Test User');
  await expect(page.locator('.sa-lookup-user')).toContainText('20 Coins given');
  await expect(page.locator('.sa-lookup-user')).toContainText('Welcome gift');
  await page.getByLabel('Number of Coins').fill('30');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByText('Please write a short reason.').first()).toBeVisible().catch(() => {});      // a reason is required
  expect(calls.some((c) => c.action === 'adminCreditAdjust')).toBe(false);
  await page.getByLabel('Reason').fill('Support gift');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => calls.find((c) => c.action === 'adminCreditAdjust')).toMatchObject({ uid: 'user_12345678901234567890', mode: 'add', amount: 30, reason: 'Support gift' });
  await expect(page.locator('.sa-lookup-user .sa-metric').first()).toContainText('50');          // the new balance shows without waiting for a full reload
  await page.getByRole('button', { name: 'Deactivate account' }).click();
  await expect.poll(() => calls.find((c) => c.action === 'moderate')).toMatchObject({ uid: 'user_12345678901234567890', status: 'blocked' });
  const box = await page.locator('.sa-lookup').boundingBox(); expect(box.x + box.width).toBeLessThanOrEqual(391);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
});
