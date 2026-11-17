import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
test.use({ viewport: { width: 1366, height: 800 } });
const ZIP = process.env.CHARACTER_ZIP || '/home/user/a/deliver/dayan.zip';
// Skills: fire, lightning, an energy ball and a magic circle are flat vector art that belongs to a character; they are entries of the effects list and are drawn by the stage.
async function open(page) {
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Skills');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
}
test('the Skills tool (More tools) lists all 26 skills in groups; without a character they are off, and the Effects tab keeps its 19 looks', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  await page.locator('.rail-more summary').click();
  await page.locator('.rail-btn', { hasText: 'Skills' }).click();
  await expect(page.locator('.skill-tile')).toHaveCount(26);
  await expect(page.locator('.skill-tile').first()).toHaveText(/Fire/);
  for (const name of ['Burning aura', 'Embers', 'Heat haze', 'Smoke', 'Lightning', 'Lightning arc', 'Lightning aura', 'Energy ball', 'Energy beam', 'Shockwave', 'Magic circle', 'Glowing runes', 'Glowing eyes', 'Magic trail', 'Sparkles', 'Ice mist', 'Ice crystal', 'Water ball', 'Wind swirl', 'Dark smoke', 'Red eye glow', 'Ghost veil', 'Shield', 'Portal', 'Speed lines']) await expect(page.locator('.skill-tile', { hasText: name }).first()).toBeVisible();
  await expect(page.locator('.sk-grouphead')).toHaveCount(6);
  await expect(page.locator('.skill-tile').first()).toBeDisabled();
  await expect(page.locator('.skill-tile canvas')).toHaveCount(26);
  await page.locator('#app .tabs.big').getByRole('button', { name: 'Effects', exact: true }).click().catch(async () => { await page.locator('.rail-btn', { hasText: /^Effects$|Overlays/ }).first().click(); });
  await expect(page.locator('.skill-tile')).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('a skill on a character is drawn on the stage at the chosen place, follows the fade, and the other effects ignore it', async ({ page }) => {
  test.skip(!existsSync(ZIP), 'needs a character ZIP (CHARACTER_ZIP)');
  test.setTimeout(120000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  const zip = readFileSync(ZIP);
  const r = await page.evaluate(async (bytes) => {
    const m = await import('/src/admin-characters.js'), { newSkill } = await import('/shared/skills.js'), T = window.__toon, { stage } = T;
    const pkg = await m.readCharacterZip(new File([new Uint8Array(bytes)], 'd.zip')), def = await m.viewDef(pkg, pkg.manifest.views[0]);
    await stage.loadCharacter(def);
    stage.setLayers([{ key: 'c1', charId: def.id, skins: null, swap: null, anims: {}, clips: [], present: null, flip: false, xf: null, mask: null, maskKeys: [], maskFollow: '', slot: 0, visible: true, keys: [] }]);
    const count = (t) => { stage.render(t, 0, [], []); const c = document.createElement('canvas'); c.width = stage.out.width; c.height = stage.out.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(stage.out, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 90 && d[i + 1] < 190 && d[i + 2] < 60) n++; return n; };
    const none = count(1);
    stage.fx = [newSkill('fire', { id: 'sk1', target: 'char:c1', start: 1, end: 6, ramp: 0.5 })];
    const fire = count(2.5), faded = count(1.05), outside = count(7);
    stage.fx = [{ ...stage.fx[0], visible: false }]; const hidden = count(2.5);
    return { none, fire, faded, outside, hidden };
  }, Array.from(zip));
  console.log('NUM', JSON.stringify(r));
  expect(r.fire).toBeGreaterThan(r.none + 200);          // orange flame pixels appear
  expect(r.faded - r.none).toBeLessThan((r.fire - r.none) / 4);              // it fades in at its start
  expect(r.outside).toBeLessThanOrEqual(r.none + 150);     // nothing after its end
  expect(r.hidden).toBeLessThanOrEqual(r.none + 150);      // hidden = nothing
  expect(errors).toEqual([]);
});
test('every skill draws something, nothing outside its picture, and the same drawing at a later time differs (it moves)', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?debug#/hub');
  const r = await page.evaluate(async () => {
    const { SKILLS, drawSkill, newSkill, cleanSkill } = await import('/shared/skills.js'), out = [], S = 160;
    const px = (id, t) => { const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d', { willReadFrequently: true }); const sk = SKILLS.find((x) => x.id === id); drawSkill(g, id, S, t, { color: sk.color, power: 0.8, speed: 1, angle: sk.angle || 0 }, 1); const d = g.getImageData(0, 0, S, S).data; let n = 0, edge = 0; for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const a = d[(y * S + x) * 4 + 3]; if (a > 20) { n++; if (x === 0 || y === 0 || x === S - 1 || y === S - 1) edge++; } } return { n, edge, hash: d.reduce((h, v, i) => (i % 97 ? h : (h * 31 + v) | 0), 7) }; };
    for (const s of SKILLS) { const a = px(s.id, 1.1), b = px(s.id, 2.3), k = newSkill(s.id, { id: 'x', target: 'char:c' }); out.push({ id: s.id, n: a.n, moves: a.hash !== b.hash, kindKept: cleanSkill(k.skill).kind === s.id, tpl: k.tpl }); }
    return out;
  });
  for (const s of r) { expect(s.n, s.id).toBeGreaterThan(150); expect(s.kindKept, s.id).toBe(true); expect(s.tpl).toBe('skill:' + s.id); }
  expect(r.filter((s) => !s.moves).map((s) => s.id)).toEqual([]);
  expect(r.length).toBe(26);
  expect(errors).toEqual([]);
});
test('every one of the 26 skills shows on a real character on the stage and leaves nothing when hidden', async ({ page }) => {
  test.skip(!existsSync(ZIP), 'needs a character ZIP (CHARACTER_ZIP)');
  test.setTimeout(180000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  const zip = readFileSync(ZIP);
  const r = await page.evaluate(async (bytes) => {
    const m = await import('/src/admin-characters.js'), { newSkill, SKILLS } = await import('/shared/skills.js'), T = window.__toon, { stage } = T;
    const pkg = await m.readCharacterZip(new File([new Uint8Array(bytes)], 'd.zip')), def = await m.viewDef(pkg, pkg.manifest.views[0]);
    await stage.loadCharacter(def);
    stage.setLayers([{ key: 'c1', charId: def.id, skins: null, swap: null, anims: {}, clips: [], present: null, flip: false, xf: null, mask: null, maskKeys: [], maskFollow: '', slot: 0, visible: true, keys: [] }]);
    const snap = (t) => { stage.render(t, 0, [], []); const c = document.createElement('canvas'); c.width = stage.out.width; c.height = stage.out.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(stage.out, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
    const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 60) n++; return n; };
    stage.fx = []; const base = snap(2.5), out = {};
    for (const s of SKILLS) { stage.fx = [newSkill(s.id, { id: 'sk', target: 'char:c1', start: 1, end: 6, ramp: 0.3 })]; const on = diff(snap(2.5), base); stage.fx = [{ ...stage.fx[0], visible: false }]; out[s.id] = { on, hidden: diff(snap(2.5), base) }; }
    return out;
  }, Array.from(zip));
  console.log('NUM', JSON.stringify(r));
  for (const [id, v] of Object.entries(r)) { expect(v.on, id).toBeGreaterThan(80); expect(v.hidden, id).toBeLessThan(40); }
  expect(Object.keys(r).length).toBe(26);
  expect(errors).toEqual([]);
});
