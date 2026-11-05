import { test, expect } from '@playwright/test';

async function studio(page) {
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.route('**/api/security', r => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', r => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug&workers=0#/toons');
  await page.getByRole('button', { name: 'Create New Project', exact: true }).click();
  await page.getByRole('textbox', { name: 'Create a project' }).fill('Hand props');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.locator('#app .stagebox canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__toon?.S.ready).catch(() => false)).toBe(true);
}

test('hand props stay out of the Objects list and appear in the Props tab of a selected character; a tap asks which hand, then the prop goes into that palm', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await studio(page);
  await page.evaluate(async () => {
    const { S, sharedBlobs } = window.__toon;
    const solid = async (color) => { const c = document.createElement('canvas'); c.width = c.height = 4; const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 4, 4); return new Promise((r) => c.toBlob(r, 'image/png')); };
    sharedBlobs.set('prop-chair', await solid('#00ff00'));
    sharedBlobs.set('prop-cup', await solid('#ff0000'));
    S.sharedAssets.push(
      { id: 'prop-chair', type: 'prop', name: 'Chair', category: 'Furniture', access: 'free', updatedAt: '1' },
      { id: 'prop-cup', type: 'prop', name: 'Cup', category: 'Kitchen', group: 'hand', access: 'free', updatedAt: '2' });
  });
  await page.evaluate(() => window.__toon.openTab('props'));
  // objects are listed as before; the hand prop is not in this list
  await expect(page.locator('.tile').filter({ hasText: 'Chair' })).toHaveCount(1);
  await expect(page.locator('.tile').filter({ hasText: 'Cup' })).toHaveCount(0);
  await page.evaluate(() => window.__toon.openTab('handprops'));
  // no character selected: the hand props are listed anyway; a tap will ask for the character and the hand
  await expect(page.locator('.hand-props')).toContainText('choose the character and the hand');
  await expect(page.locator('.hand-card')).toHaveCount(1);
  // a character is selected (a stand-in actor; the rig itself is not needed for the list)
  await page.evaluate(() => { const { S, stage } = window.__toon; S.speakers.push({ key: 'actor1', name: 'Asha', color: '#f00', charId: 'lib:test', visible: true }); S.order.push('actor1'); stage.layers.push({ key: 'actor1', visible: true, arm: { getBone: () => null }, mat: [1, 0, 0, 1, 0, 0], anchor: { x: 100, y: 300 }, box: { x0: 60, x1: 140, y0: 100, y1: 300 }, anim: new Set() }); S.sel = 'actor1'; });
  await page.evaluate(() => window.__toon.openTab('handprops'));
  await expect(page.locator('.hand-card')).toHaveCount(1);
  await expect(page.locator('.hand-props')).toContainText('Asha');
  await page.locator('.hand-card').click();
  await expect(page.locator('.edit-dock .ed-hand')).toHaveCount(2);          // which hand?
  await page.locator('.edit-dock .ed-hand[data-hand="R"]').click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.length)).toBe(1);
  const cup = await page.evaluate(() => window.__toon.S.props[0]);
  expect([cup.name, cup.assetId, cup.attach, cup.rotation, cup.follow]).toEqual(['Cup', 'prop-cup', { key: 'actor1', hand: 'R' }, 0, false]);          // upright, and it stays upright while the arm swings
  // an object is placed on the stage, not in a hand
  await page.evaluate(() => window.__toon.openTab('props'));
  await page.locator('.tile').filter({ hasText: 'Chair' }).click();
  await expect.poll(() => page.evaluate(() => window.__toon.S.props.length)).toBe(2);
  expect(await page.evaluate(() => window.__toon.S.props[1].attach)).toBeUndefined();
  expect(errors).toEqual([]);
});

test('opening the Hand props tool of a character shows that character\'s hand props', async ({ page }) => {
  await studio(page);
  await page.evaluate(() => {
    const { S } = window.__toon;
    S.sharedAssets.push({ id: 'prop-cup', type: 'prop', name: 'Cup', category: 'Kitchen', group: 'hand', access: 'free', updatedAt: '2' });
    S.speakers.push({ key: 'actor2', name: 'Ravi', color: '#00f', charId: 'lib:test', visible: true });
    window.__toon.openCharTool('actor2', 'handprops');
  });
  expect(await page.evaluate(() => [window.__toon.S.tab, window.__toon.S.sel])).toEqual(['handprops', 'actor2']);
  await expect(page.locator('.hand-props')).toContainText('Ravi');
  await expect(page.locator('.hand-card')).toHaveCount(1);
});

test('admin: choose General or Hand when publishing a prop, and change it later from the prop card', async ({ page }) => {
  const calls = [];
  await page.route('**/src/studio-assets.js*', route => route.fulfill({ contentType: 'text/javascript', body: `
    const assets = [{ id: 'p1', type: 'prop', name: 'Chair', category: 'Furniture', size: 2048 }, { id: 'p2', type: 'prop', name: 'Cup', category: 'Kitchen', size: 2048, group: 'hand' }];
    window.__calls = [];
    export const listStudioAssets = async () => assets.map((a) => ({ ...a }));
    export const saveStudioAsset = async (type, name, file, meta) => { window.__calls.push(['save', type, name, meta.group]); assets.push({ id: 'p' + (assets.length + 1), type, name, size: 1, ...meta }); return {}; };
    export const setAssetAccess = async () => ({}); export const setPropGroup = async (id, group) => { window.__calls.push(['group', id, group]); const a = assets.find((x) => x.id === id); if (group === 'hand') a.group = 'hand'; else delete a.group; return { ...a }; };
    export const deleteStudioAsset = async () => {}; export const downloadStudioAsset = async () => {};
  ` }));
  await page.route('**/api/security', r => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', r => r.fulfill({ json: { configured: false } }));
  await page.goto('/?debug#/hub');
  await page.evaluate(async () => { const { propsEffectsView } = await import('/src/admin-props-effects.js'); document.querySelector('#shell').replaceChildren(await propsEffectsView({ home: () => {}, back: () => {}, toast: (m) => { window.__toast = m; } })); });
  await expect(page.getByLabel('Prop type for Chair')).toHaveValue('general');
  await expect(page.getByLabel('Prop type for Cup')).toHaveValue('hand');
  // change a card after upload
  await page.getByLabel('Prop type for Chair').selectOption('hand');
  await expect.poll(() => page.evaluate(() => window.__calls)).toContainEqual(['group', 'p1', 'hand']);
  await page.getByLabel('Prop type for Cup').selectOption('general');
  await expect.poll(() => page.evaluate(() => window.__calls)).toContainEqual(['group', 'p2', 'general']);
  // choose the type while uploading
  await page.getByLabel('Prop type', { exact: true }).selectOption('hand');
  await page.getByLabel('Image file').setInputFiles({ name: 'sword.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') });
  await page.getByRole('button', { name: 'Publish prop', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__calls)).toContainEqual(['save', 'prop', 'sword', 'hand']);
  await expect(page.getByLabel('Prop type for sword')).toHaveValue('hand');
});
