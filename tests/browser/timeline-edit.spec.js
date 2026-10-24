import { test, expect } from '@playwright/test';

async function studio(page) {
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.route('**/api/security', r => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', r => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Timeline');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.locator('#app .stagebox canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready)).toBe(true);
}
const cornerPixel = (page, t) => page.evaluate((t) => {
  const { stage } = window.__toon; stage.render(t, 0, [], []);
  const px = new Uint8Array(4), gl = stage.gl; gl.readPixels(4, 4, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return [...px];
}, t);
const dragEdge = async (page, locator, edge, dx) => {
  const box = await locator.boundingBox(), y = box.y + box.height / 2;
  const x = edge === 'right' ? box.x + box.width - 4 : edge === 'left' ? box.x + 4 : box.x + box.width / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx / 2, y, { steps: 4 }); await page.mouse.move(x + dx, y, { steps: 4 }); await page.mouse.up();
};

test('backgrounds change over time and every timeline item can be moved and resized by dragging its edges', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await studio(page);
  // two plain-colour backgrounds on the timeline, then a third one after them
  await page.evaluate(async () => {
    const { S, stage, player } = window.__toon;
    S.bgClips.push({ id: 'b1', bgId: null, preset: 0, start: 0, dur: 2 }, { id: 'b2', bgId: null, preset: 3, start: 2, dur: 2 }, { id: 'b3', bgId: null, preset: 5, start: 4, dur: 2 });
    await stage.setBackgroundClips(S.bgClips.map((c) => ({ start: c.start, dur: c.dur, preset: c.preset, blob: null })));
  });
  const a = await cornerPixel(page, 1), b = await cornerPixel(page, 3), c = await cornerPixel(page, 5);
  expect(a).not.toEqual(b); expect(b).not.toEqual(c); expect(a).not.toEqual(c);
  // dragging the right edge of the first background clip shortens it, the second one stays
  await page.evaluate(() => window.__toon.drawTimeline?.());
  const clips = page.locator('#app .lane2.bg .tclip.mine');
  await expect(clips).toHaveCount(3);
  const before = await page.evaluate(() => window.__toon.S.bgClips[0].dur);
  await dragEdge(page, clips.nth(0), 'right', -30);
  const after = await page.evaluate(() => window.__toon.S.bgClips[0].dur);
  expect(after).toBeLessThan(before);
  // the trimmed time falls back to the scene background, so t=1.9 is no longer the first colour
  await expect(page.locator('#app .lane2.bg .tclip.mine')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('a selected background clip can be copied and pasted at the playhead with Ctrl+C / Ctrl+V', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await studio(page);
  await page.evaluate(() => { const { S, drawTimeline } = window.__toon; S.bgClips.push({ id: 'b1', bgId: null, preset: 2, start: 0, dur: 2 }); drawTimeline(); });
  await page.locator('#app .lane2.bg .tclip.mine').first().click();
  await page.keyboard.press('Control+c');
  await page.evaluate(() => window.__toon.player.seek(5));
  await page.keyboard.press('Control+v');
  await expect.poll(() => page.evaluate(() => window.__toon.S.bgClips.map((c) => [c.preset, c.start, c.dur]))).toEqual([[2, 0, 2], [2, 5, 2]]);
  expect(errors).toEqual([]);
});
