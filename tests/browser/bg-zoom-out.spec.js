import { test, expect } from '@playwright/test';
// A background shrunk below 100% must not leave black borders: the rest of the frame shows a dimmed copy of it.
test('a shrunk background is surrounded by a dimmed copy of itself, not black', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Zoom');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
  const px = await page.evaluate(async () => {
    const { S, stage } = window.__toon;
    S.bgClips.push({ id: 'b1', bgId: null, preset: 5, start: 0, dur: 4 });
    await stage.setBackgroundClips(S.bgClips.map((c) => ({ start: c.start, dur: c.dur, preset: c.preset, blob: null })));
    const read = (x, y) => { const p = new Uint8Array(4), gl = stage.gl; gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p); return [...p]; };
    stage.setBgXf(0, null); stage.render(1, 0, [], []); const full = read(6, 6), middle = read(Math.floor(stage.W / 2), Math.floor(stage.H / 2));
    stage.setBgXf(0, { x: 0, y: 0, s: 0.4 }); stage.render(1, 0, [], []); const corner = read(6, 6), centre = read(Math.floor(stage.W / 2), Math.floor(stage.H / 2));
    return { full, corner, centre, middle };
  });
  const lum = (p) => p[0] + p[1] + p[2];
  expect(lum(px.full)).toBeGreaterThan(30);                                  // the preset itself is not black
  expect(lum(px.corner)).toBeGreaterThan(15);                                // the border is not black any more ...
  expect(lum(px.corner)).toBeLessThan(lum(px.full));                         // ... but dimmer than the real background
  expect(px.centre).toEqual(px.middle);                                      // the shrunk picture itself is unchanged
});
