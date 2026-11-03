import { test, expect } from '@playwright/test';

const PLAN = (tier) => `
  export const FREE_PLAN = { tier: 'free', limitSeconds: 60, verified: false };
  const plan = { tier: ${JSON.stringify(tier)}, limitSeconds: 600, verified: true };
  export const currentPlan = () => plan; export const refreshPlan = async () => plan;
  export class ExportLimitError extends Error {} export const authorizeExport = async () => ({ grantId: null, tier: plan.tier }); export const finishExport = () => {};`;

async function studio(page, tier) {
  await page.setViewportSize({ width: 1366, height: 800 });
  if (tier) await page.route('**/src/export-plan.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: PLAN(tier) }));
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Paid items');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.locator('#app .stagebox canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
  await page.evaluate(async () => {
    const { S, sharedBlobs } = window.__toon;
    const solid = async (c) => { const el = document.createElement('canvas'); el.width = el.height = 4; const g = el.getContext('2d'); g.fillStyle = c; g.fillRect(0, 0, 4, 4); return new Promise((r) => el.toBlob(r, 'image/png')); };
    for (const id of ['prop-crown', 'prop-stick', 'fx-rain', 'fx-glow', 'bg-sky', 'bg-park']) sharedBlobs.set(id, await solid('#00ff00'));
    S.sharedAssets.push(
      { id: 'prop-crown', type: 'prop', name: 'Crown', category: 'Royal', thumb: 'data:image/webp;base64,AAAA', updatedAt: '1' },                       // no setting: paid only
      { id: 'prop-stick', type: 'prop', name: 'Stick', category: 'Basic', access: 'free', thumb: 'data:image/webp;base64,AAAA', updatedAt: '2' },
      { id: 'fx-rain', type: 'effect', name: 'Rain', category: 'Weather', blend: 'normal', opacity: 1, placement: 'full', updatedAt: '3' },
      { id: 'fx-glow', type: 'effect', name: 'Glow', category: 'Light', access: 'free', blend: 'add', opacity: 0.5, placement: 'full', updatedAt: '4' },
      { id: 'bg-sky', type: 'background', name: 'Sky', updatedAt: '5', size: 10, mime: 'image/png', key: 'assets/' + 'a'.repeat(64) },
      { id: 'bg-park', type: 'background', name: 'Park', access: 'free', updatedAt: '6', size: 10, mime: 'image/png', key: 'assets/' + 'b'.repeat(64) });
  });
}
const toastText = (page) => page.locator('.toast').last().textContent();

test('a free account sees every prop and effect but can add only the ones marked free; paid-only ones show a lock', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await studio(page);                                                                      // the debug session is a free account
  await page.evaluate(() => window.__toon.openTab('props'));
  const crown = page.locator('.lib-card').filter({ hasText: 'Crown' }), stick = page.locator('.lib-card').filter({ hasText: 'Stick' });
  await expect(page.locator('.lib-card')).toHaveCount(2);                                  // both are listed (everyone sees all)
  await expect(crown).toHaveClass(/locked/); await expect(crown.locator('.lock-badge')).toContainText('Paid'); await expect(crown).toContainText('Paid accounts only');
  await expect(crown.locator('img')).toBeVisible();                                         // the picture is still shown
  await expect(stick).not.toHaveClass(/locked/);
  await crown.click({ force: true });                                                       // aria-disabled: Playwright needs force, a person can just tap
  await expect(page.locator('.toast').last()).toHaveText('This item is for paid accounts. Buy Coins to unlock it.');
  expect(await page.evaluate(() => window.__toon.S.props.length)).toBe(0);                  // nothing was added
  await stick.click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.map((p) => p.name))).toEqual(['Stick']);
  await page.evaluate(() => window.__toon.openTab('effects'));
  await expect(page.locator('.lib-card')).toHaveCount(2);
  await page.locator('.lib-card').filter({ hasText: 'Rain' }).click({ force: true });
  await expect(page.locator('.toast').last()).toContainText('paid accounts');
  expect(await page.evaluate(() => window.__toon.S.props.filter((p) => p.kind === 'effect').length)).toBe(0);
  await page.locator('.lib-card').filter({ hasText: 'Glow' }).click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.filter((p) => p.kind === 'effect').length)).toBe(1);
  expect(errors).toEqual([]);
});

test('a paid account can add every item, locked or not', async ({ page }) => {
  await studio(page, 'paid');
  await page.evaluate(() => window.__toon.openTab('props'));
  await expect(page.locator('.lock-badge')).toHaveCount(0);
  await page.locator('.lib-card').filter({ hasText: 'Crown' }).click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.map((p) => p.name))).toEqual(['Crown']);
  await page.evaluate(() => window.__toon.openTab('effects'));
  await page.locator('.lib-card').filter({ hasText: 'Rain' }).click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.filter((p) => p.kind === 'effect').length)).toBe(1);
});

test('backgrounds: a free account sees all, and cannot add a paid-only one', async ({ page }) => {
  await studio(page);
  await page.evaluate(() => window.__toon.openTab('canvas'));
  const sky = page.locator('.studio-shared-card').filter({ hasText: 'Sky' }), park = page.locator('.studio-shared-card').filter({ hasText: 'Park' });
  await expect(sky).toHaveClass(/locked/); await expect(sky.locator('.lock-badge')).toContainText('Paid'); await expect(park).not.toHaveClass(/locked/);
  await sky.click({ force: true });
  await expect(page.locator('.toast').last()).toContainText('This item is for paid accounts');
  expect(await page.evaluate(() => window.__toon.S.myBgs.length)).toBe(0);
});

