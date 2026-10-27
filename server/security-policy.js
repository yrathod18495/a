export class AccessError extends Error {
  constructor(code, message, status = 403) { super(message); this.code = code; this.status = status; }
}
export function checkAccount(account = {}, now = Date.now(), write = false) {
  if (account.status === 'blocked') throw new AccessError('blocked', 'Your account has been blocked. Please contact support.');
  if (account.status === 'suspended' && account.until > now) throw new AccessError('suspended', 'Your account is currently suspended.');
  if (write && account.status === 'restricted') throw new AccessError('restricted', 'This account is read-only right now and cannot make changes.');
}
export function checkSession(session, sid, now = Date.now()) {
  // Sessions never time out. One only ends when it is revoked or the account signs in on another device.
  if (!sid || !session || session.sid !== sid || session.revoked)
    throw new AccessError('session_invalid', 'You were signed out because this account was signed in on another device. Please sign in again.', 401);
}
export function checkAcquisition(session, device, uid, secretHash, now = Date.now(), force = false) {
  // Only one device/browser may hold an account's session at a time; which accounts have used which browser is not restricted.
  if (!force && session && !session.revoked && session.secretHash !== secretHash)
    throw new AccessError('session_active', 'Your session is already active elsewhere. Please log out there or ask an admin for help.', 409);
}
export function nextRevision(current, expected, operationId) {
  if (current?.operationId === operationId) return current.revision;
  if ((current?.revision || 0) !== expected) throw new AccessError('conflict', 'The project has changed in the cloud. Keep your copy, or reload the cloud version.', 409);
  return expected + 1;
}
