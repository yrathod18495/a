import { test, expect } from '@playwright/test';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
async function studio(page, size = { width: 1000, height: 860 }) {
  await page.setViewportSize(size);
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Upload grid');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
  await page.evaluate(() => window.__toon.openTab('audio'));
}
const tile = (page, kind) => page.locator(`#app .up-cell:has(.up-tile[data-kind="${kind}"]) input[type=file]`);

test('the Upload tab has a tile for voices, music, backgrounds, objects, props, a logo, a video and your own characters', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await studio(page);
  await expect(page.locator('#app .up-tile')).toHaveText([/Voices/, /Music/, /Background/, /Objects/, /Props/, /Logo/, /Video/, /Characters/]);
  await expect(page.locator('#app .up-tile').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('each tile puts its file into the scene: a background clip, an object, a logo in the corner', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await studio(page);
  const file = (name) => ({ name, mimeType: 'image/png', buffer: PNG });
  await tile(page, 'background').setInputFiles(file('sky.png'));
  await expect.poll(() => page.evaluate(() => window.__toon.S.bgClips.length)).toBe(1);
  await tile(page, 'objects').setInputFiles(file('barrel.png'));
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.map((p) => p.name))).toContain('barrel');
  await tile(page, 'logo').setInputFiles(file('mylogo.png'));
  const logo = await expect.poll(() => page.evaluate(() => window.__toon.S.props.find((p) => p.name === 'Logo') || null)).not.toBeNull().then(() => page.evaluate(() => { const p = window.__toon.S.props.find((x) => x.name === 'Logo'); return { x: p.x, y: p.y, w: p.w }; }));
  expect(logo.x).toBeGreaterThan(0.8); expect(logo.y).toBeLessThan(0.25); expect(logo.w).toBeLessThan(0.3);
  await page.evaluate(() => window.__toon.openTab('audio'));
  expect(errors).toEqual([]);
});

test('a wrong kind of file is refused in plain English', async ({ page }) => {
  await studio(page);
  await tile(page, 'logo').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.locator('.toast, [role=status], .toasts').filter({ hasText: /image file for the logo/ }).first()).toBeVisible();
  await tile(page, 'video').setInputFiles({ name: 'pic.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('.toast, [role=status], .toasts').filter({ hasText: /video file/ }).first()).toBeVisible();
});

test('a short video becomes a looping, silent animated object', async ({ page }) => {
  test.setTimeout(60000);
  await studio(page);
  // a 1.5 s WebM made in the browser itself (a moving square)
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 160; c.height = 90; const g = c.getContext('2d');
    const rec = new MediaRecorder(c.captureStream(20), { mimeType: 'video/webm' }), chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data); const done = new Promise((r) => { rec.onstop = r; }); rec.start();
    const t0 = performance.now(); await new Promise((resolve) => { const tick = () => { const t = performance.now() - t0; g.fillStyle = '#123'; g.fillRect(0, 0, 160, 90); g.fillStyle = '#fc0'; g.fillRect((t / 10) % 140, 30, 20, 20); if (t < 1500) requestAnimationFrame(tick); else resolve(); }; tick(); });
    rec.stop(); await done;
    const buf = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return btoa(s);
  });
  await tile(page, 'video').setInputFiles({ name: 'clip.webm', mimeType: 'video/webm', buffer: Buffer.from(b64, 'base64') });
  await expect(page.locator('.vid-option')).toHaveText([/Behind the characters/, /In front, full screen/, /Small, in a corner/]);
  await page.locator('.vid-option[data-mode="backdrop"]').click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.find((p) => p.name === 'clip')?.sheet || null), { timeout: 30000 }).not.toBeNull();
  const sheet = await page.evaluate(() => window.__toon.S.props.find((p) => p.name === 'clip').sheet);
  expect(sheet.cols * sheet.rows).toBeGreaterThanOrEqual(2); expect(sheet.fps).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => window.__toon.S.props.find((p) => p.name === 'clip').blob.type)).toBe('image/png');
  // a backdrop fills the frame (a 16:9 clip in the 16:9 scene) and sits behind the characters
  const back = await page.evaluate(() => { const p = window.__toon.S.props.find((x) => x.name === 'clip'); return { w: p.w, h: p.h, x: p.x, y: p.y, behind: p.behind }; });
  expect(back).toMatchObject({ w: 1, h: 1, x: 0.5, y: 0.5, behind: true });
});