test('the hand props of a character are locked in the same way', async ({ page }) => {
  await studio(page);
  await page.evaluate(() => { const { S } = window.__toon; S.sharedAssets.push({ id: 'prop-cup', type: 'prop', name: 'Cup', group: 'hand', updatedAt: '9' }, { id: 'prop-pen', type: 'prop', name: 'Pen', group: 'hand', access: 'free', updatedAt: '10' }); S.speakers.push({ key: 'actor9', name: 'Asha', color: '#f00', charId: 'lib:test', visible: true }); S.sel = 'actor9'; window.__toon.openTab('props'); });
  const cup = page.locator('.hand-card').filter({ hasText: 'Cup' }), pen = page.locator('.hand-card').filter({ hasText: 'Pen' });
  await expect(cup).toHaveClass(/locked/); await expect(pen).not.toHaveClass(/locked/);
  await cup.click({ force: true }); await expect(page.locator('.toast').last()).toContainText('paid accounts');
  expect(await page.evaluate(() => window.__toon.S.props.length)).toBe(0);
});

test('admin: every props / effects / background item can be switched between paid-only and free, and new uploads can be set too', async ({ page }) => {
  const calls = [];
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.route('**/src/studio-assets.js*', (route) => route.fulfill({ contentType: 'text/javascript', body: `
    const assets = [{ id: 'p1', type: 'prop', name: 'Crown', category: 'Royal', size: 2048, updatedAt: '2026-01-01' }, { id: 'p2', type: 'prop', name: 'Stick', category: 'Basic', size: 2048, access: 'free', updatedAt: '2026-01-01' }, { id: 'b1', type: 'background', name: 'Sky', size: 2048, updatedAt: '2026-01-01' }, { id: 'e1', type: 'effect', name: 'Rain', category: 'Weather', size: 2048, updatedAt: '2026-01-01' }];
    window.__calls = [];
    export const listStudioAssets = async () => assets.map((a) => ({ ...a }));
    export const saveStudioAsset = async (type, name, file, meta) => { window.__calls.push(['save', type, name, meta?.access]); assets.push({ id: 'n' + assets.length, type, name, size: 1, updatedAt: '2026-01-02', ...(meta?.access === 'free' ? { access: 'free' } : {}) }); return {}; };
    export const setAssetAccess = async (id, access) => { window.__calls.push(['access', id, access]); const a = assets.find((x) => x.id === id); if (access === 'free') a.access = 'free'; else delete a.access; return { ...a }; };
    export const setPropGroup = async () => ({}); export const saveStudioAnimation = async () => ({}); export const loadStudioAnimation = async () => ({});
    export const deleteStudioAsset = async () => {}; export const downloadStudioAsset = async () => new Blob(['x'], { type: 'image/png' });
  ` }));
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug#/hub');
  // props and effects page
  await page.evaluate(async () => { const { propsEffectsView } = await import('/src/admin-props-effects.js'); document.querySelector('#shell').replaceChildren(await propsEffectsView({ home: () => {}, back: () => {}, toast: (m) => { window.__toast = m; } })); });
  await expect(page.getByLabel('Who can use Crown')).toHaveValue('paid');                      // no setting = paid only
  await expect(page.getByLabel('Who can use Stick')).toHaveValue('free');
  await page.getByLabel('Who can use Crown').selectOption('free');
  await expect.poll(() => page.evaluate(() => window.__calls)).toContainEqual(['access', 'p1', 'free']);
  await expect.poll(() => page.evaluate(() => window.__toast)).toBe('Crown is now free for everyone.');
  await page.getByLabel('Who can use Stick').selectOption('paid');
  await expect.poll(() => page.evaluate(() => window.__calls)).toContainEqual(['access', 'p2', 'paid']);
  await expect.poll(() => page.evaluate(() => window.__toast)).toBe('Stick is now for paid accounts only.');
  await expect(page.getByLabel('Who can use it', { exact: true })).toHaveValue('paid');        // a new upload is paid-only unless chosen
  await page.getByLabel('Who can use it', { exact: true }).selectOption('free');
  await page.getByLabel('Image file').setInputFiles({ name: 'hat.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') });
  await page.getByRole('button', { name: 'Publish prop', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__calls)).toContainEqual(['save', 'prop', 'hat', 'free']);
  // effects
  await page.getByRole('tab', { name: /Effects/ }).click();
  await page.getByLabel('Who can use Rain').selectOption('free');
  await expect.poll(() => page.evaluate(() => window.__calls)).toContainEqual(['access', 'e1', 'free']);
  // backgrounds (Add Assets)
  await page.evaluate(async () => { const { assetsView } = await import('/src/admin-assets.js'); document.querySelector('#shell').replaceChildren(await assetsView({ user: { uid: 'admin-review' }, home: () => {}, back: () => {}, toast: (m) => { window.__toast = m; } })); });
  await page.getByRole('tab', { name: /Add Background/ }).click();
  await expect(page.getByLabel('Who can use Sky')).toHaveValue('paid');
  await page.getByLabel('Who can use Sky').selectOption('free');
  await expect.poll(() => page.evaluate(() => window.__calls)).toContainEqual(['access', 'b1', 'free']);
  await expect(page.getByLabel('Who can use new uploads')).toHaveValue('paid');
});
