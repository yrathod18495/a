import { test, expect } from '@playwright/test';

const overview = {
  users: [{ id: 'user-aaa111', email: 'a@example.com', status: 'active', role: 'user', registeredAt: 'Fri, 23 Oct 2026' }, { id: 'user-bbb222', email: 'b@example.com', status: 'blocked', role: 'user' }],
  sessions: [], devices: [], events: [], audit: [], cursors: {},
};

test('admin Users: every account starts collapsed and opens with the + button', async ({ page }) => {
  await page.route('**/api/security', async (r) => { const body = JSON.parse(r.request().postData() || '{}'); await r.fulfill({ json: body.action === 'overview' ? overview : { maintenance: false } }); });
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/hub');
  await page.evaluate(async () => { const m = await import('/src/security-view.js'); document.body.replaceChildren(await m.securityView({ home() {}, toast() {} })); });
  const cards = page.locator('.sa-user');
  await expect(cards).toHaveCount(2);
  await expect(page.locator('.sa-user-body:visible')).toHaveCount(0);                     // collapsed by default
  await expect(page.getByRole('button', { name: 'Restrict' }).first()).toBeHidden();
  const first = cards.first().locator('.sa-toggle');
  await expect(first).toHaveText('+');
  await first.click();
  await expect(first).toHaveText('−');
  await expect(first).toHaveAttribute('aria-expanded', 'true');
  await expect(cards.first().getByRole('button', { name: 'Restrict' })).toBeVisible();
  await expect(cards.nth(1).getByRole('button', { name: 'Restrict' })).toBeHidden();      // only that account opened
  await page.locator('.sa-search').fill('a@');                                              // filtering re-draws the list: the open account stays open
  await expect(cards.first().getByRole('button', { name: 'Restrict' })).toBeVisible();
  await cards.first().locator('.sa-toggle').click();
  await expect(cards.first().getByRole('button', { name: 'Restrict' })).toBeHidden();
});
