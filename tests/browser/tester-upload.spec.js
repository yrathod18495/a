import { test, expect } from '@playwright/test';
import JSZip from 'jszip';

const png = (page, w, h, color) => page.evaluate(([w, h, color]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, w, h); g.fillStyle = '#000'; g.fillRect(2, 2, 6, 6); return c.toDataURL('image/png').split(',')[1]; }, [w, h, color]).then((b) => Buffer.from(b, 'base64'));
async function openTester(page) {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&tester#/tester');
  const start = page.getByRole('button', { name: /Create my own character/ });
  if (await start.isVisible({ timeout: 5000 }).catch(() => false)) await start.click();
  await expect(page.locator('.cs-tabs button.on')).toHaveText('Create', { timeout: 30000 });
  await expect(page.locator('.cs-panel input[type=file]').first()).toBeAttached();
}
const count = (page) => page.locator('.cs-panel b').first().textContent();
const toastText = async (page, pattern) => { await expect.poll(async () => (await page.locator('.toast').allTextContents()).join(' | '), { timeout: 20000 }).toMatch(pattern); return (await page.locator('.toast').allTextContents()).join(' | '); };

test('uploading many part files at once is fast, reports what happened, and rebuilds the rig once', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await openTester(page);
  const names = ['HEAD', 'Nose', 'Hair', 'Back_Hair', 'Ear_L', 'Ear_R', 'Eyeball_L', 'EB'];
  const files = [];
  for (const [i, n] of names.entries()) files.push({ name: n + '.png', mimeType: 'image/png', buffer: await png(page, 120 + i * 10, 140, ['#c33', '#3c3', '#33c', '#cc3'][i % 4]) });
  files.push({ name: 'not-a-part.png', mimeType: 'image/png', buffer: await png(page, 50, 50, '#999') });
  files.push({ name: 'Mouth_A.png', mimeType: 'image/png', buffer: Buffer.from('this is not a picture') });
  files.push({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  const t0 = Date.now();
  await page.locator('.cs-panel input[type=file]').first().setInputFiles(files);
  const text = await toastText(page, /layers replaced/);
  expect(Date.now() - t0).toBeLessThan(15000);                        // the rig is rebuilt once (this headless browser draws in software, so it is much faster on a real GPU)
  expect(text).toMatch(/8 layers replaced/); expect(text).toMatch(/1 file ka naam kisi layer se match nahi hua \(not-a-part\.png\)/); expect(text).toMatch(/2 file padhi nahi ja saki/);
  await expect.poll(() => count(page)).toMatch(/^8 of \d+ parts uploaded/);
  expect(errors).toEqual([]);
});

test('a ZIP of part pictures is read too, and a file named for the same part twice uses the later one', async ({ page }) => {
  await openTester(page);
  const zip = new JSZip();
  for (const n of ['HEAD', 'Nose', 'Hair']) zip.file(n + '.png', await png(page, 100, 120, '#c33'));
  zip.file('folder/Ear_L.png', await png(page, 100, 120, '#33c'));
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  await page.locator('.cs-panel input[type=file]').first().setInputFiles([{ name: 'parts.zip', mimeType: 'application/zip', buffer }, { name: 'Nose.png', mimeType: 'image/png', buffer: await png(page, 90, 90, '#3c3') }]);
  await toastText(page, /4 layers replaced/);
  await expect.poll(() => count(page)).toMatch(/^4 of \d+ parts uploaded/);
});
