import { test, expect } from '@playwright/test';

const magenta = (page, w, h) => page.evaluate(([w, h]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = '#ff00ff'; g.fillRect(0, 0, w, h); return c.toDataURL('image/png').split(',')[1]; }, [w, h]).then((b) => Buffer.from(b, 'base64'));
async function openTester(page) {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&tester#/tester');
  const start = page.getByRole('button', { name: /Create my own character/ });
  if (await start.isVisible({ timeout: 5000 }).catch(() => false)) await start.click();
  await expect(page.locator('.cs-tabs button.on')).toHaveText('Create', { timeout: 30000 });
}
/** centre of the magenta pixels on the preview, in screen pixels */
async function where(page) {
  const shot = (await page.locator('.cs-stage canvas').screenshot()).toString('base64');
  return page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob()), c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0, sx = 0, sy = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 70 && d[i + 2] > 200) { const p = i / 4; sx += p % c.width; sy += Math.floor(p / c.width); n++; }
    return n > 30 ? { x: sx / n, y: sy / n, n } : null;
  }, shot);
}
const settle = async (page, before, test) => { await expect.poll(async () => { const w = await where(page); return w && test(w, before); }, { timeout: 20000, intervals: [400] }).toBe(true); return where(page); };

test('a part is placed by hand: drag it on the preview, arrow keys, size, forward / back, reset', async ({ page }) => {
  test.setTimeout(180000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await openTester(page);
  await page.locator('.cs-panel input[type=file]').first().setInputFiles([{ name: 'TORSO_2.png', mimeType: 'image/png', buffer: await magenta(page, 160, 160) }]);
  await expect(page.locator('.cs-place')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.cs-place-note')).toContainText(/Dhad/i);
  // bring it to the very front first, so nothing hides a part of it while it is measured (this also tests forward)
  await page.evaluate(() => { window.__charstudio.st.order.TORSO_2 = 39; });
  await page.getByRole('button', { name: '⬆ Aage' }).click();
  await expect(page.locator('.cs-place-note')).toContainText('aage 40');
  let p0 = null; await expect.poll(async () => { const w = await where(page); if (!w) return false; await page.waitForTimeout(1500); const w2 = await where(page); p0 = w2; return !!w2 && Math.abs(w2.y - w.y) < 1 && Math.abs(w2.n - w.n) < w.n * 0.01; }, { timeout: 40000 }).toBe(true);
  // drag it 70 px right and 40 px down with the mouse
  const box = await page.locator('.cs-stage canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 35, box.y + box.height / 3 + 20, { steps: 4 }); await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 3 + 40, { steps: 4 }); await page.mouse.up();
  const p1 = await settle(page, p0, (w, b) => Math.abs(w.x - b.x - 70) < 8 && Math.abs(w.y - b.y - 40) < 8);
  expect(Math.abs(p1.x - p0.x - 70)).toBeLessThan(8); expect(Math.abs(p1.y - p0.y - 40)).toBeLessThan(8);
  // arrow keys: shift + left = 10 px left, up = 1 px up
  await page.locator('.cs-stage').click({ position: { x: 5, y: 5 }, modifiers: [] }).catch(() => {});
  await page.keyboard.press('Shift+ArrowLeft');
  const p2 = await settle(page, p1, (w, b) => Math.abs(w.x - b.x + 10) < 4);
  expect(Math.abs(p2.y - p1.y)).toBeLessThan(4);
  // the buttons: down
  await page.locator('.cs-place button[title="Neeche"]').click();
  const p3 = await settle(page, p2, (w, b) => w.y - b.y > 1.5);
  expect(p3.y).toBeGreaterThan(p2.y);
  // bigger
  await page.locator('.cs-place .btn', { hasText: '＋' }).click(); await page.locator('.cs-place .btn', { hasText: '＋' }).click();
  await settle(page, p3, (w, b) => w.n > b.n * 1.05);
  // forward / back is remembered per part and shown
  await page.getByRole('button', { name: '⬆ Aage' }).click();
  expect(await page.evaluate(() => Object.values(window.__charstudio.st.order))).toEqual([41]);
  await expect(page.locator('.cs-place-note')).toContainText('aage 41');
  // saved with the character (profile) and undone by Reset
  const profile = await page.evaluate(() => ({ xf: Object.keys(window.__charstudio.st.xf).length, order: Object.keys(window.__charstudio.st.order).length }));
  expect(profile).toEqual({ xf: 1, order: 1 });
  await page.getByRole('button', { name: /Reset/ }).click();
  expect(await page.evaluate(() => [Object.keys(window.__charstudio.st.xf).length, Object.keys(window.__charstudio.st.order).length])).toEqual([0, 0]);
  expect(errors).toEqual([]);
});

test('with "Hath se rakho" off the preview is not dragged, and the bar is hidden on the Start tab', async ({ page }) => {
  await openTester(page);
  await page.locator('.cs-panel input[type=file]').first().setInputFiles([{ name: 'TORSO_2.png', mimeType: 'image/png', buffer: await magenta(page, 160, 160) }]);
  await expect(page.locator('.cs-place')).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: /Hath se rakho: ON/ }).click();
  await expect(page.getByRole('button', { name: /Hath se rakho: OFF/ })).toBeVisible();
  const box = await page.locator('.cs-stage canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 3 + 30, { steps: 4 }); await page.mouse.up();
  expect(await page.evaluate(() => Object.keys(window.__charstudio.st.xf).length)).toBe(0);
  await page.locator('.cs-tabs button', { hasText: 'Start' }).click();
  await expect(page.locator('.cs-place')).toBeHidden();
});
