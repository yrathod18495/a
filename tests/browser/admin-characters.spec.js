import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';

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

test('admin uploads the Maya ZIP: preview with Prev / Next and views, Done makes a GIF per animation and stores everything, Delete removes it', async ({ page }) => {
  test.skip(!existsSync(ZIP), 'the Maya ZIP is made by scripts/character-zip.mjs and is not part of the repository');
  test.setTimeout(8 * 60 * 1000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1200, height: 1000 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  const server = fakeServer(page);
  await page.goto('/?debug#/hub');
  await page.evaluate(async () => { const { charactersView } = await import('/src/admin-characters.js'); document.querySelector('#shell').replaceChildren(await charactersView({ home() {}, back() {}, toast: (m) => { window.__toast = m; } })); });
  await expect(page.getByText('No characters yet')).toBeVisible();

  await page.getByLabel('Character ZIP').setInputFiles(ZIP);
  await expect(page.getByRole('heading', { name: 'Maya', level: 2 })).toBeVisible({ timeout: 30000 });
  await expect(page.locator('.admin-characters-head')).toContainText('Category: Female · 4 views · 88 animations');
  const info = page.locator('.admin-characters-anim');
  await expect(info).toContainText('stand'); await expect(info).toContainText('1 / 29'); await expect(info).toContainText('stand_female.gif');
  // the character is really drawn on the preview
  // the character is really drawn on the preview (read from a screenshot: a WebGL canvas cannot be read between frames)
  const drawn = async () => { const shot = (await page.locator('.admin-characters-stage canvas').screenshot()).toString('base64');
    return page.evaluate(async (b64) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const g = document.createElement('canvas'); g.width = g.height = 60; const x = g.getContext('2d'); x.drawImage(img, 0, 0, 60, 60); const d = x.getImageData(0, 0, 60, 60).data; const seen = new Set(); for (let i = 0; i < d.length; i += 4) seen.add(d[i] >> 4 << 8 | d[i + 1] >> 4 << 4 | d[i + 2] >> 4); return seen.size; }, shot); };
  await expect.poll(drawn, { timeout: 15000 }).toBeGreaterThan(20);
  await page.getByRole('button', { name: 'Next ›' }).click(); await expect(info).toContainText('walk'); await expect(info).toContainText('2 / 29');
  await page.getByRole('button', { name: '‹ Prev' }).click(); await page.getByRole('button', { name: '‹ Prev' }).click(); await expect(info).toContainText('29 / 29');
  await page.getByRole('button', { name: 'Side', exact: true }).click(); await expect(info).toContainText('1 / 21');
  await page.getByRole('button', { name: '❚❚ Pause' }).click(); await expect(page.getByRole('button', { name: '▶ Play' })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click(); await expect(info).toContainText('1 / 17');
  await expect.poll(drawn).toBeGreaterThan(20);

  // Done: previews, then the upload
  await page.getByRole('button', { name: 'Done — upload' }).click();
  await expect(page.locator('.admin-characters-status')).toContainText('Making the animation previews', { timeout: 30000 });
  await expect.poll(() => page.evaluate(() => window.__toast), { timeout: 7 * 60 * 1000, intervals: [2000] }).toMatch(/Maya is saved with a new category "Female"/);
  const rec = server.commits.at(-1);
  expect(Object.keys(rec.character.views)).toEqual(['f34', 'fr', 'sd', 'bk']);
  expect(Object.values(rec.category.views).reduce((n, v) => n + v.animations.length, 0)).toBe(88);
  expect(Object.values(rec.category.views).every((v) => v.animations.every((a) => a.file?.db && a.gif?.r2))).toBe(true);   // animations in the database, every GIF in R2
  expect(Object.values(rec.character.views).every((v) => v.skeleton.db && v.textures.every((t) => t.json.db && t.page.r2))).toBe(true);
  expect(rec.character.thumb.r2).toBeTruthy();
  expect(Object.values(rec.character.views).every((v) => v.thumb?.r2)).toBe(true);                        // every view has its own picture
  expect(new Set(Object.values(rec.character.views).map((v) => v.thumb.r2)).size).toBe(4);               // and they are four different pictures
  expect(server.puts).toBe(4 + 88 + 4);                       // 4 texture pages + 88 GIFs + 4 view pictures (the character's own picture is the 3/4 one) went to R2
  // 4 skeletons + 4 atlas files + 88 animations went to the database; a file that is exactly the same in two views is stored once
  const dbFiles = new Set([...Object.values(rec.character.views).flatMap((v) => [v.skeleton.db, ...v.textures.map((t) => t.json.db)]), ...Object.values(rec.category.views).flatMap((v) => v.animations.map((a) => a.file.db))]);
  expect(server.putFiles).toBe(dbFiles.size); expect(dbFiles.size).toBeGreaterThan(80); expect(dbFiles.size).toBeLessThanOrEqual(96);
  const gif = server.r2.get(rec.category.views.f34.animations[1].gif.r2);
  expect(gif.subarray(0, 6).toString()).toBe('GIF89a'); expect(gif.readUInt16LE(6)).toBe(128); expect(gif.length).toBeLessThan(150 * 1024);
  // the saved list
  await expect(page.locator('.admin-character-card')).toHaveCount(1);
  await expect(page.locator('.admin-character-card')).toContainText('3/4 Front, Front, Side, Back · 88 animations');
  await expect.poll(() => page.locator('.admin-character-thumb img').evaluate((i) => [i.naturalWidth, i.naturalHeight])).toEqual([200, 320]);
  // delete
  page.once('dialog', (d) => d.accept());
  await page.locator('.admin-character-card').getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('.admin-character-card')).toHaveCount(0);
  expect(server.characters.size).toBe(0); expect(server.categories.size).toBe(0);
  expect(errors).toEqual([]);
});

