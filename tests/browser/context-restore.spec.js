import { test, expect } from '@playwright/test';
test.use({ viewport: { width: 390, height: 800 } });
// A phone takes the graphics memory away when the page goes to the background: the picture must come back by itself.
test('after the graphics context is lost and restored, the background and the props are drawn again', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Ctx');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  await page.evaluate(async () => {
    const { S, stage } = window.__toon, mk = async (col) => { const c = document.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d'); g.fillStyle = col; g.fillRect(0, 0, 16, 16); return new Promise((r) => c.toBlob(r)); };
    await stage.setBackgroundClips([{ start: 0, dur: 5, preset: 0, blob: await mk('#2040c0') }], true);
    S.props.push({ id: 'p1', name: 'Box', kind: 'prop', blob: await mk('#ffffff'), natW: 16, natH: 16, x: 0.5, y: 0.5, w: 0.2, h: 0.3, rotation: 0, visible: true });
    await stage.setProps(S.props);
  });
  const sample = () => page.evaluate(() => {
    const { stage } = window.__toon; stage.render(0.5, 0, [], []);
    const c = document.createElement('canvas'); c.width = stage.out.width; c.height = stage.out.height; const g = c.getContext('2d'); g.drawImage(stage.out, 0, 0);
    const at = (fx, fy) => [...g.getImageData(Math.round(fx * c.width), Math.round(fy * c.height), 1, 1).data].slice(0, 3);
    return { bg: at(0.1, 0.1), prop: at(0.5, 0.5) };
  });
  const before = await sample();
  expect(before.bg[2]).toBeGreaterThan(120); expect(before.prop[0]).toBeGreaterThan(200);
  await page.evaluate(() => { const gl = window.__toon.stage.gl; window.__ext = gl.getExtension('WEBGL_lose_context'); window.__ext.loseContext(); });
  await page.waitForFunction(() => window.__toon.stage.lost === true);
  await page.evaluate(() => window.__ext.restoreContext());
  await page.waitForFunction(() => window.__toon.stage.lost === false);
  const after = await sample();
  expect(after).toEqual(before);
  expect(errors).toEqual([]);
});

test('a context that is never restored gets a new canvas when the page is back in the foreground', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Ctx');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  await page.evaluate(async () => {
    const { S, stage } = window.__toon, mk = async (col) => { const c = document.createElement('canvas'); c.width = c.height = 16; const g = c.getContext('2d'); g.fillStyle = col; g.fillRect(0, 0, 16, 16); return new Promise((r) => c.toBlob(r)); };
    await stage.setBackgroundClips([{ start: 0, dur: 5, preset: 0, blob: await mk('#2040c0') }], true);
    S.props.push({ id: 'p1', name: 'Box', kind: 'prop', blob: await mk('#ffffff'), natW: 16, natH: 16, x: 0.5, y: 0.5, w: 0.2, h: 0.3, rotation: 0, visible: true });
    await stage.setProps(S.props);
  });
  const sample = () => page.evaluate(() => {
    const { stage } = window.__toon; stage.render(0.5, 0, [], []);
    const c = document.createElement('canvas'); c.width = stage.out.width; c.height = stage.out.height; const g = c.getContext('2d'); g.drawImage(stage.out, 0, 0);
    const at = (fx, fy) => [...g.getImageData(Math.round(fx * c.width), Math.round(fy * c.height), 1, 1).data].slice(0, 3);
    return { bg: at(0.1, 0.1), prop: at(0.5, 0.5) };
  });
  const before = await sample();
  await page.evaluate(() => { const T = window.__toon; T.old = T.stage.out; T.stage.gl.getExtension('WEBGL_lose_context').loseContext(); });
  await page.waitForFunction(() => window.__toon.stage.lost === true);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(() => window.__toon.stage.lost === false && window.__toon.stage.out !== window.__toon.old, null, { timeout: 8000 });
  expect(await page.evaluate(() => !!window.__toon.stage.out.isConnected && !window.__toon.old.isConnected)).toBe(true);
  expect(await sample()).toEqual(before);
  expect(errors).toEqual([]);
});
