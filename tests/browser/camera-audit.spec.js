import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { open, ZIP } from './cam-helpers.js';
// Camera A to Z on a real scene: a picture with a red LEFT, a grey CENTRE and a blue RIGHT (so left / right can be checked from the pixels), with and without a character.
const keysOf = (page) => page.evaluate(() => window.__toon.S.camKeys.map((k) => [k.t, +k.zoom.toFixed(3), +k.cx.toFixed(3), +k.cy.toFixed(3)]).sort((a, b) => a[0] - b[0]));
const frame = (page, t) => page.evaluate((tt) => { const T = window.__toon, f = T.stage.frameAt([], tt ?? T.player.time); return { x0: f.x0, x1: f.x1, y0: f.y0, y1: f.y1, zoom: f.zoom }; }, t ?? null);
// how blue (positive) or red (negative) the row of the picture the camera shows at time t is, averaged along the whole width (the picture is drawn the way the video will be)
const bluish = (page, t) => page.evaluate((tt) => { const T = window.__toon; T.S.camPeek = true; T.stage.fullView = false; T.stage.render(tt, 0, [], []); const c = document.createElement('canvas'); c.width = T.stage.out.width; c.height = T.stage.out.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(T.stage.out, 0, 0); let sum = 0, n = 0; for (let i = 1; i < 20; i++) { const d = g.getImageData(Math.round(c.width * i / 20), Math.round(c.height * 0.08), 2, 2).data; sum += d[2] - d[0]; n++; } return sum / n; }, t);
const toCamera = async (page) => { await page.evaluate(() => window.__toon.openTab('camera')); await page.waitForTimeout(400); };
const preset = async (page, kind, at = 1) => { await page.evaluate((t) => { const T = window.__toon; T.S.camKeys = []; T.S.camSel = null; T.syncCam(); T.player.seek(t); }, at); await page.locator(`[data-preset=${kind}]`).click(); await page.waitForTimeout(200); };

