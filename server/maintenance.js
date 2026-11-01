// Maintenance mode is a switch the admin flips in the admin panel. It lives in one Firestore document (config/maintenance), which the Firestore rules
// read too, so the browser, the API and the database all follow the same switch. No document yet = the site is open (and the document is created).
// MAINTENANCE_MODE=true|false in the environment only decides the state while that document does not exist (used by tests and first start).
import { services } from './firebase-admin.js';
const TTL = 8000, seen = new WeakMap();   // per database client: { at, enabled }
export async function maintenanceOn(db = services().db) {
  const hit = seen.get(db);
  if (hit && Date.now() - hit.at < TTL) return hit.enabled;
  const ref = db.doc('config/maintenance'), snap = await ref.get(), stored = snap.data()?.enabled;
  let enabled = typeof stored === 'boolean' ? stored : process.env.MAINTENANCE_MODE === 'true';
  if (typeof stored !== 'boolean' && !enabled) await ref.set({ enabled: false, updatedAt: Date.now() }, { merge: true });
  seen.set(db, { at: Date.now(), enabled });
  return enabled;
}
export async function setMaintenance(db, enabled, by) {
  await db.doc('config/maintenance').set({ enabled: !!enabled, updatedAt: Date.now(), updatedBy: by || null }, { merge: true });
  seen.set(db, { at: Date.now(), enabled: !!enabled });
  return !!enabled;
}
