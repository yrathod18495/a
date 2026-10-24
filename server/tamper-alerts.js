import { createHash } from 'node:crypto';
import { AccessError } from './security-policy.js';

// Reports from the browser that someone opened the developer tools or tried to view the source of the studio.
// They are stored in `securityAlerts` (server-only), shown on the admin dashboard and pushed to admin devices.
// A report is a warning for the admin, not a verdict: legitimate people open the developer tools too.
export const TAMPER_KINDS = Object.freeze(['devtools', 'shortcut', 'view-source', 'console', 'integrity']);
export const MAX_REPORTS_PER_HOUR = 6;
export const PUSH_GAP_MS = 10 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const text = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim().slice(0, max);

export function cleanReport(body) {
  const kind = String(body?.kind ?? '');
  if (!TAMPER_KINDS.includes(kind)) throw new AccessError('invalid_report', 'Report sahi nahi hai.', 400);
  return { kind, detail: text(body.detail, 120), path: text(body.path, 80) };
}
export const ipHash = (ip) => (ip ? createHash('sha256').update(String(ip).split(',')[0].trim()).digest('hex').slice(0, 16) : '');

/** Stores one report unless this account already sent MAX_REPORTS_PER_HOUR in the last hour. */
export async function recordTamper(db, who, report, { userAgent = '', ip = '', country = '', now = Date.now() } = {}) {
  const userRef = db.doc(`securityUsers/${who.uid}`), user = (await userRef.get()).data() || {};
  const fresh = user.tamperWindowStart && now - user.tamperWindowStart < HOUR;
  const windowStart = fresh ? user.tamperWindowStart : now, inWindow = fresh ? Number(user.tamperWindowCount || 0) : 0;
  if (inWindow >= MAX_REPORTS_PER_HOUR) return { stored: false, limited: true, notify: false };
  const ref = db.collection('securityAlerts').doc();
  const alert = {
    id: ref.id, uid: who.uid, email: text(who.claims?.email, 120), name: text(who.claims?.name, 80), ...report,
    userAgent: text(userAgent, 200), ipHash: ipHash(ip), country: text(country, 4), at: now, acknowledged: false,
  };
  const notify = !user.lastTamperPushAt || now - user.lastTamperPushAt > PUSH_GAP_MS;
  await ref.set(alert);
  await userRef.set({ tamperCount: Number(user.tamperCount || 0) + 1, lastTamperAt: now, tamperWindowStart: windowStart, tamperWindowCount: inWindow + 1, ...(notify ? { lastTamperPushAt: now } : {}) }, { merge: true });
  return { stored: true, limited: false, notify, alert };
}

export async function listAlerts(db, limit = 50) {
  const snap = await db.collection('securityAlerts').where('acknowledged', '==', false).limit(200).get();
  const all = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => b.at - a.at);
  return { alerts: all.slice(0, limit), unacknowledged: all.length };
}

export async function acknowledgeAlerts(db, id, by, now = Date.now()) {
  if (id === 'all') {
    const snap = await db.collection('securityAlerts').where('acknowledged', '==', false).limit(200).get();
    await Promise.all(snap.docs.map((doc) => doc.ref.set({ acknowledged: true, acknowledgedBy: by, acknowledgedAt: now }, { merge: true })));
    return snap.docs.length;
  }
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{4,40}$/.test(id)) throw new AccessError('invalid_alert', 'Alert sahi nahi hai.', 400);
  const ref = db.doc(`securityAlerts/${id}`);
  if (!(await ref.get()).exists) throw new AccessError('alert_not_found', 'Ye alert nahi mila.', 404);
  await ref.set({ acknowledged: true, acknowledgedBy: by, acknowledgedAt: now }, { merge: true });
  return 1;
}

/** Best-effort push to every admin device that turned notifications on. Never throws. */
export async function notifyAdmins(db, messaging, alert) {
  try {
    const admins = (await db.collection('securityAdmins').where('enabled', '==', true).limit(30).get()).docs.map((doc) => doc.id);
    let sent = 0;
    for (const uid of admins) {
      const tokens = await db.collection('pushTokens').where('uid', '==', uid).limit(20).get();
      for (const item of tokens.docs) {
        try {
          await messaging.send({ token: item.data().token, data: { title: '⚠ 12toons security alert', body: `${alert.name || alert.email || 'Ek user'} ne browser inspect / developer tools use kiye.`, url: '/#/admin', type: 'tamper-alert' }, webpush: { headers: { TTL: '3600', Urgency: 'high' } } });
          sent++;
        } catch (error) {
          if (/registration-token-not-registered|invalid-registration-token/.test(error?.code || '')) await item.ref.delete().catch(() => {});
        }
      }
    }
    return sent;
  } catch (error) { console.warn('Admin tamper push failed:', error?.code || error?.message); return 0; }
}
