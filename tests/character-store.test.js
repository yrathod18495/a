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

async function duoRecord() {
  const view = async (tag, label) => ({ label, skeleton: await dbFile({ armature: [{ name: 'kids_' + tag, bone: [] }], who: tag }), textures: [{ json: await dbFile({ imagePath: 'texture_0.webp', who: tag }), page: r2File('page-' + tag, 500) }], thumb: r2File('thumb-' + tag, 300), gifs: { walk: r2File('gif-' + tag, 800) }, previewType: 'gif' });
  const anim = async (tag) => ({ name: 'walk', label: 'walk', group: 'Body', layer: 'body', length: 2, file: await dbFile({ walk: { duration: 50, who: tag } }), gif: null, gifName: 'walk_kids.gif' });
  return { character: { id: 'duo', name: 'Duo', views: { f34: await view('duo-f34', '3/4 Front'), sd: await view('duo-sd', 'Side') }, thumb: r2File('thumb-duo', 300) }, category: { id: 'kids', name: 'Kids', views: { f34: { animations: [await anim('f34')] }, sd: { animations: [await anim('sd')] } } } };
}
const poseOf = (list, id) => list.body.characters.find((c) => c.id === id);
const filesOf = async (refs, as) => (await call({ action: 'files', refs }, as)).body;

test('poses: a free character can have paid poses; free poses stay free, a paid pose is a locked picture until bought', async () => {
  const saved = await call({ action: 'commit', ...(await duoRecord()) }); assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.equal((await call({ action: 'update', id: 'duo', viewStore: { sd: { price: 0 } } })).statusCode, 400);
  assert.equal((await call({ action: 'update', id: 'duo', viewStore: { sd: { price: 120 } } }, creator)).statusCode, 403);
  const r = await call({ action: 'update', id: 'duo', viewStore: { sd: { price: 120 }, nope: { price: 5 } } });
  assert.deepEqual(r.body.character.viewStore, { sd: { price: 120, enabled: true } });          // an unknown pose is dropped
  const full = poseOf(await call({ action: 'list' }, admin), 'duo');
  const mine = poseOf(await call({ action: 'list' }, creator), 'duo');
  assert.equal(mine.partial, true); assert.equal(mine.locked, undefined);
  assert.ok(mine.views.f34.skeleton && !mine.views.f34.locked);
  assert.equal(mine.views.sd.locked, true); assert.equal(mine.views.sd.skeleton, undefined); assert.equal(mine.views.sd.store.price, 120); assert.ok(mine.views.sd.thumb);
  assert.deepEqual(Object.keys(mine.animations), ['f34']);
  const animFile = (v) => full.animations[v].animations[0].file;
  assert.equal(Object.keys((await filesOf([full.views.f34.skeleton, animFile('f34')], creator)).db).length, 2);                         // the free pose works
  assert.deepEqual(Object.keys((await filesOf([full.views.sd.skeleton, animFile('sd')], creator)).db), []);                              // the paid pose does not
  assert.equal(Object.keys((await filesOf([full.views.sd.thumb], creator)).r2).length, 1);                                               // its picture does
  assert.equal(poseOf(await call({ action: 'list' }, admin), 'duo').views.sd.skeleton !== undefined, true);                               // admins see everything
});

