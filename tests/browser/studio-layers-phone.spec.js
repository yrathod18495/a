import { test, expect } from '@playwright/test';
// Phone timeline: grip above it, narrow label column without overlaps, clip names that stay readable when scrolled.
async function open(page, width) {
  await page.setViewportSize({ width, height: 860 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Layers');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
  if (await page.locator('.panel.open').count()) await page.locator('.panel.open .sheet-close button').click();      // the tool sheet covers the timeline while it is open
  await expect(page.locator('.panel.open')).toHaveCount(0);
}
const tap = async (page) => { const g = await page.locator('.tl-size-grip').boundingBox(); await page.mouse.click(g.x + g.width / 2, g.y + g.height / 2); await page.waitForTimeout(250); };
const heights = (page) => page.evaluate(() => ({ prev: document.querySelector('.ws .prev').getBoundingClientRect().height, tl: document.querySelector('.ws .tlwrap').getBoundingClientRect().height }));

test('the grip above the timeline makes it bigger and smaller (tap and drag)', async ({ page }) => {
  await open(page, 390);
  const grip = page.locator('.tl-size-grip'); await expect(grip).toBeVisible();
  const gb = await grip.boundingBox(), wb = await page.locator('.tlwrap').boundingBox(), tb = await page.locator('.scene-tabs').boundingBox();
  expect(gb.y).toBeGreaterThanOrEqual(wb.y - 1); expect(gb.y + gb.height).toBeLessThanOrEqual(tb.y + tb.height + 2);      // inside the scene row: no line of its own
  const a = await heights(page);
  await tap(page);
  const b = await heights(page); expect(b.tl).toBeGreaterThan(a.tl + 30); expect(b.prev).toBeLessThan(a.prev - 30);
  await tap(page);
  const c = await heights(page); expect(Math.abs(c.tl - a.tl)).toBeLessThan(3);
  const g = await grip.boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await page.mouse.down(); await page.mouse.move(g.x + g.width / 2, g.y - 60, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(150);
  const d = await heights(page); expect(d.prev).toBeLessThan(a.prev - 30); expect(d.tl).toBeGreaterThan(a.tl + 30);
});

for (const width of [360, 390, 430]) test(`${width}px: label column is narrow, its buttons do not overlap, the clip name slides along when scrolled`, async ({ page }) => {
  await open(page, width);
  // a character row exactly as drawTimeline builds it (the bundled demo characters are not needed for a layout check)
  await page.evaluate(() => {
    const labels = document.querySelector('.tl-labels'), inner = document.querySelector('.tl-inner');
    const row = document.createElement('div'); row.className = 'rl char'; row.id = 'fake-row'; row.style.cssText = 'height:46px;--track-color:#c06';
    row.innerHTML = '<span class="timeline-icon"></span><span class="lt-wrap"><span class="lt">A very long character name</span><small class="lanim"></small></span><button class="rx add">＋</button><button class="rx lock-layer"><svg viewBox="0 0 24 24"></svg></button><button class="rx delete-layer">🗑</button>';
    labels.append(row);
    const lane = document.createElement('div'); lane.className = 'lane2 char'; lane.style.height = '46px';
    lane.innerHTML = '<div class="tclip body mine" id="fake-clip" style="left:40px;width:600px"><span class="tn">A very long character name · walk limp</span></div>';
    inner.style.width = '1400px'; inner.append(lane);
  });
  const col = await page.locator('.tl-labels').boundingBox(); expect(col.width).toBeLessThanOrEqual(66);
  const parts = await page.evaluate(() => [...document.querySelectorAll('#fake-row > *')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => { const b = e.getBoundingClientRect(); return [e.className, b.left, b.top, b.right, b.bottom]; }));
  expect(parts.length).toBe(3);                                         // picture, "+", lock: the name and the bin are not in the column
  const row = await page.locator('#fake-row').boundingBox();
  for (const p of parts) { expect(p[1], p[0]).toBeGreaterThanOrEqual(row.x - 0.5); expect(p[3], p[0]).toBeLessThanOrEqual(row.x + row.width + 0.5); expect(p[4], p[0]).toBeLessThanOrEqual(row.y + row.height + 0.5); }
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) { const a = parts[i], c = parts[j]; expect(a[3] <= c[1] + 0.5 || c[3] <= a[1] + 0.5 || a[4] <= c[2] + 0.5 || c[4] <= a[2] + 0.5, `${a[0]} overlaps ${c[0]}`).toBe(true); }
  // the label column never covers the clips
  const scroll = await page.locator('.tl-scroll').boundingBox(); expect(scroll.x).toBeGreaterThanOrEqual(col.x + col.width - 0.5);
  // scrolled 200px: the clip's left part is hidden, the name has slid to the visible edge
  await page.evaluate(() => { document.querySelector('.tl-scroll').scrollLeft = 200; });
  const tn = await page.evaluate(() => { const t = document.querySelector('#fake-clip .tn').getBoundingClientRect(), s = document.querySelector('.tl-scroll').getBoundingClientRect(); return { left: t.left, scrollLeft: s.left, right: t.right, scrollRight: s.right }; });
  expect(tn.left).toBeGreaterThanOrEqual(tn.scrollLeft - 0.5);
  expect(tn.right).toBeLessThanOrEqual(tn.scrollRight + 0.5);
});
