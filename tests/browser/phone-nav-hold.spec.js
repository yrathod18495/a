import { test, expect } from '@playwright/test';
test.use({ viewport: { width: 390, height: 800 } });

test('the phone bottom bar follows the timeline group and the Hold tool puts a prop in a hand', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Nav');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  await page.locator('.panel.open .sheet-close button').click({ timeout: 3000 }).catch(() => {});
  const bar = page.locator('.tabs-scroll > button');
  const names = async () => (await bar.evaluateAll((els) => els.map((e) => e.getAttribute('title'))));
  const chip = (t) => page.locator('.tl-cats .tl-cat', { hasText: t });
  await chip('Audio').click();
  expect(await names()).toEqual(expect.arrayContaining(['Voices', 'Music', 'Edit voice']));
  await chip('Background').click();
  expect(await names()).toEqual(expect.arrayContaining(['Pick', 'Upload', 'Edit', 'Filter', 'Colour']));
  await chip('Effects').click();
  expect(await names()).toEqual(expect.arrayContaining(['Colour']));
  await chip('Props').click();
  expect(await names()).toContain('Hold');
  // Hold with nothing to hold says what to do
  await page.getByRole('button', { name: 'Hold', exact: true }).click();
  await expect(page.locator('.hold-sheet')).toBeHidden();
  // with a prop the tool opens, the hand buttons and the joystick are there
  await page.evaluate(async () => { const T = window.__toon, S = T.S, blob = await (await fetch('data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==')).blob();
    S.props.push({ id: 'p1', name: 'Lamp', kind: 'prop', blob, natW: 1, natH: 1, x: .8, y: .7, w: .2, h: .2, rotation: 0, visible: true }); T.drawTimeline(); });
  await page.getByRole('button', { name: 'Hold', exact: true }).click();
  await expect(page.locator('.hold-sheet')).toBeVisible();
  await expect(page.locator('.hold-sheet .joy')).toBeVisible();
  await expect(page.locator('.hold-sheet [data-hand]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Close the hold tool' }).filter({ visible: true }).click();
  await expect(page.locator('.hold-sheet')).toBeHidden();
  expect(errors).toEqual([]);
});

test('the selected background can be moved and resized with the Adjust tool', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Bg');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  await page.evaluate(() => { const T = window.__toon, S = T.S; S.bgClips.push({ id: 'b1', preset: 1, start: 0, dur: 5 }); S.tlCat = 'background'; T.drawTimeline(); });
  await page.locator('.panel.open .sheet-close button').click({ timeout: 3000 }).catch(() => {});
  await page.locator('.tl-cats .tl-cat', { hasText: 'Background' }).click();
  await page.locator('.tclip.bg.mine').first().click();
  await page.locator('.clip-nav').getByRole('button', { name: 'Adjust' }).click();
  const sheet = page.locator('.bg-adjust-sheet');
  await expect(sheet).toBeVisible();
  await sheet.getByLabel('Size').evaluate((e) => { e.value = '150'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(await page.evaluate(() => window.__toon.S.bgClips[0].xf.s)).toBeCloseTo(1.5, 2);
  await sheet.getByRole('button', { name: 'Reset' }).click();
  expect(await page.evaluate(() => window.__toon.S.bgClips[0].xf.s)).toBe(1);
  await sheet.getByRole('button', { name: 'Close the background tools' }).filter({ visible: true }).click();
  await expect(sheet).toBeHidden();
  expect(errors).toEqual([]);
});

test('with a prop selected, a finger anywhere on the picture moves only that prop', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Prop');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  await page.evaluate(async () => { const T = window.__toon, S = T.S, c = document.createElement('canvas'); c.width = c.height = 16; c.getContext('2d').fillRect(0, 0, 16, 16);
    S.props.push({ id: 'p1', name: 'Box', kind: 'prop', blob: await new Promise((r) => c.toBlob(r)), natW: 16, natH: 16, x: .5, y: .5, w: .1, h: .1, rotation: 0, visible: true, start: 0, end: 5 }); T.drawTimeline();
    S.propSel = 'p1'; S.selectedPropId = 'p1'; });
  await page.locator('.panel.open .sheet-close button').click({ timeout: 3000 }).catch(() => {});
  const box = await page.locator('.stagewrap canvas').boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2); await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.3, { steps: 6 }); await page.mouse.up();
  const p = await page.evaluate(() => { const o = window.__toon.S.props[0]; return { x: o.x, y: o.y }; });
  expect(p.x).toBeGreaterThan(0.6); expect(p.y).toBeGreaterThan(0.55);
  expect(errors).toEqual([]);
});

test('two fingers resize the selected prop: it grows and shrinks smoothly, also when it has no size of its own, and never becomes NaN', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Pinch');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  await page.evaluate(async () => { const T = window.__toon, S = T.S, c = document.createElement('canvas'); c.width = c.height = 16; c.getContext('2d').fillRect(0, 0, 16, 16);
    S.props.push({ id: 'p1', name: 'Box', kind: 'prop', blob: await new Promise((r) => c.toBlob(r)), natW: 16, natH: 16, x: .5, y: .5, rotation: 0, visible: true, start: 0, end: 5 }); T.drawTimeline();          // no w / h: the default size
    S.propSel = 'p1'; S.selectedPropId = 'p1'; });
  await page.locator('.panel.open .sheet-close button').click({ timeout: 3000 }).catch(() => {});
  const box = await page.locator('.stagewrap canvas').boundingBox(), cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const fire = (type, id, x, y) => page.evaluate(([t, i, px, py]) => { const el = document.querySelector('.stagewrap'); el.dispatchEvent(new PointerEvent(t, { pointerId: i, pointerType: 'touch', isPrimary: i === 1, clientX: px, clientY: py, bubbles: true, cancelable: true })); }, [type, id, x, y]);
  await fire('pointerdown', 1, cx - 20, cy); await fire('pointerdown', 2, cx + 20, cy);
  await fire('pointermove', 2, cx + 80, cy); await fire('pointermove', 1, cx - 80, cy);
  const big = await page.evaluate(() => { const o = window.__toon.S.props[0]; return [o.w, o.h]; });
  expect(Number.isFinite(big[0]) && Number.isFinite(big[1])).toBe(true); expect(big[0]).toBeGreaterThan(0.18);
  await fire('pointermove', 2, cx + 10, cy); await fire('pointermove', 1, cx - 10, cy);
  const small = await page.evaluate(() => { const o = window.__toon.S.props[0]; return [o.w, o.h]; });
  expect(small[0]).toBeLessThan(big[0]); expect(small[0]).toBeGreaterThan(0.01);
  await fire('pointerup', 2, cx + 10, cy); await fire('pointerup', 1, cx - 10, cy);
  expect(errors).toEqual([]);
});
