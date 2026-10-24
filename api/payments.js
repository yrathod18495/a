import { randomUUID } from 'node:crypto';
import { services } from '../server/firebase-admin.js';
import { access, bodyOf, send, failure } from '../server/access.js';
import { AccessError } from '../server/security-policy.js';
import { CREDIT_PLANS, publicPlan } from '../shared/credit-plans.js';
import { creditCapturedPayment, paymentConfigReady, razorpayRequest, recordPaymentState, verifyCheckoutSignature } from '../server/credit-payments.js';

const planById = new Map(CREDIT_PLANS.map((p) => [p.id, p]));
const validOrderId = (value) => typeof value === 'string' && /^order_[a-zA-Z0-9]+$/.test(value);

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST required' });
  try {
    const b = await bodyOf(req), who = await access(req, { write: ['createOrder', 'verify'].includes(b.action), admin: b.action === 'adminList' }), { db } = services();
    if (process.env.MAINTENANCE_MODE !== 'false' && !who.admin) throw new AccessError('maintenance', '12toons is temporarily under maintenance.', 503);
    if (b.action === 'catalog') return send(res, 200, {
      keyId: process.env.RAZORPAY_KEY_ID || '', configured: paymentConfigReady(),
      plans: CREDIT_PLANS.map(publicPlan), credits: Number((await db.doc(`workspaces/${who.uid}`).get()).data()?.credits || 0),
    });
    if (b.action === 'createOrder') {
      const plan = planById.get(String(b.planId));
      if (!plan) throw new AccessError('invalid_plan', 'Choose a valid credit plan.', 400);
      if (!paymentConfigReady()) throw new AccessError('payments_unconfigured', 'Payment setup is not complete yet.', 503);
      const order = await razorpayRequest('orders', { method: 'POST', body: JSON.stringify({ amount: plan.amountPaise, currency: plan.currency, receipt: `cr_${randomUUID().replace(/-/g, '')}`, notes: { uid: who.uid, planId: plan.id } }) });
      if (!order.id || +order.amount !== plan.amountPaise || order.currency !== plan.currency) throw new AccessError('invalid_gateway_order', 'Razorpay returned an invalid order.', 502);
      const now = Date.now(), record = {
        orderId: order.id, uid: who.uid, email: who.claims.email || '', name: who.claims.name || '',
        planId: plan.id, planName: plan.name, amountPaise: plan.amountPaise, currency: plan.currency,
        credits: plan.credits, status: 'created', createdAt: now, updatedAt: now,
      };
      const ref = db.doc(`creditPayments/${order.id}`), userRef = db.doc(`workspaces/${who.uid}/creditPayments/${order.id}`);
      await db.runTransaction(async (tx) => { tx.create(ref, record); tx.create(userRef, record); });
      return send(res, 200, { keyId: process.env.RAZORPAY_KEY_ID, orderId: order.id, amountPaise: plan.amountPaise, currency: plan.currency, plan: publicPlan(plan) });
    }
    if (b.action === 'verify') {
      const orderId = String(b.orderId || ''), paymentId = String(b.paymentId || ''), signature = String(b.signature || '');
      if (!/^order_[a-zA-Z0-9]+$/.test(orderId) || !/^pay_[a-zA-Z0-9]+$/.test(paymentId)) throw new AccessError('invalid_payment', 'Invalid payment details.', 400);
      const ref = db.doc(`creditPayments/${orderId}`), snap = await ref.get(), order = snap.data();
      if (!snap.exists || order.uid !== who.uid) throw new AccessError('payment_not_found', 'Payment order not found for this account.', 404);
      if (!verifyCheckoutSignature(orderId, paymentId, signature, process.env.RAZORPAY_KEY_SECRET || '')) throw new AccessError('invalid_signature', 'Payment verification failed.', 400);
      const payment = await razorpayRequest(`payments/${paymentId}`, { method: 'GET' });
      if (payment.order_id !== orderId || +payment.amount !== +order.amountPaise || payment.currency !== order.currency) throw new AccessError('payment_mismatch', 'Payment details did not match the order.', 409);
      if (payment.status === 'captured') {
        const result = await creditCapturedPayment(db, payment);
        if (!result.ok) throw new AccessError('payment_not_captured', 'Razorpay has not confirmed this payment yet.', 409);
        return send(res, 200, { status: 'captured', credited: !result.alreadyCredited, credits: order.credits, balance: Number((await db.doc(`workspaces/${who.uid}`).get()).data()?.credits || 0) });
      }
      await recordPaymentState(db, orderId, { status: payment.status || 'pending', paymentId, paymentMethod: payment.method || '' });
      return send(res, 200, { status: payment.status || 'pending', credited: false, message: 'Payment is awaiting capture confirmation.' });
    }
    if (b.action === 'failed') {
      const orderId = String(b.orderId || ''); if (!validOrderId(orderId)) throw new AccessError('invalid_payment', 'Invalid payment order.', 400);
      const ref = db.doc(`creditPayments/${orderId}`), snap = await ref.get();
      if (!snap.exists || snap.data().uid !== who.uid) throw new AccessError('payment_not_found', 'Payment order not found for this account.', 404);
      await recordPaymentState(db, orderId, { status: 'failed', failureCode: String(b.code || '').slice(0, 80), failureMessage: String(b.description || '').slice(0, 300) });
      return send(res, 200, { ok: true });
    }
    if (b.action === 'cancel') {
      const orderId = String(b.orderId || ''); if (!validOrderId(orderId)) throw new AccessError('invalid_payment', 'Invalid payment order.', 400);
      const ref = db.doc(`creditPayments/${orderId}`), snap = await ref.get();
      if (!snap.exists || snap.data().uid !== who.uid) throw new AccessError('payment_not_found', 'Payment order not found for this account.', 404);
      await recordPaymentState(db, orderId, { status: 'cancelled' });
      return send(res, 200, { ok: true });
    }
    if (b.action === 'mine') {
      const rows = await db.collection(`workspaces/${who.uid}/creditPayments`).orderBy('createdAt', 'desc').limit(50).get();
      return send(res, 200, { payments: rows.docs.map((d) => ({ id: d.id, ...d.data() })) });
    }
    if (b.action === 'adminList') {
      if (!who.admin) throw new AccessError('admin_required', 'Admin permission required.', 403);
      let query = db.collection('creditPayments').orderBy('createdAt', 'desc').limit(100);
      if (typeof b.cursor === 'string' && validOrderId(b.cursor)) {
        const cursor = await db.doc(`creditPayments/${b.cursor}`).get();
        if (cursor.exists) query = query.startAfter(cursor);
      }
      const rows = await query.get();
      return send(res, 200, { payments: rows.docs.map((d) => ({ id: d.id, ...d.data() })), nextCursor: rows.docs.length === 100 ? rows.docs.at(-1).id : null });
    }
    throw new AccessError('unknown_action', 'Unknown payment action.', 400);
  } catch (e) { return failure(res, e); }
}
