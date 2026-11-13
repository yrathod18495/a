import { test, expect } from '@playwright/test';
test.use({ viewport: { width: 1366, height: 768 } });
// Dragging the playhead along the ruler must not select the seconds, labels or buttons.
test('dragging the playhead does not select any text', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Select');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  const ruler = page.locator('.tl2 .ruler').last(), box = await ruler.boundingBox();
  await page.mouse.move(box.x + 60, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + box.height / 2, { steps: 12 });
  await page.mouse.move(box.x + 120, box.y + box.height + 40, { steps: 8 });          // also a drag that leaves the ruler
  await page.mouse.up();
  expect(await page.evaluate(() => String(getSelection()))).toBe('');
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.tl2 .ruler')).userSelect)).toBe('none');
  expect(errors).toEqual([]);
});
