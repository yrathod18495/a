import { test, expect } from '@playwright/test';

async function studio(page) {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Editing');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.locator('#app .stagebox canvas')).toBeVisible();
}
// two background clips: A is 1 s to 3 s, B is 5 s to 7 s
async function twoClips(page) {
  await page.evaluate(() => { const { S, drawTimeline } = window.__toon; S.bgClips.push({ id: 'a', preset: 1, start: 1, dur: 2 }, { id: 'b', preset: 2, start: 5, dur: 2 }); drawTimeline(); });
  await expect(page.locator('.tclip.bg.mine')).toHaveCount(2);
}
// drag a clip so its start moves by `seconds` (the zoom can change between drags, so it is read each time)
const dragBy = async (page, locator, seconds) => {
  await page.getByRole('button', { name: 'Fit whole timeline' }).click(); await page.waitForTimeout(200);          // everything inside the visible part of the timeline
  const pps = await page.evaluate(() => window.__toon.S.pps), b = await locator.boundingBox(), x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + seconds * pps, y, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(400);          // the timeline redraws a moment after a drop
};
const clipB = (page) => page.evaluate(() => window.__toon.S.bgClips.find((c) => c.id === 'b').start);

test('snap: a dragged clip sticks to the edge of another clip, Alt moves freely, the toggle turns it off', async ({ page }) => {
  await studio(page);
  await twoClips(page);
  const el = page.locator('.tclip.bg.mine').nth(1), target = 3.03;                                                                      // B's start should end up 3.03 s: 0.03 s from A's end (3 s)
  await dragBy(page, el, (target - 5));
  expect(await clipB(page)).toBe(3);                                                         // snapped to 3.00, not the 0.05 grid (3.05)
  await page.evaluate(() => { window.__toon.S.bgClips.find((c) => c.id === 'b').start = 5; window.__toon.commitClips(); });
  await page.keyboard.down('Alt'); await dragBy(page, page.locator('.tclip.bg.mine').nth(1), (target - 5)); await page.keyboard.up('Alt');
  expect(await clipB(page)).toBe(3.05);                                                      // Alt = no snapping: the plain 0.05 grid
  await page.evaluate(() => { window.__toon.S.bgClips.find((c) => c.id === 'b').start = 5; window.__toon.commitClips(); });
  await page.locator('.snap-toggle').click();
  await expect(page.locator('.snap-toggle')).toHaveAttribute('aria-pressed', 'false');
  await dragBy(page, page.locator('.tclip.bg.mine').nth(1), (target - 5));
  expect(await clipB(page)).toBe(3.05);                                                      // snapping is off
  await page.locator('.snap-toggle').click();
  await expect(page.locator('.snap-toggle')).toHaveAttribute('aria-pressed', 'true');
});

// A (1-3 s), B (5-7 s) are background clips; P is a prop from 9 s to 11 s
async function threeThings(page) {
  await page.evaluate(async () => {
    const T = window.__toon, c = document.createElement('canvas'); c.width = c.height = 8; c.getContext('2d').fillRect(0, 0, 8, 8);
    T.S.bgClips.push({ id: 'a', preset: 1, start: 1, dur: 2 }, { id: 'b', preset: 2, start: 5, dur: 2 });
    T.S.props.push({ id: 'p', name: 'Lamp', visible: true, blob: await new Promise((r) => c.toBlob(r)), start: 9, end: 11, x: .5, y: .5, w: .1, h: .1 });
    T.commitClips();
  });
  await expect(page.locator('.tclip.bg.mine')).toHaveCount(2);
  await page.getByRole('button', { name: 'Fit whole timeline' }).click(); await page.waitForTimeout(200);
}
const starts = (page) => page.evaluate(() => ({ a: window.__toon.S.bgClips.find((c) => c.id === 'a')?.start, b: window.__toon.S.bgClips.find((c) => c.id === 'b')?.start, p: window.__toon.S.props.find((x) => x.id === 'p')?.start }));