test('a video can also cover the whole scene in front (intro) or sit small in a corner (logo)', async ({ page }) => {
  test.setTimeout(60000);
  await studio(page);
  const make = () => page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 160; c.height = 90; const g = c.getContext('2d');
    const rec = new MediaRecorder(c.captureStream(20), { mimeType: 'video/webm' }), chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data); const done = new Promise((r) => { rec.onstop = r; }); rec.start();
    const t0 = performance.now(); await new Promise((resolve) => { const tick = () => { const t = performance.now() - t0; g.fillStyle = '#123'; g.fillRect(0, 0, 160, 90); g.fillStyle = '#fc0'; g.fillRect((t / 10) % 140, 30, 20, 20); if (t < 1200) requestAnimationFrame(tick); else resolve(); }; tick(); });
    rec.stop(); await done;
    const buf = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return btoa(s);
  });
  await tile(page, 'video').setInputFiles({ name: 'intro.webm', mimeType: 'video/webm', buffer: Buffer.from(await make(), 'base64') });
  await page.locator('.vid-option[data-mode="cover"]').click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.find((p) => p.name === 'intro')?.w ?? null), { timeout: 30000 }).toBe(1);
  expect(await page.evaluate(() => window.__toon.S.props.find((p) => p.name === 'intro').behind)).toBeFalsy();
  await tile(page, 'video').setInputFiles({ name: 'logo.webm', mimeType: 'video/webm', buffer: Buffer.from(await make(), 'base64') });
  await page.locator('.vid-option[data-mode="corner"]').click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.find((p) => p.name === 'logo')?.x ?? null), { timeout: 30000 }).toBeGreaterThan(0.8);
  expect(await page.evaluate(() => window.__toon.S.props.find((p) => p.name === 'logo').w)).toBeLessThan(0.4);
});

test('no "Start your scene" card, no music card before a song exists, and no "published yet" texts in the library panels', async ({ page }) => {
  await studio(page);
  await expect(page.getByText('Start your scene')).toBeHidden();
  await expect(page.getByText('Quick start')).toBeHidden();
  await expect(page.locator('#app .music-card')).toHaveCount(0);
  await expect(page.getByText('Background music')).toHaveCount(0);
  for (const tab of ['props', 'handprops']) { await page.evaluate((t) => window.__toon.openTab(t), tab); await expect(page.getByText(/published yet/)).toHaveCount(0); }
  // a song added with the Music tile brings its controls
  const wav = (() => { const n = 8000, b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); return b; })();
  await page.evaluate(() => window.__toon.openTab('audio'));
  await tile(page, 'music').setInputFiles({ name: 'song.wav', mimeType: 'audio/wav', buffer: wav });
  await page.locator('.tclip.music').dispatchEvent('click');               // the settings are on the music layer, not in the Upload tab
  await expect(page.locator('.modal .music-card')).toContainText('song');
});

test('the hand props start with a + card and "Check for new" is a small icon next to the title, in every library panel', async ({ page }) => {
  await studio(page, { width: 400, height: 860 });
  await page.evaluate(() => window.__toon.openTab('handprops'));
  await expect(page.locator('#app .hand-props .add-card')).toBeVisible();
  await expect(page.locator('#app .hand-props .panel-head .refresh-btn')).toBeVisible();
  await expect(page.locator('#app .hand-props .panel-head .refresh-btn')).toHaveAttribute('aria-label', 'Check for new');
  await expect(page.getByText('↻ Check for new')).toHaveCount(0);
  await page.evaluate(() => window.__toon.openTab('props'));
  await expect(page.locator('#app .panel-head .refresh-btn')).toBeVisible();
  await expect(page.locator('#app .tile.add').first()).toBeVisible();                      // "+" first
});

test('a prop of your own can be added with + and asks which character holds it', async ({ page }) => {
  await studio(page);
  await page.evaluate(() => window.__toon.openTab('handprops'));
  await page.locator('#app .hand-props input[type=file]').setInputFiles({ name: 'sword.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('.toast, [role=status], .toasts').filter({ hasText: /add a character first/i }).first()).toBeVisible();   // no character yet: the same message as for a library prop
});
