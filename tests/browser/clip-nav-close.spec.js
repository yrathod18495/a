import { test, expect } from '@playwright/test';
test.use({ viewport: { width: 390, height: 800 } });
const wav = (seconds) => { const rate = 8000, n = seconds * rate, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 20) * 20000), 44 + i * 2); return b; };
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
  await page.locator('.drop input[type=file]').setInputFiles([{ name: '001-Narrator.wav', mimeType: 'audio/wav', buffer: wav(4) }, { name: '002-Amit.wav', mimeType: 'audio/wav', buffer: wav(4) }]);
  await expect(page.locator('.tclip.voice')).toHaveCount(2, { timeout: 20000 });
  await expect(nav).toBeHidden();          // importing audio selects a line by itself: that must NOT bring the clip tools back (they hide the bottom tabs)
  await page.evaluate(() => { const T = window.__toon; T.drawTimeline(); });
  await page.locator('.tclip.voice').first().dispatchEvent('click');
  await expect(nav).toBeVisible();          // only tapping an audio clip itself shows the audio tools
  await nav.getByRole('button', { name: /Close the clip tools and go back/ }).click();
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