test('a ZIP that is not a character package is explained and nothing can be uploaded', async ({ page }) => {
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  fakeServer(page);
  await page.goto('/?debug#/hub');
  await page.evaluate(async () => { const { charactersView } = await import('/src/admin-characters.js'); document.querySelector('#shell').replaceChildren(await charactersView({ home() {}, back() {}, toast() {} })); });
  const zip = await page.evaluate(async () => { const JSZip = (await import('/node_modules/.vite/deps/jszip.js')).default; const z = new JSZip(); z.file('readme.txt', 'hello'); return Array.from(await z.generateAsync({ type: 'uint8array' })); }).catch(() => null);
  const buffer = zip ? Buffer.from(zip) : Buffer.from('PK\u0005\u0006' + '\u0000'.repeat(18), 'binary');
  await page.getByLabel('Character ZIP').setInputFiles({ name: 'other.zip', mimeType: 'application/zip', buffer });
  await expect(page.getByRole('heading', { name: 'This ZIP cannot be used' })).toBeVisible();
  await expect(page.locator('.admin-characters-errors')).toContainText('no manifest.json');
  await expect(page.getByRole('button', { name: 'Done — upload' })).toHaveCount(0);
});

test('after the admin uploads Maya, a creator picks her in the Animator Studio, sees the animation previews (GIFs) and applies an animation', async ({ page }) => {
  test.skip(!existsSync(ZIP), 'the Maya ZIP is made by scripts/character-zip.mjs and is not part of the repository');
  test.setTimeout(6 * 60 * 1000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  const server = fakeServer(page);
  await page.goto('/?debug#/hub');
  await page.evaluate(async () => { const { charactersView } = await import('/src/admin-characters.js'); document.querySelector('#shell').replaceChildren(await charactersView({ home() {}, back() {}, toast: (m) => { window.__toast = m; } })); });
  await page.getByLabel('Character ZIP').setInputFiles(ZIP);
  await page.getByRole('button', { name: 'Done — upload' }).click();
  await expect.poll(() => page.evaluate(() => window.__toast), { timeout: 5 * 60 * 1000, intervals: [2000] }).toMatch(/Maya is saved/);
  expect(server.characters.size).toBe(1);

  // the studio, as a creator
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Maya test');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.locator('#app .stagebox canvas')).toBeVisible();
  await page.locator('#app .tabs.big').getByRole('button', { name: 'Characters', exact: true }).click();
  await page.getByRole('button', { name: 'Add character', exact: true }).click();
  // page 1: the characters only (no poses below); Prev is off, Next needs a character
  await expect(page.locator('.cp-stepbar .cp-step.on')).toHaveText('1Character');
  await expect(page.locator('.cp-poses')).toHaveCount(0);
  await expect(page.locator('.cp-prev')).toBeDisabled(); await expect(page.locator('.cp-next')).toBeDisabled();
  await expect(page.locator('.cp-card:not(.pose) .cp-img img')).toHaveCount(1);
  await page.locator('.cp-card').filter({ hasText: /^Maya$/ }).click();
  await expect(page.locator('.cp-poses')).toHaveCount(0); await expect(page.locator('.cp-next')).toBeEnabled();
  await page.locator('.cp-next').click();
  // page 2: the chosen character on top, then its poses; Prev goes back, Next confirms
  await expect(page.locator('.cp-stepbar .cp-step.on')).toHaveText('2Pose');
  await expect(page.locator('.cp-chosen')).toContainText('Maya');
  await expect(page.locator('.cp-poses .pose')).toHaveCount(4);
  await expect(page.locator('.cp-poses .pose small')).toHaveText(['3/4 Front', 'Front', 'Side', 'Back']);
  await expect(page.locator('.cp-poses .pose.on small')).toHaveText('3/4 Front');                       // the front pose is ready to use
  // each pose card has its own picture, drawn as a portrait with the character filling it
  const pics = await page.locator('.cp-poses .pose img').evaluateAll((imgs) => imgs.map((i) => [i.src, i.naturalWidth, i.naturalHeight]));
  expect(new Set(pics.map((p) => p[0])).size).toBe(4); expect(pics.every((p) => p[1] === 200 && p[2] === 320)).toBe(true);
  const pixels = await Promise.all((await page.locator('.cp-poses .pose img').all()).map((img) => img.evaluate(async (el) => { const c = document.createElement('canvas'); c.width = 40; c.height = 64; const g = c.getContext('2d'); g.drawImage(el, 0, 0, 40, 64); const d = g.getImageData(0, 0, 40, 64).data; let h = 0; for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) % 1000003; return h; })));
  expect(new Set(pixels).size).toBe(4);                                                                   // different views really look different
  await page.locator('.cp-prev').click(); await expect(page.locator('.cp-stepbar .cp-step.on')).toHaveText('1Character'); await expect(page.locator('.cp-card.on')).toContainText('Maya');
  await page.locator('.cp-next').click();
  await page.locator('.cp-poses .pose').nth(1).click(); await expect(page.locator('.cp-poses .pose.on small')).toHaveText('Front');   // choosing a pose only marks it ...
  expect(await page.evaluate(() => window.__toon.stage.layers.length)).toBe(0);                          // ... nothing is applied before Next
  await page.locator('.cp-next').click();                                                               // Next on the last page confirms
  await expect.poll(() => page.evaluate(() => window.__toon.stage.layers.length), { timeout: 30000 }).toBe(1);
  // the animation list: Maya's categories, each animation with its GIF
  await page.locator('#app .tabs.big').getByRole('button', { name: 'Animations', exact: true }).click();
  const cats = await page.evaluate(async () => { const { categoriesFor } = await import('/src/catalog.js'); const l = window.__toon.stage.layers[0]; const def = [...window.__toon.stage.assets.values()][0].def; return categoriesFor(def.rig).map((c) => [c.name, c.animations.length]); });
  expect(cats.map((c) => c[0])).toEqual(['Idle', 'Walk / run / dance', 'Body animations', 'Arms & hands (layer)']);          // Maya's talking moves are arm actions (both talk, right explain)
  expect(cats.reduce((n, c) => n + c[1], 0)).toBe(21);                    // the Front view (the pose chosen above) has 21 animations; the 3/4 view has 29
  const walkLabel = (await page.locator('select[aria-label="Animation category"] option', { hasText: 'Walk / run / dance' }).textContent()).trim();      // e.g. "Walk / run / dance (7)" for the Front view
  await page.getByLabel('Animation category').selectOption({ label: walkLabel });
  const walkCount = Number(walkLabel.match(/\((\d+)\)/)[1]);
  expect(walkCount).toBeGreaterThanOrEqual(1);
  await expect.poll(() => page.locator('.animation-thumb img').evaluateAll((imgs) => imgs.filter((i) => i.src.startsWith('blob:') && i.naturalWidth === 128).length), { timeout: 30000 }).toBe(walkCount);
  // apply walk: the clip is placed and the animation file came from the stored copy
  await page.getByTitle('Apply walk', { exact: true }).click();
  await expect(page.getByTitle('Apply walk', { exact: true })).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 });
  expect(await page.evaluate(() => [...window.__toon.stage.layers[0].anim].some((n) => /walk/.test(n)))).toBe(true);
  expect(errors).toEqual([]);
});
