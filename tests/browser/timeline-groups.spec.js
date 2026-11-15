import { test, expect } from '@playwright/test';
test.use({ viewport: { width: 1100, height: 900 } });
const wav = (seconds) => { const rate = 8000, n = seconds * rate, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 20) * 20000), 44 + i * 2); return b; };
const labels = (page) => page.locator('.tl-labels .rl:not(.ruler):not(.tl-empty-label)').allInnerTexts();

test('the timeline shows one group of layers at a time: the open section picks it, chips switch it, an item opens its own group', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Groups');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  await page.locator('.drop input[type=file]').setInputFiles([{ name: '001-Narrator.wav', mimeType: 'audio/wav', buffer: wav(3) }]);
  await expect(page.locator('.tclip.voice')).toHaveCount(1, { timeout: 20000 });
  await page.evaluate(async () => { const T = window.__toon, S = T.S, blob = await (await fetch('data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==')).blob(); S.fx.push({ id: 'f1', name: 'Vivid pop', target: 'scene', visible: true, start: 0, end: 5 }); S.props.push({ id: 'p1', name: 'Lamp', kind: 'prop', blob, natW: 1, natH: 1, x: .8, y: .7, w: .2, h: .2, rotation: 0, visible: true }); T.drawTimeline(); });
  const chips = page.locator('.tl-cats .tl-cat');
  await expect(chips).toHaveText([/Audio/, /Characters/, /Background/, /Props/, /Effects/]);
  // the Upload section: only the audio layer
  await page.evaluate(() => window.__toon.openTab('audio'));
  await expect(page.locator('.tl-cat.on')).toContainText('Audio');
  expect((await labels(page)).join(' ')).toContain('Audio'); expect((await labels(page)).join(' ')).not.toMatch(/FX|Prop/);
  await expect(page.locator('.tclip.fxl')).toHaveCount(0); await expect(page.locator('.tclip.prop')).toHaveCount(0);
  // the Effects section: only the effect rows
  await page.evaluate(() => window.__toon.openTab('fx'));
  await expect(page.locator('.tl-cat.on')).toContainText('Effects');
  await expect(page.locator('.tclip.fxl')).toHaveCount(1); await expect(page.locator('.tclip.voice')).toHaveCount(0);
  // by hand
  await chips.filter({ hasText: 'Props' }).click();
  await expect(page.locator('.tclip.prop')).toHaveCount(1); await expect(page.locator('.tclip.fxl')).toHaveCount(0);
  // an empty group says what to do
  await chips.filter({ hasText: 'Background' }).click();
  await expect(page.locator('.lane2.tl-empty')).toContainText('No background layer yet');
  // selecting an item opens its group
  await chips.filter({ hasText: 'Audio' }).click();
  await page.evaluate(() => { const T = window.__toon; T.S.propSel = null; });
  await page.locator('.tclip.voice').dispatchEvent('click');
  await expect(page.locator('.tl-cat.on')).toContainText('Audio');
  expect(errors).toEqual([]);
});
