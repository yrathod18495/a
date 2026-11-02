import { test, expect } from '@playwright/test';

const PAYMENTS = [
  { orderId: 'order_A1', planName: 'Starter', credits: 500, amountPaise: 9900, status: 'captured', createdAt: 1700000000000 },
  { orderId: 'order_B2', planName: 'Pro', credits: 3000, amountPaise: 49900, status: 'failed', createdAt: 1700100000000 },
  { orderId: 'order_C3', planName: 'Studio', credits: 10000, amountPaise: 149900, status: 'captured', createdAt: 1690000000000 },
];
async function open(page, hash, { credits = 1500, fail = false, payments = PAYMENTS } = {}) {
  const calls = [];
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.route('**/api/payments', (r) => { const body = r.request().postDataJSON(); calls.push(body.action); if (fail) return r.fulfill({ status: 500, json: { error: 'x' } }); return r.fulfill({ json: body.action === 'balance' ? { credits } : body.action === 'mine' ? { payments } : { configured: false, plans: [], credits } }); });
  await page.goto('/?debug#/hub');
  await page.evaluate(async (h) => { const m = await import('/src/credits-badge.js'); window.__coins = m; m.setCoinUser('test-user-123456'); location.hash = h; }, hash);
  return calls;
}

test('every page header shows the Coin balance with a coin, once per header', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const calls = await open(page, '#/toons');
  const badge = page.locator('#shell .credit-badge');
  await expect(badge).toHaveCount(1);
  await expect(badge).toContainText('1,500');
  await expect(badge.locator('.gcoin')).toBeVisible();
  expect(await badge.getAttribute('aria-label')).toBe('Your Coins: 1,500');
  // one small request, not the whole catalogue
  expect(calls.filter((a) => a === 'balance').length).toBeGreaterThan(0); expect(calls).not.toContain('catalog');
  // the same badge on the other pages, only once per header
  for (const hash of ['#/characters', '#/hub', '#/credits']) { await page.evaluate((h) => { location.hash = h; }, hash); await expect(page.locator('#shell .credit-badge')).toHaveCount(1); await expect(page.locator('#shell .credit-badge')).toContainText('1,500'); }
  expect(errors).toEqual([]);
});

test('tapping the balance opens a window with the Coin history, newest first, and "Buy more Coins" goes to the Coins page', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await open(page, '#/hub');
  await expect(page.locator('#shell .credit-badge')).toContainText('1,500');
  await page.locator('#shell .credit-badge').click();
  const win = page.locator('dialog.credit-history-window');
  await expect(win).toBeVisible();
  await expect(page).toHaveURL(/#\/hub$/);                                                    // the tap did not leave the page
  await expect(win.locator('.chw-balance')).toHaveText('1,500');
  await expect(win.locator('.chw-row')).toHaveCount(3);
  await expect(win.locator('.chw-row .chw-main b')).toHaveText(['Pro', 'Starter', 'Studio']);   // newest first
  await expect(win.locator('.chw-row.added .chw-coins')).toHaveText(['+500', '+10,000']);
  await expect(win.locator('.chw-row.failed')).toContainText('Failed');
  await expect(win.locator('.chw-note')).toContainText('10,500 Coins received in total');         // the failed payment is not counted
  await expect(win.locator('.chw-row').first()).toContainText('order_B2');
  // the buy button closes the window and opens the Coins page
  await win.getByRole('link', { name: 'Buy more Coins' }).click();
  await expect(win).toHaveCount(0);
  await expect(page).toHaveURL(/#\/credits$/);
  expect(errors).toEqual([]);
});

test('the history window closes with the X, Escape and a click outside, and shows a message when there is no history or it cannot load', async ({ page }) => {
  await open(page, '#/hub', { payments: [] });
  const win = page.locator('dialog.credit-history-window'), badge = page.locator('#shell .credit-badge');
  await badge.click(); await expect(win).toBeVisible();
  await expect(win).toContainText('No Coin history yet');
  await win.getByRole('button', { name: 'Close', exact: true }).first().click(); await expect(win).toHaveCount(0);
  await badge.click(); await expect(win).toBeVisible(); await page.keyboard.press('Escape'); await expect(win).toHaveCount(0);
  await badge.click(); await expect(win).toBeVisible(); await page.mouse.click(8, 8); await expect(win).toHaveCount(0);
});

test('if the history cannot be loaded the window says so in plain English', async ({ page }) => {
  await page.route('**/api/payments', (r) => { const body = r.request().postDataJSON(); return body.action === 'mine' ? r.fulfill({ status: 500, json: { error: 'The cloud request failed. Please try again.' } }) : r.fulfill({ json: { credits: 1500 } }); });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug#/hub');
  await page.evaluate(async () => { const m = await import('/src/credits-badge.js'); m.setCoinUser('test-user-123456'); });
  await page.locator('#shell .credit-badge').click();
  await expect(page.locator('dialog.credit-history-window .chw-hint.error')).toContainText('Could not load your Coin history');
});

test('the badge follows the balance (buying Coins) and is not shown for a signed-out visitor', async ({ page }) => {
  await open(page, '#/hub');
  await expect(page.locator('#shell .credit-badge')).toContainText('1,500');
  await page.evaluate(() => window.__coins.setCoinBalance(2750));
  await expect(page.locator('#shell .credit-badge')).toContainText('2,750');
  await page.evaluate(() => window.__coins.setCoinUser(null));
  await expect(page.locator('#shell .credit-badge')).toBeHidden();
});

test('if the balance cannot be read, the last known number stays and nothing breaks', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('12toons-coins-test-user-123456', '900'));
  await open(page, '#/hub', { fail: true });
  await expect(page.locator('#shell .credit-badge')).toContainText('900');
});

test('the studio bar shows a compact balance too', async ({ page }) => {
  await open(page, '#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Coins');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.locator('#app .stagebox canvas')).toBeVisible();
  await page.evaluate(async () => { const m = await import('/src/credits-badge.js'); m.setCoinUser('test-user-123456'); });         // opening a project reloads the page; the debug session has no account of its own
  await page.evaluate(() => window.__toon.S.ready);
  await expect(page.locator('.studio-bar .credit-badge')).toBeVisible();
  await expect(page.locator('.studio-bar .credit-badge')).toContainText('1,500');
});
