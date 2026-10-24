import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { memoryFirestore, response } from './fake-firestore.js';
import { limitFor, withinLimit, fmtLimit, limitMessage, EXPORT_LIMIT_SECONDS } from '../shared/export-limits.js';

process.env.MAINTENANCE_MODE = 'false';
const db = memoryFirestore();
const identities = new Map();
const auth = { verifyIdToken: async (token) => { if (!identities.has(token)) throw new Error('invalid token'); return identities.get(token); } };
mock.module('../server/firebase-admin.js', { exports: { services: () => ({ db, auth }) } });
const { default: exporter } = await import('../api/export.js');
const { creditCapturedPayment } = await import('../server/credit-payments.js');
const freeUser = 'free_user_1234567890123456', paidUser = 'paid_user_1234567890123456', oldPayer = 'old_payer_1234567890123456', admin = 'admin_user_123456789012345', blocked = 'target_user_1234567890123456';
for (const uid of [freeUser, paidUser, oldPayer, admin, blocked]) {
  db.data.set(`securityUsers/${uid}`, { status: 'active' });
  db.data.set(`securitySessions/${uid}`, { sid: `${uid}-sid`, expiresAt: Date.now() + 600000, revoked: false });
  identities.set(uid, { uid, sid: `${uid}-sid`, email: `${uid}@example.com`, name: uid, email_verified: true });
}
db.data.set(`securityAdmins/${admin}`, { enabled: true });
const request = (token, body) => ({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body });
async function call(uid, body) { const res = response(); await exporter(request(uid, body), res); return res; }

test('limits are 2 minutes for free and 10 minutes for paid accounts', () => {
  assert.deepEqual(EXPORT_LIMIT_SECONDS, { free: 120, paid: 600 });
  assert.equal(limitFor('free'), 120); assert.equal(limitFor('paid'), 600); assert.equal(limitFor('anything'), 120);
  assert.equal(withinLimit(120, 'free'), true); assert.equal(withinLimit(120.04, 'free'), true); assert.equal(withinLimit(120.5, 'free'), false);
  assert.equal(withinLimit(600, 'paid'), true); assert.equal(withinLimit(601, 'paid'), false); assert.equal(withinLimit(0, 'paid'), false); assert.equal(withinLimit(NaN, 'free'), false);
  assert.equal(fmtLimit(120), '2 min'); assert.equal(fmtLimit(90), '1 min 30 s'); assert.equal(fmtLimit(45), '45 s');
  assert.match(limitMessage(130, 'free'), /free accounts can export up to 2 min/); assert.match(limitMessage(130, 'free'), /buy credits/);
  assert.match(limitMessage(700, 'paid'), /up to 10 min/);
});

test('a free account is limited to 2 minutes, whether it exports one scene or all scenes joined', async () => {
  const status = await call(freeUser, { action: 'status' });
  assert.equal(status.statusCode, 200); assert.equal(status.body.tier, 'free'); assert.equal(status.body.limitSeconds, 120);
  assert.equal(db.data.get(`entitlements/${freeUser}`).tier, 'free');
  const ok = await call(freeUser, { action: 'authorize', seconds: 119.5, scenes: 3, scope: 'all' });
  assert.equal(ok.statusCode, 200); assert.equal(ok.body.tier, 'free'); assert.ok(ok.body.grantId);
  assert.equal(db.data.get(`workspaces/${freeUser}/exports/${ok.body.grantId}`).status, 'granted');
  for (const body of [{ seconds: 121, scenes: 1, scope: 'current' }, { seconds: 300, scenes: 4, scope: 'all' }]) {
    const denied = await call(freeUser, { action: 'authorize', ...body });
    assert.equal(denied.statusCode, 403); assert.equal(denied.body.code, 'export_limit'); assert.equal(denied.body.limitSeconds, 120); assert.match(denied.body.error, /buy credits/);
  }
  const logged = [...db.data.entries()].filter(([k, v]) => k.startsWith(`workspaces/${freeUser}/exports/`) && v.status === 'denied');
  assert.equal(logged.length, 2);
  const done = await call(freeUser, { action: 'complete', grantId: ok.body.grantId, ok: true });
  assert.equal(done.statusCode, 200); assert.equal(db.data.get(`workspaces/${freeUser}/exports/${ok.body.grantId}`).status, 'completed');
});

