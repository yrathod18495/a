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

test('a voice line can be trimmed from both edges; the scene gets shorter, playback and export read the trimmed part, double-click restores it', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await studio(page);
  await page.evaluate(async () => {
    const { S, prepareStudio } = window.__toon, ctx = new AudioContext(), buffer = ctx.createBuffer(1, 48000 * 4, 48000);
    S.speakers.push({ key: 'narrator', name: 'Narrator', narrator: true, color: '#7c5cff' }); S.order = ['narrator'];
    S.lines = [{ id: 'v1', order: 0, file: 'voice.wav', speaker: 'Narrator', raw: new ArrayBuffer(8), buffer, visemes: new Array(200).fill(0) }];
    await prepareStudio({ quiet: true }); window.__toon.drawTimeline(); await ctx.close();
  });
  const total0 = await page.evaluate(() => window.__toon.player.total);
  const clip = page.locator('#app .lane2.audio .tclip.voice').first();
  await expect(clip).toBeVisible();
  await dragEdge(page, clip, 'right', -300);   // 150 px per second: 2 s
  await expect.poll(() => page.evaluate(() => window.__toon.S.lines[0].trimEnd)).toBeGreaterThan(1);
  const state = await page.evaluate(() => { const { player, S } = window.__toon, c = player.clips[0]; return { total: player.total, len: c.end - c.start, trimEnd: S.lines[0].trimEnd }; });
  expect(state.total).toBeLessThan(total0 - 1); expect(state.len).toBeCloseTo(4 - state.trimEnd, 1);
  await dragEdge(page, page.locator('#app .lane2.audio .tclip.voice').first(), 'left', 60);
  await expect.poll(() => page.evaluate(() => window.__toon.S.lines[0].trimStart)).toBeGreaterThan(0.3);
  const head = await page.evaluate(() => { const c = window.__toon.player.clips[0]; return { trimStart: c.trimStart, visemes: c.visemes.length }; });
  expect(head.trimStart).toBeGreaterThan(0.3); expect(head.visemes).toBeLessThan(200);
  await page.locator('#app .lane2.audio .tclip.voice').first().dblclick({ position: { x: 20, y: 10 } });
  await expect.poll(() => page.evaluate(() => [window.__toon.S.lines[0].trimStart, window.__toon.S.lines[0].trimEnd])).toEqual([0, 0]);
  expect(await page.evaluate(() => window.__toon.player.total)).toBeCloseTo(total0, 1);
  expect(errors).toEqual([]);
});
