export const LEASE_MS = 15 * 60 * 1000;
export class AccessError extends Error {
  constructor(code, message, status = 403) { super(message); this.code = code; this.status = status; }
}
export function checkAccount(account = {}, now = Date.now(), write = false) {
  if (account.status === 'blocked') throw new AccessError('blocked', 'Aapka account block kar diya gaya hai. Support se sampark karein.');
  if (account.status === 'suspended' && account.until > now) throw new AccessError('suspended', 'Aapka account abhi suspend hai.');
  if (write && account.status === 'restricted') throw new AccessError('restricted', 'Ye account abhi sirf dekhne ke liye hai, isme badlav nahi ho sakta.');
}
export function checkSession(session, sid, now = Date.now()) {
  if (!sid || !session || session.sid !== sid || session.revoked || session.expiresAt <= now)
    throw new AccessError('session_invalid', 'Aapka session khatam ho gaya hai. Dobara sign in karein.', 401);
}
export function checkAcquisition(session, device, uid, secretHash, now = Date.now(), force = false) {
  if (device?.denied?.includes(uid)) throw new AccessError('device_rejected', 'Device ya account badalna manzoor nahi hua.');
  if (device?.accounts?.length && !device.accounts.includes(uid))
    throw new AccessError('device_review', 'Is browser par pehle doosra account use hua tha. Admin ki jaanch zaroori hai.');
  if (!force && session && !session.revoked && session.expiresAt > now && session.secretHash !== secretHash)
    throw new AccessError('session_active', 'Aapka session pehle se kahin aur chalu hai. Wahan log out karein ya admin se madad lein.', 409);
}
export function nextRevision(current, expected, operationId) {
  if (current?.operationId === operationId) return current.revision;
  if ((current?.revision || 0) !== expected) throw new AccessError('conflict', 'Cloud par project badal chuka hai. Apni copy rakh lein ya cloud wala version dobara load karein.', 409);
  return expected + 1;
}
