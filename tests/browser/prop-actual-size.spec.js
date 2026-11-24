import { test, expect } from '@playwright/test';

// A prop is placed at the real size and shape of its picture (not squeezed into a fixed box).
async function studio(page) {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Prop size');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.locator('#app .stagebox canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
  await page.evaluate(() => window.__toon.openTab('uploads'));          // More tools -> Uploads: the Objects tile brings your own pictures in as objects
}
const picture = async (page, w, h) => Buffer.from(await page.evaluate(([w, h]) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = '#c98a00'; g.fillRect(w * 0.35, 0, w * 0.3, h);
  return c.toDataURL('image/png').split(',')[1];
}, [w, h]), 'base64');
const prop = (page, i = 0) => page.evaluate((i) => { const q = window.__toon.S.props[i]; return { w: q.w, h: q.h, y: q.y, natW: q.natW, natH: q.natH }; }, i);

test('an imported prop keeps the size and shape of its picture; Size and Original size adjust it', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await studio(page);
  const input = page.locator('#app .up-cell:has(.up-tile[data-kind="objects"]) input[type=file]');
  await input.setInputFiles({ name: 'lamp.png', mimeType: 'image/png', buffer: await picture(page, 700, 2000) });
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.length)).toBe(1);
  const lamp = await prop(page);
  expect(lamp).toMatchObject({ w: 0.1823, h: 0.9259, natW: 700, natH: 2000 });             // 700 x 2000 on a 4K reference canvas
  expect(lamp.y + lamp.h / 2).toBeLessThanOrEqual(1);                                     // not cut off at the bottom
  // selected, its bar under the timeline has Edit: Size is in % of the size it came in with
  await page.evaluate(() => { const T = window.__toon, id = T.S.props[0].id; T.S.propSel = id; T.S.selectedPropId = id; T.drawTimeline(); T.drawClipBar(); });
  await page.locator('#app .clipbar').getByRole('button', { name: /Edit/ }).click();
  const size = page.locator('.edit-dock input[aria-label="Size"]');
  const setSize = (v) => size.evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
  await setSize(50);
  const half = await prop(page);
  expect(half.w).toBeCloseTo(lamp.w / 2, 3); expect(half.h).toBeCloseTo(lamp.h / 2, 3);   // both sides together: the shape stays
  await setSize(100);                                                                       // 100 % is the picture's own size again
  expect(await prop(page)).toMatchObject({ w: lamp.w, h: lamp.h });
  await page.locator('.edit-dock').getByRole('button', { name: 'Done' }).click();
  await page.evaluate(() => window.__toon.openTab('uploads'));
  await input.setInputFiles({ name: 'badge.png', mimeType: 'image/png', buffer: await picture(page, 384, 216) });
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.length)).toBe(2);
  expect(await prop(page, 1)).toMatchObject({ w: 0.1, h: 0.1, y: 0.66 });                 // a small picture stays small and where it was put
  expect(errors).toEqual([]);
});
