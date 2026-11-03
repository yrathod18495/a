import { test, expect } from '@playwright/test';
// Drawing / editing a path shows a blurred trail and faint character outlines along it; the real line stays the one that is edited.
test('path preview: blurred trail and ghost outlines while drawing and editing', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 860 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Path');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
  // the bundled characters are not in the repository: a layer with a box stands in, the path code only needs its key and size
  await page.evaluate(async () => {
    const { S, stage } = window.__toon;
    const c = document.createElement('canvas'); c.width = 20; c.height = 32; const g = c.getContext('2d'); g.fillStyle = '#c06'; g.fillRect(4, 0, 12, 32);
    S.characters.push({ id: 'fake', name: 'Fake', thumb: c.toDataURL() });
    S.speakers.push({ key: 'fake1', name: 'Fake', color: '#c06', charId: 'fake' }); S.order.push('fake1');
    stage.layers.push({ key: 'fake1', box: { x0: 100, x1: 220, y0: 100, y1: 400 }, visible: true });
    S.tab = 'motion'; S.motionFor = 'fake1';
    S.paths.fake1 = { pts: [{ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.3 }, { x: 0.8, y: 0.2 }], start: 0, dur: 3, face: true, smooth: false, mul: 1 };
    S.pathEdit = true; window.__toon.updatePathView(true);
  });
  await expect(page.locator('.pathview .trail')).toHaveCount(1);                       // the soft trail
  await expect(page.locator('.pathghosts img.pathghost')).toHaveCount(6);              // the character itself (its picture), start ... end - not boxes
  await expect(page.locator('.pathview .ghost, .pathview rect')).toHaveCount(0);
  expect(await page.locator('.pathghost').first().evaluate((e) => getComputedStyle(e).filter)).toContain('blur');
  const o = await page.locator('.pathghost').evaluateAll((els) => els.map((e) => +getComputedStyle(e).opacity)); expect(o[5]).toBeGreaterThan(o[0]);
  await expect(page.locator('.pathview polyline:not(.trail)')).toHaveCount(1);          // the line that is edited is still one line
  await expect(page.locator('.pathpt')).toHaveCount(3);
  // leaving the edit mode: only the plain line
  await page.evaluate(() => { window.__toon.S.pathEdit = false; window.__toon.updatePathView(true); });
  await expect(page.locator('.pathghost')).toHaveCount(0);
});

test('a path follows its animation clip: same start and length, and it goes when the clip is deleted', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 860 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Path2');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
  const r = await page.evaluate(() => {
    const { S, stage, commitClips } = window.__toon;
    S.characters.push({ id: 'fake', name: 'Fake', rig: {} });
    S.speakers.push({ key: 'fake1', name: 'Fake', color: '#c06', charId: 'fake' }); S.order.push('fake1');
    stage.layers.push({ key: 'fake1', box: { x0: 100, x1: 220, y0: 100, y1: 400 }, visible: true, anim: new Set() });
    const clip = { id: 'c1', kind: 'body', ref: { name: 'walk' }, start: 1, dur: 3, off: 0 };
    S.manual.fake1 = [clip];
    S.paths.fake1 = { pts: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }], clipId: 'c1', start: 1, dur: 3, face: true, smooth: false, mul: 1 };
    clip.dur = 5.5; clip.start = 2; commitClips();                         // the clip was moved and stretched on the timeline
    const after = { ...S.paths.fake1 }, last = S.charKeys.fake1?.at(-1)?.t;
    S.manual.fake1 = []; commitClips();                                    // the clip is deleted
    return { after, last, gone: !S.paths.fake1, keysGone: !S.charKeys.fake1 };
  });
  expect(r.after.start).toBe(2); expect(r.after.dur).toBe(5.5);            // the path took the clip's start and length
  expect(r.last).toBeCloseTo(7.5, 2);                                       // its keyframes end exactly where the clip ends
  expect(r.gone).toBe(true); expect(r.keysGone).toBe(true);
});

test('resizing a character that has keyframes / a path keeps it smaller everywhere (not only at the playhead)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 860 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Size');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
  const r = await page.evaluate(() => {
    const { S, stage, player, saveXf } = window.__toon;
    S.speakers.push({ key: 'fake1', name: 'Fake', color: '#c06', charId: 'fake' }); S.order.push('fake1');
    const layer = { key: 'fake1', box: { x0: 0, x1: 10, y0: 0, y1: 10 }, visible: true, anim: new Set(), anchor: { x: 100, y: 100 }, mul: 1 };
    stage.layers.push(layer);
    S.charKeys.fake1 = [0, 1, 2, 3].map((i) => ({ id: `k${i}`, t: i, x: 0.2 + i * 0.2, y: 0.2, mul: 1, ease: 'linear', pathKey: true }));
    S.paths.fake1 = { pts: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }], start: 0, dur: 3, mul: 1 };
    stage.setLayerKeys('fake1', S.charKeys.fake1);
    player.seek(1.5);
    layer.mul = 0.5; saveXf(layer);                                         // the user makes the character half the size at 1.5 s
    return { muls: S.charKeys.fake1.filter((k) => k.pathKey).map((k) => k.mul), pathMul: S.paths.fake1.mul, now: stage.keyChar(S.charKeys.fake1.slice().sort((a, b) => a.t - b.t), 0).mul };
  });
  for (const m of r.muls) expect(m).toBeCloseTo(0.5, 2);                    // every keyframe of the movement is smaller
  expect(r.pathMul).toBeCloseTo(0.5, 2); expect(r.now).toBeCloseTo(0.5, 2);
});

test('an older path (made before paths followed their clip) takes the animation that plays at its start, so the walk lasts the whole way', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 860 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Legacy');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
  const r = await page.evaluate(() => {
    const { S, stage, commitClips } = window.__toon;
    S.characters.push({ id: 'fake', name: 'Fake', rig: {} });
    S.speakers.push({ key: 'fake1', name: 'Fake', color: '#c06', charId: 'fake' }); S.order.push('fake1');
    stage.layers.push({ key: 'fake1', box: { x0: 0, x1: 10, y0: 0, y1: 10 }, visible: true, anim: new Set(), anchor: { x: 100, y: 100 }, mul: 1 });
    S.manual.fake1 = [{ id: 'walk1', kind: 'body', ref: { name: 'walk' }, start: 0.5, dur: 6, off: 0 }];
    S.paths.fake1 = { pts: [{ x: 0.1, y: 0.2 }, { x: 0.9, y: 0.2 }], start: 0.5, dur: 12, face: true, smooth: false, mul: 1 };     // the path lasted 12 s but the walk only 6 s: the walk used to stop (idle) halfway
    commitClips();
    return { ...S.paths.fake1, last: S.charKeys.fake1.at(-1).t };
  });
  expect(r.clipId).toBe('walk1'); expect(r.dur).toBe(6); expect(r.last).toBeCloseTo(6.5, 2);          // the movement ends exactly when the walk ends
});
