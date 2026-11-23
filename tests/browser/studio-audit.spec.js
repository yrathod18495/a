import { test, expect } from '@playwright/test';
import { openStudio, haveZip } from './studio-library.js';
// The studio from A to Z on a real character from the (fake) admin library. Each test is one feature area.
test.skip(!haveZip(), 'needs a character ZIP (CHARACTER_ZIP)');
const T = (page, fn, arg) => page.evaluate(fn, arg);
const undo = async (page) => { await page.getByRole('button', { name: 'Undo', exact: true }).click(); await page.waitForTimeout(500); };
const redo = async (page) => { await page.getByRole('button', { name: 'Redo', exact: true }).click(); await page.waitForTimeout(500); };
const px = (page) => page.evaluate(() => { const T = window.__toon; T.stage.render(T.player.time, 0, [], []); const c = document.createElement('canvas'); c.width = T.stage.out.width; c.height = T.stage.out.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(T.stage.out, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; let non = 0, r = 0, gg = 0, b = 0; for (let i = 0; i < d.length; i += 16) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; if (d[i] + d[i + 1] + d[i + 2] > 120) non++; } const n = d.length / 16; return { bright: non, avg: [r / n, gg / n, b / n].map(Math.round) }; });

test('character: add, select by click, size, flip, rename, remove; each step undoes and redoes', async ({ page }) => {
  test.setTimeout(240000);
  const errors = await openStudio(page, { chr: true });
  expect(await T(page, () => [window.__toon.S.speakers.length, window.__toon.stage.layers.length])).toEqual([1, 1]);
  const before = await px(page); expect(before.bright).toBeGreaterThan(50);                        // the character is really drawn
  // select it with a click on the picture
  const hit = await T(page, () => { const T = window.__toon, b = T.stage.layers[0].box, r = T.stage.out.getBoundingClientRect(); return { x: (b.x0 + b.x1) / 2 / T.stage.W * r.width, y: (b.y0 + b.y1) / 2 / T.stage.H * r.height }; });
  await page.locator('#app .stagebox canvas').click({ position: hit }); await page.waitForTimeout(300);
  expect(await T(page, () => window.__toon.S.sel)).toBe('actor1');
  // size slider
  const mul0 = await T(page, () => window.__toon.stage.layers[0].mul);
  const size = page.getByLabel('Size', { exact: true }).first(); await size.fill('150'); await page.waitForTimeout(300);
  expect(await T(page, () => window.__toon.stage.layers[0].mul)).toBeCloseTo(1.5, 2);
  await undo(page); expect(await T(page, () => window.__toon.stage.layers[0].mul)).toBeCloseTo(mul0, 2);
  await redo(page); expect(await T(page, () => window.__toon.stage.layers[0].mul)).toBeCloseTo(1.5, 2);
  // flip
  const flip0 = await T(page, () => window.__toon.stage.layers[0].flip);
  await page.locator('.char-panel, .panel').getByRole('button', { name: /flip/i }).first().click().catch(async () => { await page.getByTitle(/flip/i).first().click(); }); await page.waitForTimeout(300);
  expect(await T(page, () => window.__toon.stage.layers[0].flip)).toBe(!flip0);
  await undo(page); expect(await T(page, () => window.__toon.stage.layers[0].flip)).toBe(flip0);
  // rename
  const nm = page.getByRole('textbox', { name: 'Selected character name' }).first(); await nm.fill('Hero'); await nm.press('Enter'); await page.waitForTimeout(300);
  expect(await T(page, () => window.__toon.S.speakers[0].name)).toBe('Hero');
  // remove (the panel button), then undo brings it back
  await page.getByRole('button', { name: 'Delete selected character' }).first().click(); await page.waitForTimeout(800);
  await page.locator('.modal').getByRole('button', { name: /delete|remove|yes|ok/i }).first().click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(800);
  expect(await T(page, () => [window.__toon.S.speakers.length, window.__toon.stage.layers.length])).toEqual([0, 0]);
  await undo(page); expect(await T(page, () => [window.__toon.S.speakers.length, window.__toon.stage.layers.length])).toEqual([1, 1]);
  expect((await px(page)).bright).toBeGreaterThan(50);
  expect(errors).toEqual([]);
});

