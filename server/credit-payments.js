import { createHmac, timingSafeEqual } from 'node:crypto';

const hexEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || !/^[a-f\d]+$/i.test(a) || !/^[a-f\d]+$/i.test(b)) return false;
  const aa = Buffer.from(a, 'hex'), bb = Buffer.from(b, 'hex');
  return aa.length === bb.length && timingSafeEqual(aa, bb);
};
export const signatureFor = (orderId, paymentId, secret) => createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
export const verifyCheckoutSignature = (orderId, paymentId, signature, secret) => hexEqual(signatureFor(orderId, paymentId, secret), signature);
export const verifyWebhookSignature = (raw, signature, secret) => hexEqual(createHmac('sha256', secret).update(raw).digest('hex'), signature);

const basicAuth = () => `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64')}`;
export const paymentConfigReady = () => !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
export async function razorpayRequest(path, options = {}) {
  if (!paymentConfigReady()) throw Object.assign(new Error('Razorpay ki keys set nahi hain.'), { status: 503, code: 'payments_unconfigured' });
  const response = await fetch(`https://api.razorpay.com/v1/${path}`, {
    ...options,
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/json', ...(options.headers || {}) },
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error?.description || 'Razorpay ki request fail ho gayi. Dobara try karein.'), { status: 502, code: 'razorpay_error' });
  return data;
}

const paid = (entry) => entry?.status === 'captured';
export async function recordPaymentState(db, orderId, patch) {
  const ref = db.doc(`creditPayments/${orderId}`), snap = await ref.get();
  if (!snap.exists) return false;
  const row = snap.data();
  if (paid(row) && patch.status !== 'captured') return true;
  const userRef = db.doc(`workspaces/${row.uid}/creditPayments/${orderId}`);
  await db.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    if (!current.exists) return;
    const data = current.data();
    if (paid(data) && patch.status !== 'captured') return;
    tx.set(ref, { ...patch, updatedAt: Date.now() }, { merge: true });
    tx.set(userRef, { ...patch, updatedAt: Date.now() }, { merge: true });
  });
  return true;
}

/** Call only after Razorpay's payment entity reports captured. Idempotent across browser callback and webhook. */
export async function creditCapturedPayment(db, payment) {
  const orderId = payment?.order_id, paymentId = payment?.id;
  if (!orderId || !paymentId || payment.status !== 'captured') return { ok: false, reason: 'not_captured' };
  const paymentRef = db.doc(`creditPayments/${orderId}`), paymentSnap = await paymentRef.get();
  if (!paymentSnap.exists) return { ok: false, reason: 'order_not_found' };
  const order = paymentSnap.data();
  if (+payment.amount !== +order.amountPaise || payment.currency !== order.currency) return { ok: false, reason: 'amount_mismatch' };
  const userPaymentRef = db.doc(`workspaces/${order.uid}/creditPayments/${orderId}`), workspaceRef = db.doc(`workspaces/${order.uid}`);
  const affiliateRef = db.doc(`affiliateReferrals/${order.uid}`), settingsRef = db.doc('affiliateSettings/config'), entitlementRef = db.doc(`entitlements/${order.uid}`);
  let credited = false;
  await db.runTransaction(async (tx) => {
    credited = false;
    const [currentPayment, userProfile, affiliateReferral, affiliateSettings, entitlement] = await tx.getAll(paymentRef, workspaceRef, affiliateRef, settingsRef, entitlementRef);
    if (!currentPayment.exists) return;
    const current = currentPayment.data();
    if (+current.amountPaise !== +payment.amount || current.currency !== payment.currency) throw Object.assign(new Error('Payment ki raqam order se match nahi hui.'), { status: 409, code: 'payment_amount_mismatch' });
    if (paid(current)) return;
    const attribution = affiliateReferral.exists ? affiliateReferral.data() : null;
    const affiliateRefDoc = attribution?.affiliateId ? db.doc(`affiliatePartners/${attribution.affiliateId}`) : null;
    const affiliatePartner = affiliateRefDoc ? await tx.get(affiliateRefDoc) : null;
    const currentCredits = Number(userProfile.data()?.credits || 0);
    if (!Number.isSafeInteger(currentCredits) || currentCredits < 0 || !Number.isSafeInteger(currentCredits + current.credits)) throw new Error('Account ka credit balance sahi nahi hai. Support se sampark karein.');
    const now = Date.now(), update = { status: 'captured', paymentId, capturedAt: now, updatedAt: now };
    tx.set(workspaceRef, { credits: currentCredits + current.credits }, { merge: true });
    tx.set(paymentRef, update, { merge: true });
    tx.set(userPaymentRef, update, { merge: true });
    tx.set(entitlementRef, { tier: 'paid', source: 'purchase', paidSince: entitlement.data()?.paidSince || now, lastOrderId: orderId, updatedAt: now }, { merge: true });   // a captured purchase makes the account paid (longer exports)
    if (affiliateRefDoc && affiliatePartner?.data()?.status === 'approved') {
      const commissionPercent = Number(affiliateSettings.data()?.commissionPercent || 10), commissionPaise = Math.round(Number(current.amountPaise) * commissionPercent / 100);
      const commissionRef = affiliateRefDoc.collection('commissions').doc(orderId);
      tx.create(commissionRef, { orderId, paymentId, uid: order.uid, planId: current.planId, planName: current.planName, amountPaise: current.amountPaise, currency: current.currency, commissionPercent, commissionPaise, payoutStatus: 'pending', createdAt: now });
      tx.set(affiliateRef, { conversions: Number(attribution.conversions || 0) + 1, commissionPaise: Number(attribution.commissionPaise || 0) + commissionPaise, lastConversionAt: now }, { merge: true });
    }
    credited = true;
  });
  return { ok: true, alreadyCredited: !credited, credits: order.credits };
}

