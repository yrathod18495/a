import { services } from './firebase-admin.js';
import { AccessError, checkAccount, checkSession } from './security-policy.js';
export async function identity(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try {
    const claims = await services().auth.verifyIdToken(token, true);
    if (!claims.email_verified) throw Error('Verify your email');
    return claims;
  } catch (error) {
    console.error('Firebase ID token verification failed:', error?.code || 'unknown_error');
    throw new AccessError('unauthorized', 'Verified sign-in required.', 401);
  }
}
export async function access(req, { write = false, admin = false } = {}) {
  const claims = await identity(req), { db } = services();
  const [account, session, role] = await db.getAll(
    db.doc('securityUsers/' + claims.uid), db.doc('securitySessions/' + claims.uid), db.doc('securityAdmins/' + claims.uid));
  checkAccount(account.data(), Date.now(), write);
  checkSession(session.data(), claims.sid);
  if (admin && role.data()?.enabled !== true) throw new AccessError('admin_required', 'Admin permission required.');
  return { uid: claims.uid, claims, admin: role.data()?.enabled === true };
}
export const send = (res, code, body) => {
  res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body));
};
export async function bodyOf(req,max=1000000) {
  if (req.body && typeof req.body === 'object') { if(JSON.stringify(req.body).length>max)throw new AccessError('too_large','Request too large.',413);return req.body; }
  let body = ''; for await (const chunk of req) { body += chunk; if (body.length > max) throw new AccessError('too_large', 'Request too large.', 413); }
  try { return JSON.parse(body || '{}'); } catch { throw new AccessError('invalid_json', 'Invalid JSON.', 400); }
}
export const failure = (res, e) => send(res, e.status || 500, { code: e.code || 'server_error', error: e.status ? e.message : 'Server operation failed. Please retry.' });
