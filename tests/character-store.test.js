import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { memoryFirestore, response } from './fake-firestore.js';
import { memoryRtdb } from './fake-rtdb.js';

process.env.MAINTENANCE_MODE = 'false';
const rtdb = memoryRtdb(), db = memoryFirestore(), admin = 'characters_admin_12345', creator = 'characters_user_123456';
const r2 = new Map(), deleted = [];            // objects in "R2": key -> size
let current = admin;
for (const uid of [admin, creator]) { db.data.set('securityUsers/' + uid, { status: 'active' }); db.data.set('securitySessions/' + uid, { sid: 'ok', expiresAt: Date.now() + 1e6, revoked: false }); }
db.data.set('securityAdmins/' + admin, { enabled: true });
mock.module('../server/firebase-admin.js', {namedExports: { services: () => ({ db, rtdb, auth: { verifyIdToken: async () => ({ uid: current, email_verified: true, sid: 'ok', email: current + '@example.test', name: 'Name ' + current.slice(0, 4) }), getUserByEmail: async (email) => { const uid = email.split('@')[0]; if (!uid.startsWith('characters_')) throw Object.assign(new Error('none'), { code: 'auth/user-not-found' }); return { uid, email, displayName: 'Buyer', metadata: {} }; } } }) } });
mock.module('../server/r2-storage.js', {namedExports: {
  configured: () => true,
  readAssetText: async () => '{}',
  assetKey: (uid, hash) => `u/${uid}/a/${hash}`,
  deleteKey: async (key) => { deleted.push(key); r2.delete(key); },
  signDownloads: async (uid, hashes) => Object.fromEntries(hashes.map((h) => [h, `https://r2.test/u/${uid}/a/${h}?signed`])),
  confirmAssets: async (uid, store, items) => {
    for (const it of items) { if (r2.get(`u/${uid}/a/${it.hash}`) !== it.size) throw Object.assign(new Error('The file upload did not finish. Please try again.'), { status: 409, code: 'incomplete_upload' }); }
    for (const it of items) { if (await store.get(`assets/${uid}/${it.hash}`) == null) { await store.set(`assets/${uid}/${it.hash}`, it.size); await store.transact(`usage/${uid}`, (u) => ({ bytes: (u?.bytes || 0) + it.size, objects: (u?.objects || 0) + 1 })); } }
    return { added: items.length };
  },
} });
const { default: handler } = await import('../api/studio-assets.js');          // characters are served by the studio library function
async function call(body, as = admin) { current = as; const res = response(); await handler({ method: 'POST', headers: { authorization: 'Bearer test' }, body: { ...body, action: `character:${body.action}` } }, res); return res; }
const sha = (s) => createHash('sha256').update(s).digest('hex');
const dbFile = async (content) => { const raw = JSON.stringify(content), h = sha(raw); const r = await call({ action: 'putFile', sha: h, gz: gzipSync(raw).toString('base64') }); assert.equal(r.statusCode, 200, JSON.stringify(r.body)); return { db: h }; };
const r2File = (label, size = 1000) => { const h = sha(label); r2.set(`u/${admin}/a/${h}`, size); return { r2: h, size }; };
const val = (path) => path.split('/').reduce((n, k) => (n == null ? null : n[k]), rtdb.root) ?? null;

async function mayaRecord({ id = 'maya', name = 'Maya', withCategory = true, skin = 'maya' } = {}) {
  const view = { label: '3/4 Front', skeleton: await dbFile({ armature: [{ name: 'female_f34', bone: [] }], who: skin }), textures: [{ json: await dbFile({ imagePath: 'texture_0.webp', who: skin }), page: r2File(`page-${skin}`, 5000) }] };
  const character = { id, name, views: { f34: view }, thumb: r2File(`thumb-${skin}`, 300) };
  const category = { id: 'female', name: 'Female' };
  if (withCategory) category.views = { f34: { animations: [
    { name: 'walk', label: 'walk', group: 'Body', layer: 'body', length: 4.36, file: await dbFile({ walk: { duration: 131 } }), gif: r2File('gif-walk', 800), gifName: 'walk_female.gif' },
    { name: 'both_namaste', label: 'both namaste', group: 'Both', layer: 'hand', length: 4, file: await dbFile({ both_namaste: { duration: 120 } }), gif: r2File('gif-namaste', 700), gifName: 'both_namaste_female.gif' },
  ] } };
  return { character, category };
}


