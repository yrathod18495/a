// Realtime Database helper. RTDB bills storage and download size, not the number of reads / writes, so small and frequently changing data
// (project index, session lease, usage counters, shared config) lives here; Firestore keeps what needs queries and money records.
import { AccessError } from './security-policy.js';

/** the RTDB of this deployment, or a Hinglish error when FIREBASE_DATABASE_URL is not set yet */
export function rtdbOf(svc) {
  if (!svc?.rtdb) throw new AccessError('rtdb_missing', 'Server par Realtime Database abhi set nahi hai. Admin ko batayein.', 503);
  return svc.rtdb;
}
export const hasRtdb = (svc) => !!svc?.rtdb;

/** a thin wrapper with the five calls the server needs; paths look like 'projects/<uid>/<id>' */
export function kv(svc) {
  const db = rtdbOf(svc), ref = (path) => db.ref(path);
  return {
    async get(path) { const snap = await ref(path).get(); return snap.exists() ? snap.val() : null; },
    set: (path, value) => ref(path).set(value),
    update: (path, patch) => ref(path).update(patch),
    remove: (path) => ref(path).remove(),
    /** read-modify-write that retries on conflict; `fn(current)` returns the next value, or `undefined` to leave it alone */
    async transact(path, fn) {
      const out = await ref(path).transaction((current) => fn(current ?? null));
      return { committed: out.committed, value: out.snapshot.exists() ? out.snapshot.val() : null };
    },
  };
}
