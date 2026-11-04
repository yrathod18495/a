import { test, expect } from '@playwright/test';
test.use({ viewport: { width: 390, height: 800 } });
const PNG = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
async function open(page) {
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Lock');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  await page.evaluate(async (png) => {
    const { S, stage, drawClipBar } = window.__toon, blob = await (await fetch(png)).blob();
    S.bgClips.push({ id: 'bg1', bgId: null, preset: 1, start: 0, dur: 8 }); S.bgSel = 'bg1';
    S.props.push({ id: 'p1', name: 'Lamp', kind: 'prop', blob, natW: 1, natH: 1, x: 0.82, y: 0.7, w: 0.2, h: 0.2, rotation: 0, visible: true, start: 0, end: 8 }); await stage.setProps(S.props);
    drawClipBar();
  }, PNG);
  const guide = page.locator('.start-close'); if (await guide.count()) await guide.first().click();          // the quick start guide sits over the stage
}
test('a locked background is not moved or resized on the stage; a locked prop is not moved; unlock gives it back', async ({ page }) => {
  await open(page);
  const drag = async (fx, fy, dx, dy) => { const box = await page.locator('.stagewrap canvas').boundingBox(); await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy); await page.mouse.down(); await page.mouse.move(box.x + box.width * (fx + dx), box.y + box.height * (fy + dy), { steps: 6 }); await page.mouse.up(); };
  const xf = () => page.evaluate(() => { const c = window.__toon.S.bgClips[0]; return JSON.stringify(c.xf || null); });
  // locked layer: dragging an empty place of the background changes nothing
  await page.evaluate(() => { window.__toon.S.locks = { ...(window.__toon.S.locks || {}), bg: true }; window.__toon.drawTimeline(); window.__toon.drawClipBar(); });
  const before = await xf(); await drag(0.15, 0.2, 0.2, 0.1); expect(await xf()).toBe(before);
  await expect(page.locator('.bg-sel')).toBeHidden();                                         // no frame / handles to resize it
  // unlocked: the same drag moves it
  await page.evaluate(() => { window.__toon.S.locks.bg = false; window.__toon.drawClipBar(); });
  await drag(0.15, 0.2, 0.2, 0.1); expect(await xf()).not.toBe(before);
  // a locked prop does not move
  await page.evaluate(() => { const T = window.__toon; T.S.bgSel = null; T.S.locks['prop:p1'] = true; T.drawClipBar(); });
  const p0 = await page.evaluate(() => [window.__toon.S.props[0].x, window.__toon.S.props[0].y]);
  await drag(0.82, 0.7, -0.2, -0.1); expect(await page.evaluate(() => [window.__toon.S.props[0].x, window.__toon.S.props[0].y])).toEqual(p0);
  await page.evaluate(() => { window.__toon.S.locks['prop:p1'] = false; });
  await drag(0.82, 0.7, -0.2, -0.1);
  expect(await page.evaluate(() => [window.__toon.S.props[0].x, window.__toon.S.props[0].y])).not.toEqual(p0);
});
test('Lock in More locks one item on its own (Crop, Delete and Replace stop); another background stays free', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { const { S, drawClipBar } = window.__toon; S.bgClips.push({ id: 'bg2', bgId: null, preset: 2, start: 8, dur: 5 }); drawClipBar(); });
  const nav = page.locator('.clip-nav'); await nav.locator('.char-more summary').click();
  await nav.locator('.cb-more-list').getByRole('button', { name: 'Lock', exact: true }).click();
  expect(await page.evaluate(() => window.__toon.S.bgClips.map((c) => !!c.locked))).toEqual([true, false]);       // only this background
  await nav.getByRole('button', { name: 'Crop' }).click(); await expect(page.getByRole('heading', { name: 'Crop background' })).toHaveCount(0);          // crop is refused
  await nav.getByRole('button', { name: 'Delete' }).click(); expect(await page.evaluate(() => window.__toon.S.bgClips.length)).toBe(2);               // delete is refused
  await page.evaluate(() => { const T = window.__toon; T.S.bgSel = 'bg2'; T.drawClipBar(); });
  await expect(nav.getByRole('button', { name: 'Crop' })).toBeVisible();
  await page.evaluate(() => { const T = window.__toon; T.S.bgSel = 'bg1'; T.drawClipBar(); });
  await nav.locator('.char-more summary').click();
  await nav.locator('.cb-more-list').getByRole('button', { name: 'Unlock', exact: true }).click();
  expect(await page.evaluate(() => window.__toon.S.bgClips.map((c) => !!c.locked))).toEqual([false, false]);
});

test('holding the Move / Length arrows repeats and speeds up (a single tap is one 0.1 s step)', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.__toon.S.bgClips[0].start = 0; });
  const nav = page.locator('.clip-nav'); await nav.locator('.char-more summary').click();
  const later = nav.getByRole('button', { name: 'Move later' }), b = await later.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.up();          // one tap
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__toon.S.bgClips[0].start)).toBeCloseTo(0.1, 2);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.waitForTimeout(1600); await page.mouse.up();
  expect(await page.evaluate(() => window.__toon.S.bgClips[0].start)).toBeGreaterThan(0.9);          // held: it kept going, and faster after a second
});
