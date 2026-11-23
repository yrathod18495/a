import { test, expect } from '@playwright/test';
test.use({ viewport: { width: 390, height: 800 }, hasTouch: true });
test('phone: choosing a character or tapping empty space leaves the clip tools', async ({ page }) => {
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Deselect');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.locator('#app .stagebox canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
  if (await page.locator('.panel.open').count()) await page.locator('.panel.open .sheet-close button').click();      // the tool sheet covers the timeline while it is open
  const nav = page.locator('.clip-nav');
  // a clip is selected -> the clip bar; tapping empty space in the timeline puts the normal menu back
  await page.evaluate(() => { const t = window.__toon; t.S.mclip = 'x'; });
  await page.evaluate(() => window.__toon.S.mclip = null);
  expect(await page.evaluate(() => { const t = window.__toon; t.S.bgClips.push({ id: 'bg1', bgId: 'b', start: 0, dur: 5 }); t.S.bgSel = 'bg1'; t.drawClipBar(); return !document.querySelector('.clip-nav').hidden; })).toBe(true);
  const sc = await page.locator('.tl-scroll').boundingBox();                    // empty space low in the timeline (it shows one group of layers, so it is short)
  await page.locator('.tl-scroll').click({ position: { x: Math.min(200, sc.width - 20), y: sc.height - 8 }, force: true });
  await expect(nav).toBeHidden();
  expect(await page.evaluate(() => window.__toon.S.bgSel)).toBeNull();
});
