import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';

// The real Maya package (made by scripts/character-zip.mjs from the Maya page) is 5 MB, so it is not kept in the repository:
//   node scripts/character-zip.mjs maya_1.html /tmp/maya.zip --character maya --name Maya --category female --category-name Female
//   CHARACTER_ZIP=/tmp/maya.zip npx playwright test tests/browser/admin-characters.spec.js
const ZIP = process.env.CHARACTER_ZIP || '/tmp/maya.zip';

/** a stand-in for the character actions of api/studio-assets.js + R2 (the real server logic is tested in tests/characters-api.test.js) */
function fakeServer(page) {
  const s = { db: new Map(), r2: new Map(), characters: new Map(), categories: new Map(), puts: 0, putFiles: 0, commits: [] };
  page.route('**/api/studio-assets', async (route) => {
    const body = route.request().postDataJSON();
    if (!String(body.action).startsWith('character:')) return route.fulfill({ json: { assets: [] } });          // the props / effects library: empty here
    const b = { ...body, action: body.action.slice(10) };
    if (b.action === 'list') return route.fulfill({ json: { characters: [...s.characters.values()].map((c) => ({ ...c, categoryName: s.categories.get(c.category)?.name, animations: s.categories.get(c.category)?.views || {} })) } });
    if (b.action === 'putFile') { s.putFiles++; s.db.set(b.sha, b.gz); return route.fulfill({ json: { ok: true } }); }
    if (b.action === 'files') return route.fulfill({ json: { db: Object.fromEntries(b.refs.filter((r) => r.db).map((r) => [r.db, s.db.get(r.db)])), r2: Object.fromEntries(b.refs.filter((r) => r.r2).map((r) => [r.r2, `https://r2.fake/get/${r.r2}`])) } });
    if (b.action === 'commit') { s.commits.push(b); if (b.category.views) s.categories.set(b.category.id, b.category); s.characters.set(b.character.id, { ...b.character, category: b.category.id }); return route.fulfill({ json: { ok: true, categoryCreated: !!b.category.views } }); }
    if (b.action === 'update') { const c = s.characters.get(b.id); if (!c) return route.fulfill({ status: 404, json: { error: 'missing' } }); if (b.name !== undefined) c.name = String(b.name).trim(); if (b.group !== undefined) c.group = b.group; return route.fulfill({ json: { ok: true, character: c } }); }
    if (b.action === 'delete') { const c = s.characters.get(b.id); s.characters.delete(b.id); if (![...s.characters.values()].some((x) => x.category === c.category)) s.categories.delete(c.category); return route.fulfill({ json: { ok: true, removedFiles: 9 } }); }
    return route.fulfill({ status: 400, json: { error: 'unknown' } });
  });
  page.route('**/api/r2', async (route) => {
    const b = route.request().postDataJSON();
    return route.fulfill({ json: { upload: Object.fromEntries((b.items || []).filter((i) => !s.r2.has(i.hash)).map((i) => [i.hash, { url: `https://r2.fake/put/${i.hash}` }])), have: (b.items || []).filter((i) => s.r2.has(i.hash)).map((i) => i.hash) } });
  });
  page.context().route('https://r2.fake/**', async (route) => {
    const url = new URL(route.request().url()), [, kind, hash] = url.pathname.split('/');
    if (kind === 'put') { s.puts++; s.r2.set(hash, route.request().postDataBuffer()); return route.fulfill({ status: 200, body: '' }); }
    return route.fulfill({ status: 200, body: s.r2.get(hash) || Buffer.alloc(0), headers: { 'access-control-allow-origin': '*' } });
  });
  return s;
}


test('admin: Download HTML makes one file that plays the character with its animations', async ({ page, browser }) => {
  test.skip(!existsSync(ZIP), 'needs a character ZIP (CHARACTER_ZIP=...)');
  test.setTimeout(6 * 60 * 1000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1200, height: 1000 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  fakeServer(page);
  await page.goto('/?debug#/hub');
  await page.evaluate(async () => { const { charactersView } = await import('/src/admin-characters.js'); document.querySelector('#shell').replaceChildren(await charactersView({ home() {}, back() {}, toast: (m) => { window.__toast = m; } })); });
  await page.getByLabel('Character ZIP').setInputFiles(ZIP);
  await expect(page.locator('.admin-characters-stage canvas')).toBeVisible({ timeout: 40000 });
  await page.getByLabel('Animation preview quality').selectOption('low');
  await page.getByRole('button', { name: 'Done — upload' }).click();
  await expect.poll(() => page.evaluate(() => window.__toast), { timeout: 5 * 60 * 1000, intervals: [2000] }).toMatch(/is saved/);
  const download = page.waitForEvent('download', { timeout: 120000 });
  await page.locator('[data-act=download-html]').first().click();
  const file = await download, path = await file.path();
  expect(file.suggestedFilename()).toMatch(/^12toons-.*\.html$/);
  const html = readFileSync(path, 'utf8');
  expect(html.length).toBeGreaterThan(100000);
  expect(html).toContain('character-data');
  // the file works on its own: opened from disk it draws the character and offers the animations
  const viewer = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const viewerErrors = []; viewer.on('pageerror', (e) => viewerErrors.push(e.message));
  await viewer.goto('file://' + path);
  await expect(viewer.locator('aside select').nth(1).locator('option').first()).toBeAttached({ timeout: 30000 });
  await viewer.waitForTimeout(3000);
  const painted = async () => { const shot = (await viewer.locator('.cv-stage canvas').screenshot()).toString('base64'); return viewer.evaluate(async (b64) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const g = document.createElement('canvas'); g.width = g.height = 60; const x = g.getContext('2d'); x.drawImage(img, 0, 0, 60, 60); const d = x.getImageData(0, 0, 60, 60).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) > 40) n++; return n; }, shot); };
  await expect.poll(painted, { timeout: 15000 }).toBeGreaterThan(20);
  if (process.env.SHOT) await viewer.screenshot({ path: process.env.SHOT });
  expect(viewerErrors).toEqual([]); expect(errors).toEqual([]);
});
