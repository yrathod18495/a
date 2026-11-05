import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cleanAssetMeta } from '../../shared/studio-effects.js';

const WHO = process.env.WHO || 'Maya', CACHE = `/tmp/claude-0/-home-user-a/3967a7cb-7154-561f-8d0c-7184bb9946ac/scratchpad/mashal/${WHO.toLowerCase()}-cloud.json`;          // the uploaded Maya (fake cloud state) is kept here, so the slow upload happens once
const ZIP = process.env.CHARACTER_ZIP || (WHO === 'Roshan' ? '/tmp/claude-0/-home-user-a/3967a7cb-7154-561f-8d0c-7184bb9946ac/scratchpad/wz/roshan.zip' : '/tmp/maya.zip'), GIF = process.env.MASHAL_GIF || '/tmp/claude-0/-home-user-a/3967a7cb-7154-561f-8d0c-7184bb9946ac/scratchpad/mashal/mashal.gif', OUT = '/tmp/claude-0/-home-user-a/3967a7cb-7154-561f-8d0c-7184bb9946ac/scratchpad/mashal/';

/** a stand-in for the character actions of api/studio-assets.js + R2 (the real server logic is tested in tests/characters-api.test.js) */
function fakeServer(page) {
  const s = { assets: new Map(), db: new Map(), r2: new Map(), characters: new Map(), categories: new Map(), puts: 0, putFiles: 0, commits: [] };
  page.route('**/api/studio-assets', async (route) => {
    const body = route.request().postDataJSON();
    if (!String(body.action).startsWith('character:')) {          // the props / effects / backgrounds library: kept here, validated by the real server rules
      if (body.action === 'list') return route.fulfill({ json: { assets: [...s.assets.values()] } });
      if (body.action === 'save') {
        let meta; try { meta = cleanAssetMeta(body.type, body); } catch (e) { return route.fulfill({ status: 400, json: { error: e.message } }); }
        const asset = { ...meta, id: body.id, type: body.type, name: body.name.trim(), key: body.key, size: body.size, mime: body.mime, enabled: true, updatedAt: new Date().toISOString() };
        s.assets.set(asset.id, asset); return route.fulfill({ json: { asset } });
      }
      if (body.action === 'get') { const a = s.assets.get(body.id); return route.fulfill({ json: { url: `https://r2.fake/get/${a.key.slice(7)}` } }); }
      return route.fulfill({ json: { assets: [] } });
    }
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


test('MASHAL end to end: the admin uploads an animated GIF as a hand prop, the studio lists it, a tap asks the hand, the torch plays in Maya\'s hand, can be selected on the canvas and moved', async ({ page }) => {
  test.skip(!existsSync(ZIP) || !existsSync(GIF), 'needs the Maya ZIP and the torch GIF');
  test.setTimeout(16 * 60 * 1000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  const cloud = fakeServer(page); page.setDefaultTimeout(30000);
  await page.goto('/?debug#/hub');
  // 1. the admin publishes Maya (once; later runs load her from the cache), then the torch (Add Props = hand props)
  const cached = existsSync(CACHE);
  if (cached) { const c = JSON.parse(readFileSync(CACHE, 'utf8')); for (const [k, v] of c.db) cloud.db.set(k, v); for (const [k, v] of c.r2) cloud.r2.set(k, Buffer.from(v, 'base64')); for (const [k, v] of c.characters) cloud.characters.set(k, v); for (const [k, v] of c.categories) cloud.categories.set(k, v); console.log('STEP maya loaded from the cache'); }
  if (!cached) await page.evaluate(async () => { const { charactersView } = await import('/src/admin-characters.js'); document.querySelector('#shell').replaceChildren(await charactersView({ home() {}, back() {}, toast: (m) => { window.__toast = m; } })); });
  if (!cached) {
    await page.getByLabel('Character ZIP').setInputFiles(ZIP);
    await page.getByLabel('Animation preview quality').selectOption('low');
    await page.getByRole('button', { name: 'Done — upload' }).click();
    await expect.poll(() => page.evaluate(() => window.__toast), { timeout: 10 * 60 * 1000, intervals: [2000] }).toMatch(new RegExp(`${WHO} is saved`)); console.log('STEP maya saved');
    writeFileSync(CACHE, JSON.stringify({ db: [...cloud.db], r2: [...cloud.r2].map(([k, v]) => [k, Buffer.from(v).toString('base64')]), characters: [...cloud.characters], categories: [...cloud.categories] }));
  }
  await page.evaluate(async () => { const { propsEffectsView } = await import('/src/admin-props-effects.js'); document.querySelector('#shell').replaceChildren(await propsEffectsView({ home: () => {}, back: () => {}, toast: (m) => { window.__toast = m; }, only: 'prop', group: 'hand' })); });
  console.log('STEP admin props view'); await page.getByLabel('Image file').setInputFiles(GIF);
  await page.getByLabel('Who can use it', { exact: true }).selectOption('free');          // the default is Paid only: a free account would see the torch locked
  await page.getByRole('button', { name: 'Publish prop', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toast), { timeout: 60000 }).toMatch(/published/i);
  await expect(page.locator('.admin-asset-card', { hasText: 'mashal' })).toHaveCount(1); console.log('STEP mashal published');
  // 2. the studio: Maya on the stage
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Mashal');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.locator('#app .stagebox canvas')).toBeVisible();
  await page.locator('#app .tabs.big').getByRole('button', { name: 'Characters', exact: true }).click();
  await page.locator('.cp-kind').first().click().catch(() => {}); for (const kind of ['Male', 'Female']) { const tab = page.getByRole('tab', { name: kind, exact: true }); if (await tab.count()) { await tab.click(); if (await page.locator('.cp-card').filter({ hasText: new RegExp(`^${WHO}$`) }).count()) break; } }
  await page.locator('.cp-card').filter({ hasText: new RegExp(`^${WHO}$`) }).click(); await page.locator('.cp-poses .pose').first().click();
  await expect.poll(() => page.evaluate(() => window.__toon.stage.layers.length), { timeout: 30000 }).toBe(1);
  await page.waitForTimeout(1500); console.log('STEP maya on stage');
  // 3. Props tab: the torch is listed with nobody selected; tap it, choose the right hand
  await page.locator('#app .tabs.big').getByRole('button', { name: 'Props', exact: true }).click();
  const card = page.locator('.hand-card', { hasText: 'mashal' }); await expect(card).toBeVisible({ timeout: 20000 });
  await card.click();
  await expect(page.locator('.edit-dock .ed-title')).toContainText('which hand');
  await page.locator('.edit-dock .ed-hand[data-hand="R"]').click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.length), { timeout: 30000 }).toBe(1);
  const info = await page.evaluate(() => { const p = window.__toon.S.props[0]; return { attach: p.attach, sheet: p.sheet, type: p.blob.type, w: p.w, h: p.h, name: p.name }; });
  console.log('PROP', JSON.stringify(info));
  expect(info.attach).toMatchObject({ hand: 'R' }); expect(info.sheet.cols * info.sheet.rows).toBeGreaterThan(1); expect(info.type).toBe('image/png');
  await page.evaluate(() => { document.querySelector('.panel')?.classList.remove('open'); window.__toon.S.sel = null; });
  await page.waitForTimeout(800);
  // 4. it really sits at the palm and it animates (the picture around it changes with time)
  const geo = await page.evaluate(() => { const { stage, S } = window.__toon, p = S.props[0], pl = stage.propPlacement(p, 0), l = stage.layers[0]; return { pl, palm: (() => { const bone = ['R_Palm', 'right_grip', 'right_palm_jt'].map((n) => l.arm.getBone(n)).find(Boolean); if (!bone) return null; const m = bone.globalTransformMatrix, M = l.mat; return { x: M[0] * m.tx + M[2] * m.ty + M[4], y: M[1] * m.tx + M[3] * m.ty + M[5] }; })(), W: stage.W, H: stage.H }; });
  console.log('GEO', JSON.stringify(geo));
  expect(Math.abs(Math.sin(geo.pl.a))).toBeLessThan(0.05); console.log('BONES', JSON.stringify(await page.evaluate(() => window.__toon.stage.layers[0].arm.getBones().map((b) => b.name))));
  expect(geo.pl).not.toBeNull(); expect(geo.palm).not.toBeNull();
  expect(Math.hypot(geo.pl.cx - geo.palm.x, geo.pl.cy - geo.palm.y)).toBeLessThan(geo.pl.h * 0.6);          // the torch sits at the hand (its middle within the palm's reach)
  const frame = (t) => page.evaluate((time) => { const { stage } = window.__toon; stage.propClock = null; stage.render(time, 0, [], []); const c = document.createElement('canvas'); c.width = stage.out.width; c.height = stage.out.height; const g = c.getContext('2d'); g.drawImage(stage.out, 0, 0); return c.toDataURL('image/png'); }, t);
  const f0 = await frame(0.0), f1 = await frame(0.07), f2 = await frame(0.35);
  writeFileSync(OUT + 'f0.png', Buffer.from(f0.split(',')[1], 'base64')); writeFileSync(OUT + 'f1.png', Buffer.from(f1.split(',')[1], 'base64')); writeFileSync(OUT + 'f2.png', Buffer.from(f2.split(',')[1], 'base64'));
  expect(f0).not.toBe(f1); expect(f1).not.toBe(f2);          // the torch changes from frame to frame
  // 4b. the character walks: the torch must stay at the hand in every frame
  await page.evaluate(async () => {
    const T = window.__toon, { S, stage, player } = T, sp = S.speakers[0], { categoriesFor } = await import('/src/catalog.js'), def = [...stage.assets.values()][0].def;
    const walk = categoriesFor(def.rig).flatMap((c) => c.animations).find((x) => /walk/i.test(x.name) && !x.ref.layer && x.length);
    player.seek(0); await T.addClip(sp, walk.ref, false, walk.length); T.S.mclip = null;
  });
  for (const t of [0.4, 1.3, 2.1, 3.0]) {
    const g = await page.evaluate((time) => { const { stage, S } = window.__toon, l = stage.layers[0]; stage.propClock = null; stage.render(time, 0, [], []); const p = S.props[0], pl = stage.propPlacement(p, time), bone = ['R_Palm', 'right_grip', 'right_palm_jt'].map((n) => l.arm.getBone(n)).find(Boolean), m = bone.globalTransformMatrix, M = l.mat, palm = { x: M[0] * m.tx + M[2] * m.ty + M[4], y: M[1] * m.tx + M[3] * m.ty + M[5] };
      const c = document.createElement('canvas'); c.width = stage.out.width; c.height = stage.out.height; c.getContext('2d').drawImage(stage.out, 0, 0); return { pl, palm, png: c.toDataURL('image/png'), grip: p.grip }; }, t);
    writeFileSync(OUT + `walk-${WHO}-${t}.png`, Buffer.from(g.png.split(',')[1], 'base64'));
    expect(Math.abs(Math.sin(g.pl.a))).toBeLessThan(0.05); expect(Math.hypot(g.pl.cx - g.palm.x, g.pl.cy - g.palm.y)).toBeLessThan(g.pl.h * 0.3);          // upright and at the palm in every frame of the walk
    console.log('WALK', WHO, t, JSON.stringify({ cx: +g.pl.cx.toFixed(1), cy: +g.pl.cy.toFixed(1), a: +g.pl.a.toFixed(2), palm: [+g.palm.x.toFixed(1), +g.palm.y.toFixed(1)], grip: g.grip, h: +g.pl.h.toFixed(1) }));
  }
  // 5. tap it on the canvas: the box and its tools (Edit) open; drag it forward / up
  const at = await page.evaluate(() => { const { stage, S } = window.__toon, pl = stage.propPlacement(S.props[0], window.__toon.S.t || 0), o = stage.out.getBoundingClientRect(); return { x: o.left + pl.cx / stage.W * o.width, y: o.top + pl.cy / stage.H * o.height }; });
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => page.evaluate(() => window.__toon.S.propSel)).toBeTruthy();
  await expect(page.locator('.prop-sel')).toBeVisible();
  await expect(page.locator('.edit-dock .ed-title, .clip-nav, .clipbar').first()).toBeVisible();
  await page.screenshot({ path: OUT + 'selected.png' });
  const before = await page.evaluate(() => ({ ...window.__toon.S.props[0].holdOff }));
  const at2 = await page.evaluate(() => { const { stage, S } = window.__toon, pl = stage.propPlacement(S.props[0], 0), o = stage.out.getBoundingClientRect(); return { x: o.left + pl.cx / stage.W * o.width, y: o.top + pl.cy / stage.H * o.height }; });
  await page.mouse.move(at2.x, at2.y); await page.mouse.down(); await page.mouse.move(at2.x + 30, at2.y - 20, { steps: 6 }); await page.mouse.up();
  const after = await page.evaluate(() => ({ ...window.__toon.S.props[0].holdOff }));
  expect(after.x).not.toBe(before.x);
  await page.locator('.stagewrap').screenshot({ path: OUT + 'moved.png' });
  // 6. the timeline has its layer, the Props tab lists it under In the scene
  await expect(page.locator('.lane2.prop .tclip.prop')).toHaveCount(1);
  expect(errors).toEqual([]);
});
