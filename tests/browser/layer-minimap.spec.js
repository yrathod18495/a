import { test, expect } from '@playwright/test';
// The layer overview lives on the five layer buttons (a tiny map of each group + the playhead), not as a separate line above the timeline.
test('each layer button shows where its layers are over the scene; the old overview line is gone', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false, features: {} } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Map'); await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  await page.evaluate(() => { const T = window.__toon; T.addFx('night', 'scene'); T.S.fx[0].start = 2; T.S.fx[0].end = 6; T.S.bgClips.push({ id: 'z', start: 1, dur: 3, preset: 0 }); T.commitClips(); });
  await expect(page.locator('.ov-bar')).toHaveCount(0);
  await expect(page.locator('.tl-cat .tl-mini')).toHaveCount(5);
  const segs = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.tl-cat')].map((b) => [b.dataset.cat, b.querySelectorAll('.tl-mini-seg').length])));
  expect(segs.effects).toBeGreaterThan(0); expect(segs.background).toBeGreaterThan(0); expect(segs.audio).toBe(0);
  // the effect starts at 2 s of an 8 s scene: its segment starts a quarter of the way along, and the playhead tick follows the time
  const pos = await page.evaluate(() => { const b = document.querySelector('.tl-cat[data-cat=effects]'), m = b.querySelector('.tl-mini').getBoundingClientRect(), s = b.querySelector('.tl-mini-seg').getBoundingClientRect(); return { start: (s.left - m.left) / m.width, total: window.__toon.player.total }; });
  expect(pos.start).toBeCloseTo(2 / pos.total, 1);
  await page.evaluate(() => { window.__toon.player.seek(4); window.__toon.S.dirty = true; }); await page.waitForTimeout(400);
  const head = await page.evaluate(() => { const m = document.querySelector('.tl-cat[data-cat=background] .tl-mini').getBoundingClientRect(), h = document.querySelector('.tl-cat[data-cat=background] .tl-mini-head').getBoundingClientRect(); return { x: (h.left + h.width / 2 - m.left) / m.width, total: window.__toon.player.total }; });
  expect(head.x).toBeCloseTo(4 / head.total, 1);
  await page.locator('.tl-cats').screenshot({ path: '/tmp/claude-0/-home-user-a/3967a7cb-7154-561f-8d0c-7184bb9946ac/scratchpad/minimap.png' });
  expect(errors).toEqual([]);
});
