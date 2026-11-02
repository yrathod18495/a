import { randomUUID } from 'node:crypto';
import { services } from '../server/firebase-admin.js';
import { maintenanceOn } from '../server/maintenance.js';
import { access, bodyOf, send, failure } from '../server/access.js';
import { AccessError } from '../server/security-policy.js';
import { CREDIT_PLANS, publicPlan } from '../shared/credit-plans.js';
import { creditCapturedPayment, paymentConfigReady, razorpayRequest, recordPaymentState, verifyCheckoutSignature } from '../server/credit-payments.js';
import { buildRevenue, checkPaidUntil } from '../server/payment-revenue.js';

const planById = new Map(CREDIT_PLANS.map((p) => [p.id, p]));
const validOrderId = (value) => typeof value === 'string' && /^order_[a-zA-Z0-9]+$/.test(value);
const validPaymentId = (value) => typeof value === 'string' && /^pay_[a-zA-Z0-9]+$/.test(value);
const ADMIN_ACTIONS = ['adminList', 'adminRevenue', 'adminSetPaidUntil', 'adminApprove', 'adminPurge', 'adminGroundTruth', 'adminRecover'];
const ADMIN_WRITES = ['adminSetPaidUntil', 'adminApprove', 'adminPurge', 'adminRecover'];
/** a record of who did what, next to the other security events */
const audit = (db, who, action, details = {}) => db.collection('securityAudit').add({ admin: who.uid, action, ...details, at: Date.now() });

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'This request is not valid. Please reload the page and try again.' });
  try {
    const b = await bodyOf(req), who = await access(req, { write: ['createOrder', 'verify'].includes(b.action) || ADMIN_WRITES.includes(b.action), admin: ADMIN_ACTIONS.includes(b.action) }), { db } = services();
    if (!who.admin && await maintenanceOn(db)) throw new AccessError('maintenance', '12toons is under maintenance right now. Please try again shortly.', 503);
    // the header badge: just the Coin balance (one small read), so every page can show it
    if (b.action === 'balance') return send(res, 200, { credits: Number((await db.doc(`workspaces/${who.uid}`).get()).data()?.credits || 0) });
    if (b.action === 'catalog') return send(res, 200, {
      keyId: process.env.RAZORPAY_KEY_ID || '', configured: paymentConfigReady(),
      plans: CREDIT_PLANS.map(publicPlan), credits: Number((await db.doc(`workspaces/${who.uid}`).get()).data()?.credits || 0),
    });
    // a partner's promo code (their referral code): any buyer may use it at checkout, and the partner earns the commission on that purchase
    const partnerFor = async (raw) => {
      const code = String(raw || '').trim().toUpperCase();
      if (!code) return null;
      if (!/^[A-Z0-9]{8,12}$/.test(code)) throw new AccessError('invalid_promo', 'This promo code is not valid.', 400);
      const match = await db.collection('affiliatePartners').where('referralCode', '==', code).limit(10).get();
      const doc = match.docs.find(d => d.data()?.status === 'approved');
      if (!doc) throw new AccessError('invalid_promo', 'This promo code is not valid.', 400);
      const partner = doc.data();
      if (partner.affiliateUid === who.uid || String(partner.email || '').toLowerCase() === String(who.claims.email || '').toLowerCase()) throw new AccessError('invalid_promo', 'You cannot use your own partner code.', 400);
      return { id: doc.id, code };
    };
    if (b.action === 'checkPromo') { const hit = await partnerFor(b.promoCode); return send(res, 200, { valid: !!hit }); }
    if (b.action === 'createOrder') {
      const plan = planById.get(String(b.planId));
      if (!plan) throw new AccessError('invalid_plan', 'Please choose a valid Coins plan.', 400);
      if (!paymentConfigReady()) throw new AccessError('payments_unconfigured', 'The payment setup is not complete yet. Please try again shortly.', 503);
      const promo = await partnerFor(b.promoCode);
      const order = await razorpayRequest('orders', { method: 'POST', body: JSON.stringify({ amount: plan.amountPaise, currency: plan.currency, receipt: `cr_${randomUUID().replace(/-/g, '')}`, notes: { uid: who.uid, planId: plan.id } }) });
      if (!order.id || +order.amount !== plan.amountPaise || order.currency !== plan.currency) throw new AccessError('invalid_gateway_order', 'Received an invalid order from Razorpay. Please try again.', 502);
      const now = Date.now(), record = {
        orderId: order.id, uid: who.uid, email: who.claims.email || '', name: who.claims.name || '',
        planId: plan.id, planName: plan.name, amountPaise: plan.amountPaise, currency: plan.currency,
        credits: plan.credits, status: 'created', createdAt: now, updatedAt: now,
        ...(promo ? { promoAffiliateId: promo.id, promoCode: promo.code } : {}),
      };
      const ref = db.doc(`creditPayments/${order.id}`), userRef = db.doc(`workspaces/${who.uid}/creditPayments/${order.id}`);
      await db.runTransaction(async (tx) => { tx.create(ref, record); tx.create(userRef, record); });
      return send(res, 200, { keyId: process.env.RAZORPAY_KEY_ID, orderId: order.id, amountPaise: plan.amountPaise, currency: plan.currency, plan: publicPlan(plan) });
    }
    if (b.action === 'verify') {
      const orderId = String(b.orderId || ''), paymentId = String(b.paymentId || ''), signature = String(b.signature || '');
      if (!/^order_[a-zA-Z0-9]+$/.test(orderId) || !/^pay_[a-zA-Z0-9]+$/.test(paymentId)) throw new AccessError('invalid_payment', 'The payment details are not valid.', 400);
      const ref = db.doc(`creditPayments/${orderId}`), snap = await ref.get(), order = snap.data();
      if (!snap.exists || order.uid !== who.uid) throw new AccessError('payment_not_found', 'No payment order was found for this account.', 404);
      if (!verifyCheckoutSignature(orderId, paymentId, signature, process.env.RAZORPAY_KEY_SECRET || '')) throw new AccessError('invalid_signature', 'Could not verify the payment. If the amount was deducted, please contact support.', 400);
      const payment = await razorpayRequest(`payments/${paymentId}`, { method: 'GET' });
      if (payment.order_id !== orderId || +payment.amount !== +order.amountPaise || payment.currency !== order.currency) throw new AccessError('payment_mismatch', 'The payment details do not match the order. Please contact support.', 409);
      if (payment.status === 'captured') {
        const result = await creditCapturedPayment(db, payment);
        if (!result.ok) throw new AccessError('payment_not_captured', 'Razorpay has not confirmed this payment yet. Please check back shortly.', 409);
        return send(res, 200, { status: 'captured', credited: !result.alreadyCredited, credits: order.credits, balance: Number((await db.doc(`workspaces/${who.uid}`).get()).data()?.credits || 0) });
      }
      await recordPaymentState(db, orderId, { status: payment.status || 'pending', paymentId, paymentMethod: payment.method || '' });
      return send(res, 200, { status: payment.status || 'pending', credited: false, message: 'Waiting for the payment to be confirmed. Please check back shortly.' });
    }
    if (b.action === 'failed') {
      const orderId = String(b.orderId || ''); if (!validOrderId(orderId)) throw new AccessError('invalid_payment', 'The payment order is not valid.', 400);
      const ref = db.doc(`creditPayments/${orderId}`), snap = await ref.get();
      if (!snap.exists || snap.data().uid !== who.uid) throw new AccessError('payment_not_found', 'No payment order was found for this account.', 404);
      await recordPaymentState(db, orderId, { status: 'failed', failureCode: String(b.code || '').slice(0, 80), failureMessage: String(b.description || '').slice(0, 300) });
      return send(res, 200, { ok: true });
    }
    if (b.action === 'cancel') {
      const orderId = String(b.orderId || ''); if (!validOrderId(orderId)) throw new AccessError('invalid_payment', 'The payment order is not valid.', 400);
      const ref = db.doc(`creditPayments/${orderId}`), snap = await ref.get();
      if (!snap.exists || snap.data().uid !== who.uid) throw new AccessError('payment_not_found', 'No payment order was found for this account.', 404);
      await recordPaymentState(db, orderId, { status: 'cancelled' });
      return send(res, 200, { ok: true });
    }
    if (b.action === 'mine') {
      const rows = await db.collection(`workspaces/${who.uid}/creditPayments`).orderBy('createdAt', 'desc').limit(50).get();
      return send(res, 200, { payments: rows.docs.map((d) => ({ id: d.id, ...d.data() })) });
    }
    if (b.action === 'adminList') {
      if (!who.admin) throw new AccessError('admin_required', 'Only an admin can do this.', 403);
      let query = db.collection('creditPayments').orderBy('createdAt', 'desc').limit(100);
      if (typeof b.cursor === 'string' && validOrderId(b.cursor)) {
        const cursor = await db.doc(`creditPayments/${b.cursor}`).get();
        if (cursor.exists) query = query.startAfter(cursor);
      }
      const rows = await query.get();
      return send(res, 200, { payments: rows.docs.map((d) => ({ id: d.id, ...d.data() })), nextCursor: rows.docs.length === 100 ? rows.docs.at(-1).id : null });
    }
    if (b.action === 'adminRevenue') {
      const [captured, settings] = await Promise.all([db.collection('creditPayments').where('status', '==', 'captured').get(), db.doc('paymentSettings/revenue').get()]);
      return send(res, 200, buildRevenue(captured.docs.map((d) => d.data()), settings.data()?.paidUntil || ''));
    }
    if (b.action === 'adminSetPaidUntil') {
      const paidUntil = checkPaidUntil(b.date);
      await db.doc('paymentSettings/revenue').set({ paidUntil, updatedAt: Date.now(), updatedBy: who.uid });
      await audit(db, who, 'payments_paid_until', { paidUntil });
      const captured = await db.collection('creditPayments').where('status', '==', 'captured').get();
      return send(res, 200, buildRevenue(captured.docs.map((d) => d.data()), paidUntil));
    }
    if (b.action === 'adminApprove') {
      // approving credits the Coins, so it only works for an order Razorpay really reports as paid; nothing is credited on the admin's word alone
      const orderId = String(b.orderId || ''); if (!validOrderId(orderId)) throw new AccessError('invalid_payment', 'The payment order is not valid.', 400);
      const snap = await db.doc(`creditPayments/${orderId}`).get();
      if (!snap.exists) throw new AccessError('payment_not_found', 'This payment record was not found.', 404);
      if (snap.data().status === 'captured') return send(res, 200, { status: 'approved', credited: false });
      const found = await razorpayRequest(`orders/${orderId}/payments`, { method: 'GET' }), payment = (found.items || []).find((item) => item.status === 'captured');
      if (!payment) throw new AccessError('payment_not_captured', 'Razorpay has not received a payment for this order, so it cannot be approved.', 409);
      const result = await creditCapturedPayment(db, payment);
      if (!result.ok) throw new AccessError('payment_mismatch', 'The Razorpay payment does not match this order, so it was not approved.', 409);
      await audit(db, who, 'payment_approved', { orderId, paymentId: payment.id });
      return send(res, 200, { status: 'approved', credited: !result.alreadyCredited, credits: result.credits });
    }
    if (b.action === 'adminPurge') {
      // only records that never became a paid purchase can be deleted: a paid one is a financial record and stays
      const ids = [...new Set(Array.isArray(b.orderIds) ? b.orderIds : [])];
      if (!ids.length || ids.length > 100 || !ids.every(validOrderId)) throw new AccessError('invalid_selection', 'Please select between 1 and 100 payment records.', 400);
      const purged = [], skipped = [];
      for (const id of ids) {
        const ref = db.doc(`creditPayments/${id}`), snap = await ref.get();
        if (!snap.exists) { skipped.push({ id, reason: 'not_found' }); continue; }
        if (snap.data().status === 'captured') { skipped.push({ id, reason: 'paid' }); continue; }
        await db.doc(`workspaces/${snap.data().uid}/creditPayments/${id}`).delete();
        await ref.delete();
        purged.push(id);
      }
      if (purged.length) await audit(db, who, 'payments_purged', { orderIds: purged });
      return send(res, 200, { purged, skipped });
    }
    if (b.action === 'adminGroundTruth') {
      // the live list from Razorpay, each payment compared with what this app recorded
      const count = Math.min(Math.max(Math.floor(Number(b.count)) || 20, 1), 50), skip = Math.max(Math.floor(Number(b.skip)) || 0, 0);
      const live = await razorpayRequest(`payments?count=${count}&skip=${skip}`, { method: 'GET' }), items = live.items || [];
      const locals = items.length ? await db.getAll(...items.map((p) => db.doc(`creditPayments/${p.order_id || 'none'}`))) : [];
      const payments = items.map((p, i) => {
        const local = locals[i]?.exists ? locals[i].data() : null;
        const state = !p.order_id || (!local && p.status !== 'captured') ? 'unrelated' : p.status !== 'captured' ? 'not_paid' : local?.status === 'captured' ? 'synced' : 'missing';
        return { id: p.id, orderId: p.order_id || '', amountPaise: Number(p.amount || 0), status: p.status, method: p.method || '', email: p.email || '', createdAt: Number(p.created_at || 0) * 1000, recorded: !!local, state };
      });
      return send(res, 200, { payments, nextSkip: items.length === count ? skip + items.length : null });
    }
    if (b.action === 'adminRecover') {
      // credits a payment Razorpay captured but this app never recorded as paid (for example a closed browser and a missed webhook)
      const paymentId = String(b.paymentId || ''); if (!validPaymentId(paymentId)) throw new AccessError('invalid_payment', 'The payment details are not valid.', 400);
      const payment = await razorpayRequest(`payments/${paymentId}`, { method: 'GET' });
      if (payment.status !== 'captured' || !validOrderId(payment.order_id)) throw new AccessError('payment_not_captured', 'This payment was not captured by Razorpay, so it cannot be recovered.', 409);
      const ref = db.doc(`creditPayments/${payment.order_id}`);
      if (!(await ref.get()).exists) {
        const order = await razorpayRequest(`orders/${payment.order_id}`, { method: 'GET' }), uid = String(order.notes?.uid || ''), plan = planById.get(String(order.notes?.planId || ''));
        if (!/^[A-Za-z0-9_-]{6,128}$/.test(uid) || !plan || +order.amount !== plan.amountPaise || order.currency !== plan.currency) throw new AccessError('order_unknown', 'This order was not created by 12toons, so it cannot be recovered here.', 409);
        try { await services().auth.getUser(uid); } catch { throw new AccessError('user_not_found', 'The account for this payment no longer exists.', 404); }
        const now = Date.now(), record = { orderId: order.id, uid, email: payment.email || '', name: '', planId: plan.id, planName: plan.name, amountPaise: plan.amountPaise, currency: plan.currency, credits: plan.credits, status: 'created', createdAt: Number(order.created_at || 0) * 1000 || now, updatedAt: now, recoveredBy: who.uid };
        await db.runTransaction(async (tx) => { tx.create(ref, record); tx.create(db.doc(`workspaces/${uid}/creditPayments/${order.id}`), record); });
      }
      const result = await creditCapturedPayment(db, payment);
      if (!result.ok) throw new AccessError('payment_mismatch', 'The Razorpay payment does not match the recorded order, so it was not recovered.', 409);
      await audit(db, who, 'payment_recovered', { orderId: payment.order_id, paymentId });
      return send(res, 200, { recovered: !result.alreadyCredited, credits: result.credits });
    }
    throw new AccessError('unknown_action', 'This payment action was not recognized.', 400);
  } catch (e) { return failure(res, e); }
}
