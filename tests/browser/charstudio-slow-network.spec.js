import { test, expect } from '@playwright/test';
// On a very slow or dead connection the Character Editor still opens from what this device knows (the shared library keeps loading in the background).
test('Character Editor opens in a few seconds when the network never answers', async ({ page }) => {
  test.setTimeout(60000);
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false, features: {} } }));
  await page.route('**/api/**', (r) => (r.request().url().includes('/api/security') ? r.fallback() : new Promise(() => {})));
  await page.route('**/12toons/*.json', () => new Promise(() => {}));
  await page.goto('/?debug#/toons');
  const id = await page.evaluate(async () => { const s = await import('/src/store.js'), p = await s.createProject('debug', 'character', 'Slow'); s.selectProject('debug', p.id); return p.id; });
  const t0 = Date.now();
  await page.goto('/?debug#/characters/' + id); await page.reload();
  await expect(page.locator('.cs-panel')).toBeVisible({ timeout: 15000 });
  expect(Date.now() - t0).toBeLessThan(15000);
});
