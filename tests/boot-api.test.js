import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { memoryFirestore, response } from './fake-firestore.js';
import { readBoot, saveBoot, startingState, bootChanged, fromServer } from '../src/boot-cache.js';

process.env.MAINTENANCE_MODE = 'false';
const db = memoryFirestore(), identities = new Map();
const auth = { verifyIdToken: async (token) => { if (!identities.has(token)) throw new Error('invalid token'); return identities.get(token); } };
mock.module('../server/firebase-admin.js', { namedExports: { services: () => ({ db, auth, messaging: { send: async () => {} } }) } });
const { default: security } = await import('../api/security.js');
const user = 'boot_user_1234567890123456', boss = 'boot_admin_123456789012345', gone = 'boot_gone_12345678901234567';
for (const uid of [user, boss, gone]) {
  db.data.set(`securityUsers/${uid}`, { status: 'active' });
  db.data.set(`securitySessions/${uid}`, { sid: `${uid}-sid`, expiresAt: Date.now() + 600000, revoked: uid === gone });
  identities.set(uid, { uid, sid: `${uid}-sid`, email: `${uid}@example.com`, email_verified: true });
}
db.data.set(`securityAdmins/${boss}`, { enabled: true });
const call = async (uid, body) => { const res = response(); await security({ method: 'POST', headers: { authorization: `Bearer ${uid}` }, body }, res); return res; };

test('one boot request gives the role, the maintenance state and the tool switches', async () => {
  const a = await call(user, { action: 'boot' });
  assert.equal(a.statusCode, 200); assert.equal(a.body.ok, true); assert.equal(a.body.admin, false); assert.equal(a.body.maintenance, false);
  assert.ok(a.body.features && typeof a.body.features === 'object');
  const b = await call(boss, { action: 'boot' });
  assert.equal(b.statusCode, 200); assert.equal(b.body.admin, true);
});
test('boot also records that the user is active, like the heartbeat', async () => {
  await call(user, { action: 'boot' });
  assert.ok(Number(db.data.get(`securitySessions/${user}`).lastSeen) > Date.now() - 5000);
});
test('boot rejects an ended session with a definite 401/403 (that is what signs the user out), and nothing else does', async () => {
  const r = await call(gone, { action: 'boot' });
  assert.ok([401, 403].includes(r.statusCode));
  const none = response(); await security({ method: 'POST', headers: {}, body: { action: 'boot' } }, none);
  assert.equal(none.statusCode, 401);
});
test('the heartbeat still works after the refactor', async () => {
  assert.equal((await call(user, { action: 'heartbeat' })).statusCode, 200);
});
test('the admin Overview still reports which services are set up (loaded only when asked)', async () => {
  const r = await call(boss, { action: 'summary' });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(Object.keys(r.body.services).sort(), ['payments', 'storage', 'webhook']);
  assert.equal((await call(user, { action: 'summary' })).statusCode, 403);
});

const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
test('the remembered boot answer: saved per account, read safely, default when nothing is saved', () => {
  const s = memory();
  assert.equal(readBoot('a', s), null);
  assert.deepEqual(startingState('a', s), { role: 'user', maintenance: false, features: null });       // no server wait and no maintenance page by default
  saveBoot('a', { role: 'admin', maintenance: true, features: { animator: false } }, s);
  assert.deepEqual(readBoot('a', s), { role: 'admin', maintenance: true, features: { animator: false } });
  assert.equal(readBoot('b', s), null);                                                              // another account is not affected
  s.setItem('12toons-boot-c', '{broken'); assert.equal(readBoot('c', s), null);                       // damaged data is ignored
  s.setItem('12toons-boot-d', JSON.stringify({ role: 'root', maintenance: 'yes' })); assert.deepEqual(readBoot('d', s), { role: 'user', maintenance: false, features: null });   // nothing unknown becomes admin
});
test('the server answer is turned into the state, and a change is detected', () => {
  assert.deepEqual(fromServer({ admin: true, maintenance: false, features: { animator: true } }), { role: 'admin', maintenance: false, features: { animator: true } });
  assert.deepEqual(fromServer(null), { role: 'user', maintenance: false, features: null });
  const a = { role: 'user', maintenance: false, features: { animator: true } };
  assert.equal(bootChanged(a, { ...a }), false);
  assert.equal(bootChanged(a, { ...a, role: 'admin' }), true);
  assert.equal(bootChanged(a, { ...a, maintenance: true }), true);
  assert.equal(bootChanged(a, { ...a, features: { animator: false } }), true);
});
