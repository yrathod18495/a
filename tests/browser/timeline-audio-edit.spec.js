import { test, expect } from '@playwright/test';
test.use({ viewport: { width: 390, height: 800 } });
const wav = (seconds) => { const rate = 8000, n = seconds * rate, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 20) * 20000), 44 + i * 2); return b; };
async function studio(page) {
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Edit');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  await page.locator('.drop input[type=file]').setInputFiles([1, 2, 3].map((n) => ({ name: `00${n}-Voice${n}.wav`, mimeType: 'audio/wav', buffer: wav(4) })));
  await expect(page.locator('.tclip.voice')).toHaveCount(3, { timeout: 20000 });
  await page.locator('.sheet-close button').last().click();          // the open Audio sheet covers the timeline on a phone
  await expect(page.locator('.sheet-close')).toBeHidden();
}
const starts = (page) => page.evaluate(() => window.__toon.player.clips.map((c) => +c.start.toFixed(2)));
const zoom = (page, pps) => page.evaluate((v) => { const T = window.__toon; T.S.pps = v; T.drawTimeline(); }, pps);

test('tapping a layer puts the playhead where it was tapped', async ({ page }) => {
  await studio(page); await zoom(page, 60);
  const clip = page.locator('.tclip.voice').first(), box = await clip.boundingBox();
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
  const c = await page.evaluate(() => window.__toon.player.clips[0]);
  const t = await page.evaluate(() => window.__toon.player.time);
  expect(t).toBeGreaterThan(c.start + (c.end - c.start) * 0.55); expect(t).toBeLessThan(c.start + (c.end - c.start) * 0.95);
});

test('trimming an audio line keeps the later lines in place and offers a button in the gap; the button closes it', async ({ page }) => {
  await studio(page); await zoom(page, 60);
  const before = await starts(page);
  const rz = page.locator('.tclip.voice').first().locator('.rz'), b = await rz.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x - 90, b.y + b.height / 2, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(600);
  const after = await starts(page);
  expect(after[1]).toBeCloseTo(before[1], 1); expect(after[2]).toBeCloseTo(before[2], 1);          // the later lines did not move
  const gap = page.locator('.gap-close'); await expect(gap).toHaveCount(1);
  await gap.click(); await page.waitForTimeout(600);
  const closed = await starts(page);
  expect(closed[1]).toBeLessThan(before[1] - 0.5);          // everything after slid up
  await expect(gap).toHaveCount(0);
});

test('holding a dragged audio line at the edge scrolls the timeline so it can be carried to the end', async ({ page }) => {
  await studio(page); await zoom(page, 140);
  const scroll = page.locator('.tl-scroll'), sb = await scroll.boundingBox(), clip = page.locator('.tclip.voice').first(), cb = await clip.boundingBox();
  const before = (await starts(page))[0];
  await page.mouse.move(cb.x + 40, cb.y + cb.height / 2); await page.mouse.down();
  await page.mouse.move(sb.x + sb.width - 10, cb.y + cb.height / 2, { steps: 12 });
  await page.waitForTimeout(900);          // held at the right edge
  const scrolled = await scroll.evaluate((el) => el.scrollLeft);
  await page.mouse.up(); await page.waitForTimeout(500);
  expect(scrolled).toBeGreaterThan(150);
  expect((await starts(page))[0]).toBeGreaterThan(before + 2);          // it travelled far past the first screen
});
