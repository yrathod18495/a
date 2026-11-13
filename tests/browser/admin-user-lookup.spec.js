import { test, expect } from '@playwright/test';
// Admin → Users: a row per account; the account dialog has Overview / Projects / Coins / Actions.
const UID = 'user_12345678901234567890';
test('admin opens an account, changes Coins with a reason, and suspends it with a reason', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const calls = []; let status = 'active', credits = 20, role = 'user';
  await page.route('**/api/security', async (r) => {
    const b = r.request().postDataJSON(); calls.push(b);
    if (b.action === 'userSearch') return r.fulfill({ json: { users: [{ id: UID, email: 'test@example.com', name: 'Test User', registeredAt: '2026-11-01T00:00:00Z', status: 'active', role: 'user', credits: 20 }], sessions: [] } });
    if (b.action === 'moderate') status = b.status;
    if (b.action === 'assignRole') role = b.role;
    return r.fulfill({ json: { maintenance: false, ok: true } });
  });
  await page.route('**/api/payments', async (r) => {
    const b = r.request().postDataJSON(); calls.push(b);
    if (b.action === 'adminUserLookup') return r.fulfill({ json: { user: { uid: UID, email: b.email, name: 'Test User', registeredAt: '2026-11-01T00:00:00Z', lastSignIn: '2026-11-10T00:00:00Z', status, until: 0, role, signedIn: true, tier: 'free', credits, bonus: { status: 'granted', at: 1 }, ledger: [{ id: 'l1', delta: 20, balance: 20, reason: 'Welcome gift', kind: 'signup_bonus', at: 1 }] } } });
    if (b.action === 'adminCreditAdjust') credits = 50;
    return r.fulfill({ json: { ok: true, before: 20, balance: 50, line: { delta: 30, balance: 50, reason: 'Support gift', kind: 'admin_add', at: 2 } } });
  });
  page.on('dialog', (d) => d.accept());
  await page.goto('/?debug#/hub');
  await page.evaluate(async () => {
    const { securityView } = await import('/src/security-view.js');
    document.body.innerHTML = '<div id="host"></div>';
    document.querySelector('#host').append(await securityView({ home() {}, toast() {} }));
  });
  expect(calls.filter((c) => ['overview', 'userSearch', 'summary'].includes(c.action)).length).toBe(0);          // opening the page reads nothing
  await expect(page.locator('.sa-empty')).toContainText('Search to see accounts');
  await page.getByPlaceholder('Search identity via email or user ID…').fill('test@');
  await page.getByRole('button', { name: 'Search Database' }).click();
  expect(calls.find((c) => c.action === 'userSearch')).toMatchObject({ query: 'test@' });
  const row = page.locator('.au-row').first();
  await expect(row).toContainText('Test User');
  await expect(row).toContainText('20');
  await row.click();
  const dlg = page.locator('.au-modal:not(.sub) .au-dialog');
  await expect(dlg).toContainText('Test User');
  await expect(dlg.locator('.au-tab')).toHaveText(['Overview', 'Projects', 'Coins', 'Actions']);
  await expect(dlg).toContainText('20 Coins given');
  // Coins: a signed number and a reason are both required (the message shows inside the dialog); one apply changes the balance once
  await dlg.getByRole('button', { name: 'Coins', exact: true }).click();
  await dlg.getByLabel('Coins to add or remove').fill('+30');
  await dlg.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dlg.locator('.au-flash.bad')).toContainText('short reason');
  expect(calls.some((c) => c.action === 'adminCreditAdjust')).toBe(false);
  await expect(dlg.getByLabel('Coins to add or remove')).toHaveValue('+30');          // what was typed is kept
  await dlg.getByLabel('Reason').fill('Support gift');
  await dlg.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.locator('.au-modal.sub').getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => calls.filter((c) => c.action === 'adminCreditAdjust').length).toBe(1);
  expect(calls.find((c) => c.action === 'adminCreditAdjust')).toMatchObject({ uid: UID, mode: 'add', amount: 30, reason: 'Support gift' });
  await expect(dlg.locator('.au-balance')).toContainText('50');
  await expect(dlg.locator('.au-flash.ok')).toContainText('Coins updated');
  // Actions: Save is off until something changes; a role change asks first; own-account actions are not offered
  await dlg.getByRole('button', { name: 'Actions', exact: true }).click();
  const save = dlg.getByRole('button', { name: /No changes to save/ });
  await expect(save).toBeDisabled();
  await dlg.getByRole('button', { name: 'Admin', exact: true }).click();
  await expect(dlg.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  await dlg.getByRole('button', { name: 'Save changes' }).click();
  await page.locator('.au-modal.sub').getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => calls.find((c) => c.action === 'assignRole')).toMatchObject({ uid: UID, role: 'admin' });
  // suspend needs a reason
  await dlg.getByRole('button', { name: /Suspend or block/ }).click();
  await page.locator('.au-modal.sub').getByRole('button', { name: 'Confirm' }).click();
  expect(calls.some((c) => c.action === 'moderate')).toBe(false);
  await expect(page.locator('.au-modal.sub .au-flash')).toContainText('short reason');
  await page.locator('.au-modal.sub').getByLabel('Reason').fill('Suspicious activity detected');
  await page.locator('.au-modal.sub').getByRole('button', { name: 'Confirm' }).click();
  await expect.poll(() => calls.find((c) => c.action === 'moderate')).toMatchObject({ uid: UID, status: 'suspended', reason: 'Suspicious activity detected' });
  await expect(dlg).toContainText('This account is suspended');
  await expect(dlg.getByRole('button', { name: /Reactivate/ })).toBeVisible();
  await expect(dlg.getByRole('button', { name: 'Restrict to read-only' })).toBeDisabled();          // a suspended account cannot also be restricted
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
});
