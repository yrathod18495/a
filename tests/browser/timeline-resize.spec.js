import { test, expect } from '@playwright/test';

async function studio(page) {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Resize');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.locator('#app .stagebox canvas')).toBeVisible();
}
const height = (page) => page.locator('.tlwrap').evaluate((el) => el.getBoundingClientRect().height);

test('the timeline has a visible bar that can be dragged, and a button to make it taller', async ({ page }) => {
  await studio(page);
  const grip = page.locator('.resize-tl .tl-grip');
  await expect(grip).toBeVisible();
  const normal = await height(page);
  const box = await page.locator('.resize-tl').boundingBox();
  await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - 100, box.y - 90, { steps: 6 }); await page.mouse.up();
  expect(await height(page)).toBeGreaterThan(normal + 60);
  await page.locator('.resize-tl').dblclick({ position: { x: 150, y: 8 } });          // double-click the bar: back to normal
  expect(Math.abs((await height(page)) - normal)).toBeLessThan(3);
  await page.locator('.tl-toggle').click();
  expect(await height(page)).toBeGreaterThan(normal + 100);
  await page.locator('.tl-toggle').click();
  expect(Math.abs((await height(page)) - normal)).toBeLessThan(3);
});

test('the edit buttons sit in the same row as the zoom buttons', async ({ page }) => {
  await studio(page);
  const zoom = await page.getByRole('button', { name: 'Zoom in timeline' }).boundingBox(), split = await page.locator('.edit-split').boundingBox();
  expect(Math.abs(zoom.y - split.y)).toBeLessThan(8);
  await expect(page.locator('.edit-split')).toBeVisible();
});
