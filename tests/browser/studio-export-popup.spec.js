import { test, expect } from '@playwright/test';
// The header's Download button opens a small box (quality, fps, estimated size, Render) instead of rendering at once.
test('Download opens the export box (no direct render); quality changes the estimate; settings are MP4', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 860 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Exp');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
  await page.evaluate(() => { window.__started = 0; });
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  const box = page.locator('.exp-pop'); await expect(box).toBeVisible();
  await expect(box).not.toContainText(/mp4|webm/i);                       // no format wording
  const size = () => box.locator('.exp-pop-info b').first().textContent();
  await box.getByRole('button', { name: '360p', exact: true }).click(); const small = await size();
  await box.getByRole('button', { name: '1080p', exact: true }).click(); const big = await size();
  const mb = (t) => parseFloat(t.match(/[\d.]+/)[0]);
  expect(mb(big)).toBeGreaterThan(mb(small));
  expect(await page.evaluate(() => window.__toon.S.fps)).toBe(30);                    // always opens on 30 fps
  await expect(box.getByRole('button', { name: '60', exact: true })).toBeVisible();     // and 60 fps is there for the smoothest video
  await box.getByRole('button', { name: '15', exact: true }).click();
  expect(await page.evaluate(() => ({ q: window.__toon.S.quality, f: window.__toon.S.fps, fmt: window.__toon.S.format }))).toEqual({ q: 1080, f: 15, fmt: 'mp4' });
  const m = await box.boundingBox(); expect(m.x).toBeGreaterThanOrEqual(0); expect(m.x + m.width).toBeLessThanOrEqual(390);
  await expect(box.getByRole('button', { name: 'Render', exact: true })).toBeVisible();
  await page.locator('.modal .row .btn').first().click(); await expect(box).toHaveCount(0);
  await page.getByRole('button', { name: 'Export', exact: true }).first().click(); expect(await page.evaluate(() => window.__toon.S.fps)).toBe(30);          // opened again: back on 30 fps
  await page.locator('.modal .row .btn').first().click(); await expect(box).toHaveCount(0);
  // Render closes the box and hands over to the export (it asks the server first; the fake debug session has no account, so only the hand-over is checked)
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  await page.locator('.exp-pop-go').click(); await expect(page.locator('.exp-pop')).toHaveCount(0); await page.waitForTimeout(800);
  expect(errors).toEqual([]);
});
