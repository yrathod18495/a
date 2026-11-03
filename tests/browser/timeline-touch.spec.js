import { test, expect } from '@playwright/test';
// Touching the empty timeline on a phone must not leave selection boxes behind.
test('touch on the empty timeline leaves no selection box; mouse box is removed on cancel', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 860 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Touch');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
  const left = await page.evaluate(() => {
    const t = document.querySelector('.tl-inner'), r = t.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + Math.min(r.height - 5, 120);
    const fire = (type, pointerType, dx = 0) => t.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType, clientX: x + dx, clientY: y + dx, button: 0, pointerId: 7 }));
    for (let i = 0; i < 3; i++) { fire('pointerdown', 'touch'); window.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', clientX: x + 30, clientY: y + 30 })); fire('pointercancel', 'touch'); }
    const afterTouch = document.querySelectorAll('.tl-box').length;
    fire('pointerdown', 'mouse'); window.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: x + 30, clientY: y + 30 }));
    const during = document.querySelectorAll('.tl-box').length;
    window.dispatchEvent(new PointerEvent('pointercancel', { pointerType: 'mouse' }));
    return { afterTouch, during, afterCancel: document.querySelectorAll('.tl-box').length };
  });
  expect(left).toEqual({ afterTouch: 0, during: 1, afterCancel: 0 });
});
