import { test, expect } from '@playwright/test';
import { installLibrary, tool } from './studio-library.js';

async function studio(page) {
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.route('**/api/security', r => r.fulfill({ json: { maintenance: false } }));
  await installLibrary(page);          // "Neha" comes from the admin's character library (no character is bundled)
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Props');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.locator('#app .stagebox canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
}
// what the admin tab would have published: a prop and two effects, with their files already "downloaded"
async function publish(page) {
  await page.evaluate(async () => {
    const { S, sharedBlobs } = window.__toon;
    const solid = async (color) => { const c = document.createElement('canvas'); c.width = c.height = 4; const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 4, 4); return new Promise((r) => c.toBlob(r, 'image/png')); };
    sharedBlobs.set('prop-chair', await solid('#00ff00')); sharedBlobs.set('prop-cup', await solid('#00ff00'));
    sharedBlobs.set('fx-sparkle', await solid('#ff00ff'));
    sharedBlobs.set('fx-glow', await solid('#ff00ff'));
    S.sharedAssets.push(
      { id: 'prop-cup', type: 'prop', name: 'Cup', category: 'Kitchen', group: 'hand', access: 'free', updatedAt: '4' },
      { id: 'prop-chair', type: 'prop', name: 'Chair', category: 'Furniture', access: 'free', thumb: 'data:image/webp;base64,AAAA', updatedAt: '1' },
      { id: 'fx-sparkle', type: 'effect', name: 'Sparkle', category: 'Magic', access: 'free', blend: 'normal', opacity: 1, placement: 'full', updatedAt: '2' },
      { id: 'fx-glow', type: 'effect', name: 'Glow', category: 'Light', access: 'free', blend: 'add', opacity: 0.5, placement: 'full', sheet: { cols: 2, rows: 2, fps: 8 }, updatedAt: '3' });
  });
}
const centerPixel = (page, t = 0) => page.evaluate((t) => {
  const { stage } = window.__toon; stage.render(t, 0, [], []);
  const px = new Uint8Array(4), gl = stage.gl; gl.readPixels(Math.floor(stage.W / 2), Math.floor(stage.H / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return [...px];
}, t);

/** a library tile in the open panel (Objects, Overlays ...), by its name */
const libTile = (page, name) => page.locator('#app .panel .tile:not(.add)', { hasText: name });
/** the selected object's editor: the clip bar under the timeline has Edit (size, turn, opacity, glow, behind) */
const openEdit = async (page) => { await page.locator('#app .clipbar').getByRole('button', { name: /Edit/ }).click(); await expect(page.locator('.edit-dock .ed-title')).toBeVisible(); };
const setDock = (page, label, v) => page.locator(`.edit-dock input[aria-label="${label}"]`).evaluate((el, val) => { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); }, v);

test('props and effects come from the shared library, show in front, honour opacity, blend and time range, and survive undo/redo and reload', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await studio(page); await publish(page);
  await tool(page, 'Objects');
  await expect(libTile(page, 'Chair')).toHaveCount(1); await expect(libTile(page, 'Cup')).toHaveCount(0);          // a hand prop is not an object
  await libTile(page, 'Chair').click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.map((p) => p.kind))).toEqual(['prop']);
  const beneath = await centerPixel(page);
  await tool(page, 'Overlays');                                            // the sticker-style effects (fire, sparkles ...) are the Overlays tool
  await expect(page.locator('#app .panel .tile:not(.add)')).toHaveCount(2);
  await libTile(page, 'Sparkle').click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.filter((p) => p.kind === 'effect').length)).toBe(1);
  const fx = await page.evaluate(() => window.__toon.S.props.find((p) => p.kind === 'effect'));
  expect([fx.x, fx.y, fx.w, fx.h, fx.blend, fx.opacity]).toEqual([0.5, 0.5, 1, 1, 'normal', 1]);
  // the effect covers the frame in front of everything: its colour is what is on screen
  let [r, g, b] = await centerPixel(page); expect([r > 200, g < 60, b > 200]).toEqual([true, true, true]);
  // opacity, in the selected overlay's editor
  await page.evaluate((id) => { const T = window.__toon; T.S.propSel = id; T.S.selectedPropId = id; T.drawTimeline(); T.drawClipBar(); }, fx.id);
  await openEdit(page); await page.locator('.edit-dock .ed-chip', { hasText: 'Opacity' }).click();
  await setDock(page, 'Opacity', 20);
  expect(await page.evaluate(() => window.__toon.S.props.find((p) => p.kind === 'effect').opacity)).toBeCloseTo(0.2, 2);
  [r, g, b] = await centerPixel(page);
  for (const [i, channel] of [r, g, b].entries()) expect(Math.abs(channel - (beneath[i] * 0.8 + [255, 0, 255][i] * 0.2))).toBeLessThanOrEqual(4);
  await page.locator('.edit-dock').getByRole('button', { name: 'Done' }).click();
  // the time range: before its start the overlay is not drawn
  await page.evaluate(async () => { const T = window.__toon, p = T.S.props.find((x) => x.kind === 'effect'); p.start = 5; p.end = 8; await T.stage.setProps(T.S.props); });
  const beforeEffect = await centerPixel(page, 1);
  for (let i = 0; i < 3; i++) expect(Math.abs(beforeEffect[i] - beneath[i])).toBeLessThanOrEqual(3); // the prop and background remain before the effect starts
  // an effect never grabs clicks meant for the canvas
  await page.locator('#stagebox').click({ position: { x: 300, y: 80 } });
  expect(await page.evaluate(() => window.__toon.S.props.filter((p) => p.kind === 'effect').length)).toBe(1);
  // a second effect with a sprite sheet and glow blend
  await tool(page, 'Overlays');
  await libTile(page, 'Glow').click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.length)).toBe(3);
  const glow = await page.evaluate(() => window.__toon.S.props.at(-1));
  expect([glow.blend, glow.sheet.cols * glow.sheet.rows, glow.opacity]).toEqual(['add', 4, 0.5]);
  // undo / redo
  await page.getByRole('button', { name: 'Undo', exact: true }).first().click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.length)).toBe(2);
  await page.getByRole('button', { name: 'Redo', exact: true }).first().click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.length)).toBe(3);
  // saved with the scene, reloaded from the device
  await page.waitForTimeout(1200);
  await page.reload(); await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
  const kinds = await page.evaluate(() => window.__toon.S.props.map((p) => p.kind).sort());
  expect(kinds).toEqual(['effect', 'effect', 'prop']);
  expect(errors).toEqual([]);
});

