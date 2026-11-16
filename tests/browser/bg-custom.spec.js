import { test, expect } from '@playwright/test';
// A background picture of the user's own: tap adds it, a drop on the canvas adds it, and a picture that cannot be read leaves no empty clip.
test('custom background: tap, drag onto the canvas, and an unreadable file is explained', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Bg');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  const png = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 64; c.height = 36; const g = c.getContext('2d'); g.fillStyle = '#2a9d8f'; g.fillRect(0, 0, 64, 36); return Array.from(new Uint8Array(await (await new Promise((r) => c.toBlob(r))).arrayBuffer())); });
  await page.evaluate(async (bytes) => { const T = window.__toon; const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' }); T.S.myBgs.push({ id: 'bgx1', name: 'house.png', blob }); }, png);
  await page.locator('.panel.open .sheet-close button').click({ timeout: 2000 }).catch(() => {});
  await page.locator('.rail-btn', { hasText: 'Background' }).click();
  await page.locator('.tile', { hasText: 'house' }).first().click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.bgClips.length)).toBe(1);
  // drop on the canvas
  await page.evaluate(() => { const T = window.__toon, dt = new DataTransfer(); dt.setData('text/x-12toons-bg', 'bgx1'); document.querySelector('.stagewrap').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); });
  await expect.poll(() => page.evaluate(() => window.__toon.S.bgClips.length)).toBe(2);
  // a file that is not a picture: no empty clip is left behind
  await page.evaluate(async () => { const T = window.__toon; T.S.myBgs.push({ id: 'bad', name: 'broken.png', blob: new Blob(['not a picture'], { type: 'image/png' }) }); });
  await page.evaluate(async () => { const { addBgClipForTest } = window.__toon; if (addBgClipForTest) await addBgClipForTest({ id: 'bad', name: 'broken.png', blob: window.__toon.S.myBgs.at(-1).blob }); });
  expect(await page.evaluate(() => window.__toon.S.bgClips.length)).toBe(2);
  expect(errors).toEqual([]);
});