test('animations: apply, the character really moves, split, duplicate, drag, delete; undo / redo every step', async ({ page }) => {
  test.setTimeout(150000);
  const errors = await openStudio(page, { chr: true });
  const clips = () => T(page, () => Object.values(window.__toon.S.manual).flat().map((m) => ({ s: +m.start.toFixed(2), d: +m.dur.toFixed(2), n: m.name })));
  await page.locator('#app .tabs.big').getByRole('button', { name: 'Animations', exact: true }).click(); await page.waitForTimeout(800);
  const walk = page.locator('.anim-cats .anim-cat:visible', { hasText: 'Walk / run / dance' }).first();          // the categories are chips with their count
  await expect(walk.locator('small')).toHaveText('14'); await walk.click(); await expect(walk).toHaveAttribute('aria-pressed', 'true'); await page.waitForTimeout(500);
  await expect(page.getByRole('group', { name: 'Tap a card to' }).getByRole('button', { name: 'Use for scene' })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.animation-apply:visible').first().click(); await page.waitForTimeout(800);          // "Apply" sets the automatic animation of the scene ...
  expect(await T(page, () => document.querySelector('.tclip.auto')?.innerText)).toMatch(/Walk/);
  await page.getByTitle('Add an animation for Neha at the playhead').click(); await page.waitForTimeout(500);          // ... the + button puts one on the timeline at the playhead
  await page.locator('.modal .anim-cat', { hasText: 'Walk / run / dance' }).click(); await page.locator('.modal .animation-apply').nth(1).click(); await page.waitForTimeout(1500);
  let c = await clips(); expect(c.length).toBe(1); expect(c[0].d).toBeGreaterThan(0.5);
  // "+ Add at playhead": a tap on a card adds one more clip instead of replacing; undo takes it away again
  await page.getByRole('group', { name: 'Tap a card to' }).getByRole('button', { name: '+ Add at playhead' }).click();
  await page.locator('.animation-apply:visible').nth(2).click(); await page.waitForTimeout(1200);
  expect((await clips()).length).toBe(2);
  await page.getByRole('button', { name: 'Undo', exact: true }).first().click(); await page.waitForTimeout(900);
  expect((await clips()).length).toBe(1);
  await page.getByRole('group', { name: 'Tap a card to' }).getByRole('button', { name: 'Use for scene' }).click();
  // search looks through every category
  await page.getByRole('searchbox', { name: 'Search animations' }).fill('walk'); await page.waitForTimeout(400);
  await expect(page.locator('.animation-count')).toHaveText(/found/); expect(await page.locator('.anim-cat.on').count()).toBe(0);
  await page.getByRole('searchbox', { name: 'Search animations' }).fill(''); await page.waitForTimeout(400);
  c = await clips();
  // the animation really plays: the picture changes with time
  const frame = async (t) => { await T(page, (tt) => { window.__toon.player.seek(tt); window.__toon.S.dirty = true; }, t); await page.waitForTimeout(250); return T(page, () => { const T = window.__toon; T.stage.render(T.player.time, 0, [], []); const c = document.createElement('canvas'); c.width = T.stage.out.width; c.height = T.stage.out.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(T.stage.out, 0, 0); return Array.from(g.getImageData(0, 0, c.width, c.height).data.filter((_, i) => i % 97 === 0)); }); };
  const a = await frame(c[0].s + 0.2), b = await frame(c[0].s + 0.6); let diff = 0; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 20) diff++; expect(diff).toBeGreaterThan(5);
  // timeline clip: select, split at the playhead, duplicate, delete
  await T(page, (t) => { window.__toon.player.seek(t); }, c[0].s + c[0].d / 2);
  await page.locator('.tclip.mine').first().click(); await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Cut the selected clip at the playhead' }).click(); await page.waitForTimeout(600);
  c = await clips(); expect(c.length).toBe(2); expect(c[0].d + c[1].d).toBeCloseTo(c0total(c), 1);
  await undo(page); expect((await clips()).length).toBe(1); await redo(page); expect((await clips()).length).toBe(2);
  await page.locator('.tclip.mine').first().click(); await page.getByRole('button', { name: 'Add the same clip again, right after this one' }).click(); await page.waitForTimeout(600);
  expect((await clips()).length).toBe(3); await undo(page); expect((await clips()).length).toBe(2);
  await page.locator('.tclip.mine').first().click(); await page.getByRole('button', { name: 'Delete the selected clip' }).click(); await page.waitForTimeout(600);
  expect((await clips()).length).toBe(1); await undo(page); expect((await clips()).length).toBe(2);
  expect(errors).toEqual([]);
});
const c0total = (c) => c.reduce((n, x) => n + x.d, 0);

