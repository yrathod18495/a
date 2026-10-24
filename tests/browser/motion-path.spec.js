import { test, expect } from '@playwright/test';

async function studio(page) {
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.route('**/api/security', r => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', r => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Path');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.locator('#app .stagebox canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready)).toBe(true);
  const chars = page.locator('#app .tabs.big').getByRole('button', { name: 'Characters', exact: true });
  if (await chars.getAttribute('aria-pressed') !== 'true') await chars.click();
  await page.getByRole('button', { name: '＋ Add character', exact: true }).click();
  await page.locator('.cp-card').filter({ hasText: /^Neha$/ }).click();
  await page.locator('.cp-poses .pose').first().click();
  await expect.poll(() => page.evaluate(() => window.__toon.stage.layers.length)).toBe(1);
}

test('a line drawn with the pen tool becomes the path the character walks along, and it is saved and removable', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await studio(page);
  await page.locator('.advanced-tools').evaluate((el) => { el.open = true; });
  await page.locator('.advanced-tools-list').getByRole('button', { name: 'Move', exact: true }).click();
  await page.getByRole('button', { name: /Pen se path banayein/ }).click();
  const box = await page.locator('#app .stagewrap canvas').boundingBox();
  const pt = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
  await page.mouse.move(...pt(0.15, 0.8)); await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(...pt(0.15 + 0.7 * i / 20, 0.8 - 0.3 * i / 20));
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => Object.keys(window.__toon.S.paths).length)).toBe(1);
  const keys = await page.evaluate(() => Object.values(window.__toon.S.charKeys)[0]);
  expect(keys.length).toBeGreaterThan(3); expect(keys.every((k) => k.pathKey)).toBe(true);
  expect(keys[0].x).toBeLessThan(0.2); expect(keys.at(-1).x).toBeGreaterThan(0.8);
  // at the middle of the walk the character is in the middle of the line
  const mid = await page.evaluate(() => { const { S, stage } = window.__toon, p = Object.values(S.paths)[0], l = stage.layers[0]; stage.render(p.start + p.dur / 2, 0, [], []); return l.axf; });
  expect(mid).toBeGreaterThan(0.4); expect(mid).toBeLessThan(0.6);
  await page.getByRole('button', { name: /Path hatayein/ }).click();
  await expect.poll(() => page.evaluate(() => Object.keys(window.__toon.S.charKeys).length)).toBe(0);
  expect(errors).toEqual([]);
});