test('bad lengths and unknown requests are rejected', async () => {
  for (const seconds of [0, -5, 'abc', 90000, null]) assert.equal((await call(freeUser, { action: 'authorize', seconds })).statusCode, 400);
  assert.equal((await call(freeUser, { action: 'complete', grantId: '../x' })).statusCode, 400);
  assert.equal((await call(freeUser, { action: 'complete', grantId: 'doesnotexist' })).statusCode, 404);
  assert.equal((await call(freeUser, { action: 'nope' })).statusCode, 400);
  const anonymous = response(); await exporter(request('missing-token', { action: 'status' }), anonymous); assert.equal(anonymous.statusCode, 401);
  const wrongMethod = response(); await exporter({ method: 'GET', headers: {} }, wrongMethod); assert.equal(wrongMethod.statusCode, 405);
});

test('a captured purchase makes the account paid with a 10 minute limit; users cannot reach other accounts grants', async () => {
  db.data.set(`workspaces/${paidUser}`, { credits: 0 });
  db.data.set(`creditPayments/order_1`, { uid: paidUser, amountPaise: 45000, currency: 'INR', credits: 500, planId: 'starter', planName: 'Starter', status: 'created' });
  db.data.set(`workspaces/${paidUser}/creditPayments/order_1`, { uid: paidUser, status: 'created' });
  assert.equal((await call(paidUser, { action: 'authorize', seconds: 300 })).statusCode, 403);
  const result = await creditCapturedPayment(db, { id: 'pay_1', order_id: 'order_1', status: 'captured', amount: 45000, currency: 'INR' });
  assert.equal(result.ok, true);
  assert.equal(db.data.get(`entitlements/${paidUser}`).tier, 'paid');
  const ok = await call(paidUser, { action: 'authorize', seconds: 599, scenes: 5, scope: 'all' });
  assert.equal(ok.statusCode, 200); assert.equal(ok.body.tier, 'paid'); assert.equal(ok.body.limitSeconds, 600);
  const over = await call(paidUser, { action: 'authorize', seconds: 601 });
  assert.equal(over.statusCode, 403); assert.equal(over.body.limitSeconds, 600); assert.doesNotMatch(over.body.error, /buy credits/);
  assert.equal((await call(freeUser, { action: 'complete', grantId: ok.body.grantId })).statusCode, 404);
});

test('accounts that paid before tiers existed are recognised once and remembered', async () => {
  db.data.set(`workspaces/${oldPayer}`, { credits: 250 });
  assert.equal((await call(oldPayer, { action: 'status' })).body.tier, 'paid');
  assert.equal(db.data.get(`entitlements/${oldPayer}`).source, 'purchase-backfill');
});

test('admins export like paid accounts and can set or revoke a tier; others cannot', async () => {
  assert.equal((await call(admin, { action: 'status' })).body.limitSeconds, 600);
  assert.equal((await call(freeUser, { action: 'adminSetTier', uid: blocked, tier: 'paid' })).statusCode, 403);
  assert.equal((await call(admin, { action: 'adminSetTier', uid: blocked, tier: 'gold' })).statusCode, 400);
  assert.equal((await call(admin, { action: 'adminSetTier', uid: 'x', tier: 'paid' })).statusCode, 400);
  assert.equal((await call(admin, { action: 'adminSetTier', uid: blocked, tier: 'paid' })).statusCode, 200);
  assert.equal((await call(blocked, { action: 'status' })).body.tier, 'paid');
  assert.equal((await call(admin, { action: 'adminSetTier', uid: blocked, tier: 'free' })).statusCode, 200);
  assert.equal((await call(blocked, { action: 'status' })).body.limitSeconds, 120);
  assert.equal([...db.data.values()].filter((v) => v.action === 'tier_free' || v.action === 'tier_paid').length, 2);
});
