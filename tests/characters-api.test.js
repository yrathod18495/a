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
mock.module('../server/firebase-admin.js', { exports: { services: () => ({ db, rtdb, auth: { verifyIdToken: async () => ({ uid: current, email_verified: true, sid: 'ok' }) } }) } });
mock.module('../server/r2-storage.js', { exports: {
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

test('only admins can store files, save and delete characters; a creator can list and read them', async () => {
  for (const action of ['putFile', 'commit', 'delete']) assert.equal((await call({ action, id: 'maya' }, creator)).statusCode, 403, action);
  assert.equal((await call({ action: 'list' }, creator)).statusCode, 200);
});

test('a small file is stored once in the database, checked against its SHA-256; a changed or too big file is refused', async () => {
  const raw = JSON.stringify({ hello: 'world' }), h = sha(raw);
  assert.equal((await call({ action: 'putFile', sha: h, gz: gzipSync(raw).toString('base64') })).statusCode, 200);
  assert.equal(val(`characterFiles/${h}/size`), raw.length);
  assert.equal((await call({ action: 'putFile', sha: h, gz: gzipSync(raw).toString('base64') })).body.existed, true);
  assert.equal((await call({ action: 'putFile', sha: sha('other'), gz: gzipSync(raw).toString('base64') })).statusCode, 400);              // content does not match its name
  const big = JSON.stringify({ x: 'a'.repeat(200 * 1024) });
  assert.equal((await call({ action: 'putFile', sha: sha(big), gz: gzipSync(big).toString('base64') })).statusCode, 400);
  assert.equal((await call({ action: 'putFile', sha: sha('not json'), gz: gzipSync('not json').toString('base64') })).statusCode, 400);
});

test('commit saves the character and its category; creators see it with its animations and can read its files', async () => {
  const rec = await mayaRecord();
  const saved = await call({ action: 'commit', ...rec });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body)); assert.equal(saved.body.categoryCreated, true);
  assert.equal(val('usage/' + admin).objects, 4);                              // page, thumbnail and 2 GIFs, counted once each
  const list = await call({ action: 'list' }, creator);
  const maya = list.body.characters.find((c) => c.id === 'maya');
  assert.equal(maya.name, 'Maya'); assert.equal(maya.categoryName, 'Female'); assert.equal(maya.owner, undefined);
  assert.deepEqual(maya.animations.f34.animations.map((a) => [a.name, a.layer, a.gifName]), [['walk', 'body', 'walk_female.gif'], ['both_namaste', 'hand', 'both_namaste_female.gif']]);
  // reading: database files come back compressed, R2 files as short-lived links
  const files = await call({ action: 'files', refs: [maya.views.f34.skeleton, maya.views.f34.textures[0].page, maya.animations.f34.animations[0].gif] }, creator);
  assert.equal(files.statusCode, 200);
  assert.equal(Object.keys(files.body.db).length, 1); assert.equal(Object.keys(files.body.r2).length, 2);
  assert.match(Object.values(files.body.r2)[0], /^https:\/\/r2\.test\/u\/characters_admin_12345\/a\/[a-f0-9]{64}\?signed$/);
  // any other R2 file of the bucket cannot be asked for through this door
  assert.deepEqual((await call({ action: 'files', refs: [{ r2: sha('someone else\'s picture'), size: 1 }] }, creator)).body.r2, {});
  assert.equal((await call({ action: 'files', refs: [{ db: 'nope' }] }, creator)).statusCode, 400);
});

test('a file that never reached R2 or the database stops the save', async () => {
  const rec = await mayaRecord({ id: 'broken', skin: 'broken' });
  rec.character.views.f34.textures[0].page = { r2: sha('never uploaded'), size: 10 };
  assert.equal((await call({ action: 'commit', ...rec })).statusCode, 409);
  const rec2 = await mayaRecord({ id: 'broken2', skin: 'broken2' });
  rec2.character.views.f34.skeleton = { db: sha('never stored') };
  assert.equal((await call({ action: 'commit', ...rec2 })).statusCode, 409);
  assert.equal(val('characters/broken'), null); assert.equal(val('characters/broken2'), null);
});

test('a second character can use an existing category (same rig family, new face and outfit) without bringing animations', async () => {
  const rec = await mayaRecord({ id: 'riya', name: 'Riya', withCategory: false, skin: 'riya' });
  const saved = await call({ action: 'commit', ...rec });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body)); assert.equal(saved.body.categoryCreated, false);
  const riya = (await call({ action: 'list' }, creator)).body.characters.find((c) => c.id === 'riya');
  assert.equal(riya.animations.f34.animations.length, 2);                       // Maya's animations apply to Riya
  // a category that does not exist cannot be used like that
  const lone = await mayaRecord({ id: 'lone', withCategory: false, skin: 'lone' }); lone.category = { id: 'nobody', name: 'Nobody' };
  assert.equal((await call({ action: 'commit', ...lone })).statusCode, 400);
});

