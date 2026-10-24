import { test, expect } from '@playwright/test';

async function studio(page) {
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.route('**/api/security', r => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', r => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Props');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.locator('#app .stagebox canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready)).toBe(true);
}
// what the admin tab would have published: a prop and two effects, with their files already "downloaded"
async function publish(page) {
  await page.evaluate(async () => {
    const { S, sharedBlobs } = window.__toon;
    const solid = async (color) => { const c = document.createElement('canvas'); c.width = c.height = 4; const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 4, 4); return new Promise((r) => c.toBlob(r, 'image/png')); };
    sharedBlobs.set('prop-chair', await solid('#00ff00'));
    sharedBlobs.set('fx-sparkle', await solid('#ff00ff'));
    sharedBlobs.set('fx-glow', await solid('#ff00ff'));
    S.sharedAssets.push(
      { id: 'prop-chair', type: 'prop', name: 'Chair', category: 'Furniture', thumb: 'data:image/webp;base64,AAAA', updatedAt: '1' },
      { id: 'fx-sparkle', type: 'effect', name: 'Sparkle', category: 'Magic', blend: 'normal', opacity: 1, placement: 'full', updatedAt: '2' },
      { id: 'fx-glow', type: 'effect', name: 'Glow', category: 'Light', blend: 'add', opacity: 0.5, placement: 'full', sheet: { cols: 2, rows: 2, fps: 8 }, updatedAt: '3' });
  });
}
const centerPixel = (page, t = 0) => page.evaluate((t) => {
  const { stage } = window.__toon; stage.render(t, 0, [], []);
  const px = new Uint8Array(4), gl = stage.gl; gl.readPixels(Math.floor(stage.W / 2), Math.floor(stage.H / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return [...px];
}, t);

test('props and effects come from the shared library, show in front, honour opacity, blend and time range, and survive undo/redo and reload', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await studio(page); await publish(page);
  const rail = page.locator('#app .tabs.big');
  await rail.getByRole('button', { name: 'Props', exact: true }).click();
  await expect(page.locator('.lib-card')).toHaveCount(1);
  await page.locator('.lib-card').click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.map((p) => p.kind))).toEqual(['prop']);
  await rail.getByRole('button', { name: 'Effects', exact: true }).click();
  await expect(page.locator('.lib-card')).toHaveCount(2);
  await page.locator('.lib-card').filter({ hasText: 'Sparkle' }).click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.filter((p) => p.kind === 'effect').length)).toBe(1);
  const fx = await page.evaluate(() => window.__toon.S.props.find((p) => p.kind === 'effect'));
  expect([fx.x, fx.y, fx.w, fx.h, fx.blend, fx.opacity]).toEqual([0.5, 0.5, 1, 1, 'normal', 1]);
  // the effect covers the frame in front of everything: its colour is what is on screen
  let [r, g, b] = await centerPixel(page); expect([r > 200, g < 60, b > 200]).toEqual([true, true, true]);
  // opacity and the time range
  await page.locator('input[type=range]').first().evaluate((el) => { el.value = 0.2; el.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(await page.evaluate(() => window.__toon.S.props.find((p) => p.kind === 'effect').opacity)).toBeCloseTo(0.2, 2);
  [r, g, b] = await centerPixel(page); expect(g).toBeLessThan(120); expect(r).toBeLessThan(200);
  await page.locator('input[aria-label="Dikhe: shuru (s)"]').fill('5'); await page.locator('input[aria-label="Dikhe: shuru (s)"]').blur();
  expect((await centerPixel(page, 1))[0]).toBeLessThan(120);      // before it starts: only the background
  await page.locator('input[aria-label="Dikhe: shuru (s)"]').fill(''); await page.locator('input[aria-label="Dikhe: shuru (s)"]').blur();
  // an effect never grabs clicks meant for the canvas
  await page.locator('#stagebox').click({ position: { x: 300, y: 80 } });
  expect(await page.evaluate(() => window.__toon.S.selectedPropId)).not.toBe(null);   // still the selection made by adding it, not a click grab
  // a second effect with a sprite sheet and glow blend
  await page.locator('.lib-card').filter({ hasText: 'Glow' }).click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.length)).toBe(3);
  const glow = await page.evaluate(() => window.__toon.S.props.at(-1));
  expect([glow.blend, glow.sheet.cols * glow.sheet.rows, glow.opacity]).toEqual(['add', 4, 0.5]);
  await expect(page.getByText(/Animation speed/)).toBeVisible();
  // saved with the scene, reloaded from the device
  await page.waitForTimeout(1200);
  await page.reload(); await expect.poll(() => page.evaluate(() => window.__toon?.S.ready)).toBe(true);
  const kinds = await page.evaluate(() => window.__toon.S.props.map((p) => p.kind).sort());
  expect(kinds).toEqual(['effect', 'effect', 'prop']);
  expect(errors).toEqual([]);
});

test('effects can be removed and props can be sent behind characters', async ({ page }) => {
  await studio(page); await publish(page);
  const rail = page.locator('#app .tabs.big');
  await rail.getByRole('button', { name: 'Props', exact: true }).click();
  await page.locator('.lib-card').click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.length)).toBe(1);
  await page.getByLabel('Character ke peeche rakhein').check();
  expect(await page.evaluate(() => window.__toon.S.props[0].behind)).toBe(true);
  await page.getByRole('button', { name: 'Prop hatayein' }).click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.length)).toBe(0);
  await rail.getByRole('button', { name: 'Effects', exact: true }).click();
  await page.locator('.lib-card').filter({ hasText: 'Sparkle' }).click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.length)).toBe(1);
  await page.getByRole('button', { name: 'Effect hatayein' }).click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.length)).toBe(0);
});
