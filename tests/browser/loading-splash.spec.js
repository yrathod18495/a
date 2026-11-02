import { test, expect } from '@playwright/test';

test('the loading screen is a scratch card: a coin scratches the foil and the real 12toons logo shows up, with a changing line; it goes away when the app is ready', async ({ page }) => {
  const errors = [], loaded = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => { if (r.url().includes('/images/logo-anim/')) loaded.push([r.url().split('/').pop(), r.status()]); });
  await page.route('**/api/security', async (r) => { await new Promise((res) => setTimeout(res, 5000)); await r.fulfill({ json: { maintenance: false } }); });
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug#/toons');
  const splash = page.locator('.loading-splash'), logo = splash.locator('svg.ls-logo');
  await expect(splash).toBeVisible();
  await expect(logo).toBeVisible();
  await expect(logo.locator('image')).toHaveCount(12);
  await expect(logo.locator('.ls-cover')).toBeVisible();
  await expect(splash).toContainText('Getting things ready');
  await expect(splash.locator('.ls-line')).toHaveText('Your story, your toons.');
  // every piece of the logo was downloaded
  await expect(logo.and(page.locator('.go'))).toBeVisible();
  expect(new Set(loaded.map(([n]) => n)).size).toBe(12);
  expect(loaded.every(([, status]) => status === 200)).toBe(true);
  // while it runs: the scratched part grows and the coin moves across the card
  const read = () => page.evaluate(() => { const s = document.querySelector('.ls-scratched'), c = document.querySelector('.ls-coin').getBoundingClientRect(); return [parseFloat(getComputedStyle(s).strokeDashoffset), Math.round(c.x), Math.round(c.y)]; });
  const first = await read(); await page.waitForTimeout(700); const second = await read(); await page.waitForTimeout(700); const third = await read();
  expect(first[0]).toBeGreaterThan(second[0]); expect(second[0]).toBeGreaterThan(third[0]);       // 1 (all foil) -> 0 (all scratched)
  expect(new Set([first[1] + ',' + first[2], second[1] + ',' + second[2], third[1] + ',' + third[2]]).size).toBe(3);
  // when it is finished the foil and the coin are gone and the logo is whole
  await expect(logo.and(page.locator('.done'))).toBeVisible({ timeout: 6000 });
  await expect(logo.locator('.ls-cover')).toBeHidden();
  await expect(logo.locator('.ls-coin')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Create New Project', exact: true })).toBeVisible({ timeout: 20000 });
  await expect(splash).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('with reduced motion the logo is shown whole, nothing is scratched', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/security', async (r) => { await new Promise((res) => setTimeout(res, 2500)); await r.fulfill({ json: { maintenance: false } }); });
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug#/toons');
  await expect(page.locator('svg.ls-logo.go.done')).toBeVisible();
  await expect(page.locator('.ls-cover')).toBeHidden();
  await expect(page.locator('.ls-coin')).toBeHidden();
  expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.target?.closest?.('.ls-logo')).length)).toBe(0);
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
