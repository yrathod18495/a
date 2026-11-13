import { createHash } from 'node:crypto';
import { AccessError } from './security-policy.js';

/**
 * Coins for new accounts and the admin's Coins tools. Everything here runs on the server only; the browser can never write `credits`
 * (see firebase/firestore.rules: a signed-in user may change only name / email / photo / lastSeen on their own workspace).
 */
export const SIGNUP_BONUS_COINS = 20;
const MAX_COINS = 1_000_000;
const sha = (value) => createHash('sha256').update(String(value)).digest('hex');
const ledger = (db, uid) => db.collection(`workspaces/${uid}/creditLedger`).doc();
const validBalance = (n) => Number.isSafeInteger(n) && n >= 0 && n <= MAX_COINS * 100;

/**
 * The welcome gift, once per account, once per browser installation, only for a verified email.
 * It is granted in one transaction: the account marker (bonusGrants/{uid}), the browser marker (bonusDevices/{hash}), the balance, the
 * "free" tier record (so a gift never makes an account "paid": longer exports are for purchases) and a ledger line.
 * Never throws: a problem here must not stop a sign-in.
 */
export async function grantSignupBonus(db, { uid, email, emailVerified, deviceId, now = Date.now() }) {
  try {
    if (!uid || emailVerified !== true || !deviceId) return { granted: false, reason: 'not_eligible' };
    const bonusRef = db.doc(`bonusGrants/${uid}`), deviceRef = db.doc(`bonusDevices/${sha(deviceId)}`), workspaceRef = db.doc(`workspaces/${uid}`), entitlementRef = db.doc(`entitlements/${uid}`);
    return await db.runTransaction(async (tx) => {
      const [bonus, device, workspace, entitlement] = await tx.getAll(bonusRef, deviceRef, workspaceRef, entitlementRef);
      if (bonus.exists) return { granted: false, reason: 'already' };
      if (device.exists) { tx.create(bonusRef, { status: 'denied', reason: 'device_used', email: email || '', at: now }); return { granted: false, reason: 'device_used' }; }
      const current = Number(workspace.data()?.credits || 0);
      if (!validBalance(current)) return { granted: false, reason: 'bad_balance' };
      const balance = current + SIGNUP_BONUS_COINS;
      tx.create(bonusRef, { status: 'granted', coins: SIGNUP_BONUS_COINS, email: email || '', at: now });
      tx.create(deviceRef, { uid, at: now });
      tx.set(workspaceRef, { credits: balance }, { merge: true });
      if (!entitlement.exists) tx.set(entitlementRef, { tier: 'free', source: 'signup-bonus', updatedAt: now });
      tx.create(ledger(db, uid), { delta: SIGNUP_BONUS_COINS, balance, reason: 'Welcome gift', kind: 'signup_bonus', by: 'system', at: now });
      return { granted: true, coins: SIGNUP_BONUS_COINS, balance };
    });
  } catch (error) { console.error('Signup bonus failed:', error?.message || error); return { granted: false, reason: 'error' }; }
}

/** an admin adds, removes or sets an account's Coins. A reason is required; every change is a ledger line and an audit record. */
export async function adjustCredits(db, { uid, mode, amount, reason, by, now = Date.now() }) {
  if (!['add', 'remove', 'set'].includes(mode)) throw new AccessError('invalid_action', 'Please choose add, remove or set.', 400);
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_COINS) throw new AccessError('invalid_amount', `Please enter a whole number from 0 to ${MAX_COINS.toLocaleString('en-IN')}.`, 400);
  const why = typeof reason === 'string' ? reason.trim() : '';
  if (why.length < 3 || why.length > 200) throw new AccessError('reason_required', 'Please write a short reason (3 to 200 characters).', 400);
  const workspaceRef = db.doc(`workspaces/${uid}`), entitlementRef = db.doc(`entitlements/${uid}`);
  return db.runTransaction(async (tx) => {
    const [workspace, entitlement] = await tx.getAll(workspaceRef, entitlementRef);
    const current = Number(workspace.data()?.credits || 0);
    if (!validBalance(current)) throw new AccessError('bad_balance', 'This account\'s Coins balance is not valid. Please check it before changing it.', 409);
    const balance = mode === 'add' ? current + amount : mode === 'remove' ? current - amount : amount;
    if (balance < 0) throw new AccessError('insufficient_coins', `This account has only ${current} Coins, so ${amount} cannot be removed.`, 409);
    if (balance > MAX_COINS) throw new AccessError('invalid_amount', 'That would make the balance too large.', 400);
    tx.set(workspaceRef, { credits: balance }, { merge: true });
    if (!entitlement.exists) tx.set(entitlementRef, { tier: 'free', source: 'admin-credit', updatedAt: now });        // changing Coins never turns an account into a paid one by itself
    tx.create(ledger(db, uid), { delta: balance - current, balance, reason: why, kind: `admin_${mode}`, by, at: now });
    tx.create(db.collection('securityAudit').doc(), { admin: by, target: uid, action: `credits_${mode}`, amount, before: current, after: balance, reason: why, at: now });
    return { before: current, balance };
  });
}

/** everything an admin needs to know about one account, found by email */
export async function lookupAccount({ db, auth }, email) {
  const address = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]{1,64}@[^\s@]{1,255}$/.test(address)) throw new AccessError('invalid_email', 'Please enter a full email address.', 400);
  let user;
  try { user = await auth.getUserByEmail(address); }
  catch (error) { if (error?.code === 'auth/user-not-found') throw new AccessError('user_not_found', 'No account uses this email address.', 404); throw error; }
  const uid = user.uid;
  const [account, role, session, entitlement, workspace, bonus, recent] = await Promise.all([
    db.doc(`securityUsers/${uid}`).get(), db.doc(`securityAdmins/${uid}`).get(), db.doc(`securitySessions/${uid}`).get(), db.doc(`entitlements/${uid}`).get(),
    db.doc(`workspaces/${uid}`).get(), db.doc(`bonusGrants/${uid}`).get(),
    db.collection(`workspaces/${uid}/creditLedger`).orderBy('at', 'desc').limit(10).get(),
  ]);
  const a = account.data() || {}, s = session.data() || {};
  return {
    uid, email: user.email || '', name: user.displayName || '', registeredAt: user.metadata?.creationTime || '', lastSignIn: user.metadata?.lastSignInTime || '',
    status: a.status || 'active', until: a.until || 0, role: role.data()?.enabled === true ? 'admin' : 'user',
    signedIn: !!s.sid && !s.revoked, lastSeen: s.lastSeen || 0,
    tier: entitlement.data()?.tier || 'free', credits: Number(workspace.data()?.credits || 0),
    bonus: bonus.exists ? { status: bonus.data().status, reason: bonus.data().reason || '', at: bonus.data().at || 0 } : null,
    ledger: recent.docs.map((d) => ({ id: d.id, ...d.data() })),
  };
}
