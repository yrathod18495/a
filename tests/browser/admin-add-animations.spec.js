import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import JSZip from 'jszip';
const DAYAN = process.env.DAYAN_ZIP || '/home/user/a/deliver/dayan.zip';
const OUT = '/tmp/claude-0/-home-user-a/3967a7cb-7154-561f-8d0c-7184bb9946ac/scratchpad/anim-add';
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


// Adding animations to a character that is already saved: the ZIP's NEW animations are added after the saved ones; names that exist (also written with other capitals / dashes) are skipped; nothing is removed or doubled.
test('admin adds new animations from a ZIP: saved ones stay, same names are skipped, no duplicates, the saved previews stay', async ({ page }) => {
  test.skip(!existsSync(DAYAN), 'needs the Dayan ZIP');
  test.setTimeout(5 * 60 * 1000);
  mkdirSync(OUT, { recursive: true });
  // two small ZIPs made from the Dayan ZIP: A has 4 animations; B has 2 of A (one written differently), and 3 new ones
  const src = await JSZip.loadAsync(readFileSync(DAYAN)), manifest = JSON.parse(await src.file('manifest.json').async('string')), view = manifest.views[0];
  const make = async (name, pick) => {
    const z = new JSZip(), m = JSON.parse(JSON.stringify(manifest)); m.views[0].animations = pick;
    for (const [path, f] of Object.entries(src.files)) if (!f.dir && !path.includes('/animations/')) z.file(path, await f.async('nodebuffer'));
    z.file('manifest.json', JSON.stringify(m));
    for (const a of pick) z.file(a.file, await src.file(a.file).async('nodebuffer'));
    writeFileSync(`${OUT}/${name}`, await z.generateAsync({ type: 'nodebuffer' }));
  };
  const all = view.animations, A = all.slice(0, 4);
  const clone = (a, name, file) => ({ ...a, name, label: name, file, orig: a.name });
  const B = [clone(A[0], A[0].name.toUpperCase(), A[0].file.replace('.json', '_x.json')), A[1], clone(all[10], 'Brand_New_One', 'views/f34/animations/brand_new_one.json'), clone(all[11], 'brand-new two', 'views/f34/animations/brand_new_two.json'), clone(all[12], 'Brand_New_Three', 'views/f34/animations/brand_new_three.json')];
  await make('a.zip', A);
  { const z = new JSZip(), m = JSON.parse(JSON.stringify(manifest)); m.views[0].animations = B.map(({ orig, ...a }) => a);
    for (const [path, f] of Object.entries(src.files)) if (!f.dir && !path.includes('/animations/')) z.file(path, await f.async('nodebuffer'));
    z.file('manifest.json', JSON.stringify(m)); for (const a of B) z.file(a.file, await src.file(all.find((x) => x.name === (a.orig || a.name)).file).async('nodebuffer'));
    writeFileSync(`${OUT}/b.zip`, await z.generateAsync({ type: 'nodebuffer' })); }
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1200, height: 1000 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  const server = fakeServer(page);
  await page.goto('/?debug#/hub');
  await page.evaluate(async () => { const { charactersView } = await import('/src/admin-characters.js'); document.querySelector('#shell').replaceChildren(await charactersView({ home() {}, back() {}, toast: (m) => { window.__toast = m; } })); });
  // 1) the first upload: 4 animations
  await page.getByLabel('Character ZIP').setInputFiles(`${OUT}/a.zip`);
  await expect(page.locator('.admin-characters-head')).toContainText('1 views · 4 animations', { timeout: 30000 });
  await page.getByLabel('Animation preview quality').selectOption('low');
  await page.getByRole('button', { name: 'Done — upload' }).click();
  await expect.poll(() => page.evaluate(() => window.__toast), { timeout: 120000, intervals: [1000] }).toMatch(/Dayan is saved/);
  const first = server.commits.at(-1), firstNames = first.category.views.f34.animations.map((a) => a.name), firstFiles = JSON.stringify(first.category.views.f34.animations.map((a) => a.file));
  expect(firstNames.length).toBe(4); const firstGifs = Object.keys(first.character.views.f34.gifs);
  // 2) the second ZIP: the same character; "add" is chosen by itself and says what it will do
  await page.getByLabel('Character ZIP').setInputFiles(`${OUT}/b.zip`);
  await expect(page.locator('.admin-characters-head')).toContainText('5 animations', { timeout: 30000 });
  const add = page.locator('.admin-characters-choice', { hasText: 'Add only the NEW animations' });
  await expect(add).toBeVisible(); await expect(add.locator('input')).toBeChecked();
  await expect(add).toContainText('3 new will be added'); await expect(add).toContainText('2 already saved');
  await page.getByLabel('Animation preview quality').selectOption('low');
  await page.getByRole('button', { name: 'Done — upload' }).click();
  await expect.poll(() => page.evaluate(() => window.__toast), { timeout: 120000, intervals: [1000] }).toMatch(/3 new animations added to Dayan · 2 already saved/);
  const rec = server.commits.at(-1), list = rec.category.views.f34.animations, names = list.map((a) => a.name);
  expect(list.length).toBe(7);                                                                  // 4 saved + 3 new
  expect(names.slice(0, 4)).toEqual(firstNames);                                                // the saved ones first, in the same order
  expect(JSON.stringify(list.slice(0, 4).map((a) => a.file))).toBe(firstFiles);                // and exactly the same files
  expect(names.slice(4)).toEqual(['Brand_New_One', 'brand-new two', 'Brand_New_Three']);
  expect(new Set(names.map((n) => n.toLowerCase().replace(/[\s-]+/g, '_'))).size).toBe(7);    // no name twice
  const gifs = Object.keys(rec.character.views.f34.gifs);
  expect(gifs.length).toBe(7); for (const n of firstGifs) expect(gifs).toContain(n);           // the saved previews stay, the new ones are made
  expect(rec.character.views.f34.skeleton).toBeTruthy(); expect(rec.character.thumb).toBeTruthy();
  // 3) the same ZIP again: nothing new, nothing is saved
  const commits = server.commits.length;
  await page.getByLabel('Character ZIP').setInputFiles(`${OUT}/b.zip`);
  await expect(page.locator('.admin-characters-choice', { hasText: 'Add only the NEW animations' })).toContainText('0 new');
  await page.getByRole('button', { name: 'Done — upload' }).click();
  await expect(page.locator('.admin-characters-status')).toContainText('Nothing to add');
  expect(server.commits.length).toBe(commits);
  expect(errors).toEqual([]);
});
