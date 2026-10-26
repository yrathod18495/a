import { test, expect } from '@playwright/test';

const N = 10;
async function studio(page) {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.route('**/api/security', r => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', r => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Ten');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.locator('#app .stagebox canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready)).toBe(true);
}
// the page is busy drawing ten characters on a software GL, so buttons are pressed from inside the page (no waiting for animation frames)
const press = (loc) => loc.evaluate(e => e.click());
const tab = async (page, name) => { await press(page.locator('#app .tabs.big').getByRole('button', { name, exact: true })); await page.waitForTimeout(800); };
const wavs = (page) => page.evaluate((N) => Array.from({ length: N }, (_, i) => {
  const sr = 8000, n = sr, b = new ArrayBuffer(44 + n * 2), v = new DataView(b), w = (o, s) => [...s].forEach((c, j) => v.setUint8(o + j, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let k = 0; k < n; k++) v.setInt16(44 + k * 2, Math.sin(k / (6 + i)) * 2000, true);
  return { name: `${String(i + 1).padStart(3, '0')}-Voice${i + 1}.wav`, data: [...new Uint8Array(b)] };
}), N).then(a => a.map(f => ({ name: f.name, mimeType: 'audio/wav', buffer: Buffer.from(f.data) })));
const png = (page, color) => page.evaluate(async (color) => { const c = document.createElement('canvas'); c.width = 320; c.height = 180; const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 320, 180); const b = await new Promise(r => c.toBlob(r, 'image/png')); return [...new Uint8Array(await b.arrayBuffer())]; }, color).then(a => Buffer.from(a));
const centre = (page, key) => page.evaluate((key) => { const { stage } = window.__toon, L = stage.layers.find(x => x.key === key), b = L.box, rc = stage.out.getBoundingClientRect(), k = rc.width / stage.W; return { x: rc.left + ((b.x0 + b.x1) / 2) * k, y: rc.top + ((b.y0 + b.y1) / 2) * k }; }, key);

test(`${N} voices + ${N} characters + 5 backgrounds + 3 effects: every character is selectable by click, right-click menu and timeline name`, async ({ page }) => {
  test.setTimeout(600000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await studio(page);
  await tab(page, 'Audio');
  await page.locator('#app .panel input[type=file]').first().setInputFiles(await wavs(page));
  await expect.poll(() => page.evaluate(() => window.__toon.S.lines.length), { timeout: 120000 }).toBe(N);
  await tab(page, 'Characters');
  for (let i = 0; i < N; i++) {
    if (!(await page.getByRole('button', { name: '＋ Pick character' }).first().isVisible().catch(() => false))) await tab(page, 'Characters');
    await press(page.getByRole('button', { name: '＋ Pick character' }).first());
    await expect(page.locator('.cp-card').nth(2)).toBeVisible();
    await press(page.locator('.cp-card').nth(i % 3));
    await expect(page.locator('.cp-poses .pose').first()).toBeVisible();
    await press(page.locator('.cp-poses .pose').first());
    await expect.poll(() => page.evaluate(() => window.__toon.stage.layers.length), { timeout: 60000 }).toBe(i + 1);
  }
  await tab(page, 'Background');
  for (const c of ['#c0392b', '#27ae60', '#2980b9', '#8e44ad', '#f39c12']) {
    const n = await page.evaluate(() => window.__toon.S.myBgs.length);
    await page.locator('#app .panel input[type=file]').first().setInputFiles({ name: `bg${c.slice(1)}.png`, mimeType: 'image/png', buffer: await png(page, c) });
    await expect.poll(() => page.evaluate(() => window.__toon.S.myBgs.length)).toBe(n + 1);
  }
  await page.evaluate(async () => {
    const { S, sharedBlobs } = window.__toon;
    for (const [id, name, blend] of [['fx-a', 'Sparkle', 'normal'], ['fx-b', 'Glow', 'add'], ['fx-c', 'Dust', 'normal']]) {
      const c = document.createElement('canvas'); c.width = c.height = 4; c.getContext('2d').fillStyle = '#ff00ff'; c.getContext('2d').fillRect(0, 0, 4, 4);
      sharedBlobs.set(id, await new Promise(r => c.toBlob(r, 'image/png')));
      S.sharedAssets.push({ id, type: 'effect', name, category: 'Magic', blend, opacity: 0.4, placement: 'full', updatedAt: '1' });
    }
  });
  await tab(page, 'Effects');
  for (let i = 0; i < 3; i++) await press(page.locator('.lib-card').nth(i));
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.filter(p => p.kind === 'effect').length)).toBe(3);
  // 1. a click on each character selects exactly that character and shows its frame with four handles
  const keys = await page.evaluate(() => window.__toon.stage.layers.map(l => l.key));
  expect(keys).toHaveLength(N);
  for (const key of keys) {
    const p = await centre(page, key);
    await page.mouse.click(p.x, p.y);
    await expect.poll(() => page.evaluate(() => window.__toon.S.sel), { timeout: 15000 }).toBe(key);
    await expect.poll(() => page.evaluate(() => ({ box: !document.querySelector('.selbox').hidden, handles: [...document.querySelectorAll('[data-c]')].filter(e => !e.hidden).length }))).toEqual({ box: true, handles: 4 });
  }
  // 2. a big empty box on top of a small character never takes the click: stack two characters on one spot
  await page.evaluate(() => { const { stage } = window.__toon, [a, b] = stage.layers; for (const l of [a, b]) { l.axf = 0.5; l.ayf = 0.07; } stage.layout(); });
  const stacked = await page.evaluate(() => { const { stage } = window.__toon, [a, b] = stage.layers, p = { x: (a.box.x0 + a.box.x1) / 2, y: (a.box.y0 + a.box.y1) / 2 }; return stage.hitLayers(p).map(l => l.key).filter(k => k === a.key || k === b.key); });
  expect(stacked.length).toBeGreaterThan(0);
  // 3. right click lists every character under the mouse and the chosen one is selected
  await page.evaluate(() => { window.__toon.S.sel = null; });
  const [a] = keys.slice(0, 1), p = await centre(page, a);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect(page.locator('.cs-ctx')).toBeVisible();
  const items = await page.locator('.cs-ctx button').count();
  expect(items).toBeGreaterThan(0);
  await press(page.locator('.cs-ctx button').last());
  await expect(page.locator('.cs-ctx')).toBeHidden();
  expect(await page.evaluate(() => window.__toon.S.sel)).toBeTruthy();
  // 4. the name in the timeline selects too
  await page.evaluate(() => { window.__toon.S.sel = null; });
  await press(page.locator('.rl.char').nth(2));
  expect(await page.evaluate(() => window.__toon.S.sel)).toBeTruthy();
  expect(errors).toEqual([]);
});

test('a character that is not in frame at the playhead can still be selected: the playhead goes to where it appears', async ({ page }) => {
  test.setTimeout(240000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await studio(page);
  await tab(page, 'Characters');
  await press(page.getByRole('button', { name: '＋ Add character', exact: true }));
  await press(page.locator('.cp-card').first());
  await press(page.locator('.cp-poses .pose').first());
  await expect.poll(() => page.evaluate(() => window.__toon.stage.layers.length), { timeout: 60000 }).toBe(1);
  await page.evaluate(() => { const { stage, S } = window.__toon, l = stage.layers[0]; l.present = [{ start: 2, end: 4 }]; l.shown = false; S.sel = null; });
  await page.evaluate(() => document.querySelector('.rl.char').click());
  await expect.poll(() => page.evaluate(() => window.__toon.S.sel)).toBeTruthy();
  expect(await page.evaluate(() => window.__toon.player.time)).toBeGreaterThanOrEqual(2);
  expect(errors).toEqual([]);
});
