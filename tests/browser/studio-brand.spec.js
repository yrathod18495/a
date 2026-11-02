import { test, expect } from '@playwright/test';

async function open(page, tier) {
  await page.setViewportSize({ width: 1366, height: 800 });
  if (tier) await page.route('**/src/export-plan.js*', route => route.fulfill({ contentType: 'text/javascript', body: `
    export const FREE_PLAN = { tier: 'free', limitSeconds: 60, verified: false };
    const plan = { tier: ${JSON.stringify(tier)}, limitSeconds: 600, verified: true };
    export const currentPlan = () => plan;
    export const refreshPlan = async () => plan;
    export class ExportLimitError extends Error {}
    export const authorizeExport = async () => ({ grantId: null, tier: plan.tier });
    export const finishExport = () => {};
  ` }));
  await page.route('**/api/security', r => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', r => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Brand');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.locator('#app .stagebox canvas')).toBeVisible();
}
const barColor = (page) => page.locator('.studio-bar').evaluate((el) => getComputedStyle(el).borderTopColor);

test('the studio bar shows the 12toons name, and stays unchanged for a free account', async ({ page }) => {
  await open(page);
  await expect(page.locator('.studio-bar .studio-brand')).toContainText('12');
  await expect(page.locator('.studio-bar .studio-brand')).toContainText('toons');
  await expect(page.locator('.studio-bar')).not.toHaveClass(/gold/);
  expect(await barColor(page)).not.toBe('rgb(212, 166, 42)');
  // the name sits between the quality picker and the project ID, not on top of them
  const box = async (sel) => page.locator(sel).first().boundingBox();
  const q = await box('.studio-bar .preview-quality'), brand = await box('.studio-bar .studio-brand'), id = await box('.studio-bar .project-id');
  expect(brand.x).toBeGreaterThan(q.x + q.width); expect(brand.x + brand.width).toBeLessThan(id.x);
});

for (const tier of ['paid']) test(`the studio bar turns gold for a ${tier} account or an admin`, async ({ page }) => {
  await open(page, tier);
  await expect(page.locator('.studio-bar')).toHaveClass(/gold/);
  expect(await barColor(page)).toBe('rgb(212, 166, 42)');
  await expect(page.locator('.studio-bar .studio-brand')).toBeVisible();
});

test('the gold bar is dropped if the account turns out to be free', async ({ page }) => {
  await open(page, 'free');
  await expect(page.locator('.studio-bar')).not.toHaveClass(/gold/);
});
