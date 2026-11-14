// What the last visit learned about this account (role, maintenance, tool switches). The first screen uses it at once instead of waiting for the
// server: a page load must never be slower than the user's own phone and the nearest cache. The server is still asked (one request, in the
// background) and its answer replaces this copy; every API call is checked on the server anyway, so this only decides what is shown first.
const KEY = (uid) => `12toons-boot-${uid}`;
const DEFAULT = Object.freeze({ role: 'user', maintenance: false, features: null });

/** the remembered answer for this account, or null */
export function readBoot(uid, storage = globalThis.localStorage) {
  try {
    const v = JSON.parse(storage?.getItem(KEY(uid)) || 'null');
    if (!v || typeof v !== 'object') return null;
    return { role: v.role === 'admin' ? 'admin' : 'user', maintenance: v.maintenance === true, features: v.features && typeof v.features === 'object' ? v.features : null };
  } catch { return null; }
}
export function saveBoot(uid, { role, maintenance, features }, storage = globalThis.localStorage) {
  try { storage?.setItem(KEY(uid), JSON.stringify({ role: role === 'admin' ? 'admin' : 'user', maintenance: maintenance === true, features: features || null, at: Date.now() })); } catch { /* optional */ }
}
/** the starting values for a page load: the remembered answer, else "a normal user, no maintenance" (the server's answer follows) */
export const startingState = (uid, storage) => readBoot(uid, storage) || { ...DEFAULT };
/** did the server's answer change what the page shows? */
export function bootChanged(before, after) {
  return before.role !== after.role || before.maintenance !== after.maintenance || JSON.stringify(before.features || null) !== JSON.stringify(after.features || null);
}
/** the server's `boot` answer as the state to keep */
export const fromServer = (info) => ({ role: info?.admin === true ? 'admin' : 'user', maintenance: info?.maintenance === true, features: info?.features && typeof info.features === 'object' ? info.features : null });