import { STORE_MS, nextExpiry, leftText, cleanStore, MAX_STACK_MS, isPaid } from '../shared/character-store.js';
const DAY = 86400000;
const opId = (n) => `op_${String(n).padStart(20, '0')}`;
const wallet = (uid, credits) => db.data.set(`workspaces/${uid}`, { credits });

test('30 days are 720 hours on the server clock, whatever the month; buying again adds 30 more but never more than 90 days ahead', () => {
  assert.equal(STORE_MS, 30 * 24 * 3600 * 1000);
  const jan31 = Date.UTC(2026, 0, 31, 10, 0, 0);                      // a 31-day month, then February
  assert.equal(nextExpiry(jan31) - jan31, 30 * DAY);
  assert.equal(new Date(nextExpiry(jan31)).toISOString(), '2026-03-02T10:00:00.000Z');
  const dec1 = Date.UTC(2026, 11, 1);
  assert.equal(nextExpiry(dec1) - dec1, 30 * DAY);                    // a 31-day month: still 30 days, not "until the 1st"
  const now = Date.UTC(2026, 5, 10);
  assert.equal(nextExpiry(now, now + 10 * DAY), now + 40 * DAY);      // a running purchase is extended
  assert.equal(nextExpiry(now, now - DAY), now + 30 * DAY);           // an ended one starts again from now
  assert.equal(nextExpiry(now, now + 80 * DAY), now + MAX_STACK_MS);  // capped at 90 days ahead
});
test('the time left is written in plain English', () => {
  assert.equal(leftText(0), 'Ended'); assert.equal(leftText(-5), 'Ended');
  assert.equal(leftText(30 * DAY), '30 days left'); assert.equal(leftText(30 * DAY - 5000), '30 days left'); assert.equal(leftText(2 * DAY + 1), '3 days left'); assert.equal(leftText(1 * DAY + 3600000), '1 day 1 h left'); assert.equal(leftText(5 * 3600000), '5 h left'); assert.equal(leftText(90000), '2 min left');
});
test('a price is a whole number of Coins from 1 to 100000; no price means free', () => {
  assert.deepEqual(cleanStore({ price: 250 }), { price: 250, enabled: true });
  assert.deepEqual(cleanStore({ price: '500', enabled: false }), { price: 500, enabled: false });
  assert.equal(cleanStore(null), null);
  for (const bad of [{ price: 0 }, { price: -4 }, { price: 'x' }, { price: 100001 }, {}, 'free']) assert.throws(() => cleanStore(bad), /Coins/);
  assert.equal(isPaid({ store: { price: 1 } }), true); assert.equal(isPaid({}), false);
});

