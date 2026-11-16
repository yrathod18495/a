import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
const ZIP = process.env.CHARACTER_ZIP || '/home/user/a/deliver/dayan.zip';
// A skill set up in the Skills tool must be in the exported video: on a PC-size window and on a phone-size window, standing on the hand and flying along a path.
for (const [label, size] of [['PC', { width: 1366, height: 800 }], ['phone', { width: 390, height: 800 }]]) {
  test(`${label}: a fire skill (right hand, flies to a point) is in the exported video`, async ({ page }) => {
    test.skip(!existsSync(ZIP), 'needs a character ZIP (CHARACTER_ZIP)');
    test.setTimeout(240000);
    const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (/export failed|parallel export failed/i.test(m.text())) errors.push(m.text()); });
    await page.setViewportSize(size);
    await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
    await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
    await page.goto('/?debug&workers=1#/toons');
    await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
    await page.getByRole('textbox', { name: 'Create a project' }).fill('Skill export');
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    await page.waitForFunction(() => window.__toon?.S.ready);
    await page.locator('.panel.open .sheet-close button').click({ timeout: 3000 }).catch(() => {});
    const zip = readFileSync(ZIP);
    await page.evaluate(async (bytes) => {
      const m = await import('/src/admin-characters.js'), T = window.__toon, { S, stage } = T;
      const pkg = await m.readCharacterZip(new File([new Uint8Array(bytes)], 'd.zip')), def = await m.viewDef(pkg, pkg.manifest.views[0]);
      S.characters.push(def); S.speakers.push({ key: 'actor1', name: 'Dayan', narrator: false, color: '#c06', charId: def.id, flip: false, visible: true, manual: true }); S.order.push('actor1');
      await stage.loadCharacter(def); await T.applyLayers(); S.fps = 30; S.quality = 360; T.drawTimeline(); S.dirty = true;
    }, Array.from(zip));
    // the Skills tool: More tools -> Skills (desktop rail / phone bar)
    if (size.width > 860) { await page.locator('.rail-more summary').click(); await page.locator('.rail-btn', { hasText: 'Skills' }).click(); }
    else { await page.locator('.tl-cats .tl-cat', { hasText: 'Characters' }).click(); await page.locator('.advanced-tools summary').click(); await page.locator('.advanced-tools-list button', { hasText: 'Skills' }).click(); }
    await page.locator('.skill-tile[data-skill="fire"]').click();
    await expect(page.locator('.sk-editor')).toBeVisible();
    await page.evaluate(() => { const T = window.__toon, f = T.S.fx.find((x) => x.skill); f.start = 1; f.end = 4.5; f.ramp = 0.2; T.syncFx(); });          // starts after a second so the video has frames without it
    await page.locator('.sk-editor [data-anchor="handR"]').click();
    await page.locator('.sk-editor [data-move="point"]').click();
    await expect(page.locator('.sk-handle')).toBeVisible();
    expect(await page.evaluate(() => window.__toon.S.fx.find((x) => x.skill).skill.move.mode)).toBe('point');
    // the round handle can be dragged on the picture (an end point on the right side)
    const h = await page.locator('.sk-handle').boundingBox(), cv = await page.locator('.stagewrap canvas').boundingBox();
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down(); await page.mouse.move(cv.x + cv.width * 0.85, cv.y + cv.height * 0.3, { steps: 6 }); await page.mouse.up();
    const to = await page.evaluate(() => window.__toon.S.fx.find((x) => x.skill).skill.move.to);
    expect(to.x).toBeGreaterThan(0.75); expect(to.y).toBeLessThan(0.4);
    await page.evaluate(() => { const T = window.__toon; T.S.fx.find((x) => x.skill).skill.size = 1.4; T.syncFx(); T.commitClips(); });
    // export
    const download = page.waitForEvent('download', { timeout: 180000 });
    const exportBtn = size.width > 860 ? page.locator('#app .hdr-tools').getByRole('button', { name: 'Export', exact: true }) : page.locator('#app').getByRole('button', { name: 'Export', exact: true }).first();
    await exportBtn.click(); await page.locator('.exp-pop-go').click();
    const file = await download; const { readFile } = await import('node:fs/promises'); const bytes = await readFile(await file.path());
    expect(bytes.length).toBeGreaterThan(2000);
    const frames = await page.evaluate(async ([b64, mime]) => {
      const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: mime }), url = URL.createObjectURL(blob), v = document.createElement('video'); v.muted = true; v.src = url;
      await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('the exported video does not play here')); });
      const out = {}; const c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true });
      for (const t of [0.4, 2.0, 3.4]) {
        v.currentTime = t; await new Promise((r) => { v.onseeked = r; }); c.width = v.videoWidth; c.height = v.videoHeight; g.drawImage(v, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0, sx = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 90 && d[i + 1] < 190 && d[i + 2] < 60) { n++; sx += (i / 4) % c.width; }
        out[t] = { n, cx: n ? sx / n / c.width : null };
      }
      return { dur: v.duration, out };
    }, [bytes.toString('base64'), file.suggestedFilename().endsWith('.mp4') ? 'video/mp4' : 'video/webm']);
    console.log('FRAMES', label, JSON.stringify(frames));
    expect(frames.out[0.4].n).toBeLessThan(400);                    // before the skill starts: no fire
    expect(frames.out[2.0].n).toBeGreaterThan(1500);                // the flames are in the video
    expect(frames.out[3.4].cx).toBeGreaterThan(frames.out[2.0].cx);  // and it has flown to the right
    expect(errors).toEqual([]);
  });
}