test('effects and colour: a look on the scene changes the picture, the Colour tab grades it, remove and undo work', async ({ page }) => {
  test.setTimeout(150000);
  const errors = await openStudio(page, { chr: true });
  const base = await px(page);
  await page.locator('#app .tabs.big').getByRole('button', { name: 'Effects', exact: true }).click(); await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Whole scene', exact: true }).click(); await page.getByRole('button', { name: /^Night/ }).first().click(); await page.waitForTimeout(800);
  expect(await T(page, () => window.__toon.S.fx.length)).toBe(1);
  const night = await px(page); expect(night.avg[0] + night.avg[1] + night.avg[2]).toBeLessThan(base.avg[0] + base.avg[1] + base.avg[2] - 3);          // the picture is darker
  await undo(page); expect(await T(page, () => window.__toon.S.fx.length)).toBe(0); await redo(page); expect(await T(page, () => window.__toon.S.fx.length)).toBe(1);
  await page.locator('.rail-more summary').click(); await page.locator('.rail-btn', { hasText: /^Colour/ }).first().click(); await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Black & white', exact: true }).click(); await page.waitForTimeout(800);
  const bw = await px(page); expect(Math.abs(bw.avg[0] - bw.avg[2])).toBeLessThan(6);                           // grey: red and blue are the same
  await page.getByRole('button', { name: 'Normal', exact: true }).first().click(); await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});