async function commitPaid(id, store, { withCategory = false } = {}) {
  const rec = await mayaRecord({ id, name: id.toUpperCase(), withCategory, skin: id });
  const r = await call({ action: 'commit', ...rec, character: { ...rec.character, ...(store !== undefined ? { store } : {}) } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body)); return r.body.character;
}
test('the Character Store: a paid character is shown to everyone as a locked card with pictures only; its rig and files are for buyers', async () => {
  await commitPaid('free_one', undefined, { withCategory: true });                // the category and a free character
  const paid = await commitPaid('premium', { price: 300 });
  assert.deepEqual(paid.store, { price: 300, enabled: true });
  const list = (await call({ action: 'list' }, creator)).body;
  assert.ok(list.serverNow > 0);
  const free = list.characters.find((c) => c.id === 'free_one'), locked = list.characters.find((c) => c.id === 'premium');
  assert.ok(free.views.f34.skeleton && !free.locked);
  assert.equal(locked.locked, true); assert.equal(locked.store.price, 300); assert.equal(locked.views.f34.skeleton, undefined); assert.equal(locked.views.f34.textures, undefined); assert.deepEqual(locked.animations, {});
  assert.ok(locked.views.f34.thumb || locked.thumb);
  // the files: the rig of the paid character is not given, its thumbnail is; a free character's files still work
  const full = (await call({ action: 'list' }, admin)).body.characters.find((c) => c.id === 'premium');
  const rig = (await call({ action: 'files', refs: [full.views.f34.skeleton] }, creator)).body;
  assert.deepEqual(Object.keys(rig.db), []);
  assert.equal(Object.keys((await call({ action: 'files', refs: [full.views.f34.skeleton] }, admin)).body.db).length, 1);
  assert.equal(Object.keys((await call({ action: 'files', refs: [free.views.f34.skeleton] }, creator)).body.db).length, 1);
  assert.equal(Object.keys((await call({ action: 'files', refs: [full.thumb] }, creator)).body.r2).length, 1);
  assert.equal(Object.keys((await call({ action: 'files', refs: [full.views.f34.textures[0].page] }, creator)).body.r2).length, 0);
});

test('buying: Coins are taken once, the character is the buyer\'s for 30 days from the server clock, and a double tap charges once', async () => {
  wallet(creator, 100);
  let r = await call({ action: 'buy', id: 'premium', price: 300, opId: opId(1) }, creator);
  assert.equal(r.statusCode, 402); assert.equal(r.body.code, 'not_enough_coins'); assert.match(r.body.error, /300 Coins/);
  assert.equal(db.data.get(`workspaces/${creator}`).credits, 100);
  wallet(creator, 1000);
  r = await call({ action: 'buy', id: 'premium', price: 299, opId: opId(2) }, creator); assert.equal(r.statusCode, 409); assert.equal(r.body.code, 'price_changed');
  r = await call({ action: 'buy', id: 'nobody', price: 300, opId: opId(3) }, creator); assert.equal(r.statusCode, 404);
  r = await call({ action: 'buy', id: 'free_one', price: 1, opId: opId(4) }, creator); assert.equal(r.body.code, 'not_for_sale');
  r = await call({ action: 'buy', id: 'premium', price: 300, opId: 'short' }, creator); assert.equal(r.statusCode, 400);
  r = await call({ action: 'buy', id: 'premium', price: 300, opId: opId(5) }, creator);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body)); assert.equal(r.body.balance, 700); assert.equal(r.body.expiresAt - r.body.serverNow, 30 * DAY);
  const again = await call({ action: 'buy', id: 'premium', price: 300, opId: opId(5) }, creator);       // the same tap twice
  assert.equal(again.body.repeated, true); assert.equal(db.data.get(`workspaces/${creator}`).credits, 700);
  const ledger = [...db.data.entries()].filter(([k]) => k.startsWith(`workspaces/${creator}/creditLedger/`)).map(([, v]) => v).filter((v) => v.kind === 'store_purchase');
  assert.equal(ledger.length, 1); assert.equal(ledger[0].delta, -300); assert.equal(ledger[0].balance, 700); assert.match(ledger[0].reason, /PREMIUM.*30 days/);
  // the buyer now gets the whole character, with the end date; the rig is readable
  const mine = (await call({ action: 'list' }, creator)).body.characters.find((c) => c.id === 'premium');
  assert.ok(!mine.locked && mine.views.f34.skeleton && mine.access.expiresAt === r.body.expiresAt);
  assert.equal(Object.keys((await call({ action: 'files', refs: [mine.views.f34.skeleton] }, creator)).body.db).length, 1);
});

