import { test, expect } from '@playwright/test';
test.use({ viewport: { width: 390, height: 800 } });
const wav = (seconds) => { const rate = 8000, n = seconds * rate, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 20) * 20000), 44 + i * 2); return b; };

async function withVoices(page) {
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Voices');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  await page.locator('.drop input[type=file]').setInputFiles([{ name: '001-Narrator.wav', mimeType: 'audio/wav', buffer: wav(4) }, { name: '002-Amit.wav', mimeType: 'audio/wav', buffer: wav(4) }, { name: '003-Rohan.wav', mimeType: 'audio/wav', buffer: wav(4) }]);
  await expect(page.locator('.tclip.voice')).toHaveCount(3, { timeout: 20000 });
}

test('the Upload tab has only the file tiles; tapping an audio layer opens the Voice panel: the character, volume, fades, Mute / Solo', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await withVoices(page);
  await page.evaluate(() => window.__toon.openTab('audio'));
  await expect(page.locator('#app .up-tile')).toHaveCount(8);
  for (const t of ['Selected audio line', 'Fade in', 'Fade out', 'Solo', 'Clear all', 'Voices are optional']) await expect(page.locator('#app .panel').getByText(t, { exact: false })).toHaveCount(0);
  await expect(page.locator('#app .panel .music-card')).toHaveCount(0);
  await page.locator('.tclip.voice').nth(1).dispatchEvent('click');
  const panel = page.locator('.voice-sheet');
  await expect(panel.locator('.voice-panel')).toBeVisible();
  await expect(page.locator('#app .panel.open')).toHaveCount(0);                 // its own popup: the Upload / tab panel is not used
  await expect(panel.locator('.vo-head')).toContainText('Voice 2');
  await expect(panel.locator('.vo-who')).toContainText(/character/i);
  await expect(panel.getByRole('button', { name: 'Mute', exact: true })).toBeVisible(); await expect(panel.getByRole('button', { name: 'Solo', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Apply to all voices' })).toBeVisible();
  await panel.getByLabel('Volume').evaluate((e) => { e.value = '150'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(await page.evaluate(() => window.__toon.S.lines.map((l) => l.volume ?? 1))).toEqual([1, 1.5, 1]);
  await panel.getByRole('button', { name: 'Mute', exact: true }).click();
  expect(await page.evaluate(() => window.__toon.S.lines.map((l) => !!l.muted))).toEqual([false, true, false]);
  await expect(panel.getByText('Camera and who is in frame')).toBeVisible();
  await panel.getByRole('button', { name: 'Close the voice settings' }).click();
  await expect(panel).toBeHidden();
  expect(errors).toEqual([]);
});

test('"Apply to all voices" gives the same volume and fades to every voice', async ({ page }) => {
  await withVoices(page);
  await page.locator('.tclip.voice').first().dispatchEvent('click');
  const panel = page.locator('.voice-sheet');
  await panel.getByLabel('Volume').evaluate((e) => { e.value = '70'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await panel.getByLabel('Fade in').evaluate((e) => { e.value = '1.2'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await panel.getByRole('button', { name: 'Apply to all voices' }).click();
  const lines = await page.evaluate(() => window.__toon.S.lines.map((l) => ({ v: l.volume, fi: l.fadeIn })));
  expect(lines).toEqual([{ v: 0.7, fi: 1.2 }, { v: 0.7, fi: 1.2 }, { v: 0.7, fi: 1.2 }]);
  await expect(page.locator('.toast').filter({ hasText: /all 3 voices/ }).first()).toBeVisible();
});

test('the clip bar of an audio layer has an Edit button for the same panel', async ({ page }) => {
  await withVoices(page);
  await page.locator('.tclip.voice').first().dispatchEvent('click');
  await page.locator('.voice-sheet').getByRole('button', { name: 'Close the voice settings' }).click();
  await page.locator('.clip-nav').getByRole('button', { name: 'Edit' }).click();
  await expect(page.locator('.voice-sheet .vo-head')).toContainText('Voice 1');
});

test('the music layer opens the music settings', async ({ page }) => {
  await withVoices(page);
  const wavFile = { name: 'song.wav', mimeType: 'audio/wav', buffer: wav(2) };
  await page.locator('#app .up-cell:has(.up-tile[data-kind="music"]) input[type=file]').setInputFiles(wavFile);
  await expect(page.locator('.tclip.music')).toHaveCount(1, { timeout: 15000 });
  await page.locator('.tclip.music').dispatchEvent('click');
  await expect(page.locator('.modal .music-card')).toContainText('song');
  await page.locator('.modal').getByRole('button', { name: 'Remove' }).click();
  await expect(page.locator('.modal')).toHaveCount(0);
  expect(await page.evaluate(() => window.__toon.S.music)).toBeNull();
});