test('buying a pose unlocks only that pose for 30 days; a double tap charges once; buying a free pose is refused; it ends on time', async () => {
  wallet(creator, 500);
  assert.equal((await call({ action: 'buy', id: 'duo', view: 'f34', price: 1, opId: opId(20) }, creator)).body.code, 'not_for_sale');
  assert.equal((await call({ action: 'buy', id: 'duo', view: 'sd', price: 100, opId: opId(21) }, creator)).body.code, 'price_changed');
  const r = await call({ action: 'buy', id: 'duo', view: 'sd', price: 120, opId: opId(22) }, creator);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body)); assert.equal(r.body.balance, 380); assert.equal(r.body.expiresAt - r.body.serverNow, 30 * DAY); assert.equal(r.body.viewId, 'sd');
  assert.equal((await call({ action: 'buy', id: 'duo', view: 'sd', price: 120, opId: opId(22) }, creator)).body.repeated, true); assert.equal(db.data.get(`workspaces/${creator}`).credits, 380);
  assert.ok(db.data.get(`workspaces/${creator}/characterAccess/duo~sd`).expiresAt > Date.now());
  const mine = poseOf(await call({ action: 'list' }, creator), 'duo');
  assert.equal(mine.partial, undefined); assert.ok(mine.views.sd.skeleton && !mine.views.sd.locked); assert.deepEqual(Object.keys(mine.animations).sort(), ['f34', 'sd']);
  const full = poseOf(await call({ action: 'list' }, admin), 'duo');
  assert.equal(Object.keys((await filesOf([full.views.sd.skeleton], creator)).db).length, 1);
  const ledger = [...db.data.entries()].filter(([k]) => k.startsWith(`workspaces/${creator}/creditLedger/`)).map(([, v]) => v).filter((v) => /Duo.*Side/.test(v.reason));
  assert.equal(ledger.length, 1);
  const ref = `workspaces/${creator}/characterAccess/duo~sd`;
  db.data.set(ref, { ...db.data.get(ref), expiresAt: Date.now() - 1 });                                                                  // time over
  const after = poseOf(await call({ action: 'list' }, creator), 'duo');
  assert.equal(after.views.sd.locked, true); assert.deepEqual(Object.keys((await filesOf([full.views.sd.skeleton], creator)).db), []);
});

test('buying the whole character unlocks every pose, also a paid pose; a pose bought alone does not unlock the others', async () => {
  await call({ action: 'update', id: 'duo', store: { price: 400 }, viewStore: { sd: { price: 120 } } });
  const locked = poseOf(await call({ action: 'list' }, creator), 'duo');
  assert.equal(locked.locked, true); assert.equal(locked.store.price, 400); assert.equal(locked.views.f34.skeleton, undefined);          // a paid character: even its first pose is locked now
  wallet(creator, 1000);
  assert.equal((await call({ action: 'buy', id: 'duo', view: 'sd', price: 120, opId: opId(23) }, creator)).statusCode, 200);
  const one = poseOf(await call({ action: 'list' }, creator), 'duo');
  assert.ok(one.views.sd.skeleton && !one.views.sd.locked && one.views.f34.locked === true);                                                 // only the pose that was bought
  assert.equal((await call({ action: 'buy', id: 'duo', price: 400, opId: opId(24) }, creator)).statusCode, 200);
  const all = poseOf(await call({ action: 'list' }, creator), 'duo');
  assert.ok(all.views.f34.skeleton && all.views.sd.skeleton && !all.locked && !all.partial);
  const ref = `workspaces/${creator}/characterAccess/duo~sd`;
  db.data.set(ref, { ...db.data.get(ref), expiresAt: Date.now() - 1 });                                                                      // the single pose ended, the whole one still runs
  assert.ok(poseOf(await call({ action: 'list' }, creator), 'duo').views.sd.skeleton);
});

test('gifts of a pose: only a paid pose can be given; the sales list names the pose', async () => {
  await call({ action: 'update', id: 'duo', store: null });
  const email = `${creator}@example.test`;
  assert.equal((await call({ action: 'grant', id: 'duo', view: 'f34', email })).body.code, 'not_paid');
  const g = await call({ action: 'grant', id: 'duo', view: 'sd', email }); assert.equal(g.statusCode, 200, JSON.stringify(g.body));
  assert.ok(db.data.get(`workspaces/${creator}/characterAccess/duo~sd`).expiresAt > Date.now());
  const sales = (await call({ action: 'sales' })).body.sales;
  assert.ok(sales.some((x) => x.viewId === 'sd' && x.viewLabel === 'Side' && x.characterName === 'Duo'));
  assert.equal((await call({ action: 'update', id: 'duo', viewStore: null })).body.character.viewStore, undefined);
  assert.equal(poseOf(await call({ action: 'list' }, creator), 'duo').partial, undefined);                                                    // every pose is free again
});
