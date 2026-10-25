import { test, expect } from '@playwright/test';

const plans = [
  { id: 'starter', name: 'Starter', amountPaise: 45000, credits: 500, compareAtPaise: 64300, discountPercent: 30, features: ['500 Gold Coins (50 bonus Gold Coins)', 'One-time payment'] },
  { id: 'creator', name: 'Creator', amountPaise: 85000, credits: 1000, popular: true, compareAtPaise: 121400, discountPercent: 30, features: ['1,000 Gold Coins (150 bonus Gold Coins)', 'One-time payment'] },
  { id: 'studio', name: 'Studio', amountPaise: 99900, credits: 1500, compareAtPaise: 142700, discountPercent: 30, features: ['1,500 Gold Coins (501 bonus Gold Coins)', 'One-time payment'] },
];

test('the Buy Gold Coins page shows coins, the balance and the plans in the new wording, with no "credits" left on screen', async ({ page }, info) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/security', r => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/payments', async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === 'catalog') return route.fulfill({ json: { configured: true, plans, credits: 1250 } });
    if (body.action === 'mine') return route.fulfill({ json: { payments: [{ orderId: 'order_1', planName: 'Creator', amountPaise: 85000, status: 'captured', createdAt: Date.now() }] } });
    return route.fulfill({ json: {} });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?debug#/credits');
  await expect(page.getByRole('heading', { name: /Gold Coins plan/ })).toBeVisible();
  await expect(page.locator('.credit-plan')).toHaveCount(3);
  await expect(page.locator('.credit-balance .gcoin svg')).toHaveCount(1);
  await expect(page.locator('.credit-plan .gcoin')).toHaveCount(3);
  await expect(page.locator('.credit-balance')).toContainText('1,250');
  const visible = await page.locator('#app, body').first().innerText();
  expect(visible).not.toMatch(/credit/i);
  await expect(page.locator('.sh-crumb')).toHaveText('Buy Gold Coins');
  await page.screenshot({ path: info.outputPath('buy-gold-coins.png'), fullPage: true });
  expect(errors).toEqual([]);
});