test('multi-select: Shift+click picks clips, dragging one moves them all by the same amount', async ({ page }) => {
  await studio(page); await threeThings(page);
  await page.locator('.tclip.bg.mine').first().click();
  await page.locator('.tclip.bg.mine').nth(1).click({ modifiers: ['Shift'] });
  await page.locator('.tclip.prop').first().click({ modifiers: ['Shift'] });
  await expect(page.locator('.tclip.msel')).toHaveCount(3);
  await page.locator('.snap-toggle').click();                                                // snapping would pull the group to other edges: keep this test about the move
  await dragBy(page, page.locator('.tclip.bg.mine').nth(1), -0.95);                          // drag B left by about 1 s
  let s = await starts(page);
  expect(s.a).toBeCloseTo(0.05, 2); expect(s.b).toBeCloseTo(4.05, 2); expect(s.p).toBeCloseTo(8.05, 2);          // all three moved by the same amount
  await dragBy(page, page.locator('.tclip.bg.mine').nth(1), -3);                              // far too much: the group stops when the first clip reaches 0
  s = await starts(page);
  expect(s.a).toBe(0); expect(s.b).toBeCloseTo(4, 2); expect(s.p).toBeCloseTo(8, 2);
  await expect(page.locator('.tclip.msel')).toHaveCount(3);                                  // still selected
  await page.keyboard.press('Escape');
  await expect(page.locator('.tclip.msel')).toHaveCount(0);
});

test('multi-select: a box picks the clips it touches; copy + paste, duplicate and delete work on all of them', async ({ page }) => {
  await studio(page); await threeThings(page);
  const lane = await page.locator('.lane2.bg').boundingBox(), prop = await page.locator('.lane2.prop').boundingBox();
  const a = await page.locator('.tclip.bg.mine').first().boundingBox(), p = await page.locator('.tclip.prop').boundingBox();
  await page.mouse.move(a.x - 6, lane.y + 2); await page.mouse.down(); await page.mouse.move(p.x + p.width + 4, prop.y + prop.height - 2, { steps: 10 }); await page.mouse.up();
  await expect(page.locator('.tclip.msel')).toHaveCount(3);
  await page.locator('.edit-copy').click();
  await page.evaluate(() => window.__toon.player.seek(0));
  await page.locator('.edit-paste').click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.bgClips.length)).toBe(4);
  expect(await page.evaluate(() => window.__toon.S.props.length)).toBe(2);
  await expect(page.locator('.tclip.msel')).toHaveCount(3);                                  // the pasted ones are the new selection
  await page.locator('.edit-del').click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.bgClips.length)).toBe(2);
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.length)).toBe(1);
  expect((await starts(page)).a).toBe(1);                                                    // the originals are untouched
});

// ---- audio lines: mute, solo, volume, fades ----
const wav = (seconds) => {
  const rate = 8000, n = seconds * rate, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 20) * 20000), 44 + i * 2);
  return b;
};
async function withTwoLines(page) {
  await studio(page);
  await page.locator('.drop input[type=file]').setInputFiles([{ name: '001-Narrator.wav', mimeType: 'audio/wav', buffer: wav(6) }, { name: '002-Narrator.wav', mimeType: 'audio/wav', buffer: wav(6) }]);
  await expect(page.locator('.tclip.voice')).toHaveCount(2, { timeout: 20000 });
}
const heard = (page) => page.evaluate(async () => { const p = window.__toon.player; p.pause(); p.seek(0); await p.play(); const n = p.sources.length; p.pause(); return n; });

