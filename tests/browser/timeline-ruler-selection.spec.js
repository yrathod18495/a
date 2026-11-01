import { test, expect } from '@playwright/test';

// A short mono WAV made in the test, so no file is needed.
const wav = (seconds) => {
  const rate = 8000, n = seconds * rate, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 20) * 8000), 44 + i * 2);
  return b;
};
async function studioWithAudio(page, seconds = 30) {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Ruler and selection');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.locator('#app .stagebox canvas')).toBeVisible();
  await page.locator('.drop input[type=file]').setInputFiles({ name: '001-Narrator.wav', mimeType: 'audio/wav', buffer: wav(seconds) });
  await expect(page.locator('.tclip.voice')).toHaveCount(1, { timeout: 20000 });
}

test('the ruler has a tick every second and a label every few seconds', async ({ page }) => {
  await studioWithAudio(page);
  const labels = await page.locator('.ruler:not(.rl) .tick').allTextContents();
  expect(labels.slice(0, 4)).toEqual(['0s', '5s', '10s', '15s']);
  expect(await page.locator('.ruler:not(.rl) .tmin').count()).toBeGreaterThanOrEqual(20);          // the seconds between the labels
});

test('the audio can be split at the playhead from the toolbar, duplicated and deleted', async ({ page }) => {
  await studioWithAudio(page);
  const split = page.locator('.edittools button', { hasText: 'Split' });
  await expect(split).toBeEnabled();                                       // nothing was clicked: the audio under the playhead is the target
  const pps = await page.evaluate(() => window.__toon.S.pps), box = await page.locator('.ruler:not(.rl)').boundingBox();
  await page.mouse.click(box.x + 8 * pps, box.y + 14);
  await split.click();
  await expect(page.locator('.tclip.voice')).toHaveCount(2);
  const trims = await page.evaluate(() => window.__toon.S.lines.map((l) => [l.trimStart || 0, +(l.trimEnd || 0).toFixed(1)]));
  expect(trims[0][0]).toBe(0); expect(trims[0][1]).toBeGreaterThan(20); expect(trims[1][0]).toBeGreaterThan(7); expect(trims[1][0]).toBeLessThan(9);   // 8 s and 22 s
  await page.locator('.edittools button', { hasText: 'Duplicate' }).click();
  await expect(page.locator('.tclip.voice')).toHaveCount(3);
  await page.locator('.edittools button', { hasText: 'Delete' }).click();
  await expect(page.locator('.tclip.voice')).toHaveCount(2);
});

test('selecting a prop un-selects the audio, and the lanes do not move when the clip bar appears', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await studioWithAudio(page);
  await page.evaluate(() => { const T = window.__toon; T.S.props.push({ id: 'p1', name: 'Test prop', visible: true, blob: new Blob(['x']) }); T.drawTimeline(); });
  const lanes = async () => ({ audio: Math.round((await page.locator('.tclip.voice').first().boundingBox()).y), prop: Math.round((await page.locator('.tclip.prop').first().boundingBox()).y) });
  const before = await lanes();
  await page.locator('.tclip.prop').first().click();
  await expect(page.locator('.clipbar')).toBeVisible();
  expect(await lanes()).toEqual(before);                                   // a second click lands on the same clip
  await page.locator('.tclip.prop').first().click();
  await expect(page.locator('.tclip.prop.sel')).toHaveCount(1);
  await expect(page.locator('.tclip.voice.sel')).toHaveCount(0);
  await page.locator('.tclip.voice').first().click();
  await expect(page.locator('.tclip.voice.sel')).toHaveCount(1);
  await expect(page.locator('.tclip.prop.sel')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the small ticks between two labels are all the same distance apart, at every zoom', async ({ page }) => {
  await studioWithAudio(page);
  for (const pps of [4, 19, 60, 120, 240, 300]) {
    await page.evaluate((v) => { window.__toon.S.pps = v; window.__toon.drawTimeline(); }, pps);
    const xs = await page.locator('.ruler:not(.rl) > *').evaluateAll((els) => els.map((e) => parseFloat(e.style.left)).sort((a, b) => a - b));
    const gaps = xs.slice(1, 40).map((x, i) => +(x - xs[i]).toFixed(3));
    expect(Math.max(...gaps) - Math.min(...gaps), `zoom ${pps}`).toBeLessThan(0.01);
    expect(gaps[0]).toBeGreaterThanOrEqual(5);
  }
});

