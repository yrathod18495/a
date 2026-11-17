import { test, expect } from '@playwright/test';
// Effects (and skills) can be cut at the playhead, with the Split button and with the scissors that sits on the selected clip at the playhead.
test('split an effect: scissors on the clip at the playhead, and the Split button', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false, features: {} } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Split'); await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  await page.evaluate(() => { const T = window.__toon; T.addFx('night', 'scene'); T.S.fx[0].start = 1; T.S.fx[0].end = 7; T.commitClips(); T.player.seek(3); T.S.dirty = true; });
  await page.locator('.tl-cat[data-cat=effects]').click(); await page.waitForTimeout(300);
  const scissors = page.locator('.tl-scissors');
  await expect(scissors).toBeVisible();
  // it sits on the playhead, on the selected effect's row
  const pos = await page.evaluate(() => { const s = document.querySelector('.tl-scissors').getBoundingClientRect(), h = document.querySelector('.phead').getBoundingClientRect(), c = document.querySelector('.tclip.fxl.sel').getBoundingClientRect(); return { dx: Math.abs(s.left + s.width / 2 - h.left), inRow: s.top + s.height / 2 > c.top && s.top + s.height / 2 < c.bottom }; });
  expect(pos.dx).toBeLessThan(4); expect(pos.inRow).toBe(true);
  await scissors.click();
  const two = await page.evaluate(() => window.__toon.S.fx.map((f) => [f.start, f.end, f.tpl]).sort((a, b) => a[0] - b[0]));
  expect(two.length).toBe(2); expect(two[0].slice(0, 2)).toEqual([1, 3]); expect(two[1].slice(0, 2)).toEqual([3, 7]); expect(two[1][2]).toBe(two[0][2]);
  // the playhead is at the cut: no scissors until it is inside a clip again; the second piece is selected
  await expect(scissors).toBeHidden();
  await page.evaluate(() => { window.__toon.player.seek(5); window.__toon.S.dirty = true; }); await page.waitForTimeout(300);
  await expect(scissors).toBeVisible();
  // the Split button of the clip bar does the same
  await page.getByRole('toolbar', { name: 'Selected clip' }).getByRole('button', { name: 'Split' }).click();
  const three = await page.evaluate(() => window.__toon.S.fx.map((f) => [f.start, f.end]).sort((a, b) => a[0] - b[0]));
  expect(three).toEqual([[1, 3], [3, 5], [5, 7]]);
  // outside the clip nothing is shown
  await page.evaluate(() => { window.__toon.player.seek(0.3); window.__toon.S.dirty = true; }); await page.waitForTimeout(300); await expect(scissors).toBeHidden();
  await page.screenshot({ path: '/tmp/claude-0/-home-user-a/3967a7cb-7154-561f-8d0c-7184bb9946ac/scratchpad/split-fx.png' });
  expect(errors).toEqual([]);
});
