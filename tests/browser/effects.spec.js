import { test, expect } from '@playwright/test';
test.use({ viewport: { width: 1366, height: 800 } });
// Effects: a look (Night, Blur, Ghost ...) is a layer on the timeline. On the whole scene it colours everything, the characters too; on one picture it changes only that picture.
async function open(page) {
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Fx');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  await page.evaluate(async () => {
    const { S, stage } = window.__toon, mk = (col) => { const c = document.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d'); g.fillStyle = col; g.fillRect(0, 0, 16, 16); return new Promise((r) => c.toBlob(r)); };
    await stage.setBackgroundClips([{ start: 0, dur: 8, preset: 0, blob: await mk('#c0c0c0') }], true);
    S.props.push({ id: 'p1', name: 'Lamp', kind: 'prop', blob: await mk('#ffffff'), natW: 16, natH: 16, x: 0.5, y: 0.5, w: 0.2, h: 0.3, rotation: 0, visible: true });
    await stage.setProps(S.props); window.__toon.drawTimeline();
  });
}
const sample = (page, t = 1) => page.evaluate((time) => {
  const { stage } = window.__toon; stage.render(time, 0, [], []);
  const c = document.createElement('canvas'); c.width = stage.out.width; c.height = stage.out.height; const g = c.getContext('2d'); g.drawImage(stage.out, 0, 0);
  const at = (fx, fy) => [...g.getImageData(Math.round(fx * c.width), Math.round(fy * c.height), 1, 1).data].slice(0, 3);
  return { bg: at(0.1, 0.1), lamp: at(0.5, 0.5), edge: at(0.5 - 0.1 + 0.002, 0.5) };
}, t);
test('the Effects tab lists 19 looks, each with a preview made from the real picture, and a tap puts one on the timeline', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  await page.locator('#app .tabs.big').getByRole('button', { name: 'Effects', exact: true }).click();
  await expect(page.locator('.fx-tile')).toHaveCount(19);
  await expect(page.locator('.fx-tile canvas')).toHaveCount(19);
  await page.locator('.fx-tile[data-fx="night"]').click();
  await expect(page.locator('#app .tclip.fxl')).toHaveCount(1);
  await expect(page.locator('.fx-list .fx-row')).toHaveCount(1);
  expect(await page.evaluate(() => window.__toon.S.fx.map((f) => [f.tpl, f.target, f.start, f.end]))).toEqual([['night', 'scene', 0, 8]]);
  expect(errors).toEqual([]);
});
test('Night on the whole scene darkens the background AND the picture on it; Blur on one picture changes only that picture', async ({ page }) => {
  await open(page);
  const plain = await sample(page);
  await page.evaluate(() => window.__toon.addFx('night', 'scene'));
  const night = await sample(page);
  expect(night.bg[0]).toBeLessThan(plain.bg[0] - 40); expect(night.lamp[0]).toBeLessThan(plain.lamp[0] - 40);        // the lamp is darker too: the scene effect reaches every picture
  expect(night.bg[2]).toBeGreaterThan(night.bg[0]);                                                                   // bluish
  await page.evaluate(() => { const T = window.__toon; T.S.fx.length = 0; T.syncFx(); T.addFx('blur', 'prop:p1'); T.S.fx[0].params.blur = 1; T.syncFx(); });
  const blur = await sample(page);
  expect(blur.bg).toEqual(plain.bg);                                                                                 // the background is untouched
  expect(blur.edge[0]).toBeLessThan(plain.edge[0] - 15);                                                              // the lamp's edge is soft now
  await page.evaluate(() => { const T = window.__toon; T.S.fx[0].start = 3; T.S.fx[0].end = 5; T.syncFx(); });
  expect(await sample(page, 1)).toEqual(plain);                                                                       // outside its time range an effect does nothing
});
test('an effect is saved with the scene, goes to the export job, and an old Night on a background clip becomes a scene effect', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__toon.addFx('ghost', 'prop:p1'));
  expect(await page.evaluate(() => window.__toon.sceneDoc().fx.map((f) => f.tpl))).toEqual(['ghost']);
  expect(await page.evaluate(async () => (await window.__toon.exportJob(640, 360)).fx.map((f) => f.tpl))).toEqual(['ghost']);
  await page.evaluate(() => { const T = window.__toon; T.S.fx.length = 0; T.S.bgClips.push({ id: 'b1', start: 1, dur: 4, preset: 0, fx: 'evening' }); T.migrateBgEffects(); });
  expect(await page.evaluate(() => ({ fx: window.__toon.S.fx.map((f) => [f.tpl, f.target, f.start, f.end]), left: window.__toon.S.bgClips.some((c) => c.fx) }))).toEqual({ fx: [['evening', 'scene', 1, 5]], left: false });
});
