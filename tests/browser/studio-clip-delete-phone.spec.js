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
  await expect(bar.locator('input')).toHaveCount(0);                                         // nothing to type: arrows only
  const before = await page.evaluate(() => window.__toon.S.bgClips[0].start);
  await bar.getByRole('button', { name: 'Move later' }).click(); await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__toon.S.bgClips[0].start)).toBeCloseTo(before + 0.1, 2);
  const len0 = await page.evaluate(() => window.__toon.S.bgClips[0].dur);
  await bar.getByRole('button', { name: 'Longer' }).click(); await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__toon.S.bgClips[0].dur)).toBeCloseTo(len0 + 0.1, 2);
  const del = bar.getByRole('button', { name: /Delete/ });
  const box = await del.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390);      // not pushed off the screen
  const edit = await page.locator('.edit-del').boundingBox(); expect(edit.x + edit.width).toBeLessThanOrEqual(390.5);
  const b = await bar.boundingBox(), e = await page.locator('.edittools').boundingBox();
  expect(b.y + b.height).toBeLessThanOrEqual(e.y + 1);                                         // the bar is its own row above the edit buttons
  // nothing makes the page wider than the phone (the whole studio used to slide sideways)
  const over = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, vw: innerWidth, ws: document.querySelector('.ws').scrollWidth, wsw: document.querySelector('.ws').clientWidth, wide: [...document.querySelectorAll('.ws *')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right > innerWidth + 1 && !e.closest('.edittools,.clipbar,.cb-list,.tl-scroll,.tl-inner,.scene-tabs,.tabs,.advanced-tools-list,.panel'); }).map((e) => e.className).slice(0, 5) }));
  expect(over.doc).toBeLessThanOrEqual(over.vw); expect(over.ws).toBeLessThanOrEqual(over.wsw + 1); expect(over.wide).toEqual([]);
  await del.click();
  await expect(page.locator('#app .lane2.bg .tclip.mine')).toHaveCount(0);
  expect(await page.evaluate(() => window.__toon.S.bgClips.length)).toBe(0);
});