test('mask: only the chosen area of the character is shown; invert hides it instead', async ({ page }) => {
  test.setTimeout(150000);
  const errors = await openStudio(page, { chr: true });
  const base = await px(page);
  await page.locator('.rail-more summary').click(); await page.locator('.rail-btn', { hasText: /^Mask/ }).first().click(); await page.waitForTimeout(500);
  await page.locator('.panel:visible input[type=checkbox]').first().check(); await page.waitForTimeout(500);
  const masked = await px(page); expect(masked.bright).toBeLessThan(base.bright);                                // part of the character is hidden
  await page.locator('.panel:visible').getByText('Invert').click(); await page.waitForTimeout(500);
  const inv = await px(page); expect(inv.bright).toBeLessThan(base.bright); expect(Math.abs(inv.bright - masked.bright)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('movement: a position point, a second one, the character walks between them', async ({ page }) => {
  test.setTimeout(150000);
  const errors = await openStudio(page, { chr: true });
  await page.locator('.rail-more summary').click(); await page.locator('.rail-btn', { hasText: /^Move/ }).first().click(); await page.waitForTimeout(500);
  const where = () => T(page, () => { const b = window.__toon.stage.layers[0].box; return (b.x0 + b.x1) / 2; });
  await page.getByRole('button', { name: /Keyframe here/ }).first().click(); await page.waitForTimeout(400);
  const x0 = await where();
  await T(page, () => { window.__toon.player.seek(3); window.__toon.S.dirty = true; }); await page.waitForTimeout(300);
  const hit = await T(page, () => { const T = window.__toon, b = T.stage.layers[0].box, r = T.stage.out.getBoundingClientRect(); return { x: (b.x0 + b.x1) / 2 / T.stage.W * r.width, y: (b.y0 + b.y1) / 2 / T.stage.H * r.height }; });
  const cv = await page.locator('#app .stagebox canvas').boundingBox();
  await page.mouse.move(cv.x + hit.x, cv.y + hit.y); await page.mouse.down(); await page.mouse.move(cv.x + hit.x + 150, cv.y + hit.y, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(500);
  expect(await T(page, () => Object.values(window.__toon.S.charKeys).flat().length)).toBeGreaterThanOrEqual(2);          // a point was made for the new place
  const x3 = await where(); expect(x3).toBeGreaterThan(x0 + 40);
  await T(page, () => { window.__toon.player.seek(1.5); window.__toon.S.dirty = true; }); await page.waitForTimeout(300);
  const mid = await where(); expect(mid).toBeGreaterThan(x0 + 5); expect(mid).toBeLessThan(x3);                      // half way in between
  await undo(page); await undo(page);
  expect(errors).toEqual([]);
});

test('tears: a rig without separate eyes still gets tears under both eyes; shadow switches on and off', async ({ page }) => {
  test.setTimeout(150000);
  const errors = await openStudio(page, { chr: true });
  await page.waitForTimeout(600);
  expect(await T(page, () => Object.keys(window.__toon.stage.layers[0].tearBind || {}).sort())).toEqual(['left', 'right']);          // Dayan's eyes are part of the eyelid piece
  await page.locator('.rail-more summary').click(); await page.locator('.rail-btn', { hasText: /^Tears/ }).first().click(); await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Tear 3', exact: true }).click(); await page.waitForTimeout(1000);
  expect(await T(page, () => Object.keys(window.__toon.stage.layers[0].tearAnchors || {}).sort())).toEqual(['left', 'right']);        // the drops are drawn under both eyes
  await page.locator('#app .tabs.big').getByRole('button', { name: 'Shadow', exact: true }).click(); await page.waitForTimeout(500);
  const sw = page.getByRole('switch', { name: 'Shadow of Neha' }); await sw.click(); await page.waitForTimeout(500);
  expect(await T(page, () => [window.__toon.S.speakers[0].shadow?.on, !!window.__toon.stage.layers[0].shadow])).toEqual([true, true]);
  await sw.click(); await page.waitForTimeout(400); expect(await T(page, () => !!window.__toon.stage.layers[0].shadow)).toBe(false);
  expect(errors).toEqual([]);
});

test('scenes: a new scene starts empty, scenes keep their own characters, switching back restores them, undo, reload keeps both', async ({ page }) => {
  test.setTimeout(200000);
  const errors = await openStudio(page, { chr: true });
  const info = () => T(page, () => ({ scenes: window.__toon.S.scenes?.length, active: window.__toon.S.sceneId ?? window.__toon.S.activeScene, spk: window.__toon.S.speakers.length, layers: window.__toon.stage.layers.length }));
  console.log('S1', JSON.stringify(await info()));
  await page.getByRole('button', { name: '+ New Scene' }).click(); await page.waitForTimeout(1500);
  const s2 = await info(); console.log('S2', JSON.stringify(s2));
  expect(s2.spk).toBe(0); expect(s2.layers).toBe(0);
  await page.getByRole('tab', { name: 'Scene 1' }).click(); await page.waitForTimeout(1500);
  const back = await info(); expect(back.spk).toBe(1); expect(back.layers).toBe(1);
  await page.getByRole('tab', { name: 'Scene 2' }).click(); await page.waitForTimeout(1000);
  expect((await info()).layers).toBe(0);
  expect(errors).toEqual([]);
});

test('background: a picture of the user\'s own fills the scene, can be moved and resized, replaced and deleted (undo restores it)', async ({ page }) => {
  test.setTimeout(150000);
  const errors = await openStudio(page, { chr: false });
  await T(page, async () => { const T = window.__toon, c = document.createElement('canvas'); c.width = 640; c.height = 360; const g = c.getContext('2d'); g.fillStyle = '#2a9d8f'; g.fillRect(0, 0, 640, 360); const blob = await new Promise((r) => c.toBlob(r)), rec = { id: 'bgx', name: 'teal.png', blob }; T.S.myBgs.push(rec); await T.addBgClipForTest(rec); });
  await page.waitForTimeout(600);
  const teal = await px(page); expect(teal.avg[1]).toBeGreaterThan(teal.avg[0] + 20);                                   // the picture is drawn: green > red
  expect(await T(page, () => window.__toon.S.bgClips.length)).toBe(1);
  // move + resize (the same numbers the finger / joystick set)
  await T(page, () => { const c = window.__toon.S.bgClips[0]; c.xf = { x: 0.2, y: 0, s: 0.6 }; window.__toon.stage.setBgXf(0, c.xf); window.__toon.S.dirty = true; }); await page.waitForTimeout(300);
  const small = await px(page); expect(small.avg[1] - small.avg[0]).toBeLessThan(teal.avg[1] - teal.avg[0]);              // a smaller picture shows less green
  // delete through the clip bar, then undo
  await T(page, () => { const T = window.__toon; T.S.bgSel = T.S.bgClips[0].id; T.drawClipBar(); }); await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Delete the selected clip|^Delete$/ }).first().click(); await page.waitForTimeout(600);
  expect(await T(page, () => window.__toon.S.bgClips.length)).toBe(0);
  await undo(page); expect(await T(page, () => window.__toon.S.bgClips.length)).toBe(1);
  expect((await px(page)).avg[1]).toBeGreaterThan(teal.avg[0] + 10);
  expect(errors).toEqual([]);
});

test('props and objects from the shared library: add to the scene, show on the canvas, move, hide, delete; undo restores', async ({ page }) => {
  test.setTimeout(150000);
  const server = await (async () => { const { installLibrary } = await import('./studio-library.js'); return installLibrary(page); })();
  const { addLibraryProp } = await import('./studio-library.js');
  await addLibraryProp(server, { name: 'Red box', type: 'prop', group: 'general' });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.route('**/api/r2', (r) => r.fallback());
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click(); await page.getByRole('textbox', { name: 'Create a project' }).fill('Props'); await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready); await page.waitForTimeout(1000);
  const redN = () => T(page, () => { const T = window.__toon; T.stage.render(T.player.time, 0, [], []); const c = document.createElement('canvas'); c.width = T.stage.out.width; c.height = T.stage.out.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(T.stage.out, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 180 && d[i + 1] < 80 && d[i + 2] < 80) n++; return n; });
  const before = await redN();
  await page.locator('#app .tabs.big').getByRole('button', { name: 'Objects', exact: true }).click(); await page.waitForTimeout(800);
  console.log('OBJECTS', JSON.stringify((await page.locator('#app .panel:visible').first().innerText()).replace(/\n+/g, ' | ').slice(0, 300)));
  await page.locator('#app .panel:visible .tile', { hasText: 'Red box' }).first().click(); await page.waitForTimeout(1500);
  expect(await T(page, () => window.__toon.S.props.length)).toBe(1);
  expect(await redN()).toBeGreaterThan(before + 300);                                    // the red box is drawn
  await undo(page); expect(await T(page, () => window.__toon.S.props.length)).toBe(0);
  await redo(page); expect(await T(page, () => window.__toon.S.props.length)).toBe(1);
  expect(errors).toEqual([]);
});

function wav(seconds = 3, rate = 16000) {
  const n = seconds * rate, buf = Buffer.alloc(44 + n * 2); buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const t = i / rate, env = Math.max(0, Math.sin(t * 9)) * 0.6, f = 180 + 120 * Math.sin(t * 3); buf.writeInt16LE(Math.round(env * 20000 * (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(2 * Math.PI * f * 2.1 * t))), 44 + i * 2); }
  return buf;
}
test('audio: a voice file becomes a voice line with its own speaker, the character speaks (lip-sync), the line can be split and deleted; undo restores', async ({ page }) => {
  test.setTimeout(200000);
  const errors = await openStudio(page, { chr: false });
  await page.locator('#app .tabs.big').getByRole('button', { name: 'Audio', exact: true }).click(); await page.waitForTimeout(600);
  const input = page.locator('#app input[type=file]').first();
  await input.setInputFiles({ name: 'voice1.wav', mimeType: 'audio/wav', buffer: wav(3) }); await page.waitForTimeout(3000);
  console.log('AUDIO', JSON.stringify(await T(page, () => ({ lines: window.__toon.S.lines.length, spk: window.__toon.S.speakers.map((s) => s.name), total: window.__toon.player.total, clips: window.__toon.player.clips.length }))));
  expect(await T(page, () => window.__toon.S.lines.length)).toBe(1);
  expect(await T(page, () => window.__toon.player.total)).toBeGreaterThan(2.5);
  const line = await T(page, () => { const l = window.__toon.S.lines[0]; return { start: l.start, dur: l.duration ?? l.dur, speaker: l.speaker }; });
  expect(line.speaker).toBeTruthy();
  // give the speaker a character, then the mouth moves with the voice
  await page.locator('#app .tabs.big').getByRole('button', { name: 'Characters', exact: true }).click(); await page.waitForTimeout(600);
  await page.locator('.cp-card').filter({ hasText: /^Neha$/ }).first().click(); await page.locator('.cp-poses .pose').first().click();
  await page.waitForFunction(() => window.__toon.stage.layers.length >= 1, null, { timeout: 30000 }); await page.waitForTimeout(800);
  await T(page, async () => { const T = window.__toon, S = T.S, actor = S.speakers.find((x) => x.manual); S.speakers = S.speakers.filter((x) => x !== actor); S.order = S.order.filter((k) => k !== actor.key); Object.assign(S.speakers.find((x) => x.key === S.lines[0].speaker), { charId: actor.charId, skins: actor.skins }); await T.applyLayers(); S.dirty = true; });          // the voice's speaker takes the character
  await page.waitForTimeout(800);
  const clips = await T(page, () => window.__toon.player.clips.map((c) => ({ v: c.visemes?.length || 0, speaker: c.speaker })));
  expect(clips.length).toBe(1); expect(clips[0].v).toBeGreaterThan(20);                                   // the voice was analysed for lip-sync
  // the lips change while the voice plays
  const lips = async (t) => { await T(page, (tt) => { window.__toon.player.seek(tt); window.__toon.S.dirty = true; }, t); await page.waitForTimeout(250); return T(page, () => { const l = window.__toon.stage.layers[0]; return l.arm.getSlot('lips')?.displayIndex; }); };
  const seen = new Set(); for (let t = 0.3; t < 2.8; t += 0.2) seen.add(await lips(t)); expect(seen.size).toBeGreaterThan(1);
  expect(errors).toEqual([]);
});

