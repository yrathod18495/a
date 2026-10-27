import { services } from './firebase-admin.js';
import { AccessError, checkAccount, checkSession } from './security-policy.js';
export async function identity(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try {
    const claims = await services().auth.verifyIdToken(token, true);
    if (!claims.email_verified) throw Error('Please verify your email first.');
    return claims;
  } catch (error) {
    console.error('Firebase ID token verification failed:', error?.code || 'unknown_error');
    throw new AccessError('unauthorized', 'Please sign in with a verified account.', 401);
  }
}
// Every API call checks the account, the session and the admin list: three Firestore reads. A server instance remembers them for a few seconds
// (on Vercel; off in tests and local runs) so a burst of calls from one user costs three reads, not three per call. Admin actions, payments and
// logout always read fresh; reads and file / project saves may use a copy up to ACCESS_CACHE_MS old (blocking an account also revokes its
// session, so it stops within that time).
const seen = new Map();
const cacheMs = () => Number(process.env.ACCESS_CACHE_MS ?? (process.env.VERCEL ? 60000 : 0));
export const forgetAccess = (uid) => (uid ? seen.delete(uid) : seen.clear());
export async function access(req, { write = false, admin = false, fresh = false, light = false, cache = false } = {}) {
  const claims = await identity(req), { db } = services(), ttl = cacheMs(), now = Date.now();
  if (light) {            // the session heartbeat: only the session document (blocking an account also revokes its session)
    const session = (await db.doc('securitySessions/' + claims.uid).get()).data();
    checkSession(session, claims.sid);
    return { uid: claims.uid, claims, admin: false, session };
  }
  let docs = (!write || cache) && !fresh && ttl > 0 ? seen.get(claims.uid) : null;     // `cache`: this write may use the few-seconds-old copy too (saving files and projects)
  if (!docs || now - docs.at > ttl) {
    const [account, session, role] = await db.getAll(
      db.doc('securityUsers/' + claims.uid), db.doc('securitySessions/' + claims.uid), db.doc('securityAdmins/' + claims.uid));
    docs = { at: now, account: account.data(), session: session.data(), role: role.data() };
    if (ttl > 0) { if (seen.size > 500) seen.clear(); seen.set(claims.uid, docs); }
  }
  checkAccount(docs.account, now, write);
  checkSession(docs.session, claims.sid);
  if (admin && docs.role?.enabled !== true) throw new AccessError('admin_required', 'Only an admin can do this.');
  return { uid: claims.uid, claims, admin: docs.role?.enabled === true, session: docs.session };
}
/** During maintenance only admins and approved testers (whose page stays open) may use the cloud APIs. */
export async function maintenanceBlocks(who) {
  if (process.env.MAINTENANCE_MODE === 'false' || who.admin) return false;
  const tester = await services().db.doc('securityTesters/' + who.uid).get();
  return tester.data()?.status !== 'approved';
}
export const send = (res, code, body) => {
  res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body));
};
export async function bodyOf(req,max=1000000) {
  if (req.body && typeof req.body === 'object') { if(JSON.stringify(req.body).length>max)throw new AccessError('too_large','The request is too large.',413);return req.body; }
  let body = ''; for await (const chunk of req) { body += chunk; if (body.length > max) throw new AccessError('too_large', 'The request is too large.', 413); }
  try { return JSON.parse(body || '{}'); } catch { throw new AccessError('invalid_json', 'The request data is not valid.', 400); }
}
export const failure = (res, e) => (e.status || console.error('Server error:', e), send(res, e.status || 500, { code: e.code || 'server_error', error: e.status ? e.message : 'Something went wrong on the server. Please try again shortly.' }));
