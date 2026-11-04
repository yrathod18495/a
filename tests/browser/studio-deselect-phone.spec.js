import { test, expect } from '@playwright/test';
test.use({ viewport: { width: 390, height: 800 }, hasTouch: true });
test('phone: choosing a character or tapping empty space leaves the clip tools', async ({ page }) => {
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Deselect');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.locator('#app .stagebox canvas')).toBeVisible();
  const nav = page.locator('.clip-nav');
  // a clip is selected -> the clip bar; tapping empty space in the timeline puts the normal menu back
  await page.evaluate(() => { const t = window.__toon; t.S.mclip = 'x'; });
  await page.evaluate(() => window.__toon.S.mclip = null);
  expect(await page.evaluate(() => { const t = window.__toon; t.S.bgClips.push({ id: 'bg1', bgId: 'b', start: 0, dur: 5 }); t.S.bgSel = 'bg1'; t.drawClipBar(); return !document.querySelector('.clip-nav').hidden; })).toBe(true);
  await page.locator('.tl-scroll').click({ position: { x: 200, y: 300 }, force: true });
  await expect(nav).toBeHidden();
  expect(await page.evaluate(() => window.__toon.S.bgSel)).toBeNull();
});
