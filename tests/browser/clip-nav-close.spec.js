import { test, expect } from '@playwright/test';
test.use({ viewport: { width: 390, height: 800 } });
// On a phone, a selected clip replaces the bottom tabs (Upload / Characters / Animations ...) with the clip tools: they must have an obvious Close that brings the tabs back.
test('phone: the clip tools have a visible Close that brings the bottom tabs back', async ({ page }) => {
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Close');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  await page.evaluate(() => {
    const T = window.__toon, S = T.S;
    S.speakers.push({ key: 'ravi', name: 'Ravi', color: '#c06', charId: 'fake' });
    S.manual.ravi = [{ id: 'm1', kind: 'body', ref: { source: 'lib', id: 7, name: 'walk' }, start: 0, dur: 2, off: 0 }];
    S.mclip = 'm1'; T.drawTimeline(); T.drawClipBar();
  });
  const nav = page.locator('.clip-nav');
  await expect(nav).toBeVisible();
  await nav.getByRole('button', { name: /Close the clip tools and go back/ }).click();
  await expect(nav).toBeHidden();
  expect(await page.evaluate(() => window.__toon.S.mclip)).toBe(null);
});
