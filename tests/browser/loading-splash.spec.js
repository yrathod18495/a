import { test, expect } from '@playwright/test';

test('the loading screen shows the mascot, the message and a line that changes, then goes away when the app is ready', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/security', async (r) => { await new Promise((res) => setTimeout(res, 1800)); await r.fulfill({ json: { maintenance: false } }); });
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug#/toons');
  const splash = page.locator('.loading-splash');
  await expect(splash).toBeVisible();
  await expect(splash.locator('svg.ls-mascot')).toBeVisible();
  await expect(splash).toContainText('Getting things ready');
  await expect(splash.locator('.ls-line')).toHaveText('Your story, your toons.');
  // the mascot is really animated (bouncing), not a still picture
  const y = async () => (await splash.locator('.ls-body').boundingBox()).y;
  const samples = new Set(); for (let i = 0; i < 6; i++) { samples.add(Math.round(await y())); await page.waitForTimeout(120); }
  expect(samples.size).toBeGreaterThan(2);
  await expect(page.getByRole('button', { name: 'Create New Project', exact: true })).toBeVisible({ timeout: 20000 });
  await expect(splash).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the line under the mascot changes every few seconds and stops when the screen is removed', async ({ page }) => {
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug#/hub');
  const seen = await page.evaluate(async () => {
    const { loadingSplash } = await import('/src/loading-splash.js');
    const el = loadingSplash('Loading…', { every: 200 }); document.body.append(el);
    const lines = new Set(); for (let i = 0; i < 12; i++) { lines.add(el.querySelector('.ls-line').textContent); await new Promise((r) => setTimeout(r, 150)); }
    el.remove(); await new Promise((r) => setTimeout(r, 700)); const last = el.querySelector('.ls-line').textContent; await new Promise((r) => setTimeout(r, 900));   // one pending change may still land; after that nothing moves
    return { lines: [...lines], frozen: el.querySelector('.ls-line').textContent === last };
  });
  expect(seen.lines.length).toBeGreaterThan(2);
  expect(seen.frozen).toBe(true);
});
