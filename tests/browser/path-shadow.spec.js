import { test, expect } from '@playwright/test';
// Drawing / editing a path shows a blurred trail and faint character outlines along it; the real line stays the one that is edited.
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

const studio = async (page) => {
  await page.setViewportSize({ width: 390, height: 860 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Shadow');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
  if (await page.locator('.panel.open').count()) await page.locator('.panel.open .sheet-close button').click();
  await page.evaluate(() => {
    const { S, stage } = window.__toon;
    const c = document.createElement('canvas'); c.width = 20; c.height = 32; const g = c.getContext('2d'); g.fillStyle = '#c06'; g.fillRect(4, 0, 12, 32);
    S.characters.push({ id: 'fake', name: 'Fake', rig: {}, thumb: c.toDataURL() });
    const sp = { key: 'fake1', name: 'Fake', color: '#c06', charId: 'fake' }; S.speakers.push(sp); S.order.push('fake1');
    stage.layers.push({ key: 'fake1', box: { x0: 100, x1: 190, y0: 100, y1: 330 }, visible: true, anim: new Set(), anchor: { x: stage.W * 0.2, y: stage.H * 0.6 }, mul: 1 });      // feet at 20% from the left, 40% from the bottom
    S.manual.fake1 = [{ id: 'walk1', kind: 'body', ref: { name: 'walk' }, start: 1, dur: 4, off: 0 }];
    window.__toon.drawTimeline();
  });
};

test('Path: a faint shadow of the character is dragged to where it should go; the path starts at the character and ends at the shadow', async ({ page }) => {
  await studio(page);
  await page.evaluate(() => window.__toon.startPathShadow(window.__toon.S.speakers.find((x) => x.key === 'fake1')));
  const shadow = page.locator('.pathshadow'); await expect(shadow).toHaveCount(1);
  expect(await shadow.evaluate((e) => +getComputedStyle(e).opacity)).toBeLessThan(0.5);               // only a shadow: faded
  expect(await shadow.evaluate((e) => e.tagName)).toBe('IMG');                                        // the character's own picture
  await expect(page.locator('.pflag.stage')).toHaveCount(2);                                         // A and B
  const box = await page.locator('.pathshadow-layer').boundingBox(), s0 = await page.locator('.pathshadow').boundingBox();
  const fx = s0.x + s0.width / 2, fy = s0.y + s0.height * 0.5, dx = box.width * 0.25, dy = box.height * 0.3;
  await page.mouse.move(fx, fy); await page.mouse.down();
  await page.mouse.move(fx + dx / 2, fy + dy / 2, { steps: 5 }); await page.mouse.move(fx + dx, fy + dy, { steps: 5 });
  const mid = await page.locator('.pathshadow').boundingBox();                                       // the shadow follows the finger (by the same distance)
  expect(Math.abs(mid.x + mid.width / 2 - (fx + dx))).toBeLessThan(box.width * 0.03);
  await page.mouse.up();
  await expect(page.locator('.pathshadow-layer')).toHaveCount(1);                                    // lifting the finger does not finish
  expect(await page.evaluate(() => window.__toon.S.paths.fake1)).toBeUndefined();
  // a second drag takes the shadow where it is (no jump to the finger) and it can go out of the picture
  const sb = await page.locator('.pathshadow').boundingBox(), gx = sb.x + sb.width / 2, gy = sb.y + sb.height * 0.6;
  await page.mouse.move(gx + 20, gy); await page.mouse.down(); await page.mouse.move(gx + 50, gy, { steps: 3 }); await page.mouse.up();
  const sb2 = await page.locator('.pathshadow').boundingBox(); expect(Math.abs(sb2.x + sb2.width / 2 - (gx + 30))).toBeLessThan(8);          // moved by the finger's 30 px, it did not jump to the finger
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.pathshadow-layer')).toHaveCount(0);
  const r = await page.evaluate(() => ({ path: window.__toon.S.paths.fake1, keys: window.__toon.S.charKeys.fake1 }));
  expect(r.path.pts.length).toBe(2); expect(r.path.clipId).toBe('walk1'); expect(r.path.start).toBe(1); expect(r.path.dur).toBe(4);
  expect(r.path.pts[0].x).toBeCloseTo(0.2, 2); expect(r.path.pts[0].y).toBeCloseTo(0.4, 2);            // A: where the character stands
  expect(r.path.pts[1].x).toBeGreaterThan(0.7); expect(r.path.pts[1].y).toBeLessThan(0.2);              // B: where the shadow was left
  expect(r.keys.at(-1).t).toBeCloseTo(5, 2); expect(r.keys[0].mul).toBe(1); expect(r.keys.at(-1).mul).toBeGreaterThan(1.3);   // nearer the camera: bigger at the end
});

test('Path flags on the layer: A and B sit on the animation clip and dragging one changes the time (the clip and the path follow)', async ({ page }) => {
  await studio(page);
  await page.evaluate(() => {
    const { S, commitClips } = window.__toon;
    S.paths.fake1 = { pts: [{ x: 0.2, y: 0.4 }, { x: 0.8, y: 0.4 }], clipId: 'walk1', start: 1, dur: 4, depth: 0, mul: 1 };
    commitClips();
  });
  const a = page.locator('.lane2 .pflag.a'), b = page.locator('.lane2 .pflag.b');
  await expect(a).toHaveCount(1); await expect(b).toHaveCount(1);
  const pps = await page.evaluate(() => window.__toon.S.pps), lane = await page.locator('.lane2.char').first().boundingBox(), fa = await a.boundingBox();
  expect(fa.height).toBeLessThanOrEqual(24);                                                          // small, like a flag stuck on the layer
  expect(Math.abs(fa.x - (lane.x + 1 * pps))).toBeLessThan(6);
  const bb = await b.boundingBox(), y = bb.y + 6, x = bb.x + 1;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 60, y, { steps: 6 }); await page.mouse.up();
  const r = await page.evaluate(() => ({ clip: window.__toon.S.manual.fake1[0], path: window.__toon.S.paths.fake1 }));
  expect(r.clip.dur).toBeGreaterThan(4.3); expect(r.path.dur).toBeCloseTo(r.clip.dur, 1); expect(r.path.start).toBe(1);   // B moved later: the walk and the path are longer
  await expect(page.locator('.lane2 .pflag')).toHaveCount(2);
});
