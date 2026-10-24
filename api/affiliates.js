import { createHash, randomUUID } from 'node:crypto';
import { services } from '../server/firebase-admin.js';
import { access, bodyOf, send, failure } from '../server/access.js';
import { AccessError } from '../server/security-policy.js';

const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const emailOK = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
const statusOK = new Set(['new', 'contacted', 'approved', 'declined']);
const ipHash = req => createHash('sha256').update(String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown').split(',')[0].trim()).digest('hex');

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST required' });
  try {
    const b = await bodyOf(req, 16000), isAdmin = ['adminList', 'adminStatus', 'adminSettings', 'adminPayout'].includes(b.action);
    const isUser = ['attribute', 'dashboard'].includes(b.action);
    const who = isAdmin ? await access(req, { admin: true, write: ['adminStatus', 'adminSettings', 'adminPayout'].includes(b.action) }) : isUser ? await access(req, { write: b.action === 'attribute' }) : null;
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
      if (process.env.MAINTENANCE_MODE !== 'false') throw new AccessError('maintenance', 'The affiliate form is temporarily unavailable.', 503);
      if (text(b.website, 200)) return send(res, 200, { submitted: true }); // honeypot
      const name = text(b.name, 120), email = text(b.email, 254).toLowerCase(), phone = text(b.phone, 32), company = text(b.company, 120), platform = text(b.platform, 80), audience = text(b.audience, 80), profile = text(b.profile, 400), message = text(b.message, 1500);
      if (name.length < 2) throw new AccessError('invalid_name', 'Enter your name (at least 2 characters).', 400);
      if (!emailOK(email)) throw new AccessError('invalid_email', 'Enter a valid email address.', 400);
      if (phone.replace(/\D/g, '').length < 7 || phone.length > 32) throw new AccessError('invalid_phone', 'Enter a reachable phone or WhatsApp number.', 400);
      if (!company || !platform) throw new AccessError('missing_details', 'Add your organization and the platform you represent.', 400);
      if (profile && !/^https:\/\//i.test(profile)) throw new AccessError('invalid_profile', 'Profile or channel links must start with https://.', 400);
      if (b.consent !== true) throw new AccessError('consent_required', 'Please agree to the data-use notice before submitting.', 400);
      const now = Date.now(), day = new Date(now).toISOString().slice(0, 10), rateRef = db.doc(`affiliateRateLimits/${day}_${ipHash(req)}`);
      await db.runTransaction(async tx => {
        const snap = await tx.get(rateRef), rate = snap.data() || {};
        if ((rate.count || 0) >= 3) throw new AccessError('rate_limited', 'Submission limit reached for today. Please try again tomorrow.', 429);
        tx.set(rateRef, { count: (rate.count || 0) + 1, day, updatedAt: now }, { merge: true });
      });
      const id = randomUUID();
      await db.doc(`affiliatePartners/${id}`).set({ id, name, email, phone, company, platform, audience, profile, message, consentAt: now, status: 'new', createdAt: now, updatedAt: now });
      return send(res, 201, { submitted: true, id });
    }
    if (b.action === 'attribute') {
      if (process.env.MAINTENANCE_MODE !== 'false' && !who.admin) throw new AccessError('maintenance', 'Affiliate referrals are temporarily unavailable.', 503);
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
      const email = String(who.claims.email || '').trim().toLowerCase();
      if (!email) throw new AccessError('affiliate_unavailable', 'Sign in with the email used on your approved application.', 403);
      const matches = await db.collection('affiliatePartners').where('email', '==', email).limit(10).get();
      const partnerDoc = matches.docs.find(d => d.data()?.status === 'approved' && (!d.data()?.affiliateUid || d.data().affiliateUid === who.uid));
      if (!partnerDoc) throw new AccessError('affiliate_unavailable', 'No approved affiliate profile is linked to this Google account.', 403);
      const partner = partnerDoc.data(), partnerRef = db.doc(`affiliatePartners/${partnerDoc.id}`);
      if (!partner.affiliateUid) await partnerRef.set({ affiliateUid: who.uid, linkedAt: Date.now() }, { merge: true });
      const [clicks, referrals, commissions] = await Promise.all([
        partnerRef.collection('tracking').doc('summary').get(),
        db.collection('affiliateReferrals').where('affiliateId', '==', partnerDoc.id).get(),
        partnerRef.collection('commissions').orderBy('createdAt', 'desc').get(),
      ]);
      const commissionRows = commissions.docs.map(d => ({ id: d.id, ...d.data() }));
      const total = commissionRows.reduce((n, c) => n + Number(c.commissionPaise || 0), 0), pending = commissionRows.filter(c => c.payoutStatus !== 'paid').reduce((n, c) => n + Number(c.commissionPaise || 0), 0), paid = total - pending;
      return send(res, 200, { partner: { name: partner.name, referralCode: partner.referralCode }, clicks: Number(clicks.data()?.clicks || 0), referrals: referrals.docs.length, conversions: commissionRows.length, commissionPaise: total, pendingPaise: pending, paidPaise: paid, commissions: commissionRows.map(c => ({ id: c.id, createdAt: c.createdAt, planName: c.planName, amountPaise: c.amountPaise, commissionPercent: c.commissionPercent, commissionPaise: c.commissionPaise, payoutStatus: c.payoutStatus, paidAt: c.paidAt || null })) });
    }
    if (b.action === 'adminSettings') {
      const ref = db.doc('affiliateSettings/config');
      if (b.save === true) {
        const percent = Number(b.commissionPercent);
        if (!Number.isFinite(percent) || percent < 1 || percent > 50) throw new AccessError('invalid_commission_rate', 'Commission rate must be between 1% and 50%.', 400);
        await ref.set({ commissionPercent: percent, updatedAt: Date.now(), updatedBy: who.uid }, { merge: true });
      }
      return send(res, 200, { commissionPercent: Number((await ref.get()).data()?.commissionPercent || 10) });
    }
    if (b.action === 'adminList') {
      const snap = await db.collection('affiliatePartners').orderBy('createdAt', 'desc').limit(200).get();
      const affiliates = await Promise.all(snap.docs.map(async d => {
        const ref = db.doc(`affiliatePartners/${d.id}`), [tracking, referrals, commissions] = await Promise.all([ref.collection('tracking').doc('summary').get(), db.collection('affiliateReferrals').where('affiliateId', '==', d.id).get(), ref.collection('commissions').get()]);
        const rows = commissions.docs.map(c => c.data()), pending = rows.filter(c => c.payoutStatus !== 'paid').reduce((n, c) => n + Number(c.commissionPaise || 0), 0), total = rows.reduce((n, c) => n + Number(c.commissionPaise || 0), 0);
        return { id: d.id, ...d.data(), stats: { clicks: Number(tracking.data()?.clicks || 0), referrals: referrals.docs.length, conversions: rows.length, commissionPaise: total, pendingPaise: pending, paidPaise: total - pending }, commissions: commissions.docs.map(c => ({ id: c.id, ...c.data() })).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100) };
      }));
      return send(res, 200, { affiliates });
    }
    if (b.action === 'adminStatus') {
      if (typeof b.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(b.id) || !statusOK.has(b.status)) throw new AccessError('invalid_update', 'Choose a valid application and status.', 400);
      const ref = db.doc(`affiliatePartners/${b.id}`), snap = await ref.get();
      if (!snap.exists) throw new AccessError('not_found', 'Affiliate application not found.', 404);
      const partner = snap.data(), code = b.status === 'approved' ? (partner.referralCode || randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()) : partner.referralCode || '';
      await ref.set({ status: b.status, ...(code ? { referralCode: code, affiliateUid: partner.affiliateUid || null } : {}), updatedAt: Date.now(), updatedBy: who.uid }, { merge: true });
      return send(res, 200, { updated: true, referralCode: code || null });
    }
    if (b.action === 'adminPayout') {
      const id = text(b.id, 40), commissionId = text(b.commissionId, 100), payoutReference = text(b.payoutReference, 120);
      if (!/^[0-9a-f-]{36}$/i.test(id) || !/^order_[a-zA-Z0-9]+$/.test(commissionId) || b.status !== 'paid' || payoutReference.length < 2) throw new AccessError('invalid_payout', 'Select a commission and enter the payout reference.', 400);
      const ref = db.doc(`affiliatePartners/${id}/commissions/${commissionId}`), snap = await ref.get();
      if (!snap.exists) throw new AccessError('commission_not_found', 'Commission record not found.', 404);
      await db.runTransaction(async tx => {
        const current = await tx.get(ref);
        if (!current.exists) throw new AccessError('commission_not_found', 'Commission record not found.', 404);
        if (current.data()?.payoutStatus === 'paid') throw new AccessError('already_paid', 'This commission is already marked paid.', 409);
        tx.set(ref, { payoutStatus: 'paid', paidAt: Date.now(), payoutReference, paidBy: who.uid }, { merge: true });
      });
      return send(res, 200, { updated: true });
    }
    throw new AccessError('invalid_action', 'Unsupported affiliate action.', 400);
  } catch (e) { return failure(res, e); }
}
