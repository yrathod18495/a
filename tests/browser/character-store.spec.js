import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';

const DAY = 86400000;
// one real tiny picture stands for every thumbnail and preview (the app checks a downloaded file against its hash)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'), SHA = createHash('sha256').update(PNG).digest('hex');
const ref = () => ({ r2: SHA, size: PNG.length });
// the server's clock is deliberately 10 days AHEAD of this browser's clock: the days left must follow the server, never the phone
function fakeStore(page, { credits = 1000 } = {}) {
  const s = { serverSkew: 10 * DAY, credits, bought: new Map(), buys: [], updates: [], grants: [], characters: [
    { id: 'rani', name: 'Rani', category: 'female', categoryName: 'Female', group: 'female', store: { price: 300, enabled: true }, locked: true, views: { f34: { label: '3/4 Front', thumb: ref('a'), gifs: { walk: ref('b'), both_namaste: ref('c') }, previewType: 'gif' } }, animations: {} },
    { id: 'raja', name: 'Raja', category: 'male', categoryName: 'Male', group: 'male', store: { price: 450, enabled: true }, access: { expiresAt: Date.now() + 10 * DAY + 15 * DAY - 3600000 }, views: { f34: { label: '3/4 Front', thumb: ref('d') } }, animations: {} },
    { id: 'duo', name: 'Duo', category: 'kids', categoryName: 'Kids', group: 'boy', partial: true, viewStore: { sd: { price: 120, enabled: true } }, views: { f34: { label: '3/4 Front', thumb: ref('e'), skeleton: ref('f') }, sd: { label: 'Side', thumb: ref('g'), gifs: { walk: ref('h') }, previewType: 'gif', locked: true } }, animations: {} },
    { id: 'old_one', name: 'Old One', category: 'male', categoryName: 'Male', group: 'male', store: { price: 100, enabled: true }, locked: true, access: { expiresAt: Date.now() - DAY }, views: { f34: { label: '3/4 Front' } }, animations: {} },
  ] };
  page.context().route('https://r2.fake/**', (r) => r.fulfill({ status: 200, body: PNG, headers: { 'content-type': 'image/png', 'access-control-allow-origin': '*' } }));
  page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  page.route('**/api/payments', (r) => { const b = r.request().postDataJSON(); return r.fulfill({ json: b.action === 'balance' ? { credits: s.credits } : b.action === 'catalog' ? { configured: true, credits: s.credits } : {} }); });
  page.route('**/api/studio-assets', (r) => {
    const body = r.request().postDataJSON(), a = String(body.action || '');
    if (!a.startsWith('character:')) return r.fulfill({ json: { assets: [] } });
    const act = a.slice(10), now = Date.now() + s.serverSkew;
    if (act === 'list') return r.fulfill({ json: { characters: s.characters, serverNow: now } });
    if (act === 'files') return r.fulfill({ json: { db: {}, r2: { [SHA]: `https://r2.fake/get/${SHA}` } } });
    if (act === 'buy') {
      s.buys.push(body); const c = s.characters.find((x) => x.id === body.id), price = body.view ? c.viewStore[body.view].price : c.store.price;
      if (s.credits < price) return r.fulfill({ status: 402, json: { code: 'not_enough_coins', error: `You need ${price} Coins for this character.` } });
      s.credits -= price; const expiresAt = now + 30 * DAY;
      if (body.view) c.views[body.view] = { ...c.views[body.view], access: { expiresAt }, locked: false, skeleton: ref('f') }; else { c.access = { expiresAt }; c.locked = false; }
      return r.fulfill({ json: { ok: true, balance: s.credits, expiresAt, serverNow: now } });
    }
    if (act === 'update') { s.updates.push(body); const c = s.characters.find((x) => x.id === body.id); if (body.store === null) delete c.store; else if (body.store) c.store = body.store; if (body.viewStore === null) delete c.viewStore; else if (body.viewStore) c.viewStore = body.viewStore; return r.fulfill({ json: { ok: true, character: c } }); }
    if (act === 'sales') return r.fulfill({ json: { serverNow: now, sales: [
      { id: 's1', uid: 'u1', email: 'buyer@example.com', characterName: 'Rani', price: 300, purchasedAt: now - 2 * DAY, expiresAt: now + 28 * DAY, source: 'coins' },
      { id: 's2', uid: 'u2', email: 'gift@example.com', characterName: 'Raja', price: 0, purchasedAt: now - 40 * DAY, expiresAt: now - 10 * DAY, source: 'admin' }] } });
    if (act === 'grant') { s.grants.push(body); return r.fulfill({ json: { ok: true, expiresAt: now + 30 * DAY, serverNow: now, email: body.email } }); }
    return r.fulfill({ status: 400, json: { error: 'unknown' } });
  });
  return s;
}

