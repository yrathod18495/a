import { test, expect } from '@playwright/test';
// Whatever is placed or dragged later on the timeline makes the scene longer (effects, props, backgrounds, animations, camera): from 0 up to 2 minutes.
test('the scene grows with an effect, a prop, a background clip and a camera key moved out to 2 minutes', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false, features: {} } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Grow');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  const total = () => page.evaluate(() => window.__toon.player.total);
  const base = await total();
  for (const end of [12, 30, 75, 120]) {
    await page.evaluate((e) => { const T = window.__toon; if (!T.S.fx.length) T.addFx('night', 'scene'); const f = T.S.fx[0]; f.start = 1; f.end = e; T.commitClips(); }, end);
    expect(await total()).toBeCloseTo(end, 1);
  }
  await page.evaluate(() => { const T = window.__toon; T.S.fx[0].start = 0; T.S.fx[0].end = 5; T.commitClips(); });          // an effect that starts with the scene never holds it open
  expect(await total()).toBeLessThan(30);
  await page.evaluate(() => { const T = window.__toon; T.S.fx = []; T.S.camKeys.push({ id: 'k1', t: 40, x: 0, y: 0, zoom: 1, ease: 'smooth' }); T.commitClips(); });
  expect(await total()).toBeCloseTo(40.5, 1);
  await page.evaluate(() => { const T = window.__toon; T.S.camKeys = []; T.S.bgClips.push({ id: 'z', start: 50, dur: 20, preset: 0 }); T.commitClips(); });
  expect(await total()).toBeCloseTo(70, 1);
  expect(base).toBeLessThan(10);
});
test('dragging the end of an effect clip to the right keeps making the scene longer', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false, features: {} } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Drag');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  await page.evaluate(() => { const T = window.__toon; T.addFx('night', 'scene'); T.S.fx[0].start = 2; T.commitClips(); });
  let last = await page.evaluate(() => window.__toon.player.total);
  for (let i = 0; i < 4; i++) {
    const b = await page.locator('.tclip.fxl .rz').boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 200, b.y + b.height / 2, { steps: 8 }); await page.mouse.up();
    const now = await page.evaluate(() => window.__toon.player.total);
    expect(now).toBeGreaterThan(last); last = now;
  }
});
