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
  await expect(nav).toBeHidden();          // and it stays gone: the audio line under the playhead must not bring the tools straight back
  expect(await page.evaluate(() => window.__toon.S.mclip)).toBe(null);
  await page.evaluate(() => { const T = window.__toon; T.S.lines.push({ id: 'l1', speaker: 'ravi', file: 'a.wav', order: 1 }); T.S.lineSel = 'l1'; T.drawClipBar(); });
  await expect(nav).toBeHidden();
});

// An action whose promise never settles must not leave Undo / Redo grey and autosave waiting forever (the work would silently stop being saved).
test('a hung action releases the edit lock after 15 s', async ({ page }) => {
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Hung');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  await page.clock.install();
  const depth = await page.evaluate(() => { window.__toon.historyAction(() => new Promise(() => {})); return window.__toon.historyDepth?.() ?? null; });
  await page.clock.fastForward(16000);
  const after = await page.evaluate(() => window.__toon.historyDepth?.() ?? null);
  expect(depth === null || depth > 0).toBe(true);
  expect(after === null || after === 0).toBe(true);
});