test('deleting a character removes every file nobody else uses, from the database and from R2; the last one takes the category with it', async () => {
  const before = val('usage/' + admin).bytes;
  // Riya goes: her own skeleton, atlas json, page and thumbnail go; the shared animations stay for Maya
  const riya = (await call({ action: 'list' }, creator)).body.characters.find((c) => c.id === 'riya');
  const r1 = await call({ action: 'delete', id: 'riya' });
  assert.equal(r1.statusCode, 200); assert.equal(r1.body.categoryRemoved, false);
  assert.equal(val(`characterFiles/${riya.views.f34.skeleton.db}`), null);
  assert.ok(deleted.includes(`u/${admin}/a/${riya.views.f34.textures[0].page.r2}`));
  assert.ok(val(`characterCategories/female`));
  assert.equal(val('usage/' + admin).bytes, before - 5000 - 300);
  // Maya is the last of "female": the category, its animations and GIFs go too
  const maya = (await call({ action: 'list' }, creator)).body.characters.find((c) => c.id === 'maya');
  const r2before = deleted.length;
  const r2res = await call({ action: 'delete', id: 'maya' });
  assert.equal(r2res.statusCode, 200); assert.equal(r2res.body.categoryRemoved, true);
  assert.equal(val('characterCategories/female'), null);
  for (const a of maya.animations.f34.animations) { assert.equal(val(`characterFiles/${a.file.db}`), null); assert.ok(deleted.includes(`u/${admin}/a/${a.gif.r2}`)); }
  assert.equal(deleted.length - r2before, 4);                                   // page, thumbnail and the 2 GIFs
  for (const f of [maya.views.f34.skeleton, maya.views.f34.textures[0].json]) assert.equal(val(`characterFiles/${f.db}`), null);
  assert.equal(val('characterHashes'), null);
  assert.equal((await call({ action: 'list' }, creator)).body.characters.length, 0);
  assert.equal((await call({ action: 'delete', id: 'maya' })).statusCode, 404);
});

test('uploading a character again replaces it and removes the files only the old version used', async () => {
  const first = await mayaRecord({ skin: 'v1' });
  assert.equal((await call({ action: 'commit', ...first })).statusCode, 200);
  const second = await mayaRecord({ skin: 'v2' });
  const r = await call({ action: 'commit', ...second });
  assert.equal(r.body.replaced, true); assert.ok(r.body.removedFiles >= 3);
  assert.equal(val(`characterFiles/${first.character.views.f34.skeleton.db}`), null);
  assert.ok(val(`characterFiles/${second.character.views.f34.skeleton.db}`));
});

test('files of an upload that never finished are cleaned up once they are old; fresh ones (an upload in progress) are kept', async () => {
  const old = await dbFile({ unfinished: 'old' }), fresh = await dbFile({ unfinished: 'fresh' });
  rtdb.root.characterFiles[old.db].at = Date.now() - 7 * 3600 * 1000;
  const rec = await mayaRecord({ id: 'temp', skin: 'temp' });
  assert.equal((await call({ action: 'commit', ...rec })).statusCode, 200);
  assert.equal((await call({ action: 'delete', id: 'temp' })).statusCode, 200);
  assert.equal(val(`characterFiles/${old.db}`), null);
  assert.ok(val(`characterFiles/${fresh.db}`));
});