test('save and reopen: the scene (character, clip, camera, effect, background) comes back after a reload', async ({ page }) => {
  test.setTimeout(240000);
  const errors = await openStudio(page, { chr: true });
  await T(page, async () => { const T = window.__toon; T.S.camKeys.push({ id: 'k1', t: 1, cx: 0.5, cy: 0.5, zoom: 1.5, ease: 'smooth' }, { id: 'k2', t: 3, cx: 0.6, cy: 0.5, zoom: 2, ease: 'smooth' }); T.syncCam(); T.addFx('night', 'scene'); T.commitClips(); });
  await page.locator('#app .tabs.big').getByRole('button', { name: 'Animations', exact: true }).click(); await page.waitForTimeout(500);
  await page.getByTitle('Add an animation for Neha at the playhead').click(); await page.waitForTimeout(500); await page.locator('.modal .animation-apply').nth(1).click(); await page.waitForTimeout(1500);
  const snap = () => T(page, () => { const S = window.__toon.S; return { spk: S.speakers.map((x) => x.name), clips: Object.values(S.manual).flat().length, cam: S.camKeys.length, fx: S.fx.length, size: S.speakers[0]?.xf?.mul ?? 1 }; });
  const before = await snap(); expect(before).toMatchObject({ spk: ['Neha'], clips: 1, cam: 2, fx: 1 });
  const url = page.url(); await page.waitForTimeout(2500);          // the project saves itself a moment after the last edit
  await page.goto('about:blank'); await page.goto(url); await page.reload();
  await page.waitForFunction(() => window.__toon?.S.ready, null, { timeout: 60000 }); await page.waitForFunction(() => window.__toon.stage.layers.length >= 1, null, { timeout: 60000 }); await page.waitForTimeout(1500);
  expect(await snap()).toEqual(before);
  expect((await px(page)).bright).toBeGreaterThan(40);
  expect(errors).toEqual([]);
});

