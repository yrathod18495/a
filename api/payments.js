import { randomUUID } from 'node:crypto';
import { services } from '../server/firebase-admin.js';
import { access, bodyOf, send, failure } from '../server/access.js';
import { AccessError } from '../server/security-policy.js';
import { CREDIT_PLANS, publicPlan } from '../shared/credit-plans.js';
import { creditCapturedPayment, paymentConfigReady, razorpayRequest, recordPaymentState, verifyCheckoutSignature } from '../server/credit-payments.js';

const planById = new Map(CREDIT_PLANS.map((p) => [p.id, p]));
const validOrderId = (value) => typeof value === 'string' && /^order_[a-zA-Z0-9]+$/.test(value);

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Ye request sahi nahi hai. Page reload karke dobara try karein.' });
  try {
    const b = await bodyOf(req), who = await access(req, { write: ['createOrder', 'verify'].includes(b.action), admin: b.action === 'adminList' }), { db } = services();
    if (process.env.MAINTENANCE_MODE !== 'false' && !who.admin) throw new AccessError('maintenance', '12toons par abhi maintenance chal raha hai. Thodi der baad try karein.', 503);
    if (b.action === 'catalog') return send(res, 200, {
      keyId: process.env.RAZORPAY_KEY_ID || '', configured: paymentConfigReady(),
      plans: CREDIT_PLANS.map(publicPlan), credits: Number((await db.doc(`workspaces/${who.uid}`).get()).data()?.credits || 0),
    });
    if (b.action === 'createOrder') {
      const plan = planById.get(String(b.planId));
      if (!plan) throw new AccessError('invalid_plan', 'Sahi Gold Coins plan chunein.', 400);
      if (!paymentConfigReady()) throw new AccessError('payments_unconfigured', 'Payment ka setup abhi poora nahi hua hai. Thodi der baad try karein.', 503);
      const order = await razorpayRequest('orders', { method: 'POST', body: JSON.stringify({ amount: plan.amountPaise, currency: plan.currency, receipt: `cr_${randomUUID().replace(/-/g, '')}`, notes: { uid: who.uid, planId: plan.id } }) });
      if (!order.id || +order.amount !== plan.amountPaise || order.currency !== plan.currency) throw new AccessError('invalid_gateway_order', 'Razorpay se galat order mila. Dobara try karein.', 502);
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
      if (!/^order_[a-zA-Z0-9]+$/.test(orderId) || !/^pay_[a-zA-Z0-9]+$/.test(paymentId)) throw new AccessError('invalid_payment', 'Payment ki details sahi nahi hain.', 400);
      const ref = db.doc(`creditPayments/${orderId}`), snap = await ref.get(), order = snap.data();
      if (!snap.exists || order.uid !== who.uid) throw new AccessError('payment_not_found', 'Is account ke liye payment order nahi mila.', 404);
      if (!verifyCheckoutSignature(orderId, paymentId, signature, process.env.RAZORPAY_KEY_SECRET || '')) throw new AccessError('invalid_signature', 'Payment verify nahi ho paya. Agar paisa kat gaya hai to support se sampark karein.', 400);
      const payment = await razorpayRequest(`payments/${paymentId}`, { method: 'GET' });
      if (payment.order_id !== orderId || +payment.amount !== +order.amountPaise || payment.currency !== order.currency) throw new AccessError('payment_mismatch', 'Payment ki details order se match nahi hui. Support se sampark karein.', 409);
      if (payment.status === 'captured') {
        const result = await creditCapturedPayment(db, payment);
        if (!result.ok) throw new AccessError('payment_not_captured', 'Razorpay ne abhi tak is payment ko confirm nahi kiya. Thodi der baad dekhein.', 409);
        return send(res, 200, { status: 'captured', credited: !result.alreadyCredited, credits: order.credits, balance: Number((await db.doc(`workspaces/${who.uid}`).get()).data()?.credits || 0) });
      }
      await recordPaymentState(db, orderId, { status: payment.status || 'pending', paymentId, paymentMethod: payment.method || '' });
      return send(res, 200, { status: payment.status || 'pending', credited: false, message: 'Payment ke confirm hone ka intezaar hai. Thodi der baad dekhein.' });
    }
    if (b.action === 'failed') {
      const orderId = String(b.orderId || ''); if (!validOrderId(orderId)) throw new AccessError('invalid_payment', 'Payment order sahi nahi hai.', 400);
      const ref = db.doc(`creditPayments/${orderId}`), snap = await ref.get();
      if (!snap.exists || snap.data().uid !== who.uid) throw new AccessError('payment_not_found', 'Is account ke liye payment order nahi mila.', 404);
      await recordPaymentState(db, orderId, { status: 'failed', failureCode: String(b.code || '').slice(0, 80), failureMessage: String(b.description || '').slice(0, 300) });
      return send(res, 200, { ok: true });
    }
    if (b.action === 'cancel') {
      const orderId = String(b.orderId || ''); if (!validOrderId(orderId)) throw new AccessError('invalid_payment', 'Payment order sahi nahi hai.', 400);
      const ref = db.doc(`creditPayments/${orderId}`), snap = await ref.get();
      if (!snap.exists || snap.data().uid !== who.uid) throw new AccessError('payment_not_found', 'Is account ke liye payment order nahi mila.', 404);
      await recordPaymentState(db, orderId, { status: 'cancelled' });
      return send(res, 200, { ok: true });
    }
    if (b.action === 'mine') {
      const rows = await db.collection(`workspaces/${who.uid}/creditPayments`).orderBy('createdAt', 'desc').limit(50).get();
      return send(res, 200, { payments: rows.docs.map((d) => ({ id: d.id, ...d.data() })) });
    }
    if (b.action === 'adminList') {
      if (!who.admin) throw new AccessError('admin_required', 'Ye kaam sirf admin kar sakta hai.', 403);
      let query = db.collection('creditPayments').orderBy('createdAt', 'desc').limit(100);
      if (typeof b.cursor === 'string' && validOrderId(b.cursor)) {
        const cursor = await db.doc(`creditPayments/${b.cursor}`).get();
        if (cursor.exists) query = query.startAfter(cursor);
      }
      const rows = await query.get();
      return send(res, 200, { payments: rows.docs.map((d) => ({ id: d.id, ...d.data() })), nextCursor: rows.docs.length === 100 ? rows.docs.at(-1).id : null });
    }
    throw new AccessError('unknown_action', 'Ye payment action pehchana nahi gaya.', 400);
  } catch (e) { return failure(res, e); }
}
