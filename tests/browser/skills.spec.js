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
test('the Effects tab has a Skills card with the four skills; without a character they are off, and the normal 19 looks are unchanged', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  await page.locator('#app .tabs.big').getByRole('button', { name: 'Effects', exact: true }).click();
  await expect(page.locator('.skill-tile')).toHaveText([/Fire/, /Lightning/, /Energy ball/, /Magic circle/]);
  await expect(page.locator('.skill-tile').first()).toBeDisabled();
  await expect(page.locator('.fx-tile')).toHaveCount(19);
  await expect(page.locator('.skill-tile canvas')).toHaveCount(4);
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
    stage.fx = [newSkill('fire', { id: 'sk1', target: 'char:c1', start: 0, end: 5, ramp: 0.5 })];
    const fire = count(2.5), faded = count(0.05), outside = count(6);
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
