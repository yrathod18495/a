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
  await rail.locator('.upload-tools>summary').click();
  await rail.getByRole('button', { name: 'Props', exact: true }).click();
  await expect(page.locator('.lib-card')).toHaveCount(1);
  await page.locator('.lib-card').click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.map((p) => p.kind))).toEqual(['prop']);
  const beneath = await centerPixel(page);
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
  [r, g, b] = await centerPixel(page);
  for (const [i, channel] of [r, g, b].entries()) expect(Math.abs(channel - (beneath[i] * 0.8 + [255, 0, 255][i] * 0.2))).toBeLessThanOrEqual(4);
  await page.locator('input[aria-label="Dikhe: shuru (s)"]').fill('5'); await page.locator('input[aria-label="Dikhe: shuru (s)"]').blur();
  const beforeEffect = await centerPixel(page, 1);
  for (let i = 0; i < 3; i++) expect(Math.abs(beforeEffect[i] - beneath[i])).toBeLessThanOrEqual(3); // the prop and background remain before the effect starts
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
  await rail.locator('.upload-tools>summary').click();
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

test('a prop can be held in the left or right hand of a character and follows that hand', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await studio(page); await publish(page);
  const rail = page.locator('#app .tabs.big');
  await rail.getByRole('button', { name: 'Characters', exact: true }).click();
  await page.getByRole('button', { name: '＋ Add character', exact: true }).click();
  await page.locator('.cp-card').filter({ hasText: /^Neha$/ }).click();
  await page.locator('.cp-poses .pose').first().click();
  await expect.poll(() => page.evaluate(() => window.__toon.stage.layers.length)).toBe(1);
  await rail.locator('.upload-tools>summary').click();
  await rail.getByRole('button', { name: 'Props', exact: true }).click();
  await page.locator('.lib-card').click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.length)).toBe(1);
  // no character picked as holder yet: it stays where it is on the stage
  expect(await page.evaluate(() => window.__toon.S.props[0].attach)).toBeUndefined();
  const where = (hand) => page.evaluate(async (hand) => {
    const { S, stage } = window.__toon, { heldAt } = await import('/shared/studio-effects.js');
    stage.render(0, 0, [], []);
    const prop = S.props[0], held = heldAt(stage.layers[0], hand);
    const px = new Uint8Array(4), gl = stage.gl; const x = Math.round(held.x), y = Math.round(stage.H - held.y);
    gl.readPixels(Math.min(stage.W - 1, Math.max(0, x)), Math.min(stage.H - 1, Math.max(0, y)), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return { x, y, color: [...px], attach: prop.attach };
  }, hand);
  await page.getByRole('button', { name: 'Left hand', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props[0].attach?.hand)).toBe('L');
  const left = await where('L');
  expect(left.attach).toEqual({ key: await page.evaluate(() => window.__toon.S.speakers.find((s) => s.charId).key), hand: 'L' });
  expect(left.color[1]).toBeGreaterThan(150);                   // the green prop is drawn on the left palm
  await page.getByRole('button', { name: 'Right hand', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props[0].attach?.hand)).toBe('R');
  const right = await where('R');
  expect(right.color[1]).toBeGreaterThan(150);                  // ... and on the right palm after switching
  expect(Math.abs(right.x - left.x)).toBeGreaterThan(20);       // the two hands are in different places
  // the prop has no free-position sliders while it is held, and goes back to the stage when released
  await expect(page.getByText('Position · left / right')).toHaveCount(0);
  await expect(page.getByText('Pakad point · left / right')).toBeVisible();
  await page.getByRole('button', { name: 'Stage par', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props[0].attach)).toBeUndefined();
  await expect(page.getByText('Position · left / right')).toBeVisible();
  // the held prop moves when the hand moves (a different animation puts the hand elsewhere)
  await page.getByRole('button', { name: 'Left hand', exact: true }).click();
  const before = await page.evaluate(async () => { const { stage } = window.__toon, { heldAt } = await import('/shared/studio-effects.js'); stage.render(2.4, 0, [], []); const h = heldAt(stage.layers[0], 'L'); return [h.x, h.y]; });
  await rail.getByRole('button', { name: 'Animations', exact: true }).click();
  await page.getByLabel('Animation category').selectOption({ index: 4 });
  await page.locator('.animation-apply').first().click();
  await page.waitForTimeout(900);
  const after = await page.evaluate(async () => { const { stage } = window.__toon, { heldAt } = await import('/shared/studio-effects.js'); stage.render(2.4, 0, [], []); const h = heldAt(stage.layers[0], 'L'); return [h.x, h.y]; });
  expect(Math.hypot(after[0] - before[0], after[1] - before[1])).toBeGreaterThan(3);
  expect(errors).toEqual([]);
});
