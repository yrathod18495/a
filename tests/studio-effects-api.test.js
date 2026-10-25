import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { memoryFirestore, response } from './fake-firestore.js';
import { memoryRtdb } from './fake-rtdb.js';

process.env.MAINTENANCE_MODE = 'false';
const rtdb = memoryRtdb(), db = memoryFirestore(), admin = 'effects_admin_123456', visitor = 'effects_visitor_123456', objects = new Map();
let current = admin;
for (const uid of [admin, visitor]) { db.data.set('securityUsers/' + uid, { status: 'active' }); db.data.set('securitySessions/' + uid, { sid: 'ok', expiresAt: Date.now() + 100000, revoked: false }); }
db.data.set('securityAdmins/' + admin, { enabled: true });
mock.module('../server/firebase-admin.js', { exports: { services: () => ({ db, rtdb, auth: { verifyIdToken: async () => ({ uid: current, email_verified: true, sid: 'ok' }) } }) } });
mock.module('../server/r2-storage.js', { exports: { configured: () => true, signDownloads: async () => ({}), readAssetText: async (_, hash) => String(objects.get('assets/' + hash)), confirmAssets: async (_, __, items) => { for (const it of items) { const o = objects.get('assets/' + it.hash); if (!o || o.length !== it.size) { const e = Error('Upload poora nahi hua.'); e.status = 409; e.code = 'incomplete_upload'; throw e; } } return { added: items.length }; } } });
const { default: handler } = await import('../api/studio-assets.js');
async function call(body, as = admin) { current = as; const res = response(); await handler({ method: 'POST', headers: { authorization: 'Bearer test' }, body }, res); return res; }
const key = 'assets/' + 'b'.repeat(64);
objects.set(key, Buffer.from('png-bytes'));
const base = { action: 'save', id: 'effect_rain_123456', type: 'effect', name: 'Rain', key, size: 9, mime: 'image/webp' };

test('only admins publish effects, and their settings are validated on the server', async () => {
  assert.equal((await call(base, visitor)).statusCode, 403);
  assert.equal((await call({ ...base, blend: 'sparkle' })).statusCode, 400);
  assert.equal((await call({ ...base, sheet: { cols: 1, rows: 1, fps: 8 } })).statusCode, 400);
  assert.equal((await call({ ...base, thumb: 'data:text/html;base64,AAAA' })).statusCode, 400);
  const saved = await call({ ...base, blend: 'screen', opacity: 0.7, category: 'Weather', sheet: { cols: 4, rows: 4, fps: 12 }, thumb: 'data:image/webp;base64,AAAA' });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual([saved.body.asset.type, saved.body.asset.blend, saved.body.asset.opacity, saved.body.asset.category], ['effect', 'screen', 0.7, 'Weather']);
  assert.deepEqual(saved.body.asset.sheet, { cols: 4, rows: 4, fps: 12 });
});
test('every signed-in user sees published effects and props with their thumbnails, newest list after a change', async () => {
  const prop = await call({ ...base, id: 'prop_chair_1234567', type: 'prop', name: 'Chair', category: 'Furniture', thumb: 'data:image/webp;base64,BBBB' });
  assert.equal(prop.statusCode, 200); assert.equal(prop.body.asset.blend, undefined);
  const list = await call({ action: 'list' }, visitor);
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.body.assets.map((a) => [a.type, a.name]).sort(), [['effect', 'Rain'], ['prop', 'Chair']]);
  assert.equal(list.body.assets.find((a) => a.type === 'prop').thumb, 'data:image/webp;base64,BBBB');
  assert.equal((await call({ action: 'delete', id: 'effect_rain_123456' })).statusCode, 200);
  assert.deepEqual((await call({ action: 'list' }, visitor)).body.assets.map((a) => a.name), ['Chair']);
  assert.equal((await call({ action: 'delete', id: 'prop_chair_1234567' }, visitor)).statusCode, 403);
});