test('audio lines: mute silences a line, solo plays only the solo lines, both are saved in the line and shown on the timeline', async ({ page }) => {
  await withTwoLines(page);
  expect(await heard(page)).toBe(2);
  await page.locator('.tclip.voice').first().click();
  await page.getByRole('button', { name: 'Mute', exact: true }).click();
  await expect(page.locator('.tclip.voice.muted')).toHaveCount(1);
  expect(await heard(page)).toBe(1);                                                         // only the second line is played
  expect(await page.evaluate(() => window.__toon.S.lines[0].muted)).toBe(true);              // the line itself keeps it, so it is saved with the project
  await page.getByRole('button', { name: 'Mute', exact: true }).click();
  await expect(page.locator('.tclip.voice.muted')).toHaveCount(0);
  await page.locator('.tclip.voice').nth(1).click();
  await page.getByRole('button', { name: 'Solo', exact: true }).click();
  await expect(page.locator('.tclip.voice.solo')).toHaveCount(1);
  expect(await heard(page)).toBe(1);                                                         // solo: only that line
  const saved = await page.evaluate(() => JSON.stringify(window.__toon.S.lines.map((l) => [l.muted || false, l.solo || false])));
  expect(saved).toBe('[[false,false],[false,true]]');
  const doc = await page.evaluate(() => window.__toon.sceneDoc().lines.map((l) => ({ muted: l.muted, solo: l.solo })));
  expect(doc).toEqual([{}, { solo: true }].map((x) => ({ muted: undefined, solo: undefined, ...x })));          // what is written into the project file
});

test('audio lines: volume and fades change the real sound level (rendered with the same code the export uses)', async ({ page }) => {
  await withTwoLines(page);
  await page.locator('.tclip.voice').first().click();
  await page.getByRole('slider', { name: 'Volume' }).fill('0.5');
  await page.getByRole('slider', { name: 'Fade in' }).fill('2');
  await page.getByRole('slider', { name: 'Fade out' }).fill('2');
  const line = await page.evaluate(() => { const l = window.__toon.S.lines[0]; return { volume: l.volume, fadeIn: l.fadeIn, fadeOut: l.fadeOut }; });
  expect(line).toEqual({ volume: 0.5, fadeIn: 2, fadeOut: 2 });
  expect(await page.evaluate(() => { const l = window.__toon.sceneDoc().lines[0]; return { volume: l.volume, fadeIn: l.fadeIn, fadeOut: l.fadeOut }; })).toEqual({ volume: 0.5, fadeIn: 2, fadeOut: 2 });          // and they are in the saved project
  // render the first line through the same mixing code in an offline audio context and measure its loudness at the start, middle and end
  const rms = await page.evaluate(async () => {
    const T = window.__toon, clip = T.player.clips[0], { playClip } = await import('/src/audio-mix.js');
    const oc = new OfflineAudioContext(1, Math.ceil(clip.end * 8000) + 8000, 8000); playClip(oc, clip, oc.destination, clip.start, 0);
    const out = (await oc.startRendering()).getChannelData(0), level = (t) => { const i = Math.round(t * 8000); let s = 0; for (let k = 0; k < 400; k++) s += out[i + k] ** 2; return Math.sqrt(s / 400); };
    return { start: level(clip.start + 0.02), middle: level((clip.start + clip.end) / 2), nearEnd: level(clip.end - 0.05), first: level(clip.start + 1) };
  });
  expect(rms.start).toBeLessThan(rms.middle * 0.2);                                          // faded in: quiet at the very start
  expect(rms.nearEnd).toBeLessThan(rms.middle * 0.2);                                        // faded out: quiet at the very end
  expect(rms.middle).toBeGreaterThan(0.05);
  expect(rms.first).toBeLessThan(rms.middle);                                                // one second in, still on the way up
  // the level itself: half volume is about half as loud as full volume
  const ratio = await page.evaluate(async () => {
    const clip = window.__toon.player.clips[0], { playClip } = await import('/src/audio-mix.js'), render = async (volume) => { const oc = new OfflineAudioContext(1, 8000 * 8, 8000); playClip(oc, { ...clip, volume, fadeIn: 0, fadeOut: 0 }, oc.destination, 0, 0); const d = (await oc.startRendering()).getChannelData(0); let s = 0; for (let i = 8000; i < 16000; i++) s += d[i] ** 2; return Math.sqrt(s / 8000); };
    return (await render(0.5)) / (await render(1));
  });
  expect(ratio).toBeGreaterThan(0.45); expect(ratio).toBeLessThan(0.55);
});