test('effects can be removed and props can be sent behind characters', async ({ page }) => {
  await studio(page); await publish(page);
  await tool(page, 'Objects');
  await libTile(page, 'Chair').click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.length)).toBe(1);
  await page.evaluate(() => { const T = window.__toon, id = T.S.props[0].id; T.S.propSel = id; T.S.selectedPropId = id; T.drawTimeline(); T.drawClipBar(); });
  await openEdit(page);
  await page.locator('.edit-dock').getByRole('button', { name: 'Behind the characters' }).click();
  expect(await page.evaluate(() => window.__toon.S.props[0].behind)).toBe(true);
  await page.locator('.edit-dock').getByRole('button', { name: 'Done' }).click();
  await page.locator('#app .clipbar').getByRole('button', { name: /Delete/ }).click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.length)).toBe(0);
  await tool(page, 'Overlays');
  await libTile(page, 'Sparkle').click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.length)).toBe(1);
  await page.evaluate(() => { const T = window.__toon, id = T.S.props[0].id; T.S.propSel = id; T.S.selectedPropId = id; T.drawTimeline(); T.drawClipBar(); });
  await page.locator('#app .clipbar').getByRole('button', { name: /Delete/ }).click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.length)).toBe(0);
});

test('a prop can be held in the left or right hand of a character and follows that hand', async ({ page }) => {
  test.setTimeout(120000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await studio(page); await publish(page);
  const rail = page.locator('#app .tabs.big');
  await rail.getByRole('button', { name: 'Characters', exact: true }).click();
  await page.locator('.cp-card').filter({ hasText: /^Neha$/ }).click();
  await page.locator('.cp-poses .pose').first().click();
  await expect.poll(() => page.evaluate(() => window.__toon.stage.layers.length)).toBe(1);
  await page.evaluate(() => { const T = window.__toon; T.S.sel = T.S.speakers.find((s) => s.charId).key; });
  await rail.getByRole('button', { name: 'Props', exact: true }).click();          // Props = the hand props
  await page.locator('.hand-card', { hasText: 'Cup' }).click();
  await page.locator('.edit-dock .ed-hand[data-hand="L"]').click();                // it asks which hand first
  await expect.poll(() => page.evaluate(() => window.__toon.S.props[0]?.attach?.hand)).toBe('L');
  const where = (hand, t = 0) => page.evaluate(async ([hand, t]) => {
    const { S, stage } = window.__toon, { heldAt } = await import('/shared/studio-effects.js');
    stage.render(t, 0, [], []);
    const prop = S.props[0], held = heldAt(stage.layers[0], hand);
    const px = new Uint8Array(4), gl = stage.gl; const x = Math.round(held.x), y = Math.round(stage.H - held.y);
    gl.readPixels(Math.min(stage.W - 1, Math.max(0, x)), Math.min(stage.H - 1, Math.max(0, y)), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return { x, y, color: [...px], attach: prop.attach };
  }, [hand, t]);
  const left = await where('L');
  expect(left.attach).toEqual({ key: await page.evaluate(() => window.__toon.S.speakers.find((s) => s.charId).key), hand: 'L' });
  expect(left.color[1]).toBeGreaterThan(150);                   // the green prop is drawn on the left palm
  await page.locator('.edit-dock .ed-chip[data-hand="R"]').click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props[0].attach?.hand)).toBe('R');
  const right = await where('R');
  expect(right.color[1]).toBeGreaterThan(150);                  // ... and on the right palm after switching
  expect(Math.abs(right.x - left.x)).toBeGreaterThan(20);       // the two hands are in different places
  await page.locator('.edit-dock').getByRole('button', { name: 'Done' }).click();
  // the held prop moves when the hand moves (a different animation puts the hand elsewhere)
  const before = await where('R', 2.4);
  await rail.getByRole('button', { name: 'Animations', exact: true }).click();
  await page.locator('.anim-cats .anim-cat', { hasText: /walk/i }).first().click();
  await page.locator('.animation-apply').first().click();
  await expect(page.locator('.busy')).toHaveCount(0); await page.waitForTimeout(900);
  const after = await where('R', 2.4);
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(3);
  expect(after.color[1]).toBeGreaterThan(150);                  // still in the hand
  expect(errors).toEqual([]);
});
