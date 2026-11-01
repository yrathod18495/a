import { createHash, randomUUID } from 'node:crypto';
import { services } from '../server/firebase-admin.js';
import { maintenanceOn } from '../server/maintenance.js';
import { access, bodyOf, send, failure } from '../server/access.js';
import { AccessError } from '../server/security-policy.js';
import { walletBalance, checkWithdrawalAmount, cleanPayoutDetails, publicWithdrawal } from '../server/affiliate-wallet.js';

const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const emailOK = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
const statusOK = new Set(['new', 'contacted', 'approved', 'declined']);
const ipHash = req => createHash('sha256').update(String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown').split(',')[0].trim()).digest('hex');

/** The approved partner profile that belongs to the signed-in Google account (also links the account on first use). */
async function linkedPartner(db, who) {
  const email = String(who.claims.email || '').trim().toLowerCase();
  if (!email) throw new AccessError('affiliate_unavailable', 'Please sign in with the email the application was approved with.', 403);
  const matches = await db.collection('affiliatePartners').where('email', '==', email).limit(10).get();
  const partnerDoc = matches.docs.find(d => d.data()?.status === 'approved' && (!d.data()?.affiliateUid || d.data().affiliateUid === who.uid));
  if (!partnerDoc) throw new AccessError('affiliate_unavailable', 'No approved affiliate profile is linked to this Google account.', 403);
  const partnerRef = db.doc(`affiliatePartners/${partnerDoc.id}`);
  if (!partnerDoc.data().affiliateUid) await partnerRef.set({ affiliateUid: who.uid, linkedAt: Date.now() }, { merge: true });
  return { id: partnerDoc.id, partner: partnerDoc.data(), ref: partnerRef };
}
const walletRef = (db, id) => db.doc(`affiliatePartners/${id}/tracking/wallet`);
const withdrawalRows = async (db, id, limit) => (await db.collection(`affiliatePartners/${id}/withdrawals`).orderBy('requestedAt', 'desc').limit(limit).get()).docs.map(d => ({ id: d.id, ...d.data() }));

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'This request is not valid. Please reload the page and try again.' });
  try {
    const b = await bodyOf(req, 16000), isAdmin = ['adminList', 'adminStatus', 'adminSettings', 'adminPayout', 'adminWithdrawal'].includes(b.action);
    const isUser = ['attribute', 'dashboard', 'withdraw'].includes(b.action);
    const who = isAdmin ? await access(req, { admin: true, write: ['adminStatus', 'adminSettings', 'adminPayout', 'adminWithdrawal'].includes(b.action) }) : isUser ? await access(req, { write: b.action === 'attribute' || b.action === 'withdraw' }) : null;
    const { db } = services();
    if (b.action === 'click') {
      const code = text(b.code, 12).toUpperCase();
      if (!/^[A-Z0-9]{8,12}$/.test(code)) return send(res, 200, { tracked: false });
      const match = await db.collection('affiliatePartners').where('referralCode', '==', code).limit(10).get();
      const partner = match.docs.find(d => d.data()?.status === 'approved');
      if (!partner) return send(res, 200, { tracked: false });
      const day = new Date().toISOString().slice(0, 10), ip = ipHash(req), clickRef = db.doc(`affiliatePartners/${partner.id}/clicks/${day}_${ip}`), totalRef = db.doc(`affiliatePartners/${partner.id}/tracking/summary`);
      await db.runTransaction(async tx => {
        const [click, total] = await tx.getAll(clickRef, totalRef);
        if (click.exists) return;
        tx.create(clickRef, { day, clickedAt: Date.now() });
        tx.set(totalRef, { clicks: (total.data()?.clicks || 0) + 1, updatedAt: Date.now() }, { merge: true });
      });
      return send(res, 200, { tracked: true });
    }
    if (b.action === 'submit') {
      if (await maintenanceOn(db)) throw new AccessError('maintenance', 'The affiliate form is closed for a short while. Please try again later.', 503);
      if (text(b.website, 200)) return send(res, 200, { submitted: true }); // honeypot
      const name = text(b.name, 120), email = text(b.email, 254).toLowerCase(), phone = text(b.phone, 32), company = text(b.company, 120), platform = text(b.platform, 80), audience = text(b.audience, 80), profile = text(b.profile, 400), message = text(b.message, 1500);
      if (name.length < 2) throw new AccessError('invalid_name', 'Please enter your name (at least 2 characters).', 400);
      if (!emailOK(email)) throw new AccessError('invalid_email', 'Please enter a valid email address.', 400);
      if (phone.replace(/\D/g, '').length < 7 || phone.length > 32) throw new AccessError('invalid_phone', 'Please enter a phone or WhatsApp number where you can be reached.', 400);
      if (!company || !platform) throw new AccessError('missing_details', 'Please also enter your organization and platform name.', 400);
      if (profile && !/^https:\/\//i.test(profile)) throw new AccessError('invalid_profile', 'The profile or channel link must start with https://.', 400);
      if (b.consent !== true) throw new AccessError('consent_required', 'Please accept the data-use notice before submitting.', 400);
      const now = Date.now(), day = new Date(now).toISOString().slice(0, 10), rateRef = db.doc(`affiliateRateLimits/${day}_${ipHash(req)}`);
      await db.runTransaction(async tx => {
        const snap = await tx.get(rateRef), rate = snap.data() || {};
        if ((rate.count || 0) >= 3) throw new AccessError('rate_limited', 'Today\'s submission limit has been reached. Please try again tomorrow.', 429);
        tx.set(rateRef, { count: (rate.count || 0) + 1, day, updatedAt: now }, { merge: true });
      });
      const id = randomUUID();
      await db.doc(`affiliatePartners/${id}`).set({ id, name, email, phone, company, platform, audience, profile, message, consentAt: now, status: 'new', createdAt: now, updatedAt: now });
      return send(res, 201, { submitted: true, id });
    }
    if (b.action === 'attribute') {
      if (!who.admin && await maintenanceOn(db)) throw new AccessError('maintenance', 'Affiliate referrals are closed for a short while. Please try again later.', 503);
      const code = text(b.code, 12).toUpperCase();
      if (!/^[A-Z0-9]{8,12}$/.test(code)) return send(res, 200, { attributed: false, reason: 'invalid_code' });
      const [account, existing] = await Promise.all([services().auth.getUser(who.uid), db.doc(`affiliateReferrals/${who.uid}`).get()]);
      if (existing.exists) return send(res, 200, { attributed: false, reason: 'already_attributed' });
      const createdAt = Date.parse(account.metadata?.creationTime || '');
      if (!Number.isFinite(createdAt) || Date.now() - createdAt > 7 * 86400000 || createdAt > Date.now() + 60000) return send(res, 200, { attributed: false, reason: 'account_not_new' });
      const match = await db.collection('affiliatePartners').where('referralCode', '==', code).limit(10).get();
      const partnerDoc = match.docs.find(d => d.data()?.status === 'approved');
      if (!partnerDoc) return send(res, 200, { attributed: false, reason: 'invalid_code' });
      const partner = partnerDoc.data();
      if (partner.affiliateUid === who.uid || String(partner.email || '').toLowerCase() === String(who.claims.email || '').toLowerCase()) return send(res, 200, { attributed: false, reason: 'self_referral' });
      const ref = db.doc(`affiliateReferrals/${who.uid}`), now = Date.now();
      await db.runTransaction(async tx => {
        const current = await tx.get(ref);
        if (!current.exists) tx.create(ref, { uid: who.uid, affiliateId: partnerDoc.id, referralCode: code, signupAt: now, conversions: 0, commissionPaise: 0 });
      });
      return send(res, 200, { attributed: true });
    }
    if (b.action === 'dashboard') {
      const { id, partner, ref: partnerRef } = await linkedPartner(db, who);
      const [clicks, referrals, commissions, wallet, withdrawals] = await Promise.all([
        partnerRef.collection('tracking').doc('summary').get(),
        db.collection('affiliateReferrals').where('affiliateId', '==', id).get(),
        partnerRef.collection('commissions').orderBy('createdAt', 'desc').get(),
        walletRef(db, id).get(),
        withdrawalRows(db, id, 50),
      ]);
      const commissionRows = commissions.docs.map(d => ({ id: d.id, ...d.data() })), money = walletBalance(commissionRows, wallet.data());
      return send(res, 200, { partner: { name: partner.name, referralCode: partner.referralCode }, clicks: Number(clicks.data()?.clicks || 0), referrals: referrals.docs.length, conversions: commissionRows.length, commissionPaise: money.earnedPaise, pendingPaise: money.pendingPaise, paidPaise: money.paidPaise, wallet: money, withdrawals: withdrawals.map(publicWithdrawal), commissions: commissionRows.map(c => ({ id: c.id, createdAt: c.createdAt, planName: c.planName, amountPaise: c.amountPaise, commissionPercent: c.commissionPercent, commissionPaise: c.commissionPaise, payoutStatus: c.payoutStatus, paidAt: c.paidAt || null })) });
    }
    if (b.action === 'withdraw') {
      if (!who.admin && await maintenanceOn(db)) throw new AccessError('maintenance', 'Withdrawals are closed for a short while. Please try again later.', 503);
      const { id, partner, ref: partnerRef } = await linkedPartner(db, who);
      const amountPaise = Number(b.amountPaise), payout = cleanPayoutDetails(b.payout);
      // what the partner has earned (read before the transaction: commissions only ever grow, and a hand-marked payout is re-checked when the admin approves)
      const commissions = (await partnerRef.collection('commissions').get()).docs.map(d => d.data()), wRef = walletRef(db, id), withdrawalId = randomUUID(), now = Date.now();
      await db.runTransaction(async tx => {
        const wallet = (await tx.get(wRef)).data() || {};
        if (wallet.pendingWithdrawalId) throw new AccessError('withdrawal_pending', 'You already have a withdrawal request waiting for approval. Please wait for it to be reviewed.', 409);
        checkWithdrawalAmount(amountPaise, walletBalance(commissions, wallet).availablePaise);
        tx.create(db.doc(`affiliatePartners/${id}/withdrawals/${withdrawalId}`), { id: withdrawalId, affiliateId: id, affiliateUid: who.uid, partnerName: partner.name || '', partnerEmail: partner.email || '', amountPaise, payout, status: 'pending', requestedAt: now });
        tx.set(wRef, { reservedPaise: Math.max(0, Number(wallet.reservedPaise || 0)) + amountPaise, pendingWithdrawalId: withdrawalId, updatedAt: now }, { merge: true });
      });
      return send(res, 201, { requested: true, id: withdrawalId });
    }
    if (b.action === 'adminSettings') {
      const ref = db.doc('affiliateSettings/config');
      if (b.save === true) {
        const percent = Number(b.commissionPercent);
        if (!Number.isFinite(percent) || percent < 1 || percent > 50) throw new AccessError('invalid_commission_rate', 'The commission rate must be between 1% and 50%.', 400);
        await ref.set({ commissionPercent: percent, updatedAt: Date.now(), updatedBy: who.uid }, { merge: true });
      }
      return send(res, 200, { commissionPercent: Number((await ref.get()).data()?.commissionPercent || 10) });
    }
    if (b.action === 'adminList') {
      const snap = await db.collection('affiliatePartners').orderBy('createdAt', 'desc').limit(200).get();
      const affiliates = await Promise.all(snap.docs.map(async d => {
        const ref = db.doc(`affiliatePartners/${d.id}`), [tracking, referrals, commissions, wallet, withdrawals] = await Promise.all([ref.collection('tracking').doc('summary').get(), db.collection('affiliateReferrals').where('affiliateId', '==', d.id).get(), ref.collection('commissions').get(), walletRef(db, d.id).get(), withdrawalRows(db, d.id, 100)]);
        const rows = commissions.docs.map(c => c.data()), money = walletBalance(rows, wallet.data());
        return { id: d.id, ...d.data(), stats: { clicks: Number(tracking.data()?.clicks || 0), referrals: referrals.docs.length, conversions: rows.length, commissionPaise: money.earnedPaise, pendingPaise: money.pendingPaise, paidPaise: money.paidPaise }, wallet: money, withdrawals, commissions: commissions.docs.map(c => ({ id: c.id, ...c.data() })).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100) };
      }));
      return send(res, 200, { affiliates });
    }
    if (b.action === 'adminStatus') {
      if (typeof b.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(b.id) || !statusOK.has(b.status)) throw new AccessError('invalid_update', 'Please choose a valid application and status.', 400);
      const ref = db.doc(`affiliatePartners/${b.id}`), snap = await ref.get();
      if (!snap.exists) throw new AccessError('not_found', 'Affiliate application not found.', 404);
      const partner = snap.data(), code = b.status === 'approved' ? (partner.referralCode || randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()) : partner.referralCode || '';
      await ref.set({ status: b.status, ...(code ? { referralCode: code, affiliateUid: partner.affiliateUid || null } : {}), updatedAt: Date.now(), updatedBy: who.uid }, { merge: true });
      return send(res, 200, { updated: true, referralCode: code || null });
    }
    if (b.action === 'adminPayout') {
      const id = text(b.id, 40), commissionId = text(b.commissionId, 100), payoutReference = text(b.payoutReference, 120);
      if (!/^[0-9a-f-]{36}$/i.test(id) || !/^order_[a-zA-Z0-9]+$/.test(commissionId) || b.status !== 'paid' || payoutReference.length < 2) throw new AccessError('invalid_payout', 'Please choose a commission and enter a payout reference.', 400);
      const ref = db.doc(`affiliatePartners/${id}/commissions/${commissionId}`), snap = await ref.get();
      if (!snap.exists) throw new AccessError('commission_not_found', 'Commission record not found.', 404);
      await db.runTransaction(async tx => {
        const current = await tx.get(ref);
        if (!current.exists) throw new AccessError('commission_not_found', 'Commission record not found.', 404);
        if (current.data()?.payoutStatus === 'paid') throw new AccessError('already_paid', 'This commission is already marked as paid.', 409);
        tx.set(ref, { payoutStatus: 'paid', paidAt: Date.now(), payoutReference, paidBy: who.uid }, { merge: true });
      });
      return send(res, 200, { updated: true });
    }
    if (b.action === 'adminWithdrawal') {
      const id = text(b.id, 40), withdrawalId = text(b.withdrawalId, 40), note = text(b.note, 200);
      if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(withdrawalId) || !['approved', 'rejected'].includes(b.decision)) throw new AccessError('invalid_withdrawal', 'Please choose a withdrawal request and approve or reject it.', 400);
      const ref = db.doc(`affiliatePartners/${id}/withdrawals/${withdrawalId}`), wRef = walletRef(db, id);
      const commissions = (await db.collection(`affiliatePartners/${id}/commissions`).get()).docs.map(d => d.data()), now = Date.now();
      await db.runTransaction(async tx => {
        const [request, walletSnap] = await tx.getAll(ref, wRef), wallet = walletSnap.data() || {}, amount = Number(request.data()?.amountPaise || 0);
        if (!request.exists) throw new AccessError('withdrawal_not_found', 'Withdrawal request not found.', 404);
        if (request.data().status !== 'pending') throw new AccessError('withdrawal_not_pending', 'This withdrawal request has already been reviewed.', 409);
        const reserved = Math.max(0, Number(wallet.reservedPaise || 0) - amount), withdrawn = Math.max(0, Number(wallet.withdrawnPaise || 0)) + (b.decision === 'approved' ? amount : 0);
        // an approval moves the money out of the partner's balance: it must still be covered by what they have earned
        if (b.decision === 'approved' && walletBalance(commissions, { withdrawnPaise: wallet.withdrawnPaise }).pendingPaise < amount) throw new AccessError('insufficient_balance', 'The partner no longer has enough commission for this withdrawal.', 409);
        tx.set(ref, { status: b.decision, reviewedAt: now, reviewedBy: who.uid, ...(b.decision === 'approved' ? { payoutReference: text(b.payoutReference, 120) } : { reason: note }) }, { merge: true });
        tx.set(wRef, { reservedPaise: reserved, withdrawnPaise: withdrawn, pendingWithdrawalId: null, updatedAt: now }, { merge: true });
      });
      return send(res, 200, { updated: true, status: b.decision });
    }
    throw new AccessError('invalid_action', 'This affiliate action is not supported.', 400);
  } catch (e) { return failure(res, e); }
}