test('layer lock: a locked layer cannot be moved, trimmed, split or deleted; the lock is saved; unlocking brings editing back', async ({ page }) => {
  await studio(page); await twoClips(page);
  await page.getByRole('button', { name: 'Fit whole timeline' }).click(); await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Lock the background layer' }).click();
  await expect(page.locator('.lock-layer.on')).toHaveCount(1);
  await expect(page.locator('.tclip.bg.mine.locked')).toHaveCount(2);
  await dragBy(page, page.locator('.tclip.bg.mine').nth(1), -2);                              // tries to move B: nothing happens
  expect(await clipB(page)).toBe(5);
  await page.locator('.tclip.bg.mine').nth(1).click();                                        // it can still be selected …
  await page.locator('.edit-del').click();                                                    // … but not deleted
  expect(await page.evaluate(() => window.__toon.S.bgClips.length)).toBe(2);
  await page.locator('.edit-dup').click();                                                    // … or duplicated
  expect(await page.evaluate(() => window.__toon.S.bgClips.length)).toBe(2);
  expect(await page.evaluate(() => window.__toon.sceneDoc().locks)).toEqual({ bg: true });   // the lock is written into the project
  await page.getByRole('button', { name: 'Unlock the background layer' }).click();
  await expect(page.locator('.tclip.bg.mine.locked')).toHaveCount(0);
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));          // the “locked” notice would sit on top of the clip for a few seconds
  await dragBy(page, page.locator('.tclip.bg.mine').nth(1), -2);
  expect(await clipB(page)).toBeCloseTo(3, 1);                                                // free again
});

test('waveform: an audio clip shows the sound inside it, follows the trim and the volume', async ({ page }) => {
  await studio(page);
  // 6 s: one quiet second, then loud, so the picture must be quiet on the left and loud on the right
  const rate = 8000, n = 6 * rate, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 20) * (i < rate ? 2500 : 28000)), 44 + i * 2);
  await page.locator('.drop input[type=file]').setInputFiles({ name: '001-Narrator.wav', mimeType: 'audio/wav', buffer: b });
  await expect(page.locator('.tclip.voice canvas.wave')).toHaveCount(1, { timeout: 20000 });
  const heights = () => page.locator('.tclip.voice canvas.wave').evaluate((cv) => {
    const g = cv.getContext('2d'), w = cv.width, h = cv.height, col = (x) => { const d = g.getImageData(x, 0, 1, h).data; let top = h, bottom = 0; for (let y = 0; y < h; y++) if (d[y * 4 + 3] > 0) { top = Math.min(top, y); bottom = Math.max(bottom, y); } return Math.max(0, bottom - top); };
    return { w, h, quiet: col(Math.round(w * 0.05)), loud: col(Math.round(w * 0.6)) };
  });
  const full = await heights();
  expect(full.w).toBeGreaterThan(100);
  expect(full.loud).toBeGreaterThan(full.quiet * 3);                                          // the loud part is clearly taller than the quiet part
  expect(full.loud).toBeGreaterThan(full.h * 0.6);                                            // and fills most of the clip
  // trim the first 1.5 s off the head: the picture now starts in the loud part
  await page.evaluate(async () => { const T = window.__toon; T.S.lines[0].trimStart = 1.5; T.player.clips[0].trimStart = 1.5; T.player.clips[0].end -= 1.5; T.drawTimeline(); });
  const trimmed = await heights();
  expect(trimmed.quiet).toBeGreaterThan(trimmed.h * 0.6);                                     // the quiet second is gone from the picture
  await page.evaluate(() => { const T = window.__toon; T.S.lines[0].volume = 0.25; T.player.clips[0].volume = 0.25; T.drawTimeline(); });
  const soft = await heights();
  expect(soft.quiet).toBeLessThan(trimmed.quiet * 0.5);                                       // a quieter line is drawn lower
});

