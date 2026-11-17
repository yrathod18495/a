import { test, expect } from '@playwright/test';
test.use({ viewport: { width: 390, height: 800 } });

test('easy camera: one button makes A and B, choose one, move and zoom it, set the time, play, remove', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Cam');
  await page.getByRole('textbox', { name: 'Create a project' }).press('Tab').catch(() => {});
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  await page.locator('.panel.open .sheet-close button').click({ timeout: 3000 }).catch(() => {});
  await page.locator('.tl-cats .tl-cat', { hasText: 'Characters' }).click();
  await page.getByRole('button', { name: 'Camera', exact: true }).click();
  const sheet = page.locator('.cam-sheet');
  await expect(sheet).toBeVisible();
  // nothing yet: one big button, and the old controls are tucked away
  await expect(sheet.locator('[data-act=start-move]')).toBeVisible(); await expect(sheet.locator('.cam-more')).toHaveJSProperty('open', false);
  await sheet.locator('[data-act=start-move]').click();
  await expect(sheet.locator('[data-point=A]')).toHaveCount(1); await expect(sheet.locator('[data-point=B]')).toHaveCount(1);
  let keys = await page.evaluate(() => window.__toon.S.camKeys.map((k) => ({ t: k.t, z: k.zoom, cx: k.cx })).sort((a, b) => a.t - b.t));
  expect(keys.length).toBe(2); expect(keys[0].z).toBe(1); expect(keys[1].z).toBeGreaterThan(1.5); expect(keys[1].t - keys[0].t).toBeCloseTo(3, 1);
  // B is selected: arrows move it, the zoom buttons zoom it
  { const bb = await sheet.getByRole('button', { name: 'Move right' }).boundingBox(); await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down(); await page.waitForTimeout(400); await page.mouse.up(); }
  const afterMove = await page.evaluate(() => window.__toon.S.camKeys.map((k) => ({ t: k.t, z: k.zoom, cx: k.cx })).sort((a, b) => a.t - b.t));
  expect(afterMove[1].cx).toBeGreaterThan(keys[1].cx);
  { const bb = await sheet.getByRole('button', { name: 'Zoom in' }).boundingBox(); await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down(); await page.waitForTimeout(400); await page.mouse.up(); }
  expect((await page.evaluate(() => window.__toon.S.camKeys.map((k) => k.zoom).sort((a, b) => a - b)))[1]).toBeGreaterThan(keys[1].z);
  // A: choose it; the playhead goes to it
  await sheet.locator('[data-point=A]').click(); expect(await page.evaluate(() => window.__toon.player.time)).toBeCloseTo(keys[0].t, 1);
  // timing: "Takes" 3 s -> 4 s with the + button, "Starts at" later
  await sheet.getByRole('button', { name: 'Takes: more' }).click(); await sheet.getByRole('button', { name: 'Takes: more' }).click(); await page.waitForTimeout(1500);
  keys = await page.evaluate(() => window.__toon.S.camKeys.map((k) => ({ t: k.t })).sort((a, b) => a.t - b.t)); expect(keys[1].t - keys[0].t).toBeCloseTo(4, 1);
  await sheet.getByRole('button', { name: 'Starts at: more' }).click(); keys = await page.evaluate(() => window.__toon.S.camKeys.map((k) => ({ t: k.t })).sort((a, b) => a.t - b.t)); expect(keys[0].t).toBeCloseTo(0.5, 1); expect(keys[1].t - keys[0].t).toBeCloseTo(4, 1);
  await sheet.getByRole('button', { name: 'Even' }).click(); expect(await page.evaluate(() => window.__toon.camKeys?.()?.[0]?.ease ?? window.__toon.S.camKeys.find((k) => k.t < 1).ease)).toBe('linear');
  await page.screenshot({ path: '/tmp/claude-0/-home-user-a/3967a7cb-7154-561f-8d0c-7184bb9946ac/scratchpad/cam-easy.png' });
  // the old controls are still there under More options
  await sheet.locator('.cam-more > summary').click(); await expect(sheet.locator('[data-act=add-point]')).toBeVisible();
  await sheet.locator('.cam-more > summary').click();
  await sheet.getByRole('button', { name: 'Close the camera' }).click();
  await expect(sheet).toBeHidden();
  expect(errors).toEqual([]);
});

test('camera keys on the timeline can be removed on a phone: tap a diamond, then the trash icon', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Cam2');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  await page.locator('.panel.open .sheet-close button').click({ timeout: 3000 }).catch(() => {});
  await page.evaluate(() => { const T = window.__toon; T.S.camKeys.push({ id: 'k1', t: 0.5, cx: .5, cy: .5, zoom: 1.5, ease: 'smooth' }, { id: 'k2', t: 2, cx: .6, cy: .5, zoom: 2, ease: 'smooth' }); T.S.tlCat = 'chars'; T.drawTimeline(); });
  await page.locator('.tl-cats .tl-cat', { hasText: 'Characters' }).click();
  await page.locator('.lane2.cam .kf').first().click();
  const sheet = page.locator('.cam-sheet');
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Remove the camera move' }).first().click();
  await expect(sheet).toBeHidden();
  expect(await page.evaluate(() => window.__toon.S.camKeys.length)).toBe(0);
  await expect(page.locator('.lane2.cam')).toHaveCount(0);
  expect(errors).toEqual([]);
});
