import { test, expect } from '@playwright/test';
// Deleting a character: the card shows a moving bar at once, leaves the screen when the server says done, and does not come back from an older copy of the list.
test('admin delete shows progress, removes the card, and a stale list does not bring it back', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  const chars = [{ id: 'aaaaaaaa1', name: 'Dayan', category: 'c1', categoryName: 'Chudail', views: { f34: { label: '3/4 Front' } }, animations: { f34: { animations: [] } } }];
  await page.route('**/api/studio-assets', async (route) => {
    const b = route.request().postDataJSON(), a = String(b.action);
    if (a === 'character:list') return route.fulfill({ json: { characters: chars } });          // this list is "old": it still has the character after the delete
    if (a === 'character:delete') { await new Promise((r) => setTimeout(r, 1200)); return route.fulfill({ json: { ok: true, removedFiles: 3 } }); }
    return route.fulfill({ json: { assets: [] } });
  });
  await page.goto('/?debug#/hub');
  await page.evaluate(async () => { const { charactersView } = await import('/src/admin-characters.js'); document.querySelector('#shell').replaceChildren(await charactersView({ home() {}, back() {}, toast: (m) => { window.__toast = m; } })); });
  const card = page.locator('.admin-character-card');
  await expect(card).toHaveCount(1);
  page.once('dialog', (d) => d.accept());
  await card.getByRole('button', { name: 'Delete' }).click();
  await expect(card.locator('.work-overlay')).toContainText('Deleting');
  await expect(card.locator('.work-bar')).toBeVisible();
  await expect(card).toHaveCount(0, { timeout: 8000 });
  await page.waitForTimeout(800);                    // the list is read again in the background: the stale answer must not bring it back
  await expect(card).toHaveCount(0);
  expect(await page.evaluate(() => window.__toast)).toMatch(/Dayan was deleted/);
  expect(errors).toEqual([]);
});