test('background music: add a file, it shows on the timeline, plays with the voices, loops, mutes, and is saved and restored from the project database', async ({ page }) => {
  await studio(page);
  // voice: 6 s. music: a 2 s tone, shorter than the scene, so it has to repeat
  const tone = (seconds, hz) => { const rate = 8000, n = seconds * rate, b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * hz) * 20000), 44 + i * 2); return b; };
  await page.locator('.drop input[type=file]').setInputFiles({ name: '001-Narrator.wav', mimeType: 'audio/wav', buffer: tone(6, 300) });
  await expect(page.locator('.tclip.voice')).toHaveCount(1, { timeout: 20000 });
  expect(await page.evaluate(() => window.__toon.player.music)).toBeNull();
  await page.locator('.music-card input[type=file]').setInputFiles({ name: 'song.wav', mimeType: 'audio/wav', buffer: tone(2, 440) });
  await expect(page.locator('.tclip.music')).toHaveCount(1, { timeout: 15000 });
  await expect(page.locator('.music-card')).toContainText('song');
  const heard = () => page.evaluate(async () => { const p = window.__toon.player; p.pause(); p.seek(0); await p.play(); const n = p.sources.length; p.pause(); return n; });
  expect(await heard()).toBe(2);                                                                // the voice line and the music
  // the music mixed into the video's sound, alone (the voice line is muted): present at 4 s, after the 2 s file ended, because it loops
  await page.locator('.tclip.voice').first().click();
  await page.getByRole('button', { name: 'Mute', exact: true }).click();
  const level = (volume, muted) => page.evaluate(async ([volume, muted]) => {
    const T = window.__toon, { mixAudio } = await import('/src/exporter.js'), m = { ...T.player.music, volume, muted, fadeIn: 0, fadeOut: 0, start: 0, end: T.player.total };
    const buf = await mixAudio(T.player.clips, T.player.total, [m]), d = buf.getChannelData(0), at = (t) => { let s = 0; const i = Math.round(t * buf.sampleRate); for (let k = 0; k < 800; k++) s += d[i + k] ** 2; return Math.sqrt(s / 800); };
    return { early: at(1), looped: at(4.5), voiceOnlyCheck: at(1) };
  }, [volume, muted]);
  const full = await level(1, false), half = await level(0.5, false), none = await level(1, true);
  expect(full.early).toBeGreaterThan(0.1); expect(full.looped).toBeGreaterThan(0.1);            // plays, and keeps playing past the end of the file
  expect(half.early / full.early).toBeGreaterThan(0.45); expect(half.early / full.early).toBeLessThan(0.55);          // volume
  expect(none.early).toBeLessThan(0.001);                                                       // muted music is not in the mix
  // saved in the scene and restored from the database
  const doc = await page.evaluate(() => window.__toon.sceneDoc().music);
  expect(doc).toMatchObject({ name: 'song', muted: false }); expect(doc.id).toMatch(/^music-/);
  const restored = await page.evaluate(async () => { const T = window.__toon, doc = T.sceneDoc(); T.S.music = null; T.musicAudio.clear(); await T.loadSceneDoc(doc); return { name: T.S.music?.name, hasBuffer: !!T.player.music?.buffer || !!T.musicAudio.get(T.S.music?.id)?.buffer }; });
  expect(restored).toEqual({ name: 'song', hasBuffer: true });
  // removing it takes the row and the sound away
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.locator('.tclip.music')).toHaveCount(0);
  expect(await page.evaluate(() => window.__toon.player.music)).toBeNull();
});

