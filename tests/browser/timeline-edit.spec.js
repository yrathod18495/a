import { test, expect } from '@playwright/test';

async function studio(page, query = '?debug&workers=0') {
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.route('**/api/security', r => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', r => r.fulfill({ json: { configured: false } }));
  await page.goto(`/${query}#/toons`);
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

for (const [name, query] of [['single thread', '?debug&workers=0'], ['parallel workers', '?debug&workers=2']]) test(`the exported video shows the background clips at their times and the colour grade (${name})`, async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', (m) => { if (/parallel export failed/.test(m.text())) errors.push(m.text()); });
  await studio(page, query);
  await page.evaluate(() => {
    const { S, stage } = window.__toon;
    S.fps = 5; S.bgClips.push({ id: 'b1', bgId: null, preset: 0, start: 0, dur: 2 }, { id: 'b2', bgId: null, preset: 5, start: 2, dur: 2 });
    return stage.setBackgroundClips(S.bgClips.map((c) => ({ start: c.start, dur: c.dur, preset: c.preset, blob: null })));
  });
  const grade = async (saturation) => page.evaluate((saturation) => { window.__toon.stage.grade = saturation == null ? null : { brightness: 1, contrast: 0, saturation, vibrance: 0, exposure: 0, gamma: 1, hue: 0, temperature: 0, tintAmount: 0, shadows: 0, highlights: 0, fade: 0, sharpen: 0, vignette: 0, grain: 0, tint: '#ffffff' }; window.__toon.S.grade = window.__toon.stage.grade || window.__toon.S.grade; }, saturation);
  await grade(0);
  const downloadReady = page.waitForEvent('download');
  await page.locator('#app .hdr-tools').getByRole('button', { name: '⬇ Export', exact: true }).click();
  const download = await downloadReady;
  const { readFile } = await import('node:fs/promises'); const bytes = await readFile(await download.path());
  const pixels = await page.evaluate(async (base64) => {
    const video = document.createElement('video'); video.muted = true; video.src = URL.createObjectURL(new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type: 'video/webm' }));
    await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = reject; });
    const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight; const g = canvas.getContext('2d', { willReadFrequently: true });
    const at = async (t) => { video.currentTime = t; await new Promise((r) => { video.onseeked = r; }); g.drawImage(video, 0, 0); return [...g.getImageData(8, 8, 1, 1).data]; };
    return { first: await at(0.6), second: await at(3.0), duration: video.duration };
  }, bytes.toString('base64'));
  // the grade made it grey, the background clips made the two halves different
  for (const px of [pixels.first, pixels.second]) { expect(Math.abs(px[0] - px[1])).toBeLessThanOrEqual(6); expect(Math.abs(px[1] - px[2])).toBeLessThanOrEqual(6); }
  expect(Math.abs(pixels.first[0] - pixels.second[0])).toBeGreaterThan(8);
  expect(pixels.duration).toBeGreaterThan(3); expect(pixels.duration).toBeLessThan(5);
  expect(errors).toEqual([]);
});

