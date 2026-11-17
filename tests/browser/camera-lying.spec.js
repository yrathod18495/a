import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
const ZIP = process.env.CHARACTER_ZIP || '/home/user/a/deliver/dayan.zip';
// A character that is lying down (swim, sleep) is shown whole in the Upper body / Face views; a standing one is still cropped.
test('Upper body and Face views fall back to the whole picture for a lying character', async ({ page }) => {
  test.skip(!existsSync(ZIP), 'needs a character ZIP (CHARACTER_ZIP)');
  test.setTimeout(90000);
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug#/hub');
  const r = await page.evaluate(async (bytes) => {
    const m = await import('/src/admin-characters.js'), { Stage } = await import('/src/db/stage.js');
    const pkg = await m.readCharacterZip(new File([new Uint8Array(bytes)], 'd.zip')), def = await m.viewDef(pkg, pkg.manifest.views[0]);
    const stage = new Stage({ maxTex: 2048 }); stage.setSize('4:5', 640); await stage.loadCharacter(def);
    stage.setLayers([{ key: 'c', charId: def.id, skins: null, swap: null, anims: {}, clips: [], present: null, flip: false, xf: null, mask: null, maskKeys: [], maskFollow: '', slot: 0, visible: true, keys: [] }]);
    const plan = (type) => [{ start: 0, end: 1e9, speaker: 'c', type, focus: 'auto' }];
    stage.render(0, 0, [], plan('medium'));
    const L = stage.layers[0], names = L.arm.getBones().map((b) => b.name);
    const upright = stage.isUpright(L), zoomStanding = stage.frameAt(plan('medium'), 0).zoom;
    // lay the character down: turn the whole body 90 degrees around its root bone
    const root = L.arm.getBones().find((b) => !b.parent) || L.arm.getBones()[0]; root.offset.rotation = Math.PI / 2; root.invalidUpdate(); L.arm.advanceTime(0);
    const lying = stage.isUpright(L);
    return { names: names.slice(0, 12), upright, zoomStanding, lying, zoomLying: stage.frameAt(plan('medium'), 0).zoom, zoomLyingFace: stage.frameAt(plan('close'), 0).zoom };
  }, Array.from(readFileSync(ZIP)));
  console.log('INFO', JSON.stringify(r));
  expect(r.upright).toBe(true); expect(r.zoomStanding).toBeGreaterThan(1.5);
  expect(r.lying).toBe(false); expect(r.zoomLying).toBeCloseTo(1, 2); expect(r.zoomLyingFace).toBeCloseTo(1, 2);
});
