// Studio side of the export length limit. The server (api/export.js) decides; this file asks it and keeps the answer for the UI.
// If the server cannot be reached, the free limit applies, so a missing connection never grants the longer one.
import { auth } from './firebase.js';
import { apiCall } from './session.js';
import { limitFor, withinLimit, limitMessage, normalizeTier } from '../shared/export-limits.js';

export const FREE_PLAN = Object.freeze({ tier: 'free', limitSeconds: limitFor('free'), verified: false });
const real = () => { const uid = auth.currentUser?.uid; return uid && uid !== 'debug' ? uid : null; };
let plan = { ...FREE_PLAN }, loading = null;

export const currentPlan = () => plan;
/** what the account may export; refreshed from the server (cached for the session unless fresh) */
export function refreshPlan({ fresh = false } = {}) {
  const uid = real();
  if (!uid) return Promise.resolve((plan = { ...FREE_PLAN }));
  if (loading && !fresh) return loading;
  loading = apiCall('/api/export', { action: 'status' }, uid)
    .then((r) => (plan = { tier: normalizeTier(r.tier), limitSeconds: limitFor(r.tier), verified: true }))
    .catch(() => (plan = { ...plan, tier: plan.verified ? plan.tier : 'free', limitSeconds: plan.verified ? plan.limitSeconds : limitFor('free') }))
    .finally(() => { setTimeout(() => { loading = null; }, 60000); });
  return loading;
}
export class ExportLimitError extends Error {
  constructor(message, tier, limitSeconds) { super(message); this.name = 'ExportLimitError'; this.tier = tier; this.limitSeconds = limitSeconds; }
}
/** Ask the server for permission to export `seconds` of video. Throws ExportLimitError when the video is too long. */
export async function authorizeExport({ seconds, scenes = 1, scope = 'current' }) {
  const uid = real();
  if (!uid) {                                                      // local / debug sessions have no account: free limit
    if (!withinLimit(seconds, 'free')) throw new ExportLimitError(limitMessage(seconds, 'free'), 'free', limitFor('free'));
    return { grantId: null, tier: 'free', limitSeconds: limitFor('free') };
  }
  try {
    const grant = await apiCall('/api/export', { action: 'authorize', seconds: +seconds.toFixed(2), scenes, scope }, uid);
    plan = { tier: normalizeTier(grant.tier), limitSeconds: grant.limitSeconds, verified: true };
    return grant;
  } catch (error) {
    if (error.code === 'export_limit') {
      plan = { tier: normalizeTier(error.tier), limitSeconds: limitFor(error.tier), verified: true };
      throw new ExportLimitError(error.message, plan.tier, plan.limitSeconds);
    }
    if (error.status && error.status < 500 && error.status !== 429) throw error;   // sign-in / account problems are shown as they are
    // server unreachable: the free limit decides
    if (!withinLimit(seconds, 'free')) throw new ExportLimitError(`${limitMessage(seconds, 'free')} (Aapka plan check nahi ho paya. Internet chalu hone par dobara try karein.)`, 'free', limitFor('free'));
    return { grantId: null, tier: 'free', limitSeconds: limitFor('free'), unverified: true };
  }
}
export function finishExport(grantId, ok) {
  const uid = real();
  if (!uid || !grantId) return;
  apiCall('/api/export', { action: 'complete', grantId, ok }, uid).catch(() => { /* bookkeeping only */ });
}
