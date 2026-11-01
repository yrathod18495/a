import { test, expect } from '@playwright/test';

async function open(page) {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.route('**/api/studio-assets', (r) => r.fulfill({ json: { assets: [] } }));
  await page.goto('/?debug&workers=0#/hub');
}

test('the hub has a Background Generator card that opens a blank 4K canvas', async ({ page }) => {
  await open(page);
  await page.getByRole('heading', { name: 'Background Generator' }).click();
  await expect(page.locator('.bgg-canvas')).toBeVisible();
  await expect(page.locator('.bgg-size-info')).toHaveText('3840 × 2160');
  await expect(page.locator('.bgg-empty')).toBeVisible();
});

test('a background built on the canvas is saved to the database and shows up in the Animator Studio', async ({ page }) => {
  await open(page);
  await page.getByRole('heading', { name: 'Background Generator' }).click();
  await page.getByRole('button', { name: '▭ Rectangle' }).click();
  await page.getByRole('button', { name: 'T Text' }).click();
  await expect(page.locator('.bgg-layer')).toHaveCount(2);
  const canvas = await page.locator('.bgg-canvas').boundingBox();
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2); await page.mouse.down(); await page.mouse.move(canvas.x + canvas.width / 2 + 80, canvas.y + canvas.height / 2 + 40, { steps: 5 }); await page.mouse.up();
  await page.locator('.bgg-name').fill('Test sky');
  await page.getByRole('button', { name: 'Save to my backgrounds' }).click();
  await expect(page.locator('.bgg-lib-item')).toHaveCount(1, { timeout: 20000 });
  const rec = await page.evaluate(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open('12toons-projects-v1'); r.onsuccess = () => res(r.result); });
    const all = await new Promise((res) => { const r = db.transaction('bgLibrary').objectStore('bgLibrary').getAll(); r.onsuccess = () => res(r.result); });
    return { n: all.length, w: all[0].value.w, h: all[0].value.h, name: all[0].value.name, png: all[0].value.blob.type, size: all[0].value.blob.size };
  });
  expect(rec).toMatchObject({ n: 1, w: 3840, h: 2160, name: 'Test sky', png: 'image/png' });
  expect(rec.size).toBeGreaterThan(1000);
  // the studio finds it in the Background tab
  await page.evaluate(() => { location.hash = '#/toons'; });
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Uses generated bg');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.locator('#app .stagebox canvas')).toBeVisible();
  await page.getByRole('button', { name: /Background/ }).first().click();
  await expect(page.locator('.bggrid .bgc small', { hasText: 'Test sky' })).toBeVisible();
  await page.locator('.bggrid .bgc', { hasText: 'Test sky' }).click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.bgId)).toMatch(/^gen-/);
});

test('a brush paints a road on its own layer, undo takes it back, and the painting is saved and reopened', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  await page.getByRole('heading', { name: 'Background Generator' }).click();
  await page.getByRole('button', { name: /Brush/ }).click();
  await page.locator('select[aria-label="Brush"]').selectOption('dirt');
  const box = await page.locator('.bgg-canvas').boundingBox(), y = box.y + box.height / 2;
  await page.mouse.move(box.x + 60, y); await page.mouse.down(); await page.mouse.move(box.x + box.width - 60, y, { steps: 20 }); await page.mouse.up();
  await expect(page.locator('.bgg-layer')).toHaveCount(1);
  const colour = () => page.locator('.bgg-canvas').evaluate((c) => { const d = c.getContext('2d').getImageData(Math.round(c.width / 2), Math.round(c.height / 2), 1, 1).data; return { r: d[0], b: d[2] }; });
  const painted = await colour(); expect(painted.r - painted.b).toBeGreaterThan(30);               // brown, not the grey checkerboard
  await page.keyboard.press('Control+z');
  await expect(page.locator('.bgg-layer')).toHaveCount(0);
  await page.keyboard.press('Control+y');
  await expect(page.locator('.bgg-layer')).toHaveCount(1);
  await page.locator('select[aria-label="Brush"]').selectOption('grass');
  await page.mouse.move(box.x + 60, y - 80); await page.mouse.down(); await page.mouse.move(box.x + 300, y - 80, { steps: 10 }); await page.mouse.up();
  await expect(page.locator('.bgg-layer')).toHaveCount(1);                                          // the same painting layer is reused
  await page.getByRole('button', { name: 'Save to my backgrounds' }).click();
  await expect(page.locator('.bgg-lib-item')).toHaveCount(1, { timeout: 25000 });
  await page.getByRole('button', { name: 'New' }).click();
  await expect(page.locator('.bgg-layer')).toHaveCount(0);
  await page.locator('.bgg-lib-open').click();
  await expect(page.locator('.bgg-layer')).toHaveCount(1);
  await expect.poll(async () => { const c = await colour(); return c.r - c.b; }).toBeGreaterThan(30);   // the saved painting came back
  expect(errors).toEqual([]);
});
