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
const auth = { verifyIdToken: async (token) => { if (!identities.has(token)) throw new Error('invalid token'); return identities.get(token); }, getUser: async (uid) => { if (uid.startsWith('ghost')) throw new Error('not found'); return { uid }; } };
mock.module('../server/firebase-admin.js', { exports: { services: () => ({ db, auth }) } });
const { default: payments } = await import('../api/payments.js');
const { istDay } = await import('../server/payment-revenue.js');
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

const DAY = 86400000, orderRow = (id, status, extra = {}) => ({ orderId: id, uid: buyer, email: 'buyer@example.com', name: 'Buyer', planId: 'starter', planName: 'Starter', amountPaise: 45000, currency: 'INR', credits: 500, status, createdAt: Date.now(), updatedAt: Date.now(), ...extra });
const seed = (id, status, extra) => { const row = orderRow(id, status, extra); db.data.set(`creditPayments/${id}`, row); db.data.set(`workspaces/${row.uid}/creditPayments/${id}`, row); };

test('admin revenue: lifetime, unpaid cycle after the paid-until date, and the 10-day chart', async () => {
  const base = (await call(admin, { action: 'adminRevenue' })).body;
  seed('order_revtoday', 'captured', { amountPaise: 10000, capturedAt: Date.now() });
  seed('order_revyest', 'captured', { amountPaise: 20000, capturedAt: Date.now() - DAY });
  seed('order_rev3', 'captured', { amountPaise: 30000, capturedAt: Date.now() - 3 * DAY });
  seed('order_revold', 'captured', { amountPaise: 40000, capturedAt: Date.now() - 30 * DAY });     // counts for lifetime, not for the chart
  seed('order_revpending', 'created', { amountPaise: 99999 });                                         // never counted
  assert.equal((await call(buyer, { action: 'adminRevenue' })).statusCode, 403);
  let report = (await call(admin, { action: 'adminRevenue' })).body;
  assert.equal(report.lifetimePaise - base.lifetimePaise, 100000);
  assert.equal(report.days.length, 10); assert.equal(report.days.at(-1).day, istDay(Date.now())); assert.equal(report.days.at(-1).state, 'today');
  assert.equal(report.days.at(-1).paise - base.days.at(-1).paise, 10000); assert.equal(report.days.at(-2).paise - base.days.at(-2).paise, 20000);
  // validation of the paid-until date
  const set = (date, token = admin) => call(token, { action: 'adminSetPaidUntil', date });
  assert.equal((await set('2026-10-26', buyer)).statusCode, 403);
  for (const bad of ['yesterday', '2026-02-30', '26-10-2026', '2019-12-31', 12345]) assert.equal((await set(bad)).body.code, 'invalid_date', String(bad));
  assert.equal((await set(istDay(Date.now() + 2 * DAY))).body.code, 'future_date');
  assert.equal(db.data.get('paymentSettings/revenue'), undefined);
  // everything up to and including 2 days ago is settled; only what came after it is the unpaid cycle
  const twoAgo = istDay(Date.now() - 2 * DAY), saved = await set(twoAgo);
  assert.equal(saved.statusCode, 200); assert.equal(saved.body.paidUntil, twoAgo); assert.equal(db.data.get('paymentSettings/revenue').paidUntil, twoAgo);
  assert.equal(saved.body.unpaidPaise, base.lifetimePaise + 30000);              // earlier test payments were all captured today; plus yesterday 200 and today 100 from this test
  const states = Object.fromEntries(saved.body.days.map((d) => [d.day, d.state]));
  assert.equal(states[twoAgo], 'settled'); assert.equal(states[istDay(Date.now() - 3 * DAY)], 'settled'); assert.equal(states[istDay(Date.now() - DAY)], 'unpaid'); assert.equal(states[istDay(Date.now())], 'today');
  assert.equal((await call(admin, { action: 'adminRevenue' })).body.paidUntil, twoAgo);
  assert.equal((await set(null)).body.paidUntil, '');                                  // clearing makes everything unpaid again
  report = (await call(admin, { action: 'adminRevenue' })).body; assert.equal(report.unpaidPaise, report.lifetimePaise);
  assert.equal([...db.data].some(([k, v]) => k.startsWith('securityAudit/') && v.action === 'payments_paid_until'), true);
});

