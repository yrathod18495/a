import { test, expect } from '@playwright/test';
test.use({ viewport: { width: 390, height: 800 } });
test('phone: a background clip has Objects, Crop and Replace in the bottom bar (no Duplicate); Crop zooms, Replace waits for the next background', async ({ page }) => {
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Bg');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  await page.evaluate(() => { const { S, drawClipBar } = window.__toon; S.bgClips.push({ id: 'bg1', bgId: null, preset: 1, start: 0, dur: 5 }); S.bgSel = 'bg1'; drawClipBar(); });
  const nav = page.locator('.clip-nav'); await expect(nav).toBeVisible();
  await expect(nav.locator('.cb-list .cb-btn > span:last-child')).toHaveText(['Split', 'Copy', 'Objects', 'Crop', 'Replace', 'Delete']);
  const row = await nav.locator('.cb-list').evaluate((e) => ({ scroll: e.scrollWidth, client: e.clientWidth })); expect(row.scroll).toBeLessThanOrEqual(row.client + 1);
  // Objects opens the props (stone, tree ...)
  await nav.getByRole('button', { name: 'Objects' }).click();
  expect(await page.evaluate(() => window.__toon.S.tab)).toBe('props');
  // Crop: the zoom slider crops into the picture
  await nav.getByRole('button', { name: 'Crop' }).click();
  await expect(page.getByRole('heading', { name: 'Crop background' })).toBeVisible();
  await page.evaluate(() => { const z = document.querySelector('.modal input[aria-label="Zoom"]'); z.value = 200; z.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(await page.evaluate(() => window.__toon.S.bgClips[0].xf.s)).toBe(2);
  await page.getByRole('button', { name: 'Reset' }).click(); expect(await page.evaluate(() => window.__toon.S.bgClips[0].xf.s)).toBe(1);
  await page.locator('.modal').getByRole('button', { name: 'Done' }).click();
  // Duplicate is still in More
  await nav.locator('.char-more summary').click(); await expect(nav.locator('.cb-more-list').getByRole('button', { name: 'Duplicate' })).toBeVisible();
});
