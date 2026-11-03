import { test, expect } from '@playwright/test';
// Phone: with a clip selected, its bar (Start, Length, Delete, close) and the edit buttons stay on the screen, and Delete removes the clip.
test('phone: selected clip shows Delete in view and removes the clip', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 860 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Del');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
  if (await page.locator('.panel.open').count()) await page.locator('.panel.open .sheet-close button').click();
  await page.evaluate(async () => { const { S, stage } = window.__toon; S.bgClips.push({ id: 'b1', bgId: null, preset: 3, start: 0, dur: 2 }); await stage.setBackgroundClips(S.bgClips.map((c) => ({ start: c.start, dur: c.dur, preset: c.preset, blob: null }))); window.__toon.drawTimeline(); });
  await page.locator('#app .lane2.bg .tclip.mine').first().click();
  const bar = page.locator('.tltools .clipbar'); await expect(bar).toBeVisible();
  const del = bar.getByRole('button', { name: /Delete/ });
  const box = await del.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390);      // not pushed off the screen
  const edit = await page.locator('.edit-del').boundingBox(); expect(edit.x + edit.width).toBeLessThanOrEqual(390.5);
  const b = await bar.boundingBox(), e = await page.locator('.edittools').boundingBox();
  expect(b.y + b.height).toBeLessThanOrEqual(e.y + 1);                                         // the bar is its own row above the edit buttons
  await del.click();
  await expect(page.locator('#app .lane2.bg .tclip.mine')).toHaveCount(0);
  expect(await page.evaluate(() => window.__toon.S.bgClips.length)).toBe(0);
});
