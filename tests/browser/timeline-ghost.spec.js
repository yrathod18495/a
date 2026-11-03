import { test, expect } from '@playwright/test';
// While a clip is stretched it is light and dotted, a dotted frame shows where it was; after letting go it is normal again.
test('stretching a clip: light + dotted while dragging, original extent framed, normal afterwards', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Ghost');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
  await page.evaluate(async () => { const { S, stage } = window.__toon; S.bgClips.push({ id: 'b1', bgId: null, preset: 0, start: 1, dur: 2 }); await stage.setBackgroundClips(S.bgClips.map((c) => ({ start: c.start, dur: c.dur, preset: c.preset, blob: null }))); window.__toon.drawTimeline(); });
  const clip = page.locator('#app .lane2.bg .tclip.mine').first(); await expect(clip).toBeVisible();
  const box = await clip.boundingBox(), y = box.y + box.height / 2, x = box.x + box.width - 4;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 40, y, { steps: 5 }); await page.mouse.move(x + 90, y, { steps: 5 });
  await page.waitForTimeout(300);
  const during = await page.evaluate(() => { const c = document.querySelector('#app .lane2.bg .tclip.mine'), g = document.querySelector('.tclip-ghost'); const gb = g?.getBoundingClientRect(), cb = c.getBoundingClientRect(); return { resizing: c.classList.contains('resizing'), opacity: +getComputedStyle(c).opacity, ghost: !!g, ghostStyle: g && getComputedStyle(g).borderStyle, ghostW: gb?.width, clipW: cb.width, ghostLeft: gb?.left, clipLeft: cb.left }; });
  expect(during.resizing).toBe(true); expect(during.opacity).toBeLessThan(0.8);
  expect(during.ghost).toBe(true); expect(during.ghostStyle).toBe('dashed');
  expect(during.clipW).toBeGreaterThan(during.ghostW + 40);              // the clip is longer than it was; the frame still has the old length
  expect(Math.abs(during.ghostLeft - during.clipLeft)).toBeLessThan(1);
  await page.mouse.up();
  await expect(page.locator('.tclip-ghost')).toHaveCount(0);
  const after = await page.evaluate(() => { const c = document.querySelector('#app .lane2.bg .tclip.mine'); return { resizing: c.classList.contains('resizing'), opacity: +getComputedStyle(c).opacity, dur: window.__toon.S.bgClips[0].dur }; });
  expect(after.resizing).toBe(false); expect(after.opacity).toBe(1); expect(after.dur).toBeGreaterThan(2);
});
