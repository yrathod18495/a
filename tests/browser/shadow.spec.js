import { test, expect } from '@playwright/test';
test.use({ viewport: { width: 390, height: 800 } });
// A cast shadow: a flat black copy of the picture on the ground, away from the light; the direction can be any way round.
async function open(page) {
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Shadow');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  await page.evaluate(async () => {
    const { S, stage } = window.__toon, mk = async (col) => { const c = document.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d'); g.fillStyle = col; g.fillRect(0, 0, 16, 16); return new Promise((res) => c.toBlob(res)); };
    const floor = await mk('#d0d0d0'), prop = await mk('#ffffff');
    await stage.setBackgroundClips([{ start: 0, dur: 5, preset: 0, blob: floor }], true);
    S.props.push({ id: 'p1', name: 'Box', kind: 'prop', blob: prop, natW: 16, natH: 16, x: 0.5, y: 0.5, w: 0.1, h: 0.2, rotation: 0, visible: true });
    await stage.setProps(S.props);
  });
}
const shot = (page, spec) => page.evaluate((sh) => {
  const { S, stage } = window.__toon, p = S.props[0]; if (sh === null) delete p.shadow; else p.shadow = sh;
  stage.render(0.5, 0, [], []);
  const c = document.createElement('canvas'); c.width = stage.out.width; c.height = stage.out.height; const g = c.getContext('2d'); g.drawImage(stage.out, 0, 0);
  const W = c.width, H = c.height, at = (fx, fy) => g.getImageData(Math.round(fx * W), Math.round(fy * H), 1, 1).data[0];
  return { right: at(0.567, 0.613), left: at(0.433, 0.613), below: at(0.5, 0.66), above: at(0.5, 0.33) };
}, spec);
test('the shadow falls away from the light, to the right, left, toward the viewer or away, and is off by default', async ({ page }) => {
  await open(page);
  const none = await shot(page, null);
  const right = await shot(page, { on: true, angle: 0, length: 1, soft: 0, opacity: 0.8 });
  expect(right.right).toBeLessThan(none.right - 40); expect(right.left).toBeGreaterThan(none.left - 5);               // dark on the right only
  const left = await shot(page, { on: true, angle: 180, length: 1, soft: 0, opacity: 0.8 });
  expect(left.left).toBeLessThan(none.left - 40); expect(left.right).toBeGreaterThan(none.right - 5);                // dark on the left only
  const toward = await shot(page, { on: true, angle: 90, length: 1.5, soft: 0, opacity: 0.8 });
  expect(toward.below).toBeLessThan(none.below - 40);                                                                // falls toward the viewer: below the base
  const away = await shot(page, { on: true, angle: 270, length: 1.5, soft: 0, opacity: 0.8 });
  expect(away.below).toBeGreaterThan(none.below - 5);                                                                // away: nothing below
  const off = await shot(page, { on: false, angle: 0, length: 1, soft: 0, opacity: 0.8 });
  expect(off.right).toBeGreaterThan(none.right - 5);
});
test('the shadow editor is a short dock at the bottom: the stage stays fully visible, direction goes all the way round, Shadow is a layer and a tab', async ({ page }) => {
  await open(page);
  const guide = page.locator('.start-close'); if (await guide.count()) await guide.first().click();
  if (await page.locator('.panel.open').count()) await page.locator('.panel.open .sheet-close button').click();
  await page.evaluate(() => { const T = window.__toon; T.S.propSel = 'p1'; T.drawClipBar(); });
  await page.locator('.clip-nav').getByRole('button', { name: 'Edit' }).click();
  const dock = page.locator('.edit-dock'); await expect(dock).toBeVisible();
  await dock.getByRole('button', { name: 'Shadow', exact: true }).click();                   // from the prop editor to its shadow
  await expect(dock.locator('.ed-title')).toContainText('Shadow');
  const stage = await page.locator('.stagewrap').boundingBox(), d = await dock.boundingBox();
  expect(d.y).toBeGreaterThanOrEqual(stage.y + stage.height - 2);                              // the dock never covers the stage
  expect(d.height).toBeLessThan(230);                                                          // and it is short
  await expect(dock.locator('.ed-chip')).toHaveText([/Direction/, /Length/, /Softness/, /Darkness/]);
  await expect(dock.locator('.ed-dir')).toHaveCount(8);
  await dock.locator('.ed-dir[data-deg="180"]').click();
  expect(await page.evaluate(() => window.__toon.S.props[0].shadow)).toMatchObject({ on: true, angle: 180 });
  await dock.locator('input[aria-label="Direction"]').evaluate((el) => { el.value = 300; el.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(await page.evaluate(() => window.__toon.S.props[0].shadow.angle)).toBe(300);          // any angle, not only the eight
  await dock.getByRole('button', { name: 'Length', exact: false }).click();
  await dock.locator('input[aria-label="Length"]').evaluate((el) => { el.value = 200; el.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(await page.evaluate(() => window.__toon.S.props[0].shadow.length)).toBe(2);
  await dock.getByRole('button', { name: 'Done' }).click(); await expect(dock).toBeHidden();
  // the shadow is a layer of its own on the timeline, with the shadow icon and its own lock; selecting it gives Edit / Delete
  const row = page.locator('.lane2.shadow .tclip.shadow'); await expect(row).toHaveCount(1);
  await expect(page.locator('.rl:has(.lock-layer) svg').first()).toBeVisible();
  await row.click();
  const nav = page.locator('.clip-nav'); await expect(nav.locator('.cb-list .cb-btn > span:last-child')).toHaveText(['Edit', 'Delete']);
  await nav.getByRole('button', { name: 'Delete' }).click();
  expect(await page.evaluate(() => window.__toon.S.props[0].shadow)).toBeUndefined(); await expect(page.locator('.lane2.shadow')).toHaveCount(0);
});
test('the Shadow tab lists the scene with a switch each, and is in the sliding bottom bar', async ({ page }) => {
  await open(page);
  await page.evaluate(() => window.__toon.openTab('shadow'));
  const row = page.locator('.sh-row', { hasText: 'Box' }); await expect(row).toBeVisible();
  await row.locator('.sh-switch').click();
  expect(await page.evaluate(() => window.__toon.S.props[0].shadow?.on)).toBe(true);
  await row.click();                                                                            // a tap on the row opens its editor
  await expect(page.locator('.edit-dock')).toBeVisible();
  const bar = page.locator('#app .tabs.big .tabs-scroll');
  await expect(bar.getByRole('button', { name: 'Shadow', exact: true })).toHaveCount(1);
});