test('the dashboard has a Character Store card that opens the store; premium characters show their price, and owned ones the days left from the SERVER clock', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  fakeStore(page); await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?debug#/hub');
  const card = page.locator('.st-tool.store');
  await expect(card).toBeVisible(); await expect(card).toContainText('Character Store');
  await card.click();
  await expect(page).toHaveURL(/#\/store$/);
  await expect(page.getByRole('heading', { name: 'Character Store', level: 1 })).toBeVisible();
  await expect(page.locator('.cs-card')).toHaveCount(4);
  const raja = page.locator('.cs-card', { hasText: 'Raja' }), rani = page.locator('.cs-card', { hasText: 'Rani' });
  await expect(raja).toContainText('Yours'); await expect(raja.locator('.cs-left')).toHaveText('15 days left');          // 15 days on the server clock, though the phone clock is 10 days behind
  await expect(rani.getByRole('button', { name: /Buy/ })).toContainText('300');
  await expect(page.locator('.cs-card', { hasText: 'Old One' })).toContainText('Ended');
  await expect(page.locator('.cs-card', { hasText: 'Raja' }).getByRole('button', { name: /Renew/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('buying: the confirmation shows the price and the balance after, the same tap is charged once, and the character is then yours for 30 days', async ({ page }) => {
  const s = fakeStore(page, { credits: 1000 }); await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?debug#/hub');
  await page.evaluate(async () => { const m = await import('/src/credits-badge.js'); m.setCoinUser('test-user-123456'); m.setCoinBalance(1000); location.hash = '#/store'; });
  const rani = page.locator('.cs-card', { hasText: 'Rani' });
  await rani.getByRole('button', { name: /Buy/ }).click();
  const dlg = page.locator('dialog.cs-dialog');
  await expect(dlg).toContainText('Buy Rani?'); await expect(dlg).toContainText('300 Coins'); await expect(dlg).toContainText('700');
  await expect(dlg).toContainText('30 days');
  await dlg.getByRole('button', { name: /Buy · 300/ }).click();
  await expect(dlg).toHaveCount(0);
  expect(s.buys.length).toBe(1); expect(s.buys[0]).toMatchObject({ id: 'rani', price: 300 }); expect(s.buys[0].opId).toMatch(/^op_[A-Za-z0-9]{16,}$/);
  await expect(page.locator('.cs-card', { hasText: 'Rani' })).toContainText('Yours');
  await expect(page.locator('.cs-card', { hasText: 'Rani' }).locator('.cs-left')).toHaveText('30 days left');
  expect(s.credits).toBe(700);
});

test('not enough Coins: the dialog says how many are missing and offers Buy Coins instead of a purchase', async ({ page }) => {
  const s = fakeStore(page, { credits: 120 }); await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?debug#/hub');
  await page.evaluate(async () => { const m = await import('/src/credits-badge.js'); m.setCoinUser('test-user-123456'); m.setCoinBalance(120); location.hash = '#/store'; });
  await page.locator('.cs-card', { hasText: 'Rani' }).getByRole('button', { name: /Buy/ }).click();
  const dlg = page.locator('dialog.cs-dialog');
  await expect(dlg).toContainText('You need 180 more Coins');
  await expect(dlg.getByRole('button', { name: /Buy · 300/ })).toHaveCount(0);
  await dlg.getByRole('button', { name: 'Buy Coins' }).click();
  await expect(page.locator('dialog.credit-plans-window')).toBeVisible();
  expect(s.buys.length).toBe(0);
});

test('the preview shows the animations of a premium character before buying', async ({ page }) => {
  fakeStore(page); await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?debug#/store');
  await page.locator('.cs-card', { hasText: 'Rani' }).getByRole('button', { name: 'Preview' }).click();
  const dlg = page.locator('dialog.cs-dialog');
  await expect(dlg).toContainText('Rani'); await expect(dlg.locator('.cs-prev')).toHaveCount(2); await expect(dlg).toContainText('Both Namaste');
});

test('admin: each character shows if it is free or sold, the Store dialog changes the price, and the sales and gifts can be seen and given', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const s = fakeStore(page); await page.setViewportSize({ width: 1280, height: 1000 });
  s.characters.forEach((c) => { delete c.locked; });
  await page.goto('/?debug#/hub');
  await page.evaluate(async () => { const { charactersView } = await import('/src/admin-characters.js'); document.querySelector('#shell').replaceChildren(await charactersView({ home() {}, back() {}, toast: (m) => { window.__toast = m; } })); });
  const rani = page.locator('.admin-character-card', { hasText: 'Rani' });
  await expect(rani).toContainText('Whole character: 300 Coins');
  await rani.getByRole('button', { name: 'Store' }).click();
  const dlg = page.locator('dialog.admin-store-dialog');
  await dlg.getByLabel('Price of the whole character in Coins').fill('0'); await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(dlg).toContainText('whole number of Coins'); expect(s.updates.length).toBe(0);
  await dlg.getByLabel('Price of the whole character in Coins').fill('350'); await dlg.getByLabel('Whole character on sale').uncheck(); await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(dlg).toHaveCount(0);
  expect(s.updates[0]).toMatchObject({ id: 'rani', store: { price: 350, enabled: false } });
  await expect(page.locator('.admin-character-card', { hasText: 'Rani' })).toContainText('350 Coins · off sale');
  // free again
  await page.locator('.admin-character-card', { hasText: 'Rani' }).getByRole('button', { name: 'Store' }).click();
  await page.locator('dialog.admin-store-dialog').getByLabel('Sell the whole character').uncheck(); await page.locator('dialog.admin-store-dialog').getByRole('button', { name: 'Save' }).click();
  expect(s.updates[1]).toMatchObject({ id: 'rani', store: null });
  await expect(page.locator('.admin-character-card', { hasText: 'Rani' })).toContainText('Free for everyone');
  // sales and gifts
  await page.getByRole('button', { name: 'Show sales' }).click();
  await expect(page.locator('.admin-sales-row')).toHaveCount(2);
  await expect(page.locator('.admin-sales-sum')).toContainText('300 Coins received'); await expect(page.locator('.admin-sales-sum')).toContainText('1 still active');
  await expect(page.locator('.admin-sales-row').first()).toContainText('buyer@example.com'); await expect(page.locator('.admin-sales-row').nth(1)).toContainText('Gift');
  await page.getByLabel('Email of the account to give a character to').fill('friend@example.com');
  await page.getByRole('button', { name: /Give 30 days/ }).click();
  await expect(page.locator('.admin-sales-give')).toContainText('friend@example.com has the character');
  expect(s.grants[0]).toMatchObject({ email: 'friend@example.com' });
  expect(errors).toEqual([]);
});

test('poses: a free character with a paid pose lists only the paid pose in the store; the pose is bought alone and then shows its days left', async ({ page }) => {
  const s = fakeStore(page, { credits: 500 }); await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/?debug#/hub');
  await page.evaluate(async () => { const m = await import('/src/credits-badge.js'); m.setCoinUser('test-user-123456'); m.setCoinBalance(500); location.hash = '#/store'; });
  const duo = page.locator('.cs-card', { hasText: 'Duo' });
  await expect(duo.locator('.cs-item')).toHaveCount(1);                                    // only the paid pose is for sale; the free one is not listed
  await expect(duo.locator('.cs-item')).toContainText('Side'); await expect(duo.getByRole('button', { name: /Buy/ })).toContainText('120');
  await duo.getByRole('button', { name: /Buy/ }).click();
  const dlg = page.locator('dialog.cs-dialog');
  await expect(dlg).toContainText('Buy Duo · Side?'); await expect(dlg).toContainText('380');
  await dlg.getByRole('button', { name: /Buy · 120/ }).click();
  await expect(dlg).toHaveCount(0);
  expect(s.buys[0]).toMatchObject({ id: 'duo', view: 'sd', price: 120 });
  await expect(page.locator('.cs-card', { hasText: 'Duo' })).toContainText('Yours');
  await expect(page.locator('.cs-card', { hasText: 'Duo' }).locator('.cs-left')).toHaveText('30 days left');
  expect(s.credits).toBe(380);
});

test('admin: a pose can be marked paid with its own price; free poses stay free; a pose can be given as a gift', async ({ page }) => {
  const s = fakeStore(page); await page.setViewportSize({ width: 1280, height: 1100 });
  s.characters.forEach((c) => { delete c.locked; delete c.partial; for (const v of Object.values(c.views)) delete v.locked; });
  s.characters.find((c) => c.id === 'raja').views.sd = { label: 'Side' };
  await page.goto('/?debug#/hub');
  await page.evaluate(async () => { const { charactersView } = await import('/src/admin-characters.js'); document.querySelector('#shell').replaceChildren(await charactersView({ home() {}, back() {}, toast: () => {} })); });
  const duo = page.locator('.admin-character-card', { hasText: 'Duo' });
  await expect(duo).toContainText('Paid poses: Side 120');
  await duo.getByRole('button', { name: 'Store' }).click();
  const dlg = page.locator('dialog.admin-store-dialog');
  await expect(dlg.getByLabel('Side is paid')).toBeChecked(); await expect(dlg.getByLabel('3/4 Front is paid')).not.toBeChecked();
  await dlg.getByLabel('3/4 Front is paid').check(); await dlg.getByLabel('Price of 3/4 Front in Coins').fill('0'); await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(dlg).toContainText('whole number of Coins'); expect(s.updates.length).toBe(0);
  await dlg.getByLabel('Price of 3/4 Front in Coins').fill('90'); await dlg.getByLabel('Price of Side in Coins').fill('150'); await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(dlg).toHaveCount(0);
  expect(s.updates[0]).toMatchObject({ id: 'duo', store: null, viewStore: { f34: { price: 90, enabled: true }, sd: { price: 150, enabled: true } } });
  await expect(page.locator('.admin-character-card', { hasText: 'Duo' })).toContainText('3/4 Front 90');
  // gift one pose
  await page.getByRole('button', { name: 'Show sales' }).click();
  await page.getByLabel('Character to give').selectOption({ label: 'Duo · Side' });
  await page.getByLabel('Email of the account to give a character to').fill('friend@example.com');
  await page.getByRole('button', { name: /Give 30 days/ }).click();
  await expect(page.locator('.admin-sales-give')).toContainText('friend@example.com has the character');
  expect(s.grants[0]).toMatchObject({ id: 'duo', view: 'sd', email: 'friend@example.com' });
});
