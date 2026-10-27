import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { memoryFirestore, response } from './fake-firestore.js';
import { cleanReport, ipHash, TAMPER_KINDS, MAX_REPORTS_PER_HOUR } from '../server/tamper-alerts.js';

process.env.MAINTENANCE_MODE = 'false';
const db = memoryFirestore(), sent = [];
const identities = new Map();
const auth = { verifyIdToken: async (token) => { if (!identities.has(token)) throw new Error('invalid token'); return identities.get(token); } };
const messaging = { send: async (message) => { sent.push(message); } };
mock.module('../server/firebase-admin.js', { exports: { services: () => ({ db, auth, messaging }) } });
const { default: security } = await import('../api/security.js');
const creator = 'creator_user_1234567890123', other = 'other_user_12345678901234', admin = 'admin_user_123456789012345';
for (const uid of [creator, other, admin]) {
  db.data.set(`securityUsers/${uid}`, { status: 'active' });
  db.data.set(`securitySessions/${uid}`, { sid: `${uid}-sid`, expiresAt: Date.now() + 600000, revoked: false });
  identities.set(uid, { uid, sid: `${uid}-sid`, email: `${uid}@example.com`, name: `Name ${uid.slice(0, 5)}`, email_verified: true });
}
db.data.set(`securityAdmins/${admin}`, { enabled: true });
db.data.set('pushTokens/t1', { uid: admin, token: 'admin-device-token-1234567890' });
const call = async (uid, body, headers = {}) => { const res = response(); await security({ method: 'POST', headers: { authorization: `Bearer ${uid}`, ...headers }, body }, res); return res; };

test('reports are cleaned: only known kinds, short text, no raw IP', () => {
  assert.deepEqual(TAMPER_KINDS, ['devtools', 'shortcut', 'view-source', 'console', 'integrity']);
  assert.deepEqual(cleanReport({ kind: 'devtools', detail: ' size\n\tchange ', path: '/#/toons' }), { kind: 'devtools', detail: 'size change', path: '/#/toons' });
  assert.equal(cleanReport({ kind: 'shortcut', detail: 'x'.repeat(500) }).detail.length, 120);
  for (const bad of [{}, { kind: 'hack' }, { kind: 1 }, null]) assert.throws(() => cleanReport(bad), /report is not valid/);
  assert.equal(ipHash(''), ''); assert.match(ipHash('203.0.113.9, 10.0.0.1'), /^[a-f0-9]{16}$/); assert.equal(ipHash('203.0.113.9'), ipHash('203.0.113.9, 10.0.0.1'));
});

test('a creator opening the developer tools is recorded and the admin devices are told once', async () => {
  const res = await call(creator, { action: 'tamperReport', kind: 'devtools', detail: 'console', path: '/#/toons' }, { 'user-agent': 'TestBrowser/1', 'x-forwarded-for': '203.0.113.9', 'x-vercel-ip-country': 'IN' });
  assert.equal(res.statusCode, 200); assert.equal(res.body.stored, true);
  const [alert] = [...db.data.entries()].filter(([k]) => k.startsWith('securityAlerts/')).map(([, v]) => v);
  assert.deepEqual([alert.uid, alert.kind, alert.detail, alert.acknowledged, alert.country, alert.userAgent], [creator, 'devtools', 'console', false, 'IN', 'TestBrowser/1']);
  assert.ok(alert.ipHash && !JSON.stringify(alert).includes('203.0.113.9'));
  assert.equal(db.data.get(`securityUsers/${creator}`).tamperCount, 1);
  assert.equal(sent.length, 1); assert.equal(sent[0].token, 'admin-device-token-1234567890'); assert.match(sent[0].data.body, /developer tools/);
  await call(creator, { action: 'tamperReport', kind: 'shortcut', detail: 'F12' });
  assert.equal(sent.length, 1, 'no second push within ten minutes');
  assert.equal([...db.data.keys()].filter((k) => k.startsWith('securityAlerts/')).length, 2);
});

test('bad reports and flooding are refused or capped', async () => {
  assert.equal((await call(creator, { action: 'tamperReport', kind: 'nonsense' })).statusCode, 400);
  const before = [...db.data.keys()].filter((k) => k.startsWith('securityAlerts/')).length;
  let last;
  for (let i = 0; i < MAX_REPORTS_PER_HOUR + 3; i++) last = await call(other, { action: 'tamperReport', kind: 'console' });
  assert.equal(last.statusCode, 200); assert.equal(last.body.stored, false);
  assert.equal([...db.data.keys()].filter((k) => k.startsWith('securityAlerts/')).length - before, MAX_REPORTS_PER_HOUR);
  const nobody = response(); await security({ method: 'POST', headers: { authorization: 'Bearer nope' }, body: { action: 'tamperReport', kind: 'devtools' } }, nobody);
  assert.equal(nobody.statusCode, 401);
});

test('admins are never reported; only admins read and clear the alerts', async () => {
  const own = await call(admin, { action: 'tamperReport', kind: 'devtools' });
  assert.equal(own.statusCode, 200); assert.equal(own.body.stored, false);
  assert.equal((await call(creator, { action: 'tamperAlerts' })).statusCode, 403);
  assert.equal((await call(creator, { action: 'tamperAck', id: 'all' })).statusCode, 403);
  const list = await call(admin, { action: 'tamperAlerts' });
  assert.equal(list.statusCode, 200); assert.ok(list.body.unacknowledged >= 2);
  assert.ok(list.body.alerts.every((a, i, all) => i === 0 || all[i - 1].at >= a.at));
  const one = list.body.alerts[0];
  assert.equal((await call(admin, { action: 'tamperAck', id: one.id })).body.acknowledged, 1);
  assert.equal((await call(admin, { action: 'tamperAck', id: '../x' })).statusCode, 400);
  assert.equal((await call(admin, { action: 'tamperAck', id: 'missing123' })).statusCode, 404);
  const after = await call(admin, { action: 'tamperAlerts' });
  assert.equal(after.body.unacknowledged, list.body.unacknowledged - 1);
  assert.ok(db.data.get(`securityAlerts/${one.id}`).acknowledgedBy === admin);
  await call(admin, { action: 'tamperAck', id: 'all' });
  assert.equal((await call(admin, { action: 'tamperAlerts' })).body.unacknowledged, 0);
});