test('camera moves: zoom, pan and shake add keyframes at the playhead and really move the camera', async ({ page }) => {
  await studio(page);
  await page.locator('.drop input[type=file]').setInputFiles({ name: '001-Narrator.wav', mimeType: 'audio/wav', buffer: wav(8) });
  await expect(page.locator('.tclip.voice')).toHaveCount(1, { timeout: 20000 });
  await page.evaluate(() => window.__toon.openTab('camera'));
  await expect(page.locator('.cam-presets')).toBeVisible();
  const keys = () => page.evaluate(() => window.__toon.S.camKeys.map((k) => ({ t: k.t, zoom: +k.zoom.toFixed(3), cx: +k.cx.toFixed(3), cy: +k.cy.toFixed(3) })).sort((a, b) => a.t - b.t));
  const camAt = (t) => page.evaluate((t) => { const T = window.__toon, f = T.stage.frameAt([], t); return { zoom: +f.zoom.toFixed(3), cx: +(f.cx / T.stage.W).toFixed(3) }; }, t);
  expect(await keys()).toEqual([]);
  await page.evaluate(() => window.__toon.player.seek(1));
  await page.locator('[data-preset=zoom-in]').click();
  let k = await keys(); expect(k.map((x) => x.t)).toEqual([1, 3]); expect(k[1].zoom).toBeGreaterThan(k[0].zoom * 1.3);
  expect((await camAt(3)).zoom).toBeGreaterThan(1.3);                                          // the stage really shows the closer picture at the end of the move
  expect((await camAt(2)).zoom).toBeGreaterThan(1.05); expect((await camAt(2)).zoom).toBeLessThan(1.3);         // and part way in between
  await page.evaluate(() => window.__toon.player.seek(4));
  await page.locator('[data-preset=pan-right]').click();
  k = await keys(); const pan = k.filter((x) => x.t >= 4); expect(pan.length).toBe(2); expect(pan[1].cx).toBeGreaterThan(pan[0].cx + 0.1);
  expect((await camAt(6)).cx).toBeGreaterThan((await camAt(4)).cx + 0.1);                       // the camera moves to the right
  await page.evaluate(() => window.__toon.player.seek(6.5));
  await page.locator('.cam-presets').getByRole('button', { name: 'Strong' }).click();
  await page.locator('.cam-presets').getByRole('button', { name: '0.4 s' }).click();
  await page.locator('[data-preset=shake]').click();
  k = await keys(); const shake = k.filter((x) => x.t >= 6.5); expect(shake.length).toBeGreaterThanOrEqual(5);
  const xs = shake.slice(1, -1).map((x) => x.cx); expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.01);   // the camera jitters
  expect(shake.at(-1).t).toBeCloseTo(6.9, 1);
  expect((await camAt(7.5)).cx).toBeCloseTo(shake.at(-1).cx, 2);                                // after the shake the camera is steady again
});

test('export estimate: size and time are shown before exporting, change with the settings, and use the speed of the last export', async ({ page }) => {
  await studio(page);
  await page.locator('.drop input[type=file]').setInputFiles({ name: '001-Narrator.wav', mimeType: 'audio/wav', buffer: wav(20) });
  await expect(page.locator('.tclip.voice')).toHaveCount(1, { timeout: 20000 });
  await page.evaluate(() => { localStorage.removeItem('12toons.exportSpeed'); window.__toon.S.exportScope = 'current'; window.__toon.openTab('export'); });
  const stat = (label) => page.locator('.exp-summary div', { hasText: label }).locator('b');
  await expect(stat('Approx. time')).toBeVisible();
  const num = async (label) => { const text = (await stat(label).textContent()) || '', n = parseFloat(text.replace(/[^0-9.]/g, '')); return /min/.test(text) ? n * 60 : /\bh\b/.test(text) ? n * 3600 : n; };          // seconds / minutes / hours -> seconds
  await expect(page.locator('.exp-eta')).toContainText('rough guess');
  const t720 = await num('Approx. time'), mb720 = await num('Approx. size');
  expect(t720).toBeGreaterThan(0); expect(mb720).toBeGreaterThan(0);
  await page.evaluate(() => { window.__toon.S.quality = 2160; window.__toon.openTab('export'); });
  expect(await num('Approx. size')).toBeGreaterThan(mb720);                                     // 4K makes a bigger file …
  expect(await num('Approx. time')).toBeGreaterThanOrEqual(t720);                               // … that takes longer
  // after an export the measured speed is used: pretend the last one ran at 4× real time at 720p30
  await page.evaluate(() => { window.__toon.S.quality = 720; window.__toon.S.fps = 30; const { width, height } = { width: window.__toon.stage.W, height: window.__toon.stage.H }; localStorage.setItem('12toons.exportSpeed', JSON.stringify({ speed: 4, pixels: 1280 * 720, fps: 30, at: Date.now() })); window.__toon.openTab('export'); });
  await expect(page.locator('.exp-eta')).toContainText('last export');
  const time = (await stat('Approx. time').textContent()) || '';
  expect(time).toMatch(/about (5|10|15) s/);                                                      // a 20 s video at 4× real time is about 5 s
  await page.evaluate(() => { window.__toon.S.expMethod = 'live'; window.__toon.openTab('export'); });
  expect(await num('Approx. time')).toBeGreaterThanOrEqual(20);                                  // live recording: at least as long as the video
});