test('buying again while it is running adds 30 days (never more than 90 ahead); when it has ended the character goes back to a locked card and its files stop', async () => {
  wallet(creator, 10000);
  const before = db.data.get(`workspaces/${creator}/characterAccess/premium`).expiresAt;
  let r = await call({ action: 'buy', id: 'premium', price: 300, opId: opId(6) }, creator);
  assert.equal(r.body.extended, true); assert.equal(r.body.expiresAt, before + 30 * DAY);
  r = await call({ action: 'buy', id: 'premium', price: 300, opId: opId(7) }, creator);
  r = await call({ action: 'buy', id: 'premium', price: 300, opId: opId(8) }, creator);
  assert.ok(r.body.expiresAt - r.body.serverNow <= 90 * DAY);
  const ref = `workspaces/${creator}/characterAccess/premium`;
  db.data.set(ref, { ...db.data.get(ref), expiresAt: Date.now() - 1000 });                           // the time is over
  const list = (await call({ action: 'list' }, creator)).body.characters.find((c) => c.id === 'premium');
  assert.equal(list.locked, true); assert.equal(list.views.f34.skeleton, undefined);
  const full = (await call({ action: 'list' }, admin)).body.characters.find((c) => c.id === 'premium');
  assert.equal(Object.keys((await call({ action: 'files', refs: [full.views.f34.skeleton] }, creator)).body.db).length, 0);
});

test('the admin sets and changes the price, takes a character off sale, makes it free again; only admins can', async () => {
  assert.equal((await call({ action: 'update', id: 'premium', store: { price: 0 } })).statusCode, 400);
  assert.equal((await call({ action: 'update', id: 'premium', store: { price: 500 } }, creator)).statusCode, 403);
  let r = await call({ action: 'update', id: 'premium', store: { price: 450, enabled: true } });
  assert.equal(r.body.character.store.price, 450);
  assert.equal((await call({ action: 'buy', id: 'premium', price: 300, opId: opId(9) }, creator)).body.code, 'price_changed');
  r = await call({ action: 'update', id: 'premium', store: { price: 450, enabled: false } });                  // off sale
  assert.equal((await call({ action: 'buy', id: 'premium', price: 450, opId: opId(10) }, creator)).body.code, 'not_for_sale');
  assert.equal((await call({ action: 'list' }, creator)).body.characters.some((c) => c.id === 'premium'), false);     // not shown at all (the buyer's time has ended)
  r = await call({ action: 'update', id: 'premium', store: null });                                              // free for everyone
  assert.equal(r.body.character.store, undefined);
  const list = (await call({ action: 'list' }, creator)).body.characters.find((c) => c.id === 'premium');
  assert.ok(list && !list.locked && list.views.f34.skeleton);
  await call({ action: 'update', id: 'premium', store: { price: 300 } });                                        // back on sale for the next tests
});

test('replacing a character keeps its price unless the upload says otherwise', async () => {
  const kept = await commitPaid('premium', undefined);
  assert.deepEqual(kept.store, { price: 300, enabled: true });
  const free = await commitPaid('premium', null);
  assert.equal(free.store, undefined);
  await call({ action: 'update', id: 'premium', store: { price: 300 } });
});

test('sales and gifts: the admin sees every purchase; a gift gives 30 days without taking Coins; creators cannot see or give', async () => {
  const sales = await call({ action: 'sales' });
  assert.equal(sales.statusCode, 200); assert.ok(sales.body.sales.length >= 3);
  assert.ok(sales.body.sales.every((s) => s.characterName && s.purchasedAt && s.expiresAt && 'price' in s && s.email));
  assert.equal((await call({ action: 'sales' }, creator)).statusCode, 403);
  wallet(admin, 5);
  const email = `${admin}@example.test`;
  assert.equal((await call({ action: 'grant', id: 'premium', email }, creator)).statusCode, 403);
  const g = await call({ action: 'grant', id: 'premium', email });
  assert.equal(g.statusCode, 200, JSON.stringify(g.body)); assert.equal(g.body.expiresAt - g.body.serverNow, 30 * DAY);
  assert.equal(db.data.get(`workspaces/${admin}`).credits, 5);
  assert.equal((await call({ action: 'grant', id: 'premium', email: 'nobody@example.test' })).statusCode, 404);
  assert.equal((await call({ action: 'grant', id: 'free_one', email })).body.code, 'not_paid');                      // a free character has nothing to give
});
