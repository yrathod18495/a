import { test, expect } from '@playwright/test';
// Phone: selecting a character shows a bar of named buttons (instead of the bottom menu).
async function open(page, width) {
  await page.setViewportSize({ width, height: 860 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Bar');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
}
test('phone: a selected character gets named tool buttons over the bottom menu; Close hides them', async ({ page }) => {
  await open(page, 390);
  // the bundled demo characters are not in the repository, so a character entry is made directly: this checks the bar itself (layout, names, close)
  await page.evaluate(() => { const { S, drawCharBar } = window.__toon; S.speakers.push({ key: 'fake1', name: 'Fake', color: '#c06', charId: 'fake' }); drawCharBar({ key: 'fake1' }); });
  const bar = page.locator('.char-bar'); await expect(bar).toBeVisible();
  await expect(bar.locator('.cb-btn > span:last-child')).toHaveText(['Animations', 'Hand props', 'Path', 'Tears', 'Mask', 'Mirror', 'Reset', 'Delete']);
  const tabs = await page.locator('.tabs.big').boundingBox(), bb = await bar.boundingBox();
  expect(Math.abs(bb.y - tabs.y)).toBeLessThan(3); expect(bb.x + bb.width).toBeLessThanOrEqual(390.5);
  const row = await page.locator('.char-bar .cb-list').evaluate((e) => ({ scroll: e.scrollWidth, client: e.clientWidth }));
  expect(row.scroll).toBeGreaterThan(row.client);                           // 8 buttons: the row scrolls sideways, none is squeezed
  const sizes = await bar.locator('.cb-btn').evaluateAll((els) => els.map((e) => { const b = e.getBoundingClientRect(); return [b.left, b.right, b.width, b.height]; }));
  for (const [i, a] of sizes.entries()) { expect(a[2]).toBeGreaterThanOrEqual(60); expect(a[3]).toBeGreaterThanOrEqual(44); if (i) expect(a[0]).toBeGreaterThanOrEqual(sizes[i - 1][1] - 0.5); }      // big enough to tap, no overlap
  const tabsVisible = await page.evaluate(() => { const c = document.querySelector('.char-bar').getBoundingClientRect(), t = document.querySelector('.tabs.big').getBoundingClientRect(); return c.top <= t.top + 3 && c.bottom >= t.bottom - 3; });
  expect(tabsVisible).toBe(true);                                         // the bar covers the bottom menu
  await bar.getByRole('button', { name: 'Close the character tools' }).click();
  await expect(bar).toBeHidden();
  await expect(page.locator('.tabs.big')).toBeVisible();
});
