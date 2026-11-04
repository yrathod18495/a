import { test, expect } from '@playwright/test';
// At 100% size a character is at most 75% of the canvas height (it was 90%).
test('a character at 100% size is 75% of the canvas height at most', async ({ page }) => {
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug#/hub');
  const r = await page.evaluate(async () => {
    const { Stage, CHARACTER_MAX_HEIGHT } = await import('/src/db/stage.js'), stage = new Stage({ maxTex: 512 }), out = {};
    for (const [aspect, short] of [['16:9', 480], ['9:16', 480], ['1:1', 480]]) {
      stage.setSize(aspect, short);
      stage.layers = [{ key: 'a', mul: 1, bounds: { x: 0, y: 0, w: 100, h: 300 }, visible: true }];        // a tall, narrow character
      stage.layout();
      const b = stage.layers[0].box; out[aspect] = { share: (b.y1 - b.y0) / stage.H, wide: (b.x1 - b.x0) / stage.W };
    }
    stage.setSize('16:9', 480); stage.layers = [{ key: 'a', mul: 0.5, bounds: { x: 0, y: 0, w: 100, h: 300 }, visible: true }]; stage.layout();
    out.half = (stage.layers[0].box.y1 - stage.layers[0].box.y0) / stage.H;
    return { out, max: CHARACTER_MAX_HEIGHT, W: stage.W, H: stage.H };
  });
  expect(r.max).toBe(0.75);
  expect(r.out['16:9'].share).toBeCloseTo(0.75, 3);                // limited by the height
  expect(r.out['9:16'].share).toBeLessThanOrEqual(0.75 + 1e-6);    // never taller
  expect(r.out['1:1'].share).toBeCloseTo(0.75, 3);
  expect(r.out.half).toBeCloseTo(0.375, 3);                         // the size slider still scales from there
});

test('a character is never bigger than 300 % or smaller than 20 %', async ({ page }) => {
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Size');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  const r = await page.evaluate(() => {
    const { stage } = window.__toon; stage.setSize('16:9', 480);
    const draw = (mul) => { stage.layers = [{ key: 'a', mul, bounds: { x: 0, y: 0, w: 100, h: 300 }, visible: true }]; stage.layout(); const b = stage.layers[0].box; return b.y1 - b.y0; };
    const h100 = draw(1);
    return { big: draw(8) / h100, huge: draw(3) / h100, small: draw(0.05) / h100, min: draw(0.2) / h100 };
  });
  expect(r.big).toBeCloseTo(3, 2); expect(r.huge).toBeCloseTo(3, 2);           // asked for 800 %: 300 %
  expect(r.small).toBeCloseTo(0.2, 2); expect(r.min).toBeCloseTo(0.2, 2);      // asked for 5 %: 20 %
  await page.evaluate(() => { const T = window.__toon; T.S.speakers.push({ key: 'fake1', name: 'Fake', color: '#c06', charId: 'fake' }); T.S.sel = 'fake1'; T.drawCharBar({ key: 'fake1', mul: 1 }); });
  await expect(page.locator('.cb-size')).toHaveAttribute('max', '300'); await expect(page.locator('.cb-size')).toHaveAttribute('min', '20');
});
