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
  await box.getByRole('button', { name: '480p', exact: true }).click(); const small = await size();
  await box.getByRole('button', { name: '1080p', exact: true }).click(); const big = await size();
  const mb = (t) => parseFloat(t.match(/[\d.]+/)[0]);
  expect(mb(big)).toBeGreaterThan(mb(small));
  expect(await page.evaluate(() => window.__toon.S.fps)).toBe(40);                    // always opens on 40 fps, the minimum
  await expect(box.getByRole('button', { name: '60', exact: true })).toBeVisible();
  await expect(box.getByRole('button', { name: '90', exact: true })).toBeVisible();     // and 60 fps is there for the smoothest video
  await expect(box.getByRole('button', { name: '360p', exact: true })).toHaveCount(0); await expect(box.getByRole('button', { name: '2K', exact: true })).toBeVisible();          // no 360p, there is 2K
  for (const f of ['12', '15', '24', '30']) await expect(box.getByRole('button', { name: f, exact: true })).toHaveCount(0);          // nothing below 40 fps
  await box.getByRole('button', { name: '60', exact: true }).click();
  expect(await page.evaluate(() => ({ q: window.__toon.S.quality, f: window.__toon.S.fps, fmt: window.__toon.S.format }))).toEqual({ q: 1080, f: 60, fmt: 'mp4' });
  const m = await box.boundingBox(); expect(m.x).toBeGreaterThanOrEqual(0); expect(m.x + m.width).toBeLessThanOrEqual(390);
  await expect(box.getByRole('button', { name: 'Render on this device', exact: true })).toBeVisible();
  await expect(box.getByRole('button', { name: /Render on the cloud/ })).toBeVisible();
  await page.locator('.modal .row .btn').first().click(); await expect(box).toHaveCount(0);
  // Render closes the box and hands over to the export (it asks the server first; the fake debug session has no account, so only the hand-over is checked)
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  await page.locator('.exp-pop-go').click(); await expect(page.locator('.exp-pop')).toHaveCount(0); await page.waitForTimeout(800);
  expect(errors).toEqual([]);
});

test('90 fps: when this device cannot encode it, Render is off and a plain message says why', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Fps');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
  await page.evaluate(() => { const real = VideoEncoder.isConfigSupported.bind(VideoEncoder); VideoEncoder.isConfigSupported = async (c) => (c.framerate > 60 ? { supported: false } : real(c)); });
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  const box = page.locator('.exp-pop'); await expect(box).toBeVisible();
  await box.getByRole('button', { name: '90', exact: true }).click();
  expect(await page.evaluate(() => window.__toon.S.fps)).toBe(90);
  await expect(box.locator('.exp-pop-note')).toBeVisible(); await expect(box.locator('.exp-pop-go')).toBeDisabled();
  await box.getByRole('button', { name: '60', exact: true }).click();
  await expect(box.locator('.exp-pop-note')).toBeHidden(); await expect(box.locator('.exp-pop-go')).toBeEnabled();
});

test('4K never offers 90 fps (and drops to 60 when 4K is picked); 2K still has 90', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Heavy');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
  await page.getByRole('button', { name: 'Export', exact: true }).first().click();
  const box = page.locator('.exp-pop'); await expect(box).toBeVisible();
  await box.getByRole('button', { name: '2K', exact: true }).click(); await box.getByRole('button', { name: '90', exact: true }).click();
  expect(await page.evaluate(() => window.__toon.S.fps)).toBe(90);
  await box.getByRole('button', { name: '4K', exact: true }).click();
  await expect(box.getByRole('button', { name: '90', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__toon.S.fps)).toBe(60);
});