test.describe('desktop', () => {
  test.use({ viewport: { width: 1366, height: 800 } });
  test('pan left / right / up / down move the camera the way they say (checked on the picture itself)', async ({ page }) => {
    test.setTimeout(120000);
    await open(page, { chr: false }); await toCamera(page);
    await preset(page, 'pan-right', 0.5);
    const r0 = await bluish(page, 0.6), r1 = await bluish(page, 4);
    expect(r1).toBeGreaterThan(r0 + 40);             // the camera ends further right, where the picture is blue: it went RIGHT
    expect((await frame(page, 4)).x0).toBeGreaterThan((await frame(page, 0.6)).x0);
    await page.evaluate(() => { window.__toon.S.camPeek = false; });
    await preset(page, 'pan-left', 0.5);
    const l0 = await bluish(page, 0.6), l1 = await bluish(page, 4);
    expect(l1).toBeLessThan(l0 - 40);                // PAN LEFT: it ends further left, where the picture is red
    await page.evaluate(() => { window.__toon.S.camPeek = false; });
    await preset(page, 'pan-down', 1); expect((await frame(page, 4)).y0).toBeGreaterThan((await frame(page, 1.1)).y0);
    await preset(page, 'pan-up', 1); expect((await frame(page, 4)).y0).toBeLessThan((await frame(page, 1.1)).y0);
    // a pan taken at a later time does not change the picture before it: it starts from what the camera showed
    const before = await frame(page, 0.5); await preset(page, 'pan-right', 2);
    const after = await frame(page, 2.0); expect(Math.abs(after.zoom - before.zoom)).toBeLessThan(0.02); expect(Math.abs(after.x0 - before.x0)).toBeLessThan(2);
  });

  test('a click, a double click and a shaky click on the camera view never change the camera points or the selection', async ({ page }) => {
    test.setTimeout(120000);
    await open(page); await toCamera(page);
    await preset(page, 'pan-right', 1); await page.evaluate(() => window.__toon.player.seek(2)); await page.waitForTimeout(300);
    const snap = () => page.evaluate(() => { const S = window.__toon.S; return { keys: S.camKeys.length, camSel: S.camSel, tab: S.tab, panel: S.panelOpen, sel: S.sel }; });
    const base = await snap(), box = await page.locator('.stagewrap').boundingBox();
    for (const [fx, fy] of [[0.5, 0.5], [0.08, 0.1], [0.93, 0.9]]) { await page.mouse.dblclick(box.x + box.width * fx, box.y + box.height * fy); await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy); }
    expect(await snap()).toEqual(base);
    const fr = await page.locator('.camframe').boundingBox();
    await page.mouse.dblclick(fr.x + fr.width / 2, fr.y + fr.height / 2);
    await page.mouse.move(fr.x + fr.width / 2, fr.y + fr.height / 2); await page.mouse.down(); await page.mouse.move(fr.x + fr.width / 2 + 2, fr.y + fr.height / 2 + 1); await page.mouse.up();          // a 2 px wobble
    expect(await snap()).toEqual(base);
    await page.mouse.move(fr.x + fr.width / 2, fr.y + fr.height / 2); await page.mouse.down(); await page.mouse.move(fr.x + fr.width / 2 + 60, fr.y + fr.height / 2, { steps: 6 }); await page.mouse.up();          // a real drag does make a point
    expect((await snap()).keys).toBe(base.keys + 1);
  });

  test('the mouse wheel zooms the camera while it is being set up and never resizes the background', async ({ page }) => {
    test.setTimeout(120000);
    await open(page, { chr: false }); await toCamera(page);
    await page.evaluate(() => window.__toon.player.seek(1));
    const scale0 = await page.evaluate(() => window.__toon.S.bgClips[0].xf?.s ?? 1), box = await page.locator('.stagewrap').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, -500); await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__toon.S.bgClips[0].xf?.s ?? 1)).toBeCloseTo(scale0, 5);
    const z1 = (await frame(page)).zoom; expect(z1).toBeGreaterThan(1.3);
    await page.mouse.wheel(0, 1500); await page.waitForTimeout(300); expect((await frame(page)).zoom).toBeCloseTo(1, 1);          // back out: never below the whole picture
    await page.mouse.wheel(0, -9000); await page.waitForTimeout(300); expect((await frame(page)).zoom).toBeLessThanOrEqual(6.001);
  });

  for (const mode of [{ name: 'background only', bg: true, chr: false }, { name: 'character only', bg: false, chr: true }, { name: 'an empty scene', bg: false, chr: false }]) {
    test(`camera moves work with ${mode.name}: presets, dragging the box, its corner and manual zoom`, async ({ page }) => {
      test.skip(mode.chr && !existsSync(ZIP), 'needs a character ZIP');
      test.setTimeout(150000);
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await open(page, mode); await toCamera(page);
      for (const kind of ['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down', 'shake']) {
        await preset(page, kind, 0.5);
        const ks = await keysOf(page); expect(ks.length, kind).toBeGreaterThanOrEqual(2);
        for (const [, z, cx, cy] of ks) { expect(z).toBeGreaterThanOrEqual(1); expect(z).toBeLessThanOrEqual(6); expect(cx).toBeGreaterThanOrEqual(0); expect(cx).toBeLessThanOrEqual(1); expect(cy).toBeGreaterThanOrEqual(0); expect(cy).toBeLessThanOrEqual(1); }
        for (const t of [0, 1, 2, 3, 4.5]) { const f = await frame(page, t); expect(f.x0).toBeGreaterThanOrEqual(-0.5); expect(f.x1).toBeLessThanOrEqual(1280.5); expect(f.y0).toBeGreaterThanOrEqual(-0.5); expect(f.y1).toBeLessThanOrEqual(720.5); }
      }
      // zoom in with the preset, then drag the box and its corner by hand
      await preset(page, 'zoom-in', 1); await page.evaluate(() => window.__toon.player.seek(2)); await page.waitForTimeout(300);
      const fr = await page.locator('.camframe').boundingBox();
      await page.mouse.move(fr.x + fr.width / 2, fr.y + fr.height / 2); await page.mouse.down(); await page.mouse.move(fr.x + fr.width / 2 + 40, fr.y + fr.height / 2 + 20, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(150);
      const moved = await frame(page); expect(moved.x0 + moved.x1).toBeGreaterThan(1280); expect(moved.zoom).toBeGreaterThan(1.05);
      const hd = await page.locator('.camhd.c-tl').boundingBox(); await page.mouse.move(hd.x + hd.width / 2, hd.y + hd.height / 2); await page.mouse.down(); await page.mouse.move(hd.x + hd.width / 2 + 60, hd.y + hd.height / 2 + 30, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(150);
      expect((await frame(page)).zoom).toBeGreaterThan(moved.zoom);          // a corner pulled INTO the picture makes the frame smaller = zoom in
      expect(errors).toEqual([]);
    });
  }

  test('camera points survive undo / redo and saving the scene', async ({ page }) => {
    test.setTimeout(120000);
    await open(page, { chr: false }); await toCamera(page);
    await preset(page, 'pan-right', 1); const keys = await keysOf(page); expect(keys.length).toBe(3);
    await page.keyboard.press('Control+z'); await page.waitForTimeout(400); expect(await keysOf(page)).toEqual([]);
    await page.keyboard.press('Control+y'); await page.waitForTimeout(400); expect(await keysOf(page)).toEqual(keys);
    const rt = await page.evaluate(async () => { const T = window.__toon, doc = T.sceneDoc(); T.S.camKeys = []; await T.loadSceneDoc(doc); return { back: T.S.camKeys.length, onStage: T.stage.camKeys.length }; });
    expect(rt).toEqual({ back: 3, onStage: 3 });
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  const sheetOpen = async (page, at) => {
    if (at != null) await page.evaluate((t) => window.__toon.player.seek(t), at);
    await page.locator('.tl-cats .tl-cat', { hasText: 'Characters' }).tap(); await page.getByRole('button', { name: 'Camera', exact: true }).tap();
    const sheet = page.locator('.cam-sheet'); await expect(sheet).toBeVisible(); return sheet;
  };
  test('a camera move started near the end of the scene stays inside it; "Takes" and "Starts at" cannot push B past the end; zoom 1 explains why nothing moves', async ({ page }) => {
    test.setTimeout(120000);
    await open(page, { chr: false });
    const sheet = await sheetOpen(page, 4.5); await sheet.locator('[data-act=start-move]').tap(); await page.waitForTimeout(300);
    const total = await page.evaluate(() => window.__toon.player.total);
    let ks = await keysOf(page); expect(ks[1][0]).toBeLessThanOrEqual(total + 1e-6); expect(ks[1][0] - ks[0][0]).toBeGreaterThanOrEqual(0.5);
    await page.evaluate(() => { const T = window.__toon; T.S.camKeys = []; T.S.camSel = null; T.syncCam(); T.player.seek(0); });
    await sheet.locator('[data-act=close], button[aria-label="Close the camera"]').first().tap().catch(() => {});
    const sheet2 = await sheetOpen(page, 0); await sheet2.locator('[data-act=start-move]').tap(); await page.waitForTimeout(300);
    for (let i = 0; i < 10; i++) await sheet2.getByRole('button', { name: 'Takes: more' }).tap();
    ks = await keysOf(page); expect(ks[1][0]).toBeLessThanOrEqual(total + 1e-6);
    for (let i = 0; i < 12; i++) await sheet2.getByRole('button', { name: 'Starts at: more' }).tap();
    ks = await keysOf(page); expect(ks[1][0]).toBeLessThanOrEqual(total + 1e-6);
    await sheet2.locator('[data-point=A]').tap(); await expect(sheet2.locator('.hd-note').first()).toContainText(/Zoom in first/);
  });

  test('two fingers pinch the camera: the zoom follows the fingers and stays between 1x and 6x', async ({ page }) => {
    test.setTimeout(120000);
    await open(page, { chr: false });
    const sheet = await sheetOpen(page, 1); await sheet.locator('[data-act=start-move]').tap(); await page.waitForTimeout(300);
    const r = await page.evaluate(async () => {
      const T = window.__toon, wrap = document.querySelector('.stagewrap'), b = wrap.getBoundingClientRect(), ev = (type, id, x, y) => wrap.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, pointerType: 'touch', isPrimary: id === 1, bubbles: true, cancelable: true }));
      const cx = b.left + b.width / 2, cy = b.top + b.height / 2, z = () => T.stage.frameAt([], T.player.time).zoom, z0 = z();
      ev('pointerdown', 1, cx - 30, cy); ev('pointerdown', 2, cx + 30, cy);
      ev('pointermove', 1, cx - 90, cy); ev('pointermove', 2, cx + 90, cy); const wide = z();
      ev('pointermove', 1, cx - 15, cy); ev('pointermove', 2, cx + 15, cy); const narrow = z();
      ev('pointermove', 1, cx - 2000, cy); ev('pointermove', 2, cx + 2000, cy); const max = z();
      ev('pointerup', 1, cx, cy); ev('pointerup', 2, cx, cy);
      return { z0, wide, narrow, max, keys: T.S.camKeys.length };
    });
    expect(r.wide).toBeGreaterThan(r.z0 * 1.5); expect(r.narrow).toBeLessThan(r.wide); expect(r.max).toBeLessThanOrEqual(6.001); expect(r.keys).toBe(2);          // the point at the playhead is edited, none is added
  });

  test('a double tap on the picture while the camera sheet is open changes nothing', async ({ page }) => {
    test.setTimeout(120000);
    await open(page, { chr: false });
    const sheet = await sheetOpen(page, 1); await sheet.locator('[data-act=start-move]').tap(); await page.waitForTimeout(300);
    const snap = () => page.evaluate(() => { const S = window.__toon.S; return { keys: S.camKeys.length, camSel: S.camSel, sheet: !document.querySelector('.cam-sheet').hidden, t: window.__toon.player.time }; });
    const base = await snap(), box = await page.locator('.stagewrap').boundingBox();
    for (const [fx, fy] of [[0.5, 0.5], [0.1, 0.1]]) { const x = box.x + box.width * fx, y = box.y + box.height * fy; await page.touchscreen.tap(x, y); await page.waitForTimeout(60); await page.touchscreen.tap(x, y); await page.waitForTimeout(300); }
    expect(await snap()).toEqual(base);
  });
});

