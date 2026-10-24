import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { memoryFirestore, response } from './fake-firestore.js';

process.env.MAINTENANCE_MODE = 'false';
process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'rzp_webhook_secret';
const db = memoryFirestore();
const identities = new Map();
const auth = { verifyIdToken: async (token) => { if (!identities.has(token)) throw new Error('invalid token'); return identities.get(token); } };
mock.module('../server/firebase-admin.js', { exports: { services: () => ({ db, auth }) } });
const { default: payments } = await import('../api/payments.js');
const { default: webhook } = await import('../api/razorpay-webhook.js');
const buyer = 'buyer_12345678901234567890', admin = 'admin_12345678901234567890';
const affiliateId = 'abcdef01-2345-6789-abcd-ef0123456789';
db.data.set(`affiliatePartners/${affiliateId}`, { id: affiliateId, status: 'approved', referralCode: 'AFFILIATE01' });
db.data.set(`affiliateReferrals/${buyer}`, { uid: buyer, affiliateId, referralCode: 'AFFILIATE01', conversions: 0, commissionPaise: 0 });
for (const [uid, sid] of [[buyer, 'buyer-session'], [admin, 'admin-session']]) {
  db.data.set(`securityUsers/${uid}`, { status: 'active' });
  db.data.set(`securitySessions/${uid}`, { sid, expiresAt: Date.now() + 600000, revoked: false });
  identities.set(uid, { uid, sid, email: `${uid}@example.com`, name: uid, email_verified: true });
}
db.data.set(`securityAdmins/${admin}`, { enabled: true });
const request = (token, body) => ({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body });
async function call(token, body) { const res = response(); await payments(request(token, body), res); return res; }
let nextOrder = 1;
globalThis.fetch = async (url, options = {}) => {
  if (url.endsWith('/orders') && options.method === 'POST') {
    const data = JSON.parse(options.body); return { ok: true, json: async () => ({ id: `order_test${nextOrder++}`, amount: data.amount, currency: data.currency }) };
  }
  if (url.includes('/payments/pay_test')) return { ok: true, json: async () => ({ id: 'pay_test1', order_id: 'order_test1', amount: 45000, currency: 'INR', status: 'captured', method: 'upi' }) };
  return { ok: false, json: async () => ({ error: { description: 'unexpected request' } }) };
};

test('server fixes plan amounts and credits, verifies captured payments once, and protects admin reports', async () => {
  const catalog = await call(buyer, { action: 'catalog' });
  assert.equal(catalog.statusCode, 200); assert.equal(catalog.body.configured, true);
  assert.deepEqual(catalog.body.plans.map((p) => [p.amountPaise, p.credits]), [[45000, 500], [85000, 1000], [99900, 1500]]);
  assert.equal((await call(buyer, { action: 'createOrder', planId: 'unknown', amountPaise: 1 })).statusCode, 400);
  const created = await call(buyer, { action: 'createOrder', planId: 'starter', amountPaise: 1 });
  assert.equal(created.statusCode, 200); assert.equal(created.body.amountPaise, 45000);
  const orderId = created.body.orderId, paymentId = 'pay_test1';
  const signature = createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  const verified = await call(buyer, { action: 'verify', orderId, paymentId, signature });
  assert.equal(verified.statusCode, 200); assert.equal(verified.body.status, 'captured'); assert.equal(verified.body.credited, true); assert.equal(verified.body.balance, 500);
  const repeated = await call(buyer, { action: 'verify', orderId, paymentId, signature });
  assert.equal(repeated.statusCode, 200); assert.equal(repeated.body.credited, false); assert.equal(repeated.body.balance, 500);
  assert.equal(db.data.get(`creditPayments/${orderId}`).status, 'captured');
  assert.equal(db.data.get(`workspaces/${buyer}`).credits, 500);
  const commission = db.data.get(`affiliatePartners/${affiliateId}/commissions/${orderId}`);
  assert.equal(commission.commissionPercent, 10); assert.equal(commission.commissionPaise, 4500); assert.equal(commission.payoutStatus, 'pending');
  assert.equal(db.data.get(`affiliateReferrals/${buyer}`).conversions, 1);
  assert.equal((await call(buyer, { action: 'adminList' })).statusCode, 403);
  const report = await call(admin, { action: 'adminList' });
  assert.equal(report.statusCode, 200); assert.equal(report.body.payments[0].paymentId, paymentId);
});

test('signed Razorpay webhook credits capture once and rejects invalid signatures', async () => {
  const created = await call(buyer, { action: 'createOrder', planId: 'creator' });
  const orderId = created.body.orderId, event = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_webhook2', order_id: orderId, amount: 85000, currency: 'INR', status: 'captured', method: 'card' } } } });
  const signature = createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(event).digest('hex');
  const good = response(); await webhook({ method: 'POST', headers: { 'x-razorpay-signature': signature }, body: event }, good);
  assert.equal(good.statusCode, 200); assert.equal(db.data.get(`workspaces/${buyer}`).credits, 1500);
  const repeated = response(); await webhook({ method: 'POST', headers: { 'x-razorpay-signature': signature }, body: event }, repeated);
  assert.equal(repeated.statusCode, 200); assert.equal(db.data.get(`workspaces/${buyer}`).credits, 1500);
  const bad = response(); await webhook({ method: 'POST', headers: { 'x-razorpay-signature': 'bad' }, body: event }, bad);
  assert.equal(bad.statusCode, 401);
});
