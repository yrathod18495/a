import { services } from '../server/firebase-admin.js';
import { access, bodyOf, send, failure } from '../server/access.js';
import { AccessError } from '../server/security-policy.js';
import { effectiveTier, setTier } from '../server/entitlements.js';
import { EXPORT_LIMIT_SECONDS, limitFor, withinLimit, limitMessage } from '../shared/export-limits.js';

const MAX_SECONDS = 24 * 3600;
const validGrant = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{4,40}$/.test(value);
const validUid = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,128}$/.test(value);

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'This request is not valid. Please reload the page and try again.' });
  try {
    const b = await bodyOf(req), { db } = services();
    const who = await access(req, { write: ['authorize', 'complete'].includes(b.action), admin: b.action === 'adminSetTier' });
    if (process.env.MAINTENANCE_MODE !== 'false' && !who.admin) throw new AccessError('maintenance', '12toons is under maintenance right now. Please try again shortly.', 503);
    if (b.action === 'status') {
      const tier = await effectiveTier(db, who);
      return send(res, 200, { tier, limitSeconds: limitFor(tier), limits: EXPORT_LIMIT_SECONDS });
    }
    if (b.action === 'authorize') {
      const seconds = Number(b.seconds), scenes = Math.min(200, Math.max(1, Math.floor(Number(b.scenes) || 1))), scope = b.scope === 'all' ? 'all' : 'current';
      if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_SECONDS) throw new AccessError('invalid_length', 'The video length is not valid.', 400);
      const tier = await effectiveTier(db, who), limitSeconds = limitFor(tier), allowed = withinLimit(seconds, tier);
      const ref = db.collection(`workspaces/${who.uid}/exports`).doc();
      await ref.set({ id: ref.id, uid: who.uid, tier, limitSeconds, seconds: +seconds.toFixed(2), scenes, scope, status: allowed ? 'granted' : 'denied', createdAt: Date.now() });
      if (!allowed) return send(res, 403, { code: 'export_limit', error: limitMessage(seconds, tier), tier, limitSeconds, seconds });
      return send(res, 200, { grantId: ref.id, tier, limitSeconds });
    }
    if (b.action === 'complete') {
      if (!validGrant(b.grantId)) throw new AccessError('invalid_grant', 'The export reference is not valid.', 400);
      const ref = db.doc(`workspaces/${who.uid}/exports/${b.grantId}`), snap = await ref.get();
      if (!snap.exists) throw new AccessError('grant_not_found', 'Export reference not found.', 404);
      if (snap.data().status === 'granted') await ref.set({ status: b.ok === false ? 'failed' : 'completed', completedAt: Date.now() }, { merge: true });
      return send(res, 200, { ok: true });
    }
    if (b.action === 'adminSetTier') {
      if (!validUid(b.uid)) throw new AccessError('invalid_user', 'Please choose a valid user.', 400);
      await setTier(db, b.uid, b.tier, who.uid);
      return send(res, 200, { ok: true, uid: b.uid, tier: b.tier });
    }
    throw new AccessError('unknown_action', 'This export action was not recognized.', 400);
  } catch (e) { return failure(res, e); }
}
