import { test, expect } from '@playwright/test';

async function studio(page) {
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.route('**/api/security', r => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', r => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Grade');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.locator('#app .stagebox canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready)).toBe(true);
}
const corner = (page) => page.evaluate(() => {
  const { stage } = window.__toon; stage.render(1, 0, [], []);
  const px = new Uint8Array(4), gl = stage.gl; gl.readPixels(6, 6, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return [...px];
});
const setNum = async (page, label, value) => { const box = page.getByLabel(`${label} value`, { exact: true }); await box.fill(String(value)); await box.dispatchEvent('change'); };

test('the Colour tab grades the whole scene live, presets and Reset All work, and the grade is saved with the scene', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await studio(page);
  await page.evaluate(() => { const { stage } = window.__toon; stage.bg.preset = 3; stage.S = 1; window.__toon.S.dirty = true; });
  const base = await corner(page);
  await page.locator('#app .tabs.big').getByRole('button', { name: 'Colour', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Colour Grading/ })).toBeVisible();
  // brightness down darkens, saturation 0 makes the picture grey
  await setNum(page, 'Brightness', 0.5);
  const dark = await corner(page);
  expect(dark[0] + dark[1] + dark[2]).toBeLessThan(base[0] + base[1] + base[2]);
  await setNum(page, 'Brightness', 1); await setNum(page, 'Saturation', 0);
  const grey = await corner(page);
  expect(Math.abs(grey[0] - grey[1])).toBeLessThanOrEqual(2); expect(Math.abs(grey[1] - grey[2])).toBeLessThanOrEqual(2);
  // the grade lives in the scene document
  expect(await page.evaluate(() => window.__toon.S.grade.saturation)).toBe(0);
  // a preset replaces it, Reset All brings back the original picture
  await page.getByRole('button', { name: 'Black & white', exact: true }).click();
  expect(await page.evaluate(() => window.__toon.S.grade.saturation)).toBe(0);
  await page.getByRole('button', { name: /Reset All/ }).click();
  expect(await corner(page)).toEqual(base);
  expect(await page.evaluate(() => window.__toon.stage.grade)).toBe(null);
  // hue rotation really changes the colour
  await setNum(page, 'Hue', 120);
  const hue = await corner(page);
  expect(hue).not.toEqual(base);
  expect(errors).toEqual([]);
});
