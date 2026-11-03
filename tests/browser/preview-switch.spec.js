import { test, expect } from '@playwright/test';
// Changing the preview quality (Low / Medium / High) only changes how sharp the picture is: nothing in the scene is set again.
test('switching the preview quality keeps the background and props where they were', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Preview');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
  await page.evaluate(async () => {
    const { S, stage } = window.__toon;
    // a background clip moved / shrunk, a red prop at the middle, 
    S.bgClips.push({ id: 'b1', bgId: null, preset: 5, start: 0, dur: 8, xf: { x: 0.1, y: -0.05, s: 0.7 } });
    await stage.setBackgroundClips(S.bgClips.map((c) => ({ start: c.start, dur: c.dur, preset: c.preset, blob: null, xf: c.xf })));
    const c = document.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d'); g.fillStyle = '#ff0000'; g.fillRect(0, 0, 16, 16);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    S.props.push({ id: 'p1', kind: 'prop', name: 'Red', blob, natW: 16, natH: 16, x: 0.5, y: 0.5, w: 0.2, h: 0.3, rotation: 0, visible: true }); await stage.setProps(S.props);
    window.__before = JSON.stringify({ bg: S.bgClips, props: S.props.map(({ blob, ...p }) => p) });
  });
  const probe = () => page.evaluate(() => {
    const { stage } = window.__toon, out = { W: stage.W, H: stage.H };
    const read = (fx, fy) => { const p = new Uint8Array(4), gl = stage.gl; stage.render(1, 0, [], []); gl.readPixels(Math.round(fx * stage.W), Math.round((1 - fy) * stage.H), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p); return [...p]; };
    out.propCentre = read(0.5, 0.5); out.outside = read(0.9, 0.9); out.bgBorder = read(0.02, 0.5);
    return out;
  });
  const medium = await probe();
  for (const mode of ['low', 'high', 'medium']) {
    await page.getByLabel('Preview quality').selectOption(mode); await expect(page.locator('.busy')).toHaveCount(0, { timeout: 30000 });
    const now = await probe(), kept = await page.evaluate(() => JSON.stringify({ bg: window.__toon.S.bgClips, props: window.__toon.S.props.map(({ blob, ...p }) => p) }));
    expect(kept).toBe(await page.evaluate(() => window.__before));                         // nothing in the project was changed
    expect(now.propCentre[0]).toBeGreaterThan(200); expect(now.propCentre[1]).toBeLessThan(60);          // the red prop is in the middle in every mode
    expect(now.outside).not.toEqual(now.propCentre);
    expect(now.bgBorder).toEqual(medium.bgBorder);                                                        // the moved / shrunk background is the same (the dimmed border too)
    console.log('MODE', mode, now.W, now.H);
  }
});
