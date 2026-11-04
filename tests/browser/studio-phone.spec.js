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

test('the bottom bar: Upload, Characters, Animations, Props, Objects, Shadow, Background, More (the whole bar scrolls sideways, nothing is pinned); Export is the last item of Advanced', async ({ page }) => {
  await phone(page, 390);
  const bar = page.locator('#app .tabs.big');
  const items = await bar.evaluate((el) => [...el.querySelectorAll(':scope > button, :scope > details, :scope > .tabs-scroll > button, :scope > .tabs-scroll > details')].map((c) => ({ label: c.tagName === 'DETAILS' ? c.querySelector('summary').textContent.trim() : c.textContent.trim() })));
  expect(items.map((i) => i.label)).toEqual(['Upload', 'Characters', 'Animations', 'Props', 'Objects', 'Shadow', 'Background', 'More']);
  const barBox = await bar.boundingBox(), sc = await bar.locator('.tabs-scroll').evaluate((e) => ({ scrolls: e.scrollWidth > e.clientWidth, x: getComputedStyle(e).overflowX }));
  expect(sc.x).toBe('auto');                                                                    // the middle slides sideways
  const first = await bar.locator('.tabs-scroll > :first-child').evaluate((e) => e.textContent.trim()), last = await bar.locator('.tabs-scroll > :last-child > summary').evaluate((e) => e.textContent.trim());
  expect([first, last]).toEqual(['Upload', 'More']);          // Upload is the first item of the sliding bar and More the last; neither is pinned
  await expect(bar.getByRole('button', { name: 'Export', exact: true })).toHaveCount(0);                                                                     // no Export button in the bar itself
  const tab = () => page.evaluate(() => window.__toon.S.tab);
  await bar.getByRole('button', { name: 'Upload' }).click(); expect(await tab()).toBe('audio');
  await bar.getByRole('button', { name: 'Props', exact: true }).click(); expect(await tab()).toBe('handprops'); await expect(page.locator('.panel')).toContainText('Props');
  await bar.getByRole('button', { name: 'Objects' }).click(); expect(await tab()).toBe('props'); await expect(page.locator('.panel')).toContainText('Objects');
  await bar.getByRole('button', { name: 'Background' }).click(); expect(await tab()).toBe('canvas');
  await bar.getByRole('button', { name: 'Characters' }).click(); expect(await tab()).toBe('chars');
  await bar.getByRole('button', { name: 'Animations' }).click(); expect(await tab()).toBe('anim');
  // Advanced ends with Export
  await bar.locator('summary[title="More tools"]').click();
  const names = await bar.locator('.advanced-tools-list button').evaluateAll((b) => b.map((x) => x.title));
  expect(names.at(-1)).toBe('Export'); expect(names).toEqual(['Tears', 'Effects', 'Colour', 'Move', 'Camera', 'Mask', 'AI', 'Export']);
  await bar.locator('.advanced-tools-list button[title="Export"]').click();
  expect(await tab()).toBe('export'); await expect(page.locator('.panel')).toContainText(/Export/);
  await expect(bar.locator('.advanced-tools')).toHaveClass(/has-active/);                                    // Advanced shows it is the open one
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