// ---- a real export (parallel workers) in the background ----
const goertzel = (data, rate, hz) => { const w = (2 * Math.PI * hz) / rate; let s1 = 0, s2 = 0; const c = 2 * Math.cos(w); for (const x of data) { const s = x + c * s1 - s2; s2 = s1; s1 = s; } return Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2) / data.length * 2; };

test('background export: the editor stays free while the video is made from a snapshot, and the file has the voice (volume) and the looped music', async ({ page }) => {
  test.setTimeout(150000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (/parallel export failed/.test(m.text())) errors.push(m.text()); });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=2#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Export');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.locator('#app .stagebox canvas')).toBeVisible();
  const tone = (seconds, hz, amp) => { const rate = 8000, n = seconds * rate, b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * hz) * amp), 44 + i * 2); return b; };
  await page.locator('.drop input[type=file]').setInputFiles({ name: '001-Narrator.wav', mimeType: 'audio/wav', buffer: tone(4, 300, 20000) });
  await expect(page.locator('.tclip.voice')).toHaveCount(1, { timeout: 20000 });
  await page.locator('.music-card input[type=file]').setInputFiles({ name: 'song.wav', mimeType: 'audio/wav', buffer: tone(1, 440, 20000) });         // 1 s of music for a 5 s video: it has to repeat
  await expect(page.locator('.tclip.music')).toHaveCount(1, { timeout: 15000 });
  await page.evaluate(() => { const T = window.__toon; T.S.fps = 5; T.S.quality = 360; Object.assign(T.S.music, { volume: 0.2, fadeIn: 0, fadeOut: 0 }); Object.assign(T.S.lines[0], { volume: 0.5 }); Object.assign(T.player.clips[0], { volume: 0.5 }); T.player.music.volume = 0.2; T.player.music.fadeOut = 0; T.player.music.fadeIn = 0; });
  const downloadReady = page.waitForEvent('download', { timeout: 120000 });
  await page.locator('#app .hdr-tools').getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.locator('.export-pill')).toBeVisible({ timeout: 20000 });                 // the progress box, not a locked screen
  expect(await page.evaluate(() => window.__toon.S.exporting)).toBe(false);                    // the editor is not frozen
  await expect(page.locator('.busy')).toHaveCount(0);
  // keep working while it renders: change the project. The video must still be made from the project as it was when Export was pressed
  await page.evaluate(() => { const T = window.__toon; T.S.lines[0].muted = true; T.player.clips[0].muted = true; T.S.bgClips.push({ id: 'late', preset: 3, start: 0, dur: 1 }); T.commitClips(); });
  expect(await page.evaluate(() => window.__toon.S.lines[0].muted)).toBe(true);
  const download = await downloadReady;
  await expect(page.locator('.export-pill')).toHaveCount(0);
  const { readFile } = await import('node:fs/promises'); const bytes = await readFile(await download.path());
  expect(bytes.length).toBeGreaterThan(2000);
  const heard = await page.evaluate(async (base64) => {
    const ctx = new AudioContext(), buf = await ctx.decodeAudioData(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer), d = buf.getChannelData(0), rate = buf.sampleRate;
    const slice = (a, b) => d.slice(Math.round(a * rate), Math.round(b * rate)), mag = (x, hz) => { const w = (2 * Math.PI * hz) / rate, c = 2 * Math.cos(w); let s1 = 0, s2 = 0; for (const v of x) { const s = v + c * s1 - s2; s2 = s1; s1 = s; } return Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2) / x.length * 2; };
    return { duration: buf.duration, voiceWhileTalking: mag(slice(1, 3), 300), musicWhileTalking: mag(slice(1, 3), 440), voiceAfter: mag(slice(4.6, 4.95), 300), musicAfter: mag(slice(4.6, 4.95), 440), musicLooped: mag(slice(2.2, 3.8), 440) };
  }, bytes.toString('base64'));
  expect(heard.duration).toBeGreaterThan(4.5); expect(heard.duration).toBeLessThan(6);
  expect(heard.voiceWhileTalking).toBeGreaterThan(0.2);                                       // the voice is in the video, although it was muted after Export was pressed (a snapshot)
  expect(heard.musicWhileTalking).toBeGreaterThan(0.06);                                      // and the music under it
  expect(heard.voiceWhileTalking / heard.musicWhileTalking).toBeGreaterThan(1.7); expect(heard.voiceWhileTalking / heard.musicWhileTalking).toBeLessThan(3.6);   // volume 0.5 vs 0.2: about 2.5 times louder
  expect(heard.voiceAfter).toBeLessThan(0.03);                                                // the voice line has ended …
  expect(heard.musicAfter).toBeGreaterThan(0.06);                                             // … and the music, which repeats, still plays to the end
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('12toons.exportSpeed') || 'null')?.speed > 0)).toBe(true);     // the speed was remembered for the next estimate
  expect(errors).toEqual([]);
});