test('admin can purge unpaid records only, and approve only what Razorpay really captured', async () => {
  const realFetch = globalThis.fetch, captured = { id: 'pay_apr1', order_id: 'order_aprpend', amount: 45000, currency: 'INR', status: 'captured' };
  globalThis.fetch = async (url) => {
    if (url.includes('orders/order_aprpend/payments')) return { ok: true, json: async () => ({ items: [captured] }) };
    if (url.includes('orders/order_aprnone/payments')) return { ok: true, json: async () => ({ items: [{ id: 'pay_x', status: 'failed' }] }) };
    return realFetch(url);
  };
  try {
    seed('order_aprpend', 'created'); seed('order_aprnone', 'created'); seed('order_aprpaid', 'captured', { paymentId: 'pay_paid', capturedAt: Date.now() });
    assert.equal((await call(buyer, { action: 'adminApprove', orderId: 'order_aprpend' })).statusCode, 403);
    assert.equal((await call(admin, { action: 'adminApprove', orderId: 'bad id' })).statusCode, 400);
    assert.equal((await call(admin, { action: 'adminApprove', orderId: 'order_missing1' })).statusCode, 404);
    const nothing = await call(admin, { action: 'adminApprove', orderId: 'order_aprnone' });
    assert.equal(nothing.statusCode, 409); assert.equal(nothing.body.code, 'payment_not_captured'); assert.equal(db.data.get('creditPayments/order_aprnone').status, 'created');
    const before = Number(db.data.get(`workspaces/${buyer}`)?.credits || 0);
    const approved = await call(admin, { action: 'adminApprove', orderId: 'order_aprpend' });
    assert.equal(approved.statusCode, 200); assert.equal(approved.body.credited, true);
    assert.equal(db.data.get('creditPayments/order_aprpend').status, 'captured'); assert.equal(db.data.get(`workspaces/${buyer}`).credits, before + 500);
    assert.equal((await call(admin, { action: 'adminApprove', orderId: 'order_aprpend' })).body.credited, false);           // never credited twice
    assert.equal(db.data.get(`workspaces/${buyer}`).credits, before + 500);
    // purge: paid records are kept, unpaid ones are removed from both places
    seed('order_purge1', 'created'); seed('order_purge2', 'failed');
    assert.equal((await call(buyer, { action: 'adminPurge', orderIds: ['order_purge1'] })).statusCode, 403);
    assert.equal((await call(admin, { action: 'adminPurge', orderIds: [] })).statusCode, 400);
    assert.equal((await call(admin, { action: 'adminPurge', orderIds: ['nope'] })).statusCode, 400);
    const purged = await call(admin, { action: 'adminPurge', orderIds: ['order_purge1', 'order_purge2', 'order_aprpaid', 'order_gone0001'] });
    assert.deepEqual(purged.body.purged.sort(), ['order_purge1', 'order_purge2']);
    assert.deepEqual(purged.body.skipped.map((x) => x.reason).sort(), ['not_found', 'paid']);
    assert.equal(db.data.has('creditPayments/order_purge1'), false); assert.equal(db.data.has(`workspaces/${buyer}/creditPayments/order_purge1`), false); assert.equal(db.data.has('creditPayments/order_aprpaid'), true);
  } finally { globalThis.fetch = realFetch; }
});