test.describe('follow', () => {
  test.use({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  test('Follow keeps the character in the frame from A to B, even when A is still at 1x', async ({ page }) => {
    test.skip(!existsSync(ZIP), 'needs a character ZIP');
    test.setTimeout(150000);
    await open(page, { bg: true, chr: true });
    await page.locator('.tl-cats .tl-cat', { hasText: 'Characters' }).tap(); await page.getByRole('button', { name: 'Camera', exact: true }).tap();
    const sheet = page.locator('.cam-sheet'); await sheet.locator('[data-act=start-move]').tap(); await page.waitForTimeout(300);
    await sheet.locator('[data-point=A]').tap();                                   // A is at 1x: the camera must still really follow
    await sheet.locator('.cam-more > summary').tap(); await sheet.locator('[data-follow=actor1]').tap(); await page.waitForTimeout(3500);
    const r = await page.evaluate(() => { const T = window.__toon, l = T.stage.layers[0], b = l.box, mid = (b.x0 + b.x1) / 2, ks = [...T.S.camKeys].sort((a, c) => a.t - c.t); const f = T.stage.frameAt([], (ks[0].t + ks.at(-1).t) / 2); return { n: ks.length, zoom: Math.min(...ks.map((k) => k.zoom)), inside: mid >= f.x0 && mid <= f.x1, box: [Math.round(b.x0), Math.round(b.x1)], frame: [Math.round(f.x0), Math.round(f.x1)] }; });
    expect(r.n).toBeGreaterThan(3); expect(r.zoom).toBeGreaterThanOrEqual(1.4); expect(r.inside).toBe(true);
  });
});

test.describe('panel sliders', () => {
  test.use({ viewport: { width: 1366, height: 800 } });
  test('the camera panel keeps a point inside the picture: sliders, quick framing and the Camera view button', async ({ page }) => {
    test.setTimeout(120000);
    await open(page, { chr: false }); await toCamera(page);
    await page.evaluate(() => window.__toon.player.seek(1)); await page.locator('.panel button', { hasText: 'Keyframe here' }).click();
    const set = (idx, v) => page.locator('.panel .cs-sl input[type=range]').nth(idx).evaluate((el, val) => { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, String(v));
    await set(1, 0.95); await set(0, 3);                       // far right, then zoom in: the stored centre must stay reachable
    let k = (await keysOf(page))[0]; expect(k[1]).toBeCloseTo(3, 1); expect(k[2]).toBeLessThanOrEqual(1 - 0.5 / 3 + 1e-3);
    await set(0, 1); k = (await keysOf(page))[0]; expect(k[2]).toBeCloseTo(0.5, 2);          // back to 1x: the whole picture, centred
    await page.getByRole('button', { name: /Camera view: off/ }).click(); await expect(page.getByRole('button', { name: /Camera view: on/ })).toBeVisible();
    await expect(page.locator('.camframe')).toBeHidden();                                      // the final picture is shown without the box
    await page.getByRole('button', { name: /Camera view: on/ }).click(); await expect(page.locator('.camframe')).toBeVisible();
  });
});

test.describe('phone long flow', () => {
  test.use({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  test('A to B with real finger touches: drag the box and a corner, pinch, joystick, a middle point, change the timing, play it, see the end, remove it', async ({ page }) => {
    test.setTimeout(240000);
    const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('dialog', (d) => d.accept());
    await open(page);
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1 })) });
    const drag = async (from, to, steps = 8) => { await touch('touchStart', [from]); for (let i = 1; i <= steps; i++) await touch('touchMove', [{ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }]); await touch('touchEnd', []); await page.waitForTimeout(150); };
    const pinch = async (c, d0, d1, steps = 8) => { const pts = (d) => [{ x: c.x - d / 2, y: c.y }, { x: c.x + d / 2, y: c.y }]; await touch('touchStart', pts(d0)); for (let i = 1; i <= steps; i++) await touch('touchMove', pts(d0 + (d1 - d0) * i / steps)); await touch('touchEnd', []); await page.waitForTimeout(150); };
    const info = () => page.evaluate(() => { const S = window.__toon.S; return { keys: S.camKeys.map((k) => ({ t: k.t, z: k.zoom, cx: k.cx, cy: k.cy })).sort((a, b) => a.t - b.t), scrollY: window.scrollY, scale: window.visualViewport.scale }; });
    await page.locator('.tl-cats .tl-cat', { hasText: 'Characters' }).tap(); await page.getByRole('button', { name: 'Camera', exact: true }).tap();
    const sheet = page.locator('.cam-sheet'); await sheet.locator('[data-act=start-move]').tap(); await page.waitForTimeout(400);
    let i0 = await info(); expect(i0.keys.length).toBe(2);
    // B: a finger drags the box, then a corner; two fingers pinch the picture
    let b = await page.locator('.camframe').boundingBox();
    await drag({ x: b.x + b.width / 2, y: b.y + b.height / 2 }, { x: b.x + b.width / 2 + 50, y: b.y + b.height / 2 + 15 });
    let i1 = await info(); expect(i1.keys[1].cx).toBeGreaterThan(i0.keys[1].cx); expect(i1.keys.length).toBe(2);
    const hd = await page.locator('.camhd.c-br').boundingBox(); expect(hd.width).toBeGreaterThanOrEqual(28);
    await drag({ x: hd.x + hd.width / 2, y: hd.y + hd.height / 2 }, { x: hd.x + hd.width / 2 - 25, y: hd.y + hd.height / 2 - 12 });
    const i2 = await info(); expect(i2.keys[1].z).toBeGreaterThan(i1.keys[1].z);
    const sb = await page.locator('.stagewrap').boundingBox();
    await pinch({ x: sb.x + sb.width / 2, y: sb.y + sb.height / 2 }, 160, 130); const i3 = await info(); expect(i3.keys[1].z).toBeLessThan(i2.keys[1].z);
    expect(i3.scrollY).toBe(0); expect(i3.scale).toBe(1);                                        // the page did not scroll or zoom under the finger
    // More options: the joystick, then a middle point
    await sheet.locator('.cam-more > summary').tap(); await page.waitForTimeout(300);
    const joy = page.locator('.cam-sheet .joy'); await joy.scrollIntoViewIfNeeded(); const jb = await joy.boundingBox();
    await touch('touchStart', [{ x: jb.x + jb.width / 2, y: jb.y + jb.height / 2 }]); await touch('touchMove', [{ x: jb.x + jb.width / 2 + 40, y: jb.y + jb.height / 2 }]); await page.waitForTimeout(500); await touch('touchEnd', []); await page.waitForTimeout(200);
    const i4 = await info(); expect(i4.keys[1].cx).toBeGreaterThan(i3.keys[1].cx);
    await page.evaluate(() => window.__toon.player.seek(1.5)); await sheet.locator('[data-act=add-point]').tap(); await page.waitForTimeout(300);
    const mid0 = await info(); expect(mid0.keys.length).toBe(3);
    // the move is made longer / later: the middle point stays between A and B at the same share of the way
    await sheet.locator('[data-point=A]').tap(); await sheet.getByRole('button', { name: 'Starts at: more' }).tap(); await sheet.getByRole('button', { name: 'Takes: less' }).tap(); await page.waitForTimeout(200);
    const i5 = await info(); expect(i5.keys[0].t).toBeCloseTo(0.5, 1); expect(i5.keys[1].t).toBeGreaterThan(i5.keys[0].t); expect(i5.keys[1].t).toBeLessThan(i5.keys[2].t); expect(i5.keys[2].t).toBeCloseTo(3, 1);
    // play it: the camera really goes from A toward B and stays inside the picture
    await sheet.locator('[data-act=play-move]').first().tap(); await page.waitForTimeout(300);
    const seen = []; for (let i = 0; i < 10; i++) { seen.push(await page.evaluate(() => { const T = window.__toon, f = T.stage.frameAt([], T.player.time); return { t: T.player.time, z: f.zoom, x0: f.x0, x1: f.x1, y0: f.y0, y1: f.y1 }; })); await page.waitForTimeout(450); }
    expect(seen.at(-1).z).toBeGreaterThan(seen[0].z); for (const f of seen) { expect(f.x0).toBeGreaterThanOrEqual(-0.5); expect(f.x1).toBeLessThanOrEqual(1280.5); expect(f.y0).toBeGreaterThanOrEqual(-0.5); expect(f.y1).toBeLessThanOrEqual(720.5); }
    // remove it: back to the automatic shots
    await page.locator('.tl-cats .tl-cat', { hasText: 'Characters' }).tap().catch(() => {}); await page.getByRole('button', { name: 'Camera', exact: true }).tap().catch(() => {});
    await page.locator('.cam-sheet [aria-label="Remove the camera move"]').tap(); await page.waitForTimeout(300);
    expect((await info()).keys.length).toBe(0);
    expect(errors).toEqual([]);
  });
});
