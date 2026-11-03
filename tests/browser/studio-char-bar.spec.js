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
  // the main tools are all in view (no sideways scrolling), the rest is behind "More"
  await expect(bar.locator('.cb-list .cb-btn > span:last-child')).toHaveText(['Animations', 'Hand props', 'Path', 'Mirror']);
  const row = await bar.locator('.cb-list').evaluate((e) => ({ scroll: e.scrollWidth, client: e.clientWidth })); expect(row.scroll).toBeLessThanOrEqual(row.client + 1);
  const sizes = await bar.locator('.cb-list .cb-btn').evaluateAll((els) => els.map((e) => { const b = e.getBoundingClientRect(); return [b.left, b.right, b.width, b.height]; }));
  for (const [i, a] of sizes.entries()) { expect(a[2]).toBeGreaterThanOrEqual(56); expect(a[3]).toBeGreaterThanOrEqual(44); expect(a[1]).toBeLessThanOrEqual(390); if (i) expect(a[0]).toBeGreaterThanOrEqual(sizes[i - 1][1] - 0.5); }
  const tabsBox = await page.locator('.tabs.big').boundingBox(), bb = await bar.boundingBox();
  expect(Math.abs(bb.y - tabsBox.y)).toBeLessThan(3); expect(bb.x + bb.width).toBeLessThanOrEqual(390.5);             // it covers the bottom menu
  const more = bar.locator('.char-more'); const sb = await more.locator('summary').boundingBox(); await page.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await expect(more.locator('.cb-more-list .cb-btn > span:last-child')).toHaveText(['Tears', 'Mask', 'Reset', 'Delete', 'Done']);
  const pop = await more.locator('.cb-more-list').boundingBox(); expect(pop.x).toBeGreaterThanOrEqual(0); expect(pop.x + pop.width).toBeLessThanOrEqual(390); expect(pop.y + pop.height).toBeLessThanOrEqual(bb.y);   // above the bar, inside the screen
  await page.locator('.controls .time').click(); await expect(more).toHaveJSProperty('open', false); await expect(bar).toBeVisible();       // tap elsewhere: closes
  const sb2 = await more.locator('summary').boundingBox(); await page.mouse.click(sb2.x + sb2.width / 2, sb2.y + sb2.height / 2); await more.getByRole('button', { name: 'Close the character tools' }).click();
  await expect(bar).toBeHidden();
  await expect(page.locator('.tabs.big')).toBeVisible();
});