test('splitting audio leaves no gap at the cut, and a split prop stays on its own row', async ({ page }) => {
  await studioWithAudio(page);
  const pps = await page.evaluate(() => window.__toon.S.pps), box = await page.locator('.ruler:not(.rl)').boundingBox();
  await page.mouse.click(box.x + 8 * pps, box.y + 14);
  await page.locator('.edittools button', { hasText: 'Split' }).click();
  await expect(page.locator('.tclip.voice')).toHaveCount(2);
  const edges = await page.evaluate(() => window.__toon.player.clips.map((c) => [c.start, c.end]));
  expect(Math.abs(edges[1][0] - edges[0][1])).toBeLessThan(0.001);               // the second part starts exactly where the first ends
  await page.evaluate(async () => { const { S, drawTimeline } = window.__toon, c = document.createElement('canvas'); c.width = c.height = 8; c.getContext('2d').fillRect(0, 0, 8, 8); const blob = await new Promise((r) => c.toBlob(r)); S.props.push({ id: 'p-test', name: 'Lamp', blob, start: 0, end: 20, x: .5, y: .5, w: .1, h: .1 }); S.propSel = 'p-test'; S.lineSel = null; drawTimeline(); });
  await expect(page.locator('.lane2.prop')).toHaveCount(1);
  await page.mouse.click(box.x + 10 * pps, box.y + 14);
  await page.evaluate(() => { window.__toon.S.propSel = 'p-test'; window.__toon.S.lineSel = null; });
  await page.locator('.edittools button', { hasText: 'Split' }).click();
  await expect(page.locator('.lane2.prop')).toHaveCount(1);                      // still one row
  await expect(page.locator('.lane2.prop .tclip.prop')).toHaveCount(2);          // with two pieces on it
});

test('the whole-scene background can be selected and split, and both pieces stay on the Background row', async ({ page }) => {
  await studioWithAudio(page);
  await page.evaluate(() => { const { stage, drawTimeline } = window.__toon; stage.bg.preset = 1; drawTimeline(); });
  await expect(page.locator('.lane2.bg .tclip.bg.base')).toHaveCount(1);
  await page.locator('.lane2.bg .tclip.bg.base').click({ position: { x: 100, y: 10 } });
  await expect(page.locator('.lane2.bg .tclip.bg.mine.sel')).toHaveCount(1);       // it is now an ordinary clip on the same row
  const pps = await page.evaluate(() => window.__toon.S.pps), box = await page.locator('.ruler:not(.rl)').boundingBox();
  await page.mouse.click(box.x + 10 * pps, box.y + 14);
  await page.locator('.edittools button', { hasText: 'Split' }).click();
  await expect(page.locator('.lane2.bg')).toHaveCount(1);
  await expect(page.locator('.lane2.bg .tclip.bg.mine')).toHaveCount(2);
  await expect(page.locator('.lane2.bg .tclip.bg.base')).toHaveCount(0);
});

test('outside the pieces of a split background the canvas is plain black, not the old background', async ({ page }) => {
  await studioWithAudio(page);
  await page.evaluate(() => { const { stage, drawTimeline } = window.__toon; stage.bg.preset = 1; drawTimeline(); });
  await page.locator('.lane2.bg .tclip.bg.base').click({ position: { x: 100, y: 10 } });
  await page.evaluate(async () => { const { S, stage } = window.__toon, c = S.bgClips[0]; c.start = 5; c.dur = 5; await stage.setBackgroundClips(S.bgClips.map((x) => ({ start: x.start, dur: x.dur, preset: x.preset ?? 0, blob: null })), true); });
  const keys = await page.evaluate(() => { const { stage } = window.__toon; stage.ensureBackground(2); const early = stage.bgTex; stage.ensureBackground(7); const inside = stage.bgTex; return { early: [...stage.bgCache].find(([, v]) => v === early)?.[0], inside: [...stage.bgCache].find(([, v]) => v === inside)?.[0] }; });
  expect(keys.early).toMatch(/^blank\|/);            // before the clip: black
  expect(keys.inside).toMatch(/^1\|/);               // inside the clip: its own background
});
