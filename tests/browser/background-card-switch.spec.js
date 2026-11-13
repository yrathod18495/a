import { test, expect } from '@playwright/test';

async function hub(page, features) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false, features } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug#/hub');
}

test('the Background Generator card is on the dashboard when it is switched on', async ({ page }) => {
  await hub(page, { animator: true, character: true, background: true });
  await expect(page.getByRole('heading', { name: 'Background Generator' })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('heading', { name: /Animator Studio/ })).toBeVisible();
});

test('when the admin hides it, users do not see the card and cannot open the page either; the other cards stay', async ({ page }) => {
  await hub(page, { animator: true, character: true, background: false });
  await expect(page.getByRole('heading', { name: /Animator Studio/ })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('heading', { name: /Character Editor/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Background Generator' })).toHaveCount(0);
  // typing the address does not get around it
  await page.evaluate(() => { location.hash = '#/background-generator'; });
  await expect(page).toHaveURL(/#\/hub$/);
  await expect(page.getByRole('heading', { name: 'Background Generator' })).toHaveCount(0);
});

test('with every card hidden the dashboard says the tools are not available', async ({ page }) => {
  await hub(page, { animator: false, character: false, background: false });
  await expect(page.getByText('The tools are not available right now.')).toBeVisible({ timeout: 20000 });
});

test('admin: the Overview page has a Background Generator card switch that saves, and a failed save is explained', async ({ page }) => {
  const calls = []; let failSave = false;
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.route('**/api/security', async (r) => {
    const body = r.request().postDataJSON(); calls.push(body);
    if (body.action === 'getMaintenance') return r.fulfill({ json: { maintenance: false, features: { animator: true, character: true, background: true } } });
    if (body.action === 'setFeature') return failSave ? r.fulfill({ status: 500, json: { error: 'The cloud request failed. Please try again.' } }) : r.fulfill({ json: { features: { animator: true, character: true, background: body.enabled } } });
    return r.fulfill({ json: { maintenance: false } });
  });
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug#/');
  await page.evaluate(async () => {
    const m = await import('/src/admin.js'); document.body.innerHTML = '';
    document.body.append(await m.view({ user: { uid: 'u1', email: 'admin@example.com', displayName: 'Admin' }, home() {}, toast(text) { (window.__toasts ||= []).push(text); } }));
  });
  await page.locator('.admin-console-tab', { hasText: 'Overview' }).click();            // the "Access and visibility" switches are on the Overview page
  // the rows have room on both sides: text and switches do not touch the edge of the card (they looked cut off before)
  const gaps = await page.evaluate(() => { const c = document.querySelector('.admin-maint').getBoundingClientRect(); return [...document.querySelectorAll('.admin-maint-row')].map((row) => ({ left: row.querySelector('h2').getBoundingClientRect().left - c.left, right: c.right - row.querySelector('.admin-switch').getBoundingClientRect().right })); });
  expect(gaps.length).toBe(4);
  for (const gap of gaps) { expect(gap.left).toBeGreaterThanOrEqual(12); expect(gap.right).toBeGreaterThanOrEqual(12); }
  const toggle = page.getByRole('switch', { name: 'Background Generator' });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(toggle.locator('xpath=..')).toContainText('Visible');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(toggle.locator('xpath=..')).toContainText('Hidden');
  expect(calls.filter((c) => c.action === 'setFeature')).toEqual([{ action: 'setFeature', feature: 'background', enabled: false }]);
  expect(await page.evaluate(() => window.__toasts.at(-1))).toBe('Background Generator: OFF.');
  failSave = true; await toggle.click();
  await expect.poll(() => page.evaluate(() => window.__toasts.at(-1))).toMatch(/Could not change “Background Generator”/);
  await expect(toggle).toHaveAttribute('aria-checked', 'false');          // still as it was
});
