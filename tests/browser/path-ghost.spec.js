import { test, expect } from '@playwright/test';
// Drawing / editing a path shows a blurred trail and faint character outlines along it; the real line stays the one that is edited.
test('path preview: blurred trail and ghost outlines while drawing and editing', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 860 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Path');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
  // the bundled characters are not in the repository: a layer with a box stands in, the path code only needs its key and size
  await page.evaluate(() => {
    const { S, stage } = window.__toon;
    S.speakers.push({ key: 'fake1', name: 'Fake', color: '#c06', charId: 'fake' }); S.order.push('fake1');
    stage.layers.push({ key: 'fake1', box: { x0: 100, x1: 220, y0: 100, y1: 400 }, visible: true });
    S.tab = 'motion'; S.motionFor = 'fake1';
    S.paths.fake1 = { pts: [{ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.3 }, { x: 0.8, y: 0.2 }], start: 0, dur: 3, face: true, smooth: false, mul: 1 };
    S.pathEdit = true; window.__toon.updatePathView(true);
  });
  await expect(page.locator('.pathview .trail')).toHaveCount(1);
  await expect(page.locator('.pathview .ghost')).toHaveCount(6);                       // "from here to here": the start, four steps and the end
  expect(await page.locator('.pathview .trail').evaluate((e) => getComputedStyle(e).filter)).toContain('blur');
  await expect(page.locator('.pathview polyline:not(.trail)')).toHaveCount(1);          // the line that is edited is still one line
  await expect(page.locator('.pathpt')).toHaveCount(3);
  // leaving the edit mode: only the plain line
  await page.evaluate(() => { window.__toon.S.pathEdit = false; window.__toon.updatePathView(true); });
  await expect(page.locator('.pathview .ghost')).toHaveCount(0);
});