test('export: the scene is rendered to a video that plays, shows the character, and follows the camera', async ({ page }) => {
  test.setTimeout(280000);
  const errors = []; page.on('console', (m) => { if (/export failed|parallel export failed/i.test(m.text())) errors.push(m.text()); });
  await openStudio(page, { chr: true, workers: 1 });
  await T(page, () => { const S = window.__toon.S; S.fps = 30; S.quality = 360; S.dirty = true; });
  const download = page.waitForEvent('download', { timeout: 240000 });
  await page.locator('#app .hdr-tools').getByRole('button', { name: 'Export', exact: true }).click(); await page.locator('.exp-pop-go').click();
  const file = await download; const { readFile } = await import('node:fs/promises'); const bytes = await readFile(await file.path()); expect(bytes.length).toBeGreaterThan(3000);
  const r = await page.evaluate(async ([b64, mime]) => {
    const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: mime }), v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(blob);
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('the exported video does not play here')); });
    const c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true }); v.currentTime = Math.min(1, v.duration / 2); await new Promise((x) => { v.onseeked = x; }); c.width = v.videoWidth; c.height = v.videoHeight; g.drawImage(v, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; let green = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 1] > d[i] + 25 && d[i + 1] > d[i + 2] + 25) green++;          // Dayan's green skin
    return { dur: v.duration, w: v.videoWidth, h: v.videoHeight, green };
  }, [bytes.toString('base64'), file.suggestedFilename().endsWith('.mp4') ? 'video/mp4' : 'video/webm']);
  console.log('EXPORT', JSON.stringify(r));
  expect(r.dur).toBeGreaterThan(4); expect(r.green).toBeGreaterThan(30);
  expect(errors).toEqual([]);
});