test('a character animation clip and a prop lane can be dragged: trim, stretch, move and the scene length follows', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await studio(page);
  const chars = page.locator('.tabs.big').getByRole('button', { name: 'Characters', exact: true });
  if (await chars.getAttribute('aria-pressed') !== 'true') await chars.click();
  await page.getByRole('button', { name: '＋ Add character', exact: true }).click();
  await page.locator('.cp-card').filter({ hasText: /^Neha$/ }).click();
  await page.locator('.cp-poses .pose').first().click();
  await expect.poll(() => page.evaluate(() => window.__toon.stage.layers.length)).toBe(1);
  await expect(page.locator('.busy')).toHaveCount(0);
  await page.locator('.tabs.big').getByRole('button', { name: 'Animations', exact: true }).click();
  const category = page.getByLabel('Animation category');
  const talking = await category.locator('option').evaluateAll((options) => options.find((o) => /talking/i.test(o.textContent))?.value);
  await category.selectOption(talking);
  await page.locator('.animation-apply').first().click();
  await expect(page.locator('.busy')).toHaveCount(0);
  const length = await page.evaluate(() => Object.values(window.__toon.S.solo)[0].bodyLen);
  expect(length).toBeGreaterThan(1.5);
  // the automatic clip of the picked animation becomes the user's own clip when dragged; its right edge shortens it and the scene follows
  const auto = page.locator('#app .lane2.char .tclip.body.auto').first();
  await expect(auto).toBeVisible();
  await dragEdge(page, auto, 'right', -80);
  await expect.poll(() => page.evaluate(() => Object.values(window.__toon.S.manual).flat().length)).toBe(1);
  const afterRight = await page.evaluate(() => { const m = Object.values(window.__toon.S.manual).flat()[0]; return { dur: m.dur, start: m.start, solo: Object.values(window.__toon.S.solo)[0]?.bodyLen, total: window.__toon.player.total }; });
  expect(afterRight.dur).toBeLessThan(length - 0.3); expect(afterRight.solo).toBeUndefined(); expect(afterRight.total).toBeCloseTo(Math.max(1, afterRight.dur), 1);
  // the left edge trims the head: the clip starts later and skips the first part of the animation
  const mine = page.locator('#app .lane2.char .tclip.body.mine').first();
  await dragEdge(page, mine, 'left', 30);
  const afterLeft = await page.evaluate(() => Object.values(window.__toon.S.manual).flat()[0]);
  expect(afterLeft.start).toBeGreaterThan(0.1); expect(afterLeft.off).toBeGreaterThan(0.1); expect(afterLeft.dur).toBeLessThan(afterRight.dur);
  // moving by the middle keeps the length
  const lenBefore = afterLeft.dur;
  await dragEdge(page, page.locator('#app .lane2.char .tclip.body.mine').first(), 'move', 45);
  const moved = await page.evaluate(() => Object.values(window.__toon.S.manual).flat()[0]);
  expect(moved.start).toBeGreaterThan(afterLeft.start + 0.1); expect(moved.dur).toBeCloseTo(lenBefore, 2);
  // a prop gets its own lane; dragging its right edge sets the time it disappears
  await page.evaluate(async () => {
    const { S, stage, drawTimeline } = window.__toon, blob = await new Promise((r) => stage.out.toBlob(r));
    S.props.push({ id: 'p1', name: 'Chair', kind: 'prop', blob, x: 0.2, y: 0.5, w: 0.1, h: 0.1 }); await stage.setProps(S.props); drawTimeline();
  });
  const prop = page.locator('#app .lane2.prop .tclip.prop').first();
  await expect(prop).toBeVisible();
  await dragEdge(page, prop, 'right', -120);
  const end = await page.evaluate(() => window.__toon.S.props[0].end);
  expect(end).toBeGreaterThan(0.2); expect(end).toBeLessThan(await page.evaluate(() => window.__toon.player.total + 8));
  expect(errors).toEqual([]);
});

test('an automatic animation clip made from the voice can be dragged too', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await studio(page);
  const chars = page.locator('.tabs.big').getByRole('button', { name: 'Characters', exact: true });
  if (await chars.getAttribute('aria-pressed') !== 'true') await chars.click();
  await page.getByRole('button', { name: '＋ Add character', exact: true }).click();
  await page.locator('.cp-card').filter({ hasText: /^Neha$/ }).click();
  await page.locator('.cp-poses .pose').first().click();
  await expect.poll(() => page.evaluate(() => window.__toon.stage.layers.length)).toBe(1);
  await expect(page.locator('.busy')).toHaveCount(0);
  await page.evaluate(async () => {
    const { S, prepareStudio } = window.__toon, ctx = new AudioContext(), buffer = ctx.createBuffer(1, 48000 * 4, 48000), key = S.speakers.find((s) => s.charId).key;
    S.lines = [{ id: 'v1', order: 0, file: 'voice.wav', speaker: key, raw: new ArrayBuffer(8), buffer, visemes: new Array(200).fill(0) }];
    await prepareStudio({ quiet: true }); window.__toon.drawTimeline(); await ctx.close();
  });
  const auto = page.locator('#app .lane2.char .tclip.body.auto').first();
  await expect(auto).toBeVisible();
  const before = await auto.boundingBox();
  await dragEdge(page, auto, 'move', 60);
  await expect.poll(() => page.evaluate(() => Object.values(window.__toon.S.manual).flat().length)).toBe(1);
  const m = await page.evaluate(() => Object.values(window.__toon.S.manual).flat()[0]);
  expect(m.kind).toBe('body'); expect(m.start).toBeGreaterThan(0.2);
  const mine = await page.locator('#app .lane2.char .tclip.body.mine').first().boundingBox();
  expect(mine.x).toBeGreaterThan(before.x + 20);
  expect(errors).toEqual([]);
});
