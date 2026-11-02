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
const edge = (page) => page.locator('.studio-bar .project-id').evaluate((el) => getComputedStyle(el).borderTopColor);
const logoColors = (page) => page.locator('.studio-brand').evaluate((el) => [getComputedStyle(el.querySelector('.brand-mark')).color, getComputedStyle(el.querySelector('.brand-name')).color, getComputedStyle(el.querySelector('.brand-name')).fontWeight]);

test('the studio bar shows the 12toons name, and the Project ID box of a free account has no amber edge', async ({ page }) => {
  await open(page);
  await expect(page.locator('.studio-bar .studio-brand')).toContainText('12');
  await expect(page.locator('.studio-bar .studio-brand')).toContainText('toons');
  expect(await edge(page)).not.toBe('rgb(217, 164, 65)');
  await expect(page.locator('.studio-bar .project-id')).not.toHaveAttribute('data-t', /.*/);
  expect(await logoColors(page)).toEqual(['rgb(165, 151, 255)', 'rgb(242, 243, 245)', '800']);
  // the name sits between the quality picker and the project ID, not on top of them
  const box = async (sel) => page.locator(sel).first().boundingBox();
  const q = await box('.studio-bar .preview-quality'), brand = await box('.studio-bar .studio-brand'), id = await box('.studio-bar .project-id');
  expect(brand.x).toBeGreaterThan(q.x + q.width); expect(brand.x + brand.width).toBeLessThan(id.x);
});

test('a paid account or an admin gets an amber edge on the Project ID box; the bar and the logo stay as they are', async ({ page }) => {
  await open(page, 'paid');
  await expect(page.locator('.studio-bar .project-id')).toHaveAttribute('data-t', '');
  expect(await edge(page)).toBe('rgb(217, 164, 65)');
  expect(await page.locator('.studio-bar').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(29, 30, 34)');   // the bar is the normal dark bar
  expect(await logoColors(page)).toEqual(['rgb(165, 151, 255)', 'rgb(242, 243, 245)', '800']);
  await expect(page.locator('.studio-bar .project-id')).toContainText(/\d{9}/);
  await expect(page.locator('.studio-bar')).not.toContainText(/paid|premium|gold|pro\b/i);   // nothing in the text gives the plan away
});

test('a free account (the plan check says free) has no amber edge', async ({ page }) => {
  await open(page, 'free');
  await expect(page.locator('.studio-bar .project-id')).not.toHaveAttribute('data-t', /.*/);
});
