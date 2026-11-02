import { test, expect } from '@playwright/test';

test('the loading screen draws the real 12toons logo piece by piece, with a changing line, and goes away when the app is ready', async ({ page }) => {
  const errors = [], loaded = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => { if (r.url().includes('/images/logo-anim/')) loaded.push([r.url().split('/').pop(), r.status()]); });
  await page.route('**/api/security', async (r) => { await new Promise((res) => setTimeout(res, 3500)); await r.fulfill({ json: { maintenance: false } }); });
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug#/toons');
  const splash = page.locator('.loading-splash');
  await expect(splash).toBeVisible();
  await expect(splash.locator('svg.ls-logo')).toBeVisible();
  await expect(splash.locator('svg.ls-logo image')).toHaveCount(12);
  await expect(splash).toContainText('Getting things ready');
  await expect(splash.locator('.ls-line')).toHaveText('Your story, your toons.');
  // every piece of the logo was downloaded
  await expect(splash.locator('svg.ls-logo.go')).toBeVisible();
  expect(new Set(loaded.map(([n]) => n)).size).toBe(12);
  expect(loaded.every(([, status]) => status === 200)).toBe(true);
  // really animated: pieces are moving right now, and the "1" is not in its final place at the start
  expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)).toBeGreaterThan(8);
  const frames = new Set(); for (let i = 0; i < 8; i++) { frames.add(await page.locator('.ls-one').evaluate((el) => getComputedStyle(el).transform + getComputedStyle(el).opacity)); await page.waitForTimeout(90); }
  expect(frames.size).toBeGreaterThan(2);
  await expect(page.getByRole('button', { name: 'Create New Project', exact: true })).toBeVisible({ timeout: 20000 });
  await expect(splash).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('with reduced motion the logo is shown whole and still', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/security', async (r) => { await new Promise((res) => setTimeout(res, 2500)); await r.fulfill({ json: { maintenance: false } }); });
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug#/toons');
  await expect(page.locator('svg.ls-logo.go')).toBeVisible();
  expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.target?.closest?.('.ls-logo')).length)).toBe(0);
  expect(await page.locator('.ls-pencil').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
});

test('the line under the logo changes every few seconds and stops when the screen is removed', async ({ page }) => {
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