test('background export: closing the studio while it renders does not stop it; the file still arrives', async ({ page }) => {
  test.setTimeout(150000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=2#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Leave');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.locator('#app .stagebox canvas')).toBeVisible();
  await page.locator('.drop input[type=file]').setInputFiles({ name: '001-Narrator.wav', mimeType: 'audio/wav', buffer: wav(12) });
  await expect(page.locator('.tclip.voice')).toHaveCount(1, { timeout: 20000 });
  await page.evaluate(() => { window.__toon.S.fps = 5; window.__toon.S.quality = 360; });
  const downloadReady = page.waitForEvent('download', { timeout: 120000 });
  await page.locator('#app .hdr-tools').getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.locator('.export-pill')).toBeVisible({ timeout: 20000 });
  await page.locator('.close-studio').click(); await page.locator('.close-yes').click();                                                   // leave the studio while it renders
  await expect(page.locator('#app')).toBeHidden({ timeout: 15000 });
  const download = await downloadReady;
  const { readFile } = await import('node:fs/promises'); expect((await readFile(await download.path())).length).toBeGreaterThan(2000);
  await expect(page.locator('.export-pill')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('save status: says when the project was saved and keeps counting ("Saved · 2 min ago")', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Saved');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.locator('#app .stagebox canvas')).toBeVisible();
  await page.evaluate(() => { window.__toon.S.bgClips.push({ id: 'x', preset: 2, start: 0, dur: 2 }); window.__toon.commitClips(); window.__toon.S.dirty = true; });
  const label = page.locator('.save-status .save-label');
  await expect(label).toBeVisible();                                                           // the words are on screen, not only an icon
  await expect(label).toContainText('Saved locally', { timeout: 20000 });                      // the studio saves on this device a moment after a change
  await page.waitForTimeout(2500);                                                              // let the status settle (there is no account here, so the cloud copy is never made by itself)
  // the cloud copy was made: the label says when (this test tells the studio directly)
  await page.evaluate(() => window.__toon.updateSaveStatus({ text: 'Saved to Cloud', at: Date.now() }));
  await expect(label).toContainText(/Saved to cloud · (just now|\d+ s ago)/);
  // two minutes pass (the clock of the page jumps): the counter moves on by itself, without any new save
  await page.evaluate(() => { const real = Date.now.bind(Date); Date.now = () => real() + 125000; });
  await expect(label).toContainText('2 min ago', { timeout: 20000 });
  await page.evaluate(() => { const real = Date.now.bind(Date); Date.now = () => real() + 3 * 3600000; });
  await expect(label).toContainText(/\d h ago/, { timeout: 20000 });
});
