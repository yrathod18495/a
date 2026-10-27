import { test, expect } from '@playwright/test';
async function studio(page) {
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.route('**/api/security', route => route.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', route => route.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Delete layers');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
}
async function history(page, name) {
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page.locator('.busy')).toHaveCount(0);
}
test('frame and timeline character delete remove the actor and animation; undo and redo restore it', async ({ page }) => {
  await studio(page);
  const rail = page.locator('#app .tabs.big');
  await rail.getByRole('button', { name: 'Characters', exact: true }).click();
  await page.getByRole('button', { name: 'Add character', exact: true }).click();
  await page.locator('.cp-card').filter({ hasText: /^Neha$/ }).click();
  await page.locator('.cp-poses .pose').first().click();
  await expect.poll(() => page.evaluate(() => window.__toon.stage.layers.length)).toBe(1);
  await rail.getByRole('button', { name: 'Animations', exact: true }).click();
  await page.locator('.animation-apply').first().click();
  const before = await page.evaluate(() => { const { S } = window.__toon; return { speaker: S.speakers[0], solo: S.solo, manual: S.manual }; });
  await page.getByRole('button', { name: 'Delete selected character', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon.stage.layers.length)).toBe(0);
  await expect(page.getByRole('button', { name: 'Delete Character 1 from scene', exact: true })).toHaveCount(0);
  expect(await page.evaluate(key => ({ actor: window.__toon.S.speakers.some(s => s.key === key), solo: window.__toon.S.solo[key], manual: window.__toon.S.manual[key], keys: window.__toon.S.charKeys[key] }), before.speaker.key)).toEqual({ actor: false });
  await history(page, 'Undo');
  await expect.poll(() => page.evaluate(() => window.__toon.stage.layers.length)).toBe(1);
  expect(await page.evaluate(() => ({ solo: window.__toon.S.solo, manual: window.__toon.S.manual }))).toEqual({ solo: before.solo, manual: before.manual });
  await history(page, 'Redo');
  await expect.poll(() => page.evaluate(() => window.__toon.stage.layers.length)).toBe(0);
  await history(page, 'Undo');
  await page.getByRole('button', { name: 'Delete Character 1 from scene', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon.stage.layers.length)).toBe(0);
  await page.waitForTimeout(1300); await page.reload();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
  expect(await page.evaluate(() => window.__toon.S.speakers.filter(s => s.charId).length)).toBe(0);
});

test('background layer delete clears its base and clips, preserves uploaded files and other scenes, and supports undo', async ({ page }) => {
  await studio(page);
  await page.locator('.upload-tools>summary').click();
  await page.locator('.upload-tools').getByRole('button', { name: 'Background', exact: true }).click();
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 8; const g = c.getContext('2d'); g.fillStyle = 'red'; g.fillRect(0, 0, 8, 8); return c.toDataURL().split(',')[1]; });
  await page.locator('.panel input[type=file]').setInputFiles({ name: 'red.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await expect.poll(() => page.evaluate(() => window.__toon.S.bgId)).toBeTruthy();
  const id = await page.evaluate(() => window.__toon.S.bgId);
  await page.getByRole('button', { name: 'On the timeline (from the playhead)', exact: true }).click();
  await page.getByRole('button', { name: 'Sky', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.bgClips.length)).toBe(1);
  await page.getByLabel('Options for Scene 1', { exact: true }).click();
  await page.locator('.scene-tab').getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Scene 1 copy', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Delete background layer', exact: true }).click();
  const blank = () => page.evaluate(() => { const { S, stage } = window.__toon; stage.render(0, 0, [], []); const px = new Uint8Array(4); stage.gl.readPixels(2, 2, 1, 1, stage.gl.RGBA, stage.gl.UNSIGNED_BYTE, px); return { id: S.bgId, clips: S.bgClips.length, preset: stage.bg.preset, pixel: [...px], files: S.myBgs.length }; });
  expect(await blank()).toEqual({ id: null, clips: 0, preset: 0, pixel: [255, 255, 255, 255], files: 1 });
  await expect(page.locator('.lane2.bg')).toHaveCount(0);
  await history(page, 'Undo');
  expect(await page.evaluate(() => ({ id: window.__toon.S.bgId, clips: window.__toon.S.bgClips.length }))).toEqual({ id, clips: 1 });
  await history(page, 'Redo'); expect((await blank()).id).toBe(null);
  await page.getByRole('tab', { name: 'Scene 1', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.bgId)).toBe(id);
  expect(await page.evaluate(() => window.__toon.S.bgClips.length)).toBe(1);
  await page.getByRole('tab', { name: 'Scene 1 copy', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.bgId)).toBe(null);
  await page.waitForTimeout(1300); await page.reload();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
  expect(await blank()).toEqual({ id: null, clips: 0, preset: 0, pixel: [255, 255, 255, 255], files: 1 });
});
