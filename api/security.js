import { randomUUID, createHash } from 'node:crypto';
import { services } from '../server/firebase-admin.js';
import { maintenanceOn, setMaintenance, getFeatures, setFeature } from '../server/maintenance.js';
import { notifyNewUser } from '../server/telegram.js';
import { grantSignupBonus } from '../server/signup-bonus.js';
import { identity, access, bodyOf, send, failure } from '../server/access.js';
import { NEVER_EXPIRES, needsExpiryUpgrade, AccessError, checkAccount, checkSession, checkAcquisition } from '../server/security-policy.js';
import { cleanReport, recordTamper, listAlerts, acknowledgeAlerts, notifyAdmins } from '../server/tamper-alerts.js';
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,128}$/.test(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const HEARTBEAT_WRITE_MS = 9 * 60 * 1000;
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'This request is not valid. Please reload the page and try again.' });
  try {
    const b = await bodyOf(req), { db, auth } = services(), now = Date.now();
    if (b.action === 'maintenanceStatus') {
      let admin = false;
      if (req.headers.authorization) {
        try {
          const who = await access(req);
          admin = who.admin;
        } catch { /* anonymous and invalid sessions receive the public maintenance state */ }
      }
      const [maintenance, features] = await Promise.all([maintenanceOn(db), getFeatures(db)]);
      return send(res, 200, { maintenance, admin, features });
    }
    if (b.action === 'acquire') {
      const claims = await identity(req), uid = claims.uid;
      // Maintenance mode no longer blocks sign-in: everyone can log in normally, and the app gates access after login (admins always get through).
      if (claims.firebase?.sign_in_provider !== 'google.com' || Date.now()/1000 - claims.auth_time > 300)
        throw new AccessError('fresh_login_required', 'Please sign in again to start a session.', 401);
      if (!validId(b.deviceId) || !validId(b.secret)) throw new AccessError('invalid_device', 'This browser\'s identity is not valid. Please reload the page.', 400);
      const u = db.doc('securityUsers/' + uid), s = db.doc('securitySessions/' + uid), d = db.doc('securityDevices/' + b.deviceId);
      const event = db.collection('securityEvents').doc(), sid = randomUUID(), secretHash = hash(b.secret);
      const result = await db.runTransaction(async tx => {
        const [us, ss, ds] = await tx.getAll(u, s, d);
        let denied;
        try {
          checkAccount(us.data(), now);
          if (claims.auth_time <= (us.data()?.reauthAfter || 0)) throw new AccessError('fresh_login_required', 'Please sign in again.', 401);
          checkAcquisition(ss.data(), ds.data(), uid, secretHash, now, true);          // the newest login always wins; the older one is signed out
        } catch (e) { denied = e; }
        // Opening the studio again on the same browser (a reload) continues the running session: no new login, so nothing is written
        // (a login writes four documents).
        const running = !denied && ss.data()?.secretHash === secretHash && !ss.data()?.revoked;
        if (running) {
          if (needsExpiryUpgrade(ss.data())) tx.update(s, { expiresAt: NEVER_EXPIRES });   // a session started before sessions stopped expiring
          return { sid: ss.data().sid };
        }
        const accounts = ds.data()?.accounts || [];
        tx.set(u, { email: claims.email || '', name: claims.name || '', lastAttempt: now }, { merge: true });
        tx.create(event, { uid, email: claims.email || '', deviceId: b.deviceId, accounts, at: now, code: denied?.code || 'login', review: denied?.code === 'device_review' ? 'pending' : null });
        if (denied) return { denied: { code: denied.code, message: denied.message, status: denied.status } };
        const same = ss.data()?.secretHash === secretHash && !ss.data()?.revoked;
        const sessionId = same ? ss.data().sid : sid;
        tx.set(s, { sid: sessionId, deviceId: b.deviceId, secretHash, startedAt: same ? ss.data().startedAt : now, lastSeen: now, expiresAt: NEVER_EXPIRES, revoked: false });
        // the signal an older device listens to: it is signed out the moment this changes (only the session id, which the account's own tokens carry anyway)
        tx.set(db.doc('sessionSignals/' + uid), { sid: sessionId, at: now });
        tx.set(d, { accounts: [...new Set([...accounts, uid])], lastSeen: now, firstSeen: ds.data()?.firstSeen || now }, { merge: true });
        return { sid: sessionId, isNew: !us.exists };
      });
      if (result.denied) throw new AccessError(result.denied.code, result.denied.message, result.denied.status);
      // the very first sign-in of an account is a sign-up: tell the owner on Telegram
      if (result.isNew) await notifyNewUser({ name: claims.name, email: claims.email });
      // the welcome Coins: once per account, once per browser installation, verified email only (server/signup-bonus.js)
      if (result.isNew) await grantSignupBonus(db, { uid, email: claims.email, emailVerified: claims.email_verified === true, deviceId: b.deviceId });
      // persisted on the account (not just this token) so the sid claim survives the hourly ID-token refresh instead of forcing a fresh Google sign-in every time it rolls
      await auth.setCustomUserClaims(uid, { sid: result.sid });
      const token = await auth.createCustomToken(uid, { sid: result.sid });
      return send(res, 200, { token });
    }
    const who = await access(req, { light: b.action === 'heartbeat', fresh: b.action === 'logout', admin: ['overview', 'moderate', 'deviceDecision', 'assignRole', 'tamperAlerts', 'tamperAck'].includes(b.action) });
    if (b.action === 'status') return send(res, 200, { admin: who.admin });
    if (b.action === 'getMaintenance') { if (!who.admin) throw new AccessError('admin_required', 'Only an admin can do this.', 403); return send(res, 200, { maintenance: await maintenanceOn(db), features: await getFeatures(db) }); }
    if (b.action === 'setFeature') { if (!who.admin) throw new AccessError('admin_required', 'Only an admin can do this.', 403); try { return send(res, 200, { features: await setFeature(db, String(b.feature || ''), b.enabled === true, who.uid) }); } catch (e) { if (e.code === 'invalid_feature') throw new AccessError('invalid_feature', 'This option is not valid.', 400); throw e; } }
    if (b.action === 'setMaintenance') { if (!who.admin) throw new AccessError('admin_required', 'Only an admin can do this.', 403); return send(res, 200, { maintenance: await setMaintenance(db, b.enabled === true, who.uid) }); }
    // the studio reports that someone opened the developer tools / view-source: stored for the admin dashboard and pushed to admin devices
    if (b.action === 'tamperReport') {
      if (who.admin) return send(res, 200, { ok: true, stored: false });             // admins may inspect their own site
      const result = await recordTamper(db, who, cleanReport(b), { userAgent: req.headers['user-agent'], ip: req.headers['x-forwarded-for'] || req.headers['x-real-ip'], country: req.headers['x-vercel-ip-country'] });
      if (result.notify) await notifyAdmins(db, services().messaging, result.alert);
      return send(res, 200, { ok: true, stored: result.stored });
    }
    if (b.action === 'tamperAlerts') return send(res, 200, await listAlerts(db));
    if (b.action === 'tamperAck') return send(res, 200, { ok: true, acknowledged: await acknowledgeAlerts(db, b.id, who.uid) });
    if (b.action === 'heartbeat') {
      // Sessions do not expire; the check above already rejects a revoked or replaced one. A session started before that change is upgraded once so the Firestore rules keep accepting it.
      // The heartbeat also records when the user was last active (at most one write every ~10 minutes), so the admin list can tell an online user from one who left days ago.
      const update = {};
      if (needsExpiryUpgrade(who.session)) update.expiresAt = NEVER_EXPIRES;
      if (!who.session?.lastSeen || now - who.session.lastSeen >= HEARTBEAT_WRITE_MS) update.lastSeen = now;
      if (Object.keys(update).length) await db.doc('securitySessions/' + who.uid).update(update);
      return send(res, 200, { ok: true });
    }
    if (b.action === 'logout') {
      await db.runTransaction(async tx => {
        const ref = db.doc('securitySessions/' + who.uid), s = await tx.get(ref);
        checkSession(s.data(), who.claims.sid, now);
        tx.update(ref, { revoked: true });
        tx.set(db.doc('securityUsers/' + who.uid), { reauthAfter: Math.floor(now/1000) }, { merge: true });
      });
      return send(res, 200, { ok: true });
    }
    if (!who.admin && await maintenanceOn(db)) throw new AccessError('maintenance', '12toons is under maintenance right now. Please try again shortly.', 503);
    if (b.action === 'overview') {
      // Only the asked sections are read, and all of them are read at the same time (the admin page opens with users + sessions + events;
      // devices and the audit log are fetched when their tab is opened).
      const want = new Set(Array.isArray(b.parts) && b.parts.length ? b.parts.filter(x => ['users', 'sessions', 'devices', 'events', 'audit'].includes(x)) : ['users', 'sessions', 'devices', 'events', 'audit']);
      const out = { cursors: {} };
      const usersTask = want.has('users') ? (async () => {
        const registered = b.cursors && 'users' in b.cursors && !b.cursors.users ? { users: [], pageToken: null } : await auth.listUsers(100, b.cursors?.users || undefined);
        const [userStates, adminStates] = await Promise.all([
          registered.users.length ? db.getAll(...registered.users.map(u => db.doc('securityUsers/' + u.uid))) : [],
          registered.users.length ? db.getAll(...registered.users.map(u => db.doc('securityAdmins/' + u.uid))) : []
        ]);
        out.users = registered.users.map((u, i) => ({ id: u.uid, email: u.email || '', name: u.displayName || '', registeredAt: u.metadata.creationTime, ...userStates[i].data(), role: adminStates[i].data()?.enabled === true ? 'admin' : 'user' }));
        out.cursors.users = registered.pageToken || null;
      })() : null;
      const collectionTasks = Object.entries({ sessions: 'securitySessions', devices: 'securityDevices', events: 'securityEvents', audit: 'securityAudit' }).filter(([key]) => want.has(key)).map(async ([key, name]) => {
        if (b.cursors && key in b.cursors && !b.cursors[key]) { out[key] = []; out.cursors[key] = null; return; }
        let query = db.collection(name).orderBy('__name__').limit(100);
        if (b.cursors?.[key]) query = query.startAfter(String(b.cursors[key]));
        const snap = await query.get();
        out[key] = snap.docs.map(d => { const { secretHash, ...v } = d.data(); return { id: d.id, ...v }; });
        out.cursors[key] = snap.docs.length === 100 ? snap.docs.at(-1).id : null;
      });
      await Promise.all([usersTask, ...collectionTasks]);
      return send(res, 200, out);
    }
    if (b.action === 'moderate') {
      if (!validId(b.uid) || !['blocked', 'restricted', 'suspended', 'active', 'revoke'].includes(b.status)) throw new AccessError('invalid_action', 'The moderation action is not valid.', 400);
      if (b.uid === who.uid) throw new AccessError('self_moderation', 'Only another admin can take action on your own account.');
      if (b.status === 'suspended' && (!Number.isSafeInteger(b.until) || b.until <= now)) throw new AccessError('invalid_expiry', 'Please choose a suspension date that is in the future.', 400);
      await db.runTransaction(async tx => {
        // Re-check actor authorization inside the moderation transaction.
        const [role,actor,actorSession] = await tx.getAll(db.doc('securityAdmins/' + who.uid),db.doc('securityUsers/'+who.uid),db.doc('securitySessions/'+who.uid));
        if (!role.data()?.enabled) throw new AccessError('admin_required', 'Your admin permission has been removed.');
        checkAccount(actor.data(),Date.now(),true);checkSession(actorSession.data(),who.claims.sid);
        tx.set(db.doc('securityUsers/' + b.uid), { reauthAfter: Math.floor(now/1000), ...(b.status !== 'revoke' ? { status: b.status, until: b.status === 'suspended' ? b.until : 0 } : {}) }, { merge: true });
        tx.set(db.doc('securitySessions/' + b.uid), { revoked: true }, { merge: true });
        tx.create(db.collection('securityAudit').doc(), { admin: who.uid, target: b.uid, action: b.status, until: b.until || null, at: now });
      });
      return send(res, 200, { ok: true });
    }
    if (b.action === 'assignRole') {
      if (!validId(b.uid) || !['user', 'admin'].includes(b.role)) throw new AccessError('invalid_action', 'Please choose a valid user role.', 400);
      if (b.uid === who.uid) throw new AccessError('self_role_change', 'Ask another admin to change your own role.');
      let target;
      try { target = await auth.getUser(b.uid); }
      catch (error) { if (error.code === 'auth/user-not-found') throw new AccessError('user_not_found', 'This account no longer exists.', 404); throw error; }
      const targetAdminRef = db.doc('securityAdmins/' + b.uid), targetSessionRef = db.doc('securitySessions/' + b.uid);
      const auditRef = db.collection('securityAudit').doc();
      await db.runTransaction(async tx => {
        const [actorRole, actorAccount, actorSession, targetAdmin, targetSession] = await tx.getAll(
          db.doc('securityAdmins/' + who.uid), db.doc('securityUsers/' + who.uid), db.doc('securitySessions/' + who.uid),
          targetAdminRef, targetSessionRef
        );
        if (actorRole.data()?.enabled !== true) throw new AccessError('admin_required', 'Your admin permission has been removed.');
        checkAccount(actorAccount.data(), Date.now(), true); checkSession(actorSession.data(), who.claims.sid);
        tx.set(targetAdminRef, { enabled: b.role === 'admin', updatedAt: now, updatedBy: who.uid }, { merge: true });
        const wasAdmin = targetAdmin.data()?.enabled === true;
        if (wasAdmin && b.role !== 'admin' && targetSession.exists) tx.set(targetSessionRef, { revoked: true }, { merge: true });
        tx.create(auditRef, { admin: who.uid, target: b.uid, action: 'set_role', role: b.role, at: now });
      });
      return send(res, 200, { ok: true, uid: b.uid, role: b.role });
    }
    if (b.action === 'deviceDecision') {
      if (!validId(b.deviceId) || !validId(b.uid) || typeof b.approve !== 'boolean') throw new AccessError('invalid_action', 'The device decision is not valid.', 400);
      await db.runTransaction(async tx => {
        const d = db.doc('securityDevices/' + b.deviceId), [snap, role,actor,actorSession] = await tx.getAll(d, db.doc('securityAdmins/' + who.uid),db.doc('securityUsers/'+who.uid),db.doc('securitySessions/'+who.uid));
        if (!role.data()?.enabled) throw new AccessError('admin_required', 'Your admin permission has been removed.');
        checkAccount(actor.data(),Date.now(),true);checkSession(actorSession.data(),who.claims.sid);
        const accounts = new Set(snap.data()?.accounts || []), denied = new Set(snap.data()?.denied || []);
        if (b.approve) { accounts.add(b.uid); denied.delete(b.uid); } else { accounts.delete(b.uid); denied.add(b.uid); }
        tx.set(d, { accounts: [...accounts], denied: [...denied] }, { merge: true });
        tx.set(db.doc('securitySessions/' + b.uid), { revoked: true }, { merge: true });
        tx.set(db.doc('securityUsers/' + b.uid), { reauthAfter: Math.floor(now/1000) }, { merge: true });
        tx.create(db.collection('securityAudit').doc(), { admin: who.uid, target: b.uid, deviceId: b.deviceId, action: b.approve ? 'approve_device' : 'reject_device', at: now });
      });
      return send(res, 200, { ok: true });
    }
    throw new AccessError('unknown_action', 'This action was not recognized.', 400);
  } catch (e) { return failure(res, e); }
}
