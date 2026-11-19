import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { open } from './cam-helpers.js';
test.use({ viewport: { width: 1366, height: 800 } });
// The camera move set up in the studio is the one in the exported video: a pan right on a red | grey | blue picture ends on the blue side.
test('exported video: Pan right starts on the red left side and ends further right, where the picture is blue', async ({ page }) => {
  test.setTimeout(240000);
  const errors = []; page.on('console', (m) => { if (/export failed|parallel export failed/i.test(m.text())) errors.push(m.text()); });
  await open(page, { chr: false, workers: 1 });
  await page.evaluate(() => { const S = window.__toon.S; S.fps = 30; S.quality = 360; window.__toon.S.dirty = true; });
  await page.evaluate(() => window.__toon.openTab('camera')); await page.waitForTimeout(400);
  await page.evaluate(() => { window.__toon.player.seek(0.2); });
  await page.evaluate(() => { window.__toon.S.camKeys = []; }); await page.locator('[data-preset=5s], .seg button', { hasText: '5 s' }).first().click().catch(() => {});
  await page.locator('[data-preset=pan-right]').click(); await page.waitForTimeout(300);
  await page.evaluate(() => { const T = window.__toon; T.S.camPeek = false; T.commitClips(); });
  const download = page.waitForEvent('download', { timeout: 200000 });
  await page.locator('#app .hdr-tools').getByRole('button', { name: 'Export', exact: true }).click(); await page.locator('.exp-pop-go').click();
  const file = await download; const bytes = await readFile(await file.path()); expect(bytes.length).toBeGreaterThan(2000);
  const out = await page.evaluate(async ([b64, mime]) => {
    const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: mime }), v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(blob);
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('the exported video does not play here')); });
    const c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true }), r = {};
    for (const t of [0.1, v.duration * 0.5, Math.max(0.1, v.duration - 0.2)]) { v.currentTime = t; await new Promise((x) => { v.onseeked = x; }); c.width = v.videoWidth; c.height = v.videoHeight; g.drawImage(v, 0, 0); let sum = 0, n = 0; for (let i = 1; i < 20; i++) { const d = g.getImageData(Math.round(c.width * i / 20), Math.round(c.height * 0.08), 2, 2).data; sum += d[2] - d[0]; n++; } r[t.toFixed(1)] = sum / n; }
    return { dur: v.duration, r };
  }, [bytes.toString('base64'), file.suggestedFilename().endsWith('.mp4') ? 'video/mp4' : 'video/webm']);
  console.log('EXPORT', JSON.stringify(out));
  const v = Object.values(out.r); expect(v[2]).toBeGreaterThan(v[0] + 35);        // the last frame is bluer than the first: the camera moved right
  expect(errors).toEqual([]);
});
