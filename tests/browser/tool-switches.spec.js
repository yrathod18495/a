import { test, expect } from '@playwright/test';
// The admin switches studio tools off: a normal user stops seeing them at once (no reload), an admin still sees them, lighter.
async function open(page, size, features = {}) {
  await page.setViewportSize(size);
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false, features } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Tools');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  await page.locator('.panel.open .sheet-close button').click({ timeout: 3000 }).catch(() => {});
}
const flags = (page, features, admin) => page.evaluate(async ([f, a]) => { (await import('/src/tool-flags.js')).setToolFlags(f, a); }, [features, admin]);
test('PC: a tool switched off disappears for a user at once and shows lighter for an admin; Export too', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await open(page, { width: 1366, height: 800 });
  await page.locator('.rail-more summary').click();
  await expect(page.locator('.rail-btn', { hasText: 'Tears' })).toBeVisible(); await expect(page.locator('.export-btn')).toBeVisible();
  await flags(page, { tool_tears: false, tool_export: false, tool_skills: false }, false);
  await expect(page.locator('.rail-btn', { hasText: 'Tears' })).toHaveCount(0); await expect(page.locator('.rail-btn', { hasText: 'Skills' })).toHaveCount(0);
  await expect(page.locator('.export-btn')).toBeHidden();
  await expect(page.locator('.rail-btn', { hasText: 'Camera' })).toHaveCount(1);                         // the others stay
  expect(await page.evaluate(async () => { const T = window.__toon; T.openTab('tears'); return T.S.tab; })).not.toBe('tears');          // a tool that is off cannot be opened another way
  await flags(page, { tool_tears: false, tool_export: false, tool_skills: false }, true);               // the same switches, seen by an admin
  await page.locator('.rail-more summary').click().catch(() => {});
  const tears = page.locator('.rail-btn', { hasText: 'Tears' });
  await expect(tears).toBeVisible(); await expect(tears).toHaveClass(/tool-off/); await expect(tears).toHaveAttribute('title', /off for users/);
  await expect(page.locator('.export-btn')).toBeVisible(); await expect(page.locator('.export-btn')).toHaveClass(/tool-off/);
  expect(Number(await tears.evaluate((e) => getComputedStyle(e).opacity))).toBeLessThan(0.8);
  await flags(page, {}, true);                                                                           // switched on again
  await expect(page.locator('.rail-btn', { hasText: 'Tears' })).not.toHaveClass(/tool-off/);
  expect(errors).toEqual([]);
});
test('phone: a tool switched off is gone from the bottom bar and from More tools', async ({ page }) => {
  await open(page, { width: 390, height: 800 });
  await page.locator('.tl-cats .tl-cat', { hasText: 'Characters' }).click();
  await expect(page.locator('.tabs-scroll > button[title="Animations"]')).toHaveCount(1);
  await flags(page, { tool_anim: false, tool_skills: false, tool_tears: false }, false);
  await expect(page.locator('.tabs-scroll > button[title="Animations"]')).toHaveCount(0);
  await page.locator('.advanced-tools summary').click();
  await expect(page.locator('.advanced-tools-list button', { hasText: 'Tears' })).toHaveCount(0); await expect(page.locator('.advanced-tools-list button', { hasText: 'Skills' })).toHaveCount(0);
  await expect(page.locator('.advanced-tools-list button', { hasText: 'Camera' })).toHaveCount(1);
});
test('the studio follows the server by itself: within about half a minute a tool the admin switched off is gone, without a reload', async ({ page }) => {
  test.setTimeout(90000);
  let off = false;
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false, features: off ? { tool_tears: false } : {} } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Poll'); await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.waitForFunction(() => window.__toon?.S.ready);
  await page.locator('.rail-more summary').click();
  await expect(page.locator('.rail-btn', { hasText: 'Tears' })).toBeVisible();
  off = true;
  await expect(page.locator('.rail-btn', { hasText: 'Tears' })).toHaveCount(0, { timeout: 45000 });
});