test('voice trim: both edges of a voice line can be dragged, the scene gets shorter, double-click restores it', async ({ page }) => {
  test.setTimeout(150000);
  const errors = await openStudio(page, { chr: false });
  await page.locator('#app .tabs.big').getByRole('button', { name: 'Audio', exact: true }).click(); await page.waitForTimeout(500);
  await page.locator('#app input[type=file]').first().setInputFiles({ name: 'voice1.wav', mimeType: 'audio/wav', buffer: wav(4) }); await page.waitForTimeout(3000);
  const total0 = await T(page, () => window.__toon.player.total);
  const clip = () => page.locator('#app .lane2.audio .tclip.voice').first();
  await expect(clip()).toBeVisible();
  const drag = async (edge, dx) => { const box = await clip().boundingBox(), y = box.y + box.height / 2, x = edge === 'right' ? box.x + box.width - 4 : box.x + 4; await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx / 2, y, { steps: 4 }); await page.mouse.move(x + dx, y, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(400); };
  await drag('right', -120);
  const afterRight = await T(page, () => ({ trimEnd: window.__toon.S.lines[0].trimEnd, total: window.__toon.player.total }));
  console.log('TRIM right', JSON.stringify(afterRight), 'total0', total0);
  expect(afterRight.trimEnd).toBeGreaterThan(0.3); expect(afterRight.total).toBeLessThan(total0 - 0.3);
  await drag('left', 60);
  const afterLeft = await T(page, () => ({ trimStart: window.__toon.S.lines[0].trimStart, trimEnd: window.__toon.S.lines[0].trimEnd, total: window.__toon.player.total }));
  console.log('TRIM left', JSON.stringify(afterLeft));
  expect(afterLeft.trimStart).toBeGreaterThan(0.1);
  await clip().dblclick({ position: { x: 20, y: 10 } }); await page.waitForTimeout(400);
  expect(await T(page, () => [window.__toon.S.lines[0].trimStart, window.__toon.S.lines[0].trimEnd])).toEqual([0, 0]);
  expect(errors).toEqual([]);
});
