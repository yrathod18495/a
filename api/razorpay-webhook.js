import { services } from '../server/firebase-admin.js';
import { creditCapturedPayment, recordPaymentState, verifyWebhookSignature } from '../server/credit-payments.js';
import { send } from '../server/access.js';

export const config = { api: { bodyParser: false } };

async function rawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw Object.assign(new Error('Webhook ka data bahut bada hai.'), { status: 413 });
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Ye request sahi nahi hai. Page reload karke dobara try karein.' });
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) return send(res, 503, { error: 'Webhook secret set nahi hai.' });
    const raw = await rawBody(req), signature = String(req.headers['x-razorpay-signature'] || '');
    if (!verifyWebhookSignature(raw, signature, secret)) return send(res, 401, { error: 'Webhook ka signature sahi nahi hai.' });
    const event = JSON.parse(raw.toString('utf8')), payment = event.payload?.payment?.entity;
    if (!payment?.order_id || !payment?.id) return send(res, 200, { ok: true, ignored: true });
    const { db } = services();
    if (event.event === 'payment.captured' || event.event === 'order.paid') {
      const result = await creditCapturedPayment(db, payment);
      if (result.reason === 'order_not_found') return send(res, 200, { ok: true, ignored: true });
      if (!result.ok) return send(res, 400, { error: 'Payment saved order se match nahi hui.' });
    } else if (event.event === 'payment.failed') {
      await recordPaymentState(db, payment.order_id, { status: 'failed', paymentId: payment.id, failureCode: payment.error_code || '', failureMessage: String(payment.error_description || '').slice(0, 300) });
    } else if (event.event === 'payment.authorized') {
      await recordPaymentState(db, payment.order_id, { status: 'authorized', paymentId: payment.id, paymentMethod: payment.method || '' });
    }
    return send(res, 200, { ok: true });
  } catch (e) { return send(res, e.status || 500, { error: e.status ? e.message : 'Webhook process nahi ho paya.' }); }
}
