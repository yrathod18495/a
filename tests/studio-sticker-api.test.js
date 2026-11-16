import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { memoryFirestore, response } from './fake-firestore.js';
import { memoryRtdb } from './fake-rtdb.js';

// Stickers (scars, blood marks ...) are library items like props: the file is in R2, a small record with a thumbnail is in the database, and everybody reads one cached list.
process.env.MAINTENANCE_MODE = 'false';
const rtdb = memoryRtdb(), db = memoryFirestore(), admin = 'sticker_admin_123456', visitor = 'sticker_visitor_123456', objects = new Map();
let current = admin;
for (const uid of [admin, visitor]) { db.data.set('securityUsers/' + uid, { status: 'active' }); db.data.set('securitySessions/' + uid, { sid: 'ok', expiresAt: Date.now() + 100000, revoked: false }); }
db.data.set('securityAdmins/' + admin, { enabled: true });
mock.module('../server/firebase-admin.js', { namedExports: { services: () => ({ db, rtdb, auth: { verifyIdToken: async () => ({ uid: current, email_verified: true, sid: 'ok' }) } }) } });
mock.module('../server/r2-storage.js', { namedExports: { configured: () => true, assetKey: (uid, hash) => `u/${uid}/a/${hash}`, deleteKey: async () => {}, signDownloads: async () => ({}), readAssetText: async () => '', confirmAssets: async () => ({ added: 0 }) } });
const { default: handler } = await import('../api/studio-assets.js');
async function call(body, as = admin) { current = as; const res = response(); await handler({ method: 'POST', headers: { authorization: 'Bearer test' }, body }, res); return res; }
const key = 'assets/' + 'c'.repeat(64); objects.set(key, Buffer.from('png'));
const base = { action: 'save', id: 'sticker_blood_1234567', type: 'sticker', name: 'Blood splatter', key, size: 3, mime: 'image/png', category: 'Wounds', thumb: 'data:image/webp;base64,AAAA' };

test('only admins publish stickers; a sticker needs an image file and keeps its category and thumbnail', async () => {
  assert.equal((await call(base, visitor)).statusCode, 403);
  assert.equal((await call({ ...base, mime: 'text/plain' })).statusCode, 400);
  const saved = await call(base);
  assert.equal(saved.statusCode, 200);
  assert.deepEqual([saved.body.asset.type, saved.body.asset.category, saved.body.asset.thumb], ['sticker', 'Wounds', 'data:image/webp;base64,AAAA']);
});
test('every signed-in user sees the stickers in the one cached list; free access can be set; only an admin removes one', async () => {
  const list = await call({ action: 'list' }, visitor);
  assert.deepEqual(list.body.assets.map((a) => [a.type, a.name, a.access]), [['sticker', 'Blood splatter', undefined]]);          // no setting = paid accounts only
  assert.equal((await call({ action: 'update', id: base.id, access: 'free' })).statusCode, 200);
  assert.equal((await call({ action: 'list' }, visitor)).body.assets[0].access, 'free');
  assert.equal((await call({ action: 'delete', id: base.id }, visitor)).statusCode, 403);
  assert.equal((await call({ action: 'delete', id: base.id })).statusCode, 200);
  assert.deepEqual((await call({ action: 'list' }, visitor)).body.assets, []);
});
