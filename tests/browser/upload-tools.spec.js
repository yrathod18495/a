import { test, expect } from '@playwright/test';

// The tools: on a big screen a labelled rail (Start here: Audio, Characters, Animations / Scene / Finish) with the rarer tools under "More tools";
// on a phone a short bottom bar whose "More" menu holds the rarer tools. The menu stays on the screen, picking a tool opens its panel and closes the menu.
test('the tool rail and the More menu open every tool and stay on the screen', async ({ page }, info) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.route('**/api/security', route => route.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', route => route.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Upload toolbar');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
  const rail = page.locator('#app .tabs.big'), panel = page.locator('#app .panel');
  // big screen: the main tools are plain buttons, in the order a person works
  await expect(rail.locator(':scope > .rail-btn .rb-label')).toHaveText(['Audio', 'Characters', 'Animations', 'Background', 'Props', 'Objects', 'Shadow', 'Effects', 'Export']);
  const more = rail.locator('.rail-more');
  await more.locator('summary').click();
  await expect(more).toHaveAttribute('open', '');
  for (const name of ['Uploads', 'Colour', 'Move', 'Camera']) {
    await more.getByRole('button', { name, exact: true }).click();
    await expect(panel).toHaveClass(/open/);
    await expect(more).toHaveAttribute('open', '');                       // the list stays open while one of its tools is in use
    await expect(more.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  await rail.getByRole('button', { name: 'Audio', exact: true }).click();
  await expect(rail.getByRole('button', { name: 'Audio', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.locator('.up-tile')).toHaveText([/Voices/, /Music/]);
  await page.screenshot({ path: info.outputPath('rail-1366.png') });
  // phone sizes: the More menu fits on the screen, a tool in it opens the panel and closes the menu; Escape and a tap elsewhere close it too
  for (const [width, height] of [[390, 844], [500, 620], [360, 640]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => { const T = window.__toon; T.S.tlCat = null; T.S.panelOpen = false; T.openTab('chars'); });
    const menu = page.locator('#app .tabs-scroll:not(.cube-out) .advanced-tools'), summary = menu.locator('summary');
    for (const name of ['Uploads', 'Colour', 'Move']) {
      await summary.click();
      await expect(menu).toHaveAttribute('open', '');
      await expect.poll(() => menu.locator('.advanced-tools-list').evaluate(list => {
        const box = list.getBoundingClientRect();
        return box.left >= 0 && box.top >= 0 && box.right <= innerWidth + 0.5 && box.bottom <= innerHeight + 0.5;
      })).toBe(true);
      await menu.locator('.advanced-tools-list').getByRole('button', { name, exact: true }).click();
      await expect(page.locator('#app .advanced-tools[open]')).toHaveCount(0);          // the menu closed (the bar may now show the tool's own group)
      await expect(panel).toHaveClass(/open/);
      await expect(panel.locator('.sheet-close b')).toHaveText(name);
      await page.evaluate(() => { const T = window.__toon; T.S.tlCat = null; T.openTab('chars'); });
    }
    await summary.click(); await page.keyboard.press('Escape');
    await expect(menu).not.toHaveAttribute('open', '');
    await summary.click(); await page.locator('#app .topbar').click({ position: { x: 2, y: 2 } });
    await expect(menu).not.toHaveAttribute('open', '');
    await page.screenshot({ path: info.outputPath(`more-${width}.png`) });
  }
});
