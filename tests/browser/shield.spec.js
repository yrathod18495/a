import { test, expect } from '@playwright/test';

// The shield only starts for signed-in creators in the production build, so the real module is started by hand here.
test('inspect shortcuts and "save image" menus are blocked and reported in a real browser', async ({ page }) => {
  await page.route('**/api/security', r => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug#/');
  await page.evaluate(async () => {
    const { createShield } = await import('/src/shield.js');
    window.__reports = []; window.__notices = [];
    document.body.insertAdjacentHTML('beforeend', '<canvas id="stage" width="40" height="40"></canvas><input id="note" value="text">');
    window.__shield = createShield({ report: async (r) => { window.__reports.push(r); }, notice: (m) => window.__notices.push(m) });
    window.__shield.start();
    window.__menu = (selector) => { const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); document.querySelector(selector).dispatchEvent(e); return e.defaultPrevented; };
  });
  await page.keyboard.press('F12');
  await page.keyboard.press('Control+Shift+I');
  await page.keyboard.press('Control+u');
  await page.keyboard.press('Control+z');            // normal shortcuts keep working
  const reports = await page.evaluate(() => window.__reports);
  expect(reports.map((r) => `${r.kind}:${r.detail}`)).toEqual(['shortcut:F12', 'shortcut:Ctrl+Shift+I', 'view-source:Ctrl+U']);
  expect(await page.evaluate(() => window.__notices.length)).toBe(1);
  expect(await page.evaluate(() => window.__menu('#stage'))).toBe(true);        // no "save image as" on the stage
  expect(await page.evaluate(() => window.__menu('#note'))).toBe(false);        // text fields keep copy / paste
  await page.evaluate(() => window.__shield.stop());
  expect(await page.evaluate(() => window.__menu('#stage'))).toBe(false);
});
