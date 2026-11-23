import { test, expect } from '@playwright/test';

async function phone(page, width) {
  await page.setViewportSize({ width, height: 800 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Phone');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.locator('#app .stagebox canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
}

for (const width of [360, 390, 430]) test(`on a ${width}px phone the whole top bar fits: the project ID is small, and Export and Close stay on screen`, async ({ page }) => {
  await phone(page, width);
  const m = await page.evaluate(() => { const bar = document.querySelector('.studio-bar').getBoundingClientRect(); const items = [...document.querySelector('.hdr-tools').children].filter((c) => c.getBoundingClientRect().width > 0).map((c) => ({ name: c.className.split(' ')[0] || c.tagName, right: c.getBoundingClientRect().right, left: c.getBoundingClientRect().left })); return { barRight: bar.right, items, scroll: document.documentElement.scrollWidth, vw: innerWidth }; });
  expect(m.scroll).toBeLessThanOrEqual(m.vw);
  for (const item of m.items) { expect(item.left, item.name).toBeGreaterThanOrEqual(0); expect(item.right, item.name).toBeLessThanOrEqual(m.barRight + 0.5); }
  await expect(page.getByRole('button', { name: 'Export', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close studio' })).toBeVisible();
  const chip = await page.locator('.studio-bar .project-id').boundingBox();
  expect(chip.width).toBeLessThan(100); expect(chip.height).toBeLessThanOrEqual(30);
});

test('one tap on the project ID copies it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await phone(page, 390);
  const id = await page.locator('.studio-bar .project-id').getAttribute('data-id');
  expect(id).toMatch(/^\d{9}$/);
  await page.locator('.studio-bar .project-id').click();                       // one click, nothing else
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(id);
  await expect(page.locator('.toast').last()).toHaveText('Project ID copied.');
  await expect(page.locator('.studio-bar .project-id')).toHaveClass(/copied/);
});

test('the "..." menu opens inside the screen', async ({ page }) => {
  await phone(page, 360);
  await page.locator('.studio-menu > summary').click();
  const panel = await page.locator('.studio-menu-panel').boundingBox();
  expect(panel.x).toBeGreaterThanOrEqual(0); expect(panel.x + panel.width).toBeLessThanOrEqual(360); await expect(page.getByRole('button', { name: /Reset this project/ })).toBeVisible();
});

test('the bottom bar follows the timeline group (Characters, Audio, Background, Props, Effects): a few big buttons each; More ends with Export', async ({ page }) => {
  await phone(page, 390);
  const bar = page.locator('#app .tabs.big');
  const labels = () => bar.evaluate((el) => [...el.querySelectorAll(':scope > .tabs-scroll:not(.cube-out) > button, :scope > .tabs-scroll:not(.cube-out) > details')].filter((c) => !c.hidden).map((c) => (c.tagName === 'DETAILS' ? c.querySelector('summary') : c).textContent.trim()));
  const group = async (key) => { if (await page.locator('.panel.open').count()) await page.locator('.panel.open .sheet-close button').click(); await page.locator(`#app .tl-cat[data-cat="${key}"]`).click(); await expect(bar.locator('.tabs-scroll.cube-out')).toHaveCount(0); };
  const tab = () => page.evaluate(() => window.__toon.S.tab);
  await group('chars'); expect(await labels()).toEqual(['Characters', 'Animations', 'Move', 'More']);
  await group('audio'); expect(await labels()).toEqual(['Voices', 'Music', 'Edit voice', 'Upload']);
  await group('background'); expect(await labels()).toEqual(['Pick', 'Upload', 'Edit', 'Filter', 'Colour']);
  await group('props'); expect(await labels()).toEqual(['Props', 'Objects', 'Hold', 'Shadow']);
  await group('effects'); expect(await labels()).toEqual(['Effects', 'Overlays', 'Colour']);
  const sc = await bar.locator('.tabs-scroll').evaluate((e) => getComputedStyle(e).overflowX);
  expect(sc).toBe('auto');                                                                      // the bar slides sideways when a group has more buttons than fit
  await expect(bar.getByRole('button', { name: 'Export', exact: true })).toHaveCount(0);       // no Export button in the bar itself (it is in the header and under More)
  // each button opens its own tool
  await group('props');
  await bar.getByRole('button', { name: 'Props', exact: true }).click(); expect(await tab()).toBe('handprops'); await expect(page.locator('.panel')).toContainText('Props');
  await bar.getByRole('button', { name: 'Objects', exact: true }).click(); expect(await tab()).toBe('props'); await expect(page.locator('.panel')).toContainText('Objects');
  await group('background'); await bar.getByRole('button', { name: 'Pick', exact: true }).click(); expect(await tab()).toBe('canvas');
  await group('audio'); await bar.getByRole('button', { name: 'Upload', exact: true }).click(); expect(await tab()).toBe('audio');
  await group('chars');
  await bar.getByRole('button', { name: 'Characters', exact: true }).click(); expect(await tab()).toBe('chars');
  await bar.getByRole('button', { name: 'Animations', exact: true }).click(); expect(await tab()).toBe('anim');
  // More ends with Export
  await bar.locator('summary[title="More tools"]').click();
  const names = await bar.locator('.advanced-tools-list button').evaluateAll((b) => b.map((x) => x.title));
  expect(names).toEqual(['Uploads', 'Skills', 'Tears', 'Overlays', 'Colour', 'Move', 'Camera', 'Mask', 'AI', 'Export']);
  await bar.locator('.advanced-tools-list button[title="Export"]').click();
  expect(await tab()).toBe('export'); await expect(page.locator('.panel')).toContainText(/Export/);
  await group('chars');
  await expect(bar.locator('.advanced-tools')).toHaveClass(/has-active/);                                    // More shows it holds the open tool
});

test('on a wide screen the left menu is unchanged: Export is still listed under Finish', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Wide');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.locator('#app .stagebox canvas')).toBeVisible();
  await expect(page.locator('#app .tabs.big .rail-btn')).toContainText(['Audio', 'Characters', 'Animations', 'Background', 'Objects', 'Export']);
});
