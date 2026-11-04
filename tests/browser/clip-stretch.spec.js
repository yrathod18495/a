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

test('an animation comes onto the timeline 5 s long and plays once over the clip: longer = slower, shorter = faster; Split keeps the speed', async ({ page }) => {
  test.skip(!existsSync(ZIP), 'the Maya ZIP is not part of the repository');
  test.setTimeout(5 * 60 * 1000);
  await page.setViewportSize({ width: 1366, height: 900 });
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
  await expect(page.locator('.animation-len')).toHaveCount(0);
  const r = await page.evaluate(async () => {
    const T = window.__toon, { S, stage, player } = T, sp = S.speakers[0];
    const { categoriesFor } = await import('/src/catalog.js'); const def = [...stage.assets.values()][0].def;
    const a = categoriesFor(def.rig).flatMap((c) => c.animations).find((x) => x.ref.source === 'lib' && x.length > 0.5 && !x.ref.layer && x.length < 4);
    const plan = () => stage.layers[0].clips.filter((c) => c.manual);
    player.seek(0); await T.addClip(sp, a.ref, false, a.length);
    const m = S.manual[sp.key][0], first = { dur: m.dur, span: m.span, len: a.length, rate: plan()[0]?.rate, at: m.start };
    m.dur = 10; await new Promise((res) => setTimeout(res, 50)); T.commitClips(); await T.applyLayers?.();
    return { first, rateLong: T.rateOf(m), rateShort: (() => { m.dur = 2.5; return T.rateOf(m); })(), len: a.length };
  });
  const pose = await page.evaluate(async () => {
    const { S, stage, player } = window.__toon, m = S.manual[S.speakers[0].key][0]; m.dur = 5; window.__toon.commitClips(); await window.__toon.applyLayers();
    stage.render(m.start + 2.5, 0, [], []); const nm = stage.layers[0].clips.find((c) => c.manual).name, at = () => stage.layers[0].states.find((x) => x.name === nm)?.currentTime, half = at();
    stage.render(m.start + 5 * 0.8, 0, [], []); const late = at();
    return { half, late, len: m.span };
  });
  expect(pose.half).toBeCloseTo(pose.len * 0.5, 1); expect(pose.late).toBeCloseTo(pose.len * 0.8, 1);          // the animation is spread over the 5 s clip
  expect(r.first.dur).toBe(5); expect(r.first.span).toBeCloseTo(r.len, 2); expect(r.first.rate).toBeCloseTo(r.len / 5, 2);
  expect(r.rateLong).toBeCloseTo(r.len / 10, 3);           // 10 s clip: half the speed
  expect(r.rateShort).toBeCloseTo(r.len / 2.5, 3);         // 2.5 s clip: twice the speed
  // Split at 2 s of the 5 s clip: both halves keep the same speed and together show the whole animation
  const sp = await page.evaluate(async () => {
    const T = window.__toon, { S, player } = T, sp = S.speakers[0], m = S.manual[sp.key][0]; m.dur = 5; S.mclip = m.id; player.seek(2); T.drawClipBar?.();
    const rate0 = T.rateOf(m); await T.splitSelected();
    const [x, y] = S.manual[sp.key].slice().sort((p, q) => p.start - q.start);
    return { rate0, rx: T.rateOf(x), ry: T.rateOf(y), total: x.span + y.span, spanSum: m.span, offY: y.off, durs: [x.dur, y.dur], len: m.span };
  });
  expect(sp.rx).toBeCloseTo(sp.rate0, 3); expect(sp.ry).toBeCloseTo(sp.rate0, 3);
  expect(sp.durs[0] + sp.durs[1]).toBeCloseTo(5, 2); expect(sp.offY).toBeCloseTo(sp.rate0 * 2, 2);
});
