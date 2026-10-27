import { normalizeTier } from '../shared/export-limits.js';

/**
 * Account tier, kept in entitlements/{uid} = { tier: 'free' | 'paid', source, paidSince?, updatedAt }.
 * Only the server writes it: a captured credit purchase sets 'paid' (server/credit-payments.js), an admin can set either tier.
 * Accounts that paid before this document existed are recognised from their credits / captured payments and remembered.
 */
export const entitlementRef = (db, uid) => db.doc(`entitlements/${uid}`);

export async function tierOf(db, uid) {
  const ref = entitlementRef(db, uid), snap = await ref.get(), recorded = snap.data()?.tier;
  if (recorded === 'free' || recorded === 'paid') return recorded;      // an explicit decision, including an admin revoking paid
  const now = Date.now(), workspace = await db.doc(`workspaces/${uid}`).get();
  let paid = Number(workspace.data()?.credits || 0) > 0;
  if (!paid) paid = (await db.collection(`workspaces/${uid}/creditPayments`).where('status', '==', 'captured').limit(1).get()).docs.length > 0;
  await ref.set(paid ? { tier: 'paid', source: 'purchase-backfill', paidSince: now, updatedAt: now } : { tier: 'free', source: 'default', updatedAt: now }, { merge: true });
  return paid ? 'paid' : 'free';
}

/** the tier that decides export limits: admins export like paid accounts */
export async function effectiveTier(db, who) {
  return who.admin ? 'paid' : normalizeTier(await tierOf(db, who.uid));
}

export async function setTier(db, uid, tier, by) {
  if (tier !== 'free' && tier !== 'paid') throw Object.assign(new Error('Tier must be either free or paid.'), { status: 400, code: 'invalid_tier' });
  const now = Date.now(), ref = entitlementRef(db, uid), current = (await ref.get()).data() || {};
  await ref.set({ tier, source: 'admin', by, ...(tier === 'paid' ? { paidSince: current.paidSince || now } : {}), updatedAt: now }, { merge: true });
  await db.collection('securityAudit').doc().set({ target: uid, action: `tier_${tier}`, by, at: now });
}
