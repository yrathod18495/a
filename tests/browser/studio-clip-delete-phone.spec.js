import { test, expect } from '@playwright/test';
// Phone: what you can do with the selected clip (Split, Copy, Objects, Crop, Replace, Path, Delete, More) is in the bottom bar; the rows at the top are gone.
async function open(page) {
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
}
test('phone: the selected clip\'s tools are in the bottom bar, nothing is left at the top, and Delete removes the clip', async ({ page }) => {
  await open(page);
  await expect(page.locator('.clip-nav')).toBeHidden();                                          // nothing selected: the normal bottom menu
  await page.locator('#app .lane2.bg .tclip.mine').first().click();
  const selStyle = await page.locator('#app .lane2.bg .tclip.mine').first().evaluate((e) => ({ edge: getComputedStyle(e).borderTopColor, bar: getComputedStyle(e.querySelector('.lz')).width, bar2: getComputedStyle(e.querySelector('.rz')).width }));
  expect(selStyle).toEqual({ edge: 'rgb(255, 255, 255)', bar: '9px', bar2: '9px' });      // the tapped clip looks selected: a thin white edge and a white bar on each side
  const nav = page.locator('.clip-nav'); await expect(nav).toBeVisible();
  await expect(nav.locator('.cb-list .cb-btn > span:last-child')).toHaveText(['Split', 'Copy', 'Objects', 'Crop', 'Replace', 'Delete']);
  await expect(page.locator('.tltools .clipbar')).toBeHidden(); await expect(page.locator('.selbar')).toBeHidden();
  const edits = await page.locator('.tltools .edit-btn:visible').evaluateAll((els) => els.map((e) => e.className.match(/edit-(?!btn)(\w+)/)[1]));
  expect(edits).toEqual(['prev', 'next', 'paste', 'del']);                                              // only the ones that need no selection stay at the top
  const tabs = await page.locator('.tabs.big').boundingBox(), bb = await nav.boundingBox();
  expect(Math.abs(bb.y - tabs.y)).toBeLessThan(3); expect(bb.x + bb.width).toBeLessThanOrEqual(390.5);       // it takes the place of the bottom menu
  // More: Move / Length arrows, Paste, Duplicate, Lock, Done (no Prev / Next: they are in the row above the timeline)
  await nav.locator('.char-more summary').click();
  const list = nav.locator('.cb-more-list'); await expect(list).toBeVisible();
  await expect(list.getByRole('button', { name: 'Prev', exact: true })).toHaveCount(0); await expect(list.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0);
  const before = await page.evaluate(() => ({ ...window.__toon.S.bgClips[0] }));
  await list.getByRole('button', { name: 'Move later' }).click(); await page.waitForTimeout(200);
  await list.getByRole('button', { name: 'Longer' }).click(); await page.waitForTimeout(200);
  const after = await page.evaluate(() => ({ ...window.__toon.S.bgClips[0] }));
  expect(after.start).toBeCloseTo(before.start + 0.1, 2); expect(after.dur).toBeCloseTo(before.dur + 0.1, 2);
  const pop = await list.boundingBox(); expect(pop.x).toBeGreaterThanOrEqual(0); expect(pop.x + pop.width).toBeLessThanOrEqual(390); expect(pop.y + pop.height).toBeLessThanOrEqual(bb.y);
  await page.locator('.controls .time').click(); await expect(nav.locator('.char-more')).toHaveJSProperty('open', false);           // tap elsewhere closes the list
  // nothing makes the page wider than the phone
  const over = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, vw: innerWidth }));
  expect(over.doc).toBeLessThanOrEqual(over.vw);
  await nav.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('#app .lane2.bg .tclip.mine')).toHaveCount(0);
  expect(await page.evaluate(() => window.__toon.S.bgClips.length)).toBe(0);
  await expect(nav).toBeHidden();                                                                // the selection is gone: the normal menu is back
  await expect(page.locator('.tabs.big')).toBeVisible();
});

test('phone: the character\'s name and size are in its More list; the size bar at the top is gone', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const { S, stage, drawCharBar } = window.__toon;
    S.speakers.push({ key: 'fake1', name: 'Fake', color: '#c06', charId: 'fake' });
    stage.layers.push({ key: 'fake1', box: { x0: 0, x1: 10, y0: 0, y1: 10 }, visible: true, anim: new Set(), anchor: { x: stage.W * 0.5, y: stage.H * 0.6 }, mul: 1, bounds: { x: 0, y: 0, w: 10, h: 30 } });
    drawCharBar({ key: 'fake1' });
  });
  await expect(page.locator('.char-bar')).toBeVisible(); await expect(page.locator('.selbar')).toBeHidden();
  await page.locator('.char-bar .char-more summary').click();
  // (the stand-in character cannot be drawn, which makes typing in the page slow: the fields are set from the page itself)
  await page.evaluate(() => { const n = document.querySelector('.cb-name'); n.value = 'Rani'; n.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(await page.evaluate(() => window.__toon.S.speakers.find((x) => x.key === 'fake1').name)).toBe('Rani');
  await page.evaluate(() => { const r = document.querySelector('.cb-size'); r.value = '60'; r.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(await page.evaluate(() => window.__toon.stage.layers.find((x) => x.key === 'fake1').mul)).toBeCloseTo(0.6, 2);
  await expect(page.locator('.cb-pct')).toHaveText('60%');
});
