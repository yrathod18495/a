import { test, expect } from '@playwright/test';
test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 860 } });
// Undo / Redo with a finger: both the buttons in the top bar and the ones above the timeline must work.
test('phone: Undo and Redo work from the top bar and from the timeline buttons', async ({ page }) => {
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).tap();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('U');
  await page.getByRole('button', { name: 'Create project', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
  await page.evaluate(() => window.__toon.openTab('canvas'));
  const preset = () => page.evaluate(() => window.__toon.stage.bg.preset);
  const p0 = await preset();
  await page.locator('.sw button').nth(3).tap(); await page.waitForTimeout(600);
  const p1 = await preset(); console.log('P', p0, p1);
  if (await page.locator('.panel.open').count()) await page.locator('.panel.open .sheet-close button').tap();
  await page.locator('.history-button[aria-label=Undo]').tap(); await page.waitForTimeout(1500);
  expect(await preset()).toBe(p0);
  await page.locator('.history-button[aria-label=Redo]').tap(); await page.waitForTimeout(1500);
  expect(await preset()).toBe(p1);
  await page.locator('.tl-hist[aria-label=Undo]').tap(); await page.waitForTimeout(1500);
  expect(await preset()).toBe(p0);
  await page.locator('.tl-hist[aria-label=Redo]').tap(); await page.waitForTimeout(1500);
  expect(await preset()).toBe(p1);
});