test('Razorpay ground truth lists live payments and recovers a captured payment that was never credited', async () => {
  const realFetch = globalThis.fetch, now = Math.floor(Date.now() / 1000);
  const live = [
    { id: 'pay_gt1', order_id: 'order_gtsync', amount: 45000, currency: 'INR', status: 'captured', method: 'upi', email: 'a@example.com', created_at: now },
    { id: 'pay_gt2', order_id: 'order_gtlost', amount: 45000, currency: 'INR', status: 'captured', method: 'card', email: 'b@example.com', created_at: now },
    { id: 'pay_gt3', order_id: 'order_gtfail', amount: 45000, currency: 'INR', status: 'failed', method: 'upi', email: 'c@example.com', created_at: now },
    { id: 'pay_gt4', order_id: 'order_gtnew1', amount: 85000, currency: 'INR', status: 'captured', method: 'upi', email: 'd@example.com', created_at: now },
    { id: 'pay_gt5', order_id: 'order_gtghost', amount: 85000, currency: 'INR', status: 'captured', method: 'upi', email: 'e@example.com', created_at: now },
    { id: 'pay_gt6', order_id: 'order_gtother', amount: 100, currency: 'INR', status: 'captured', method: 'upi', email: 'f@example.com', created_at: now }];
  globalThis.fetch = async (url) => {
    if (url.includes('payments?count=')) return { ok: true, json: async () => ({ items: live }) };
    const payment = live.find((p) => url.endsWith(`/payments/${p.id}`)); if (payment) return { ok: true, json: async () => payment };
    if (url.endsWith('/orders/order_gtnew1')) return { ok: true, json: async () => ({ id: 'order_gtnew1', amount: 85000, currency: 'INR', created_at: now, notes: { uid: buyer, planId: 'creator' } }) };
    if (url.endsWith('/orders/order_gtghost')) return { ok: true, json: async () => ({ id: 'order_gtghost', amount: 85000, currency: 'INR', created_at: now, notes: { uid: 'ghost_account_123456', planId: 'creator' } }) };
    if (url.endsWith('/orders/order_gtother')) return { ok: true, json: async () => ({ id: 'order_gtother', amount: 100, currency: 'INR', created_at: now, notes: {} }) };
    return realFetch(url);
  };
  try {
    seed('order_gtsync', 'captured', { paymentId: 'pay_gt1', capturedAt: Date.now() }); seed('order_gtlost', 'created'); seed('order_gtfail', 'failed');
    assert.equal((await call(buyer, { action: 'adminGroundTruth' })).statusCode, 403);
    const list = await call(admin, { action: 'adminGroundTruth', count: 20 });
    assert.deepEqual(Object.fromEntries(list.body.payments.map((p) => [p.id, p.state])), { pay_gt1: 'synced', pay_gt2: 'missing', pay_gt3: 'not_paid', pay_gt4: 'missing', pay_gt5: 'missing', pay_gt6: 'missing' });
    assert.equal(list.body.nextSkip, null);
    assert.equal((await call(buyer, { action: 'adminRecover', paymentId: 'pay_gt2' })).statusCode, 403);
    assert.equal((await call(admin, { action: 'adminRecover', paymentId: 'nope' })).statusCode, 400);
    assert.equal((await call(admin, { action: 'adminRecover', paymentId: 'pay_gt3' })).body.code, 'payment_not_captured');          // not paid at Razorpay
    // a recorded order that was never credited is credited once
    const before = Number(db.data.get(`workspaces/${buyer}`)?.credits || 0);
    assert.equal((await call(admin, { action: 'adminRecover', paymentId: 'pay_gt2' })).body.recovered, true);
    assert.equal(db.data.get(`workspaces/${buyer}`).credits, before + 500); assert.equal(db.data.get('creditPayments/order_gtlost').status, 'captured');
    assert.equal((await call(admin, { action: 'adminRecover', paymentId: 'pay_gt2' })).body.recovered, false);
    assert.equal(db.data.get(`workspaces/${buyer}`).credits, before + 500);
    // an order this app never recorded is rebuilt from the Razorpay order notes (user + plan), then credited
    assert.equal((await call(admin, { action: 'adminRecover', paymentId: 'pay_gt4' })).body.recovered, true);
    assert.equal(db.data.get('creditPayments/order_gtnew1').credits, 1000); assert.equal(db.data.get(`workspaces/${buyer}`).credits, before + 1500);
    // unknown order / deleted account are refused and nothing is credited
    assert.equal((await call(admin, { action: 'adminRecover', paymentId: 'pay_gt6' })).body.code, 'order_unknown');
    assert.equal((await call(admin, { action: 'adminRecover', paymentId: 'pay_gt5' })).body.code, 'user_not_found');
    assert.equal(db.data.has('creditPayments/order_gtghost'), false); assert.equal(db.data.has('creditPayments/order_gtother'), false);
  } finally { globalThis.fetch = realFetch; }
});

test('the header balance: a signed-in account reads only its own Coin balance, a new account has 0, and signed-out requests are refused', async () => {
  const fresh = 'fresh_12345678901234567890';
  db.data.set(`securityUsers/${fresh}`, { status: 'active' });
  db.data.set(`securitySessions/${fresh}`, { sid: 'fresh-session', expiresAt: Date.now() + 600000, revoked: false });
  identities.set(fresh, { uid: fresh, sid: 'fresh-session', email: 'fresh@example.com', name: 'Fresh', email_verified: true });
  db.data.set(`workspaces/${buyer}`, { ...(db.data.get(`workspaces/${buyer}`) || {}), credits: 4200 });
  const mine = await call(fresh, { action: 'balance' });
  assert.equal(mine.statusCode, 200); assert.deepEqual(mine.body, { credits: 0 });
  const bought = await call(buyer, { action: 'balance' });
  assert.equal(bought.statusCode, 200); assert.equal(bought.body.credits, 4200);
  assert.deepEqual(Object.keys(bought.body), ['credits']);                                   // nothing else leaves the server (no keys, no plans)
  const anonymous = response(); await payments({ method: 'POST', headers: {}, body: { action: 'balance' } }, anonymous);
  assert.ok(anonymous.statusCode === 401 || anonymous.statusCode === 403, String(anonymous.statusCode));
  assert.equal((await call(admin, { action: 'balance' })).statusCode, 200);                   // admins have a balance of their own too
});
