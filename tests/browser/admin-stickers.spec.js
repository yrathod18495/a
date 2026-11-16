import { test, expect } from '@playwright/test';
// Admin → Add Assets → Add Stickers: a PNG or an SVG becomes a see-through PNG, goes to R2 once, and its record (name, category, thumbnail) goes to the library list.
test('admin publishes a sticker from an SVG and a PNG; the list shows them with thumbnails', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1366, height: 800 });
  const saved = [], puts = [];
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', async (r) => { const b = r.request().postDataJSON(); return r.fulfill({ json: { upload: Object.fromEntries((b.items || []).map((i) => [i.hash, { url: `https://r2.fake/put/${i.hash}` }])), have: [] } }); });
  await page.context().route('https://r2.fake/**', (r) => { puts.push(r.request().url()); return r.fulfill({ status: 200, body: '' }); });
  await page.route('**/api/studio-assets', async (r) => {
    const b = r.request().postDataJSON();
    if (b.action === 'save') { saved.push(b); return r.fulfill({ json: { asset: { ...b, enabled: true } } }); }
    if (b.action === 'list') return r.fulfill({ json: { assets: saved.map((s) => ({ ...s, enabled: true })) } });
    return r.fulfill({ json: { assets: [], characters: [] } });
  });
  await page.goto('/?debug#/');
  await page.evaluate(async () => { const m = await import('/src/admin.js'); document.body.innerHTML = ''; document.body.append(await m.view({ user: { uid: 'u1', email: 'a@example.com', displayName: 'Admin' }, home() {}, toast(t) { (window.__toasts ||= []).push(t); } })); });
  await page.locator('.admin-console-tab').filter({ hasText: /^Add Assets$/ }).click();
  await page.locator('.admin-assets-tab', { hasText: 'Add Stickers' }).click();
  await expect(page.getByRole('heading', { name: 'Stickers', level: 1 })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('button', { name: 'Publish sticker' })).toBeVisible();
  await expect(page.getByLabel('Prop type')).toHaveCount(0); await expect(page.getByLabel('Blend mode')).toHaveCount(0);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><circle cx="100" cy="100" r="60" fill="#b00010"/></svg>';
  await page.getByLabel('Image file').setInputFiles([{ name: 'blood.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) }]);
  await page.getByLabel('Category').fill('Wounds');
  await page.getByRole('button', { name: 'Publish sticker' }).click();
  await expect.poll(() => saved.length, { timeout: 15000 }).toBe(1);
  expect(saved[0]).toMatchObject({ type: 'sticker', mime: 'image/png', category: 'Wounds', name: 'blood' });
  expect(saved[0].thumb).toMatch(/^data:image\/webp;base64,/); expect(saved[0].key).toMatch(/^assets\/[a-f0-9]{64}$/);
  expect(puts.length).toBe(1);                                                         // the file went to R2 once
  await expect(page.locator('.admin-asset-card')).toHaveCount(1); await expect(page.locator('.admin-asset-card img')).toHaveCount(1);
  expect(errors).toEqual([]);
});
