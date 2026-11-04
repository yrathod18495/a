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

test('double tap on a character brings it back to 100% inside the frame, and Undo / Redo work for it; the corner handles are small', async ({ page }) => {
  test.skip(!existsSync(ZIP), 'the Maya ZIP is not part of the repository');
  test.setTimeout(5 * 60 * 1000);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  fakeServer(page);
  await page.goto('/?debug#/hub');
  await page.evaluate(async () => { const { charactersView } = await import('/src/admin-characters.js'); document.querySelector('#shell').replaceChildren(await charactersView({ home() {}, back() {}, toast: (m) => { window.__toast = m; } })); });
  await page.getByLabel('Character ZIP').setInputFiles(ZIP);
  await page.getByLabel('Animation preview quality').selectOption('low');
  await page.getByRole('button', { name: 'Done — upload' }).click();
  await expect.poll(() => page.evaluate(() => window.__toast), { timeout: 4 * 60 * 1000, intervals: [2000] }).toMatch(/Maya is saved/);
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Tears');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.locator('#app .stagebox canvas')).toBeVisible();
  await page.locator('#app .tabs.big').getByRole('button', { name: 'Characters', exact: true }).click();
  await page.locator('.cp-card').filter({ hasText: /^Maya$/ }).click(); await page.locator('.cp-poses .pose').first().click();
  await expect.poll(() => page.evaluate(() => window.__toon.stage.layers.length), { timeout: 30000 }).toBe(1);
  
  await page.waitForTimeout(1500);
  await page.evaluate(() => { document.querySelector('.panel')?.classList.remove('open'); const t = window.__toon, l = t.stage.layers[0]; l.axf = 0.62; l.ayf = 0.1; l.mul = 1.4; t.saveXf(l); t.stage.layout(); t.S.sel = l.key; t.S.dirty = true; });
  await page.waitForTimeout(800);
  const state = () => page.evaluate(() => { const l = window.__toon.stage.layers[0]; return { mul: +(l.mul ?? 1).toFixed(3), axf: +(l.axf ?? -1).toFixed(3), ayf: +(l.ayf ?? -1).toFixed(3) }; });
  const before = await state(); expect(before.mul).toBe(1.4);
  const hd = await page.locator('.stagewrap > .hd:not([hidden])').first().boundingBox(); expect(hd.width).toBeLessThanOrEqual(22);          // small corner handles
  const at = await page.evaluate(() => { const l = window.__toon.stage.layers[0], o = document.querySelector('.stagewrap canvas').getBoundingClientRect(), v = window.__toon.stage.view; return { x: o.left + ((l.box.x0 + l.box.x1) / 2 - v.x) / v.w * o.width, y: o.top + ((l.box.y0 + l.box.y1) / 2 - v.y) / v.h * o.height }; });
  await page.mouse.click(at.x, at.y); await page.waitForTimeout(120); await page.mouse.click(at.x, at.y); await page.waitForTimeout(600);
  const after = await state(); expect(after.mul).toBe(1); expect(after.axf).toBeGreaterThan(0.05); expect(after.axf).toBeLessThan(0.95); expect(after.ayf).toBeLessThan(0.6);
  await page.getByRole('button', { name: 'Undo' }).first().click(); await page.waitForTimeout(800);
  expect((await state()).mul).toBeCloseTo(1.4, 1);
  await page.getByRole('button', { name: 'Redo' }).first().click(); await page.waitForTimeout(800);
  expect((await state()).mul).toBe(1);
});
