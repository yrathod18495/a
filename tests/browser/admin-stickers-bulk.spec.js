import { test, expect } from '@playwright/test';
// Admin → Add Stickers with 48 files at once: a progress bar and "n of 48" appear, three go at a time, a failing file is retried once and then listed, the rest are published.
async function setup(page, { slowMs = 120, failName = null, hangName = null } = {}) {
  const saved = [], attempts = {};
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', async (r) => { const b = r.request().postDataJSON(); return r.fulfill({ json: { upload: Object.fromEntries((b.items || []).map((i) => [i.hash, { url: `https://r2.fake/put/${i.hash}` }])), have: [] } }); });
  await page.context().route('https://r2.fake/**', async (r) => { await new Promise((x) => setTimeout(x, slowMs)); return r.fulfill({ status: 200, body: '' }); });
  await page.route('**/api/studio-assets', async (r) => {
    const b = r.request().postDataJSON();
    if (b.action === 'save') {
      attempts[b.name] = (attempts[b.name] || 0) + 1;
      if (failName && b.name === failName) return r.fulfill({ status: 500, json: { error: 'x' } });
      saved.push(b); return r.fulfill({ json: { asset: { ...b, enabled: true } } });
    }
    if (b.action === 'list') return r.fulfill({ json: { assets: saved.map((s) => ({ ...s, enabled: true })) } });
    return r.fulfill({ json: { assets: [], characters: [] } });
  });
  await page.goto('/?debug#/');
  await page.evaluate(async () => { const m = await import('/src/admin.js'); document.body.innerHTML = ''; document.body.append(await m.view({ user: { uid: 'u1', email: 'a@example.com', displayName: 'Admin' }, home() {}, toast(t) { (window.__toasts ||= []).push(t); } })); });
  await page.locator('.admin-console-tab').filter({ hasText: /^Add Assets$/ }).click();
  await page.locator('.admin-assets-tab', { hasText: 'Add Stickers' }).click();
  await expect(page.getByRole('heading', { name: 'Stickers', level: 1 })).toBeVisible({ timeout: 5000 });
  const files = Array.from({ length: 48 }, (_, i) => ({ name: `scar-${String(i + 1).padStart(2, '0')}.svg`, mimeType: 'image/svg+xml', buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><circle cx="${20 + i}" cy="40" r="${10 + (i % 20)}" fill="#b00010"/></svg>`) }));
  await page.getByLabel('Image file').setInputFiles(files);
  return { saved, attempts };
}
test('48 stickers: the progress bar moves, all 48 are published, and the page says so', async ({ page }) => {
  test.setTimeout(150000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const { saved } = await setup(page);
  await page.getByRole('button', { name: 'Publish sticker' }).click();
  await expect(page.locator('.upload-progress')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('.upload-progress .pb-text')).toContainText(/Publishing|of 48/, { timeout: 5000 });
  const widths = new Set(); for (let i = 0; i < 12; i++) { widths.add(await page.locator('.pb-fill').evaluate((e) => e.style.width, null, { timeout: 500 }).catch(() => 'done')); await page.waitForTimeout(250); }
  expect([...widths].filter((w) => w !== 'done').length).toBeGreaterThan(2);          // it really moves (three or more different widths while it was there)
  await expect.poll(() => saved.length, { timeout: 60000 }).toBe(48);
  await expect(page.locator('.upload-progress')).toHaveCount(0, { timeout: 10000 });
  await expect(page.getByRole('button', { name: 'Publish sticker' })).toBeEnabled();
  expect(await page.evaluate(() => window.__toasts.at(-1))).toMatch(/48 stickers published/);
  expect(errors).toEqual([]);
});
test('one bad file is tried twice, listed by name, and the other 47 are still published', async ({ page }) => {
  const { saved, attempts } = await setup(page, { slowMs: 20, failName: 'scar-07' });
  await page.getByRole('button', { name: 'Publish sticker' }).click();
  await expect(page.locator('.upload-progress li')).toHaveCount(1, { timeout: 60000 });
  await expect(page.locator('.upload-progress li')).toContainText('scar-07.svg');
  expect(saved.length).toBe(47); expect(attempts['scar-07']).toBe(2);
  expect(await page.evaluate(() => window.__toasts.at(-1))).toMatch(/47 published, 1 did not upload/);
});
test('Stop ends the batch and says how many were published', async ({ page }) => {
  const { saved } = await setup(page, { slowMs: 300 });
  await page.getByRole('button', { name: 'Publish sticker' }).click();
  await page.waitForTimeout(1500); await page.getByRole('button', { name: 'Stop' }).click();
  await expect.poll(() => page.evaluate(() => (window.__toasts || []).at(-1) || ''), { timeout: 30000 }).toMatch(/Stopped\. \d+ stickers? published/);
  expect(saved.length).toBeLessThan(48); await expect(page.getByRole('button', { name: 'Publish sticker' })).toBeEnabled();
});
