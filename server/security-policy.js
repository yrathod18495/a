export const LEASE_MS = 15 * 60 * 1000;
export class AccessError extends Error {
  constructor(code, message, status = 403) { super(message); this.code = code; this.status = status; }
}
export function checkAccount(account = {}, now = Date.now(), write = false) {
  if (account.status === 'blocked') throw new AccessError('blocked', 'Account blocked.');
  if (account.status === 'suspended' && account.until > now) throw new AccessError('suspended', 'Account suspended.');
  if (write && account.status === 'restricted') throw new AccessError('restricted', 'This account is read-only.');
}
export function checkSession(session, sid, now = Date.now()) {
  if (!sid || !session || session.sid !== sid || session.revoked || session.expiresAt <= now)
    throw new AccessError('session_invalid', 'Session expired or revoked. Sign in again.', 401);
}
export function checkAcquisition(session, device, uid, secretHash, now = Date.now()) {
  if (device?.denied?.includes(uid)) throw new AccessError('device_rejected', 'Device/account change rejected.');
  if (device?.accounts?.length && !device.accounts.includes(uid))
    throw new AccessError('device_review', 'This browser was used by another account. Admin review is required.');
  if (session && !session.revoked && session.expiresAt > now && session.secretHash !== secretHash)
    throw new AccessError('session_active', 'An active session already exists. Log out there or ask an admin for recovery.', 409);
}
export function nextRevision(current, expected, operationId) {
  if (current?.operationId === operationId) return current.revision;
  if ((current?.revision || 0) !== expected) throw new AccessError('conflict', 'Cloud project changed. Keep a copy or reload the cloud version.', 409);
  return expected + 1;
}
