import { test, expect } from '@playwright/test';
test.use({ viewport: { width: 1366, height: 700 } });
// A short timeline must still show every layer (rows shrink together) instead of hiding the lower ones under the scroll bar.
test('all layer rows stay inside the visible timeline when it is made short', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Fit');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  await page.evaluate(async () => {
    const { S, stage, drawTimeline } = window.__toon, mk = () => { const c = document.createElement('canvas'); c.width = c.height = 16; return new Promise((r) => c.toBlob(r)); };
    await stage.setBackgroundClips([{ start: 0, dur: 5, preset: 0, blob: await mk() }], true);
    for (let i = 0; i < 4; i++) S.props.push({ id: `p${i}`, name: `Box ${i}`, kind: 'prop', blob: await mk(), natW: 16, natH: 16, x: 0.3, y: 0.5, w: 0.1, h: 0.2, rotation: 0, visible: true, shadow: { on: true, angle: 0, length: 1, soft: 0, opacity: 0.5 } });
    await stage.setProps(S.props); drawTimeline();
  });
  const rows = () => page.evaluate(() => { const sc = document.querySelector('.tl-scroll').getBoundingClientRect(), ls = [...document.querySelectorAll('.tl-labels .rl')].map((e) => e.getBoundingClientRect()); return { box: [sc.top, sc.bottom], n: ls.length, last: ls.at(-1).bottom, tops: ls.map((r) => Math.round(r.top)) }; });
  const tall = await rows();
  await page.evaluate(() => { const w = document.querySelector('.tl2'); w.style.height = '200px'; w.style.maxHeight = '200px'; });
  await page.waitForTimeout(400);
  const small = await rows();
  await page.screenshot({ path: '/tmp/claude-0/-home-user-a/3967a7cb-7154-561f-8d0c-7184bb9946ac/scratchpad/tl.png', clip: { x: 230, y: 480, width: 840, height: 220 } });
  expect(small.last).toBeLessThanOrEqual(small.box[1] + 1);
  expect(small.n).toBe(tall.n);
  expect(errors).toEqual([]);
});
