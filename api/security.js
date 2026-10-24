import { randomUUID, createHash } from 'node:crypto';
import { services } from '../server/firebase-admin.js';
import { identity, access, bodyOf, send, failure } from '../server/access.js';
import { LEASE_MS, AccessError, checkAccount, checkSession, checkAcquisition } from '../server/security-policy.js';
import { testerAnimations } from '../server/tester-animations.js';
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,128}$/.test(value);
const hash = value => createHash('sha256').update(value).digest('hex');
const maintenanceEnabled = () => process.env.MAINTENANCE_MODE !== 'false';
let publishedMaintenance;
async function publishMaintenance(db, now) {
  const enabled = maintenanceEnabled();
  if (publishedMaintenance !== enabled) {
    const ref = db.doc('config/maintenance'), current = await ref.get();
    if (current.data()?.enabled !== enabled) await ref.set({ enabled, updatedAt: now }, { merge: true });
    publishedMaintenance = enabled;
  }
  return maintenanceEnabled();
}
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Ye request sahi nahi hai. Page reload karke dobara try karein.' });
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
      const maintenance = await publishMaintenance(db, now);
      return send(res, 200, { maintenance, admin });
    }
    // Staff sign-in checks the allowlist before creating a regular user session.
    // This endpoint only returns the caller's own enabled status.
    if (b.action === 'staffStatus') {
      const claims = await identity(req);
      const role = await db.doc('securityAdmins/' + claims.uid).get();
      return send(res, 200, { admin: role.data()?.enabled === true });
    }
    if (b.action === 'testerStatus') {
      const claims = await identity(req);
      const [admin, tester, account] = await db.getAll(db.doc('securityAdmins/' + claims.uid), db.doc('securityTesters/' + claims.uid), db.doc('securityUsers/' + claims.uid));
      checkAccount(account.data(), now);
      const state = admin.data()?.enabled === true ? 'approved' : (tester.data()?.status || 'none');
      return send(res, 200, { uid: claims.uid, status: state, reviewedAt: tester.data()?.reviewedAt || null });
    }
    if (b.action === 'testerApply') {
      const claims = await identity(req);
      if (claims.firebase?.sign_in_provider !== 'google.com') throw new AccessError('google_required', 'Tester access maangne ke liye Google se sign in karein.', 403);
      const testerRef = db.doc('securityTesters/' + claims.uid), adminRef = db.doc('securityAdmins/' + claims.uid);
      const result = await db.runTransaction(async tx => {
        const [admin, tester, account] = await tx.getAll(adminRef, testerRef, db.doc('securityUsers/' + claims.uid));
        checkAccount(account.data(), now, true);
        if (admin.data()?.enabled === true) return 'approved';
        const current = tester.data()?.status || 'none';
        if (current === 'approved' || current === 'pending') return current;
        tx.set(testerRef, { uid: claims.uid, email: String(claims.email || '').toLowerCase(), name: claims.name || '', status: 'pending', submittedAt: now, updatedAt: now, reviewedAt: null, reviewedBy: null }, { merge: true });
        tx.create(db.collection('securityAudit').doc(), { target: claims.uid, action: 'tester_request', at: now });
        return 'pending';
      });
      return send(res, 200, { status: result });
    }
    if (b.action === 'acquire') {
      const claims = await identity(req), uid = claims.uid;
      if (maintenanceEnabled()) {
        const [role, tester] = await db.getAll(db.doc('securityAdmins/' + uid), db.doc('securityTesters/' + uid));
        // Tester intent opens only an approved tester session; other APIs retain their maintenance gates.
        if (role.data()?.enabled !== true && !(b.scope === 'tester' && tester.data()?.status === 'approved')) throw new AccessError('maintenance', '12toons par abhi maintenance chal raha hai. Thodi der baad try karein.', 503);
      }
      if (claims.firebase?.sign_in_provider !== 'google.com' || Date.now()/1000 - claims.auth_time > 300)
        throw new AccessError('fresh_login_required', 'Session shuru karne ke liye Google se dobara sign in karein.', 401);
      if (!validId(b.deviceId) || !validId(b.secret)) throw new AccessError('invalid_device', 'Is browser ki pehchaan sahi nahi hai. Page reload karein.', 400);
      const u = db.doc('securityUsers/' + uid), s = db.doc('securitySessions/' + uid), d = db.doc('securityDevices/' + b.deviceId);
      const event = db.collection('securityEvents').doc(), sid = randomUUID(), secretHash = hash(b.secret);
      const result = await db.runTransaction(async tx => {
        const [us, ss, ds] = await tx.getAll(u, s, d);
        let denied;
        try {
          checkAccount(us.data(), now);
          if (claims.auth_time <= (us.data()?.reauthAfter || 0)) throw new AccessError('fresh_login_required', 'Google se dobara sign in karein.', 401);
          checkAcquisition(ss.data(), ds.data(), uid, secretHash, now);
        } catch (e) { denied = e; }
        const accounts = ds.data()?.accounts || [];
        tx.set(u, { email: claims.email || '', name: claims.name || '', lastAttempt: now }, { merge: true });
        tx.create(event, { uid, email: claims.email || '', deviceId: b.deviceId, accounts, at: now, code: denied?.code || 'login', review: denied?.code === 'device_review' ? 'pending' : null });
        if (denied) return { denied: { code: denied.code, message: denied.message, status: denied.status } };
        const same = ss.data()?.secretHash === secretHash && !ss.data()?.revoked && ss.data()?.expiresAt > now;
        const sessionId = same ? ss.data().sid : sid;
        tx.set(s, { sid: sessionId, deviceId: b.deviceId, secretHash, startedAt: same ? ss.data().startedAt : now, expiresAt: now + LEASE_MS, revoked: false });
        tx.set(d, { accounts: [...new Set([...accounts, uid])], lastSeen: now, firstSeen: ds.data()?.firstSeen || now }, { merge: true });
        return { sid: sessionId };
      });
      if (result.denied) throw new AccessError(result.denied.code, result.denied.message, result.denied.status);
      const token = await auth.createCustomToken(uid, { sid: result.sid });
      return send(res, 200, { token, expiresAt: now + LEASE_MS });
    }
    const who = await access(req, { write: b.action === 'saveTesterAnimations', admin: ['overview', 'moderate', 'deviceDecision', 'assignRole', 'reviewTester', 'testerRequests', 'saveTesterAnimations'].includes(b.action) });
    if (b.action === 'testerAnimations') {
      if (!who.admin) {
        const tester = await db.doc('securityTesters/' + who.uid).get();
        if (tester.data()?.status !== 'approved') throw new AccessError('tester_required', 'Iske liye approved tester access chahiye.');
      }
      const settings = await db.doc('config/testers').get();
      return send(res, 200, { ...testerAnimations(settings.data()), admin: who.admin });
    }
    if (b.action === 'saveTesterAnimations') {
      const current = await db.doc('config/testers').get();
      const config = testerAnimations({ ...current.data(), ...b }), updatedAt = new Date(now).toISOString();
      await db.doc('config/testers').set({ anims: JSON.stringify(config.anims), limit: config.limit, blockedAnims: config.blockedAnims, hiddenGroups: config.hiddenGroups, blockedDownloads: config.blockedDownloads, updatedAt, by: who.claims.email || '' }, { merge: true });
      return send(res, 200, { ...config, at: updatedAt, admin: who.admin });
    }
    if (b.action === 'status') return send(res, 200, { admin: who.admin });
    if (b.action === 'heartbeat' || b.action === 'logout') {
      await db.runTransaction(async tx => {
        const ref = db.doc('securitySessions/' + who.uid), s = await tx.get(ref);
        checkSession(s.data(), who.claims.sid, now);
        tx.update(ref, b.action === 'logout' ? { revoked: true, expiresAt: now } : { expiresAt: now + LEASE_MS });
        if (b.action === 'logout') tx.set(db.doc('securityUsers/' + who.uid), { reauthAfter: Math.floor(now/1000) }, { merge: true });
      });
      return send(res, 200, { ok: true });
    }
    if (maintenanceEnabled() && !who.admin) throw new AccessError('maintenance', '12toons par abhi maintenance chal raha hai. Thodi der baad try karein.', 503);
    if (b.action === 'testerRequests') {
      const snap = await db.collection('securityTesters').where('status', '==', 'pending').limit(100).get();
      const requests = snap.docs.map(doc => ({ uid: doc.id, ...doc.data() })).sort((a,b) => (b.submittedAt || 0) - (a.submittedAt || 0));
      return send(res, 200, { requests });
    }
    if (b.action === 'overview') {
      const out = { cursors: {} };
      const registered=b.cursors&&'users' in b.cursors&&!b.cursors.users?{users:[],pageToken:null}:await auth.listUsers(100,b.cursors?.users||undefined);
      const [userStates, adminStates, testerStates, pendingTesterRequests] = await Promise.all([
        registered.users.length ? db.getAll(...registered.users.map(u=>db.doc('securityUsers/'+u.uid))) : [],
        registered.users.length ? db.getAll(...registered.users.map(u=>db.doc('securityAdmins/'+u.uid))) : [],
        registered.users.length ? db.getAll(...registered.users.map(u=>db.doc('securityTesters/'+u.uid))) : [],
        db.collection('securityTesters').where('status', '==', 'pending').limit(100).get()
      ]);
      out.users=registered.users.map((u,i)=>({id:u.uid,email:u.email||'',name:u.displayName||'',registeredAt:u.metadata.creationTime,...userStates[i].data(),role:adminStates[i].data()?.enabled===true?'admin':testerStates[i].data()?.status==='approved'?'tester':'user'}));
      out.testerRequests=pendingTesterRequests.docs.map(doc=>({uid:doc.id,...doc.data()})).sort((a,b)=>(b.submittedAt||0)-(a.submittedAt||0));
      out.cursors.users=registered.pageToken||null;
      for (const [key, name] of Object.entries({ sessions: 'securitySessions', devices: 'securityDevices', events: 'securityEvents', audit: 'securityAudit' })) {
        if(b.cursors&&key in b.cursors&&!b.cursors[key]){out[key]=[];out.cursors[key]=null;continue;}
        let query=db.collection(name).orderBy('__name__').limit(100);
        if(b.cursors?.[key])query=query.startAfter(String(b.cursors[key]));
        const snap = await query.get();
        out[key] = snap.docs.map(d => { const { secretHash, ...v } = d.data(); return { id: d.id, ...v }; });
        out.cursors[key]=snap.docs.length===100?snap.docs.at(-1).id:null;
      }
      return send(res, 200, out);
    }
    if (b.action === 'moderate') {
      if (!validId(b.uid) || !['blocked', 'restricted', 'suspended', 'active', 'revoke'].includes(b.status)) throw new AccessError('invalid_action', 'Moderation action sahi nahi hai.', 400);
      if (b.uid === who.uid) throw new AccessError('self_moderation', 'Aapke account par action koi doosra admin hi le sakta hai.');
      if (b.status === 'suspended' && (!Number.isSafeInteger(b.until) || b.until <= now)) throw new AccessError('invalid_expiry', 'Suspension ki aisi date chunein jo aane wale samay me ho.', 400);
      await db.runTransaction(async tx => {
        // Re-check actor authorization inside the moderation transaction.
        const [role,actor,actorSession] = await tx.getAll(db.doc('securityAdmins/' + who.uid),db.doc('securityUsers/'+who.uid),db.doc('securitySessions/'+who.uid));
        if (!role.data()?.enabled) throw new AccessError('admin_required', 'Aapki admin permission hata di gayi hai.');
        checkAccount(actor.data(),Date.now(),true);checkSession(actorSession.data(),who.claims.sid);
        tx.set(db.doc('securityUsers/' + b.uid), { reauthAfter: Math.floor(now/1000), ...(b.status !== 'revoke' ? { status: b.status, until: b.status === 'suspended' ? b.until : 0 } : {}) }, { merge: true });
        tx.set(db.doc('securitySessions/' + b.uid), { revoked: true, expiresAt: now }, { merge: true });
        tx.create(db.collection('securityAudit').doc(), { admin: who.uid, target: b.uid, action: b.status, until: b.until || null, at: now });
      });
      return send(res, 200, { ok: true });
    }
    if (b.action === 'assignRole') {
      if (!validId(b.uid) || !['user', 'admin', 'tester'].includes(b.role)) throw new AccessError('invalid_action', 'Sahi user role chunein.', 400);
      if (b.uid === who.uid) throw new AccessError('self_role_change', 'Apna role badalne ke liye kisi doosre admin se kahein.');
      let target;
      try { target = await auth.getUser(b.uid); }
      catch (error) { if (error.code === 'auth/user-not-found') throw new AccessError('user_not_found', 'Ye account ab maujood nahi hai.', 404); throw error; }
      const email = String(target.email || '').trim().toLowerCase();
      if (b.role === 'tester' && !email) throw new AccessError('tester_email_required', 'Tester banne ke liye account me email address hona zaroori hai.', 400);
      const targetAdminRef = db.doc('securityAdmins/' + b.uid), targetSessionRef = db.doc('securitySessions/' + b.uid);
      const testerRef = db.doc('config/testers'), auditRef = db.collection('securityAudit').doc();
      await db.runTransaction(async tx => {
        const [actorRole, actorAccount, actorSession, targetAdmin, targetSession, testerDoc, targetTester] = await tx.getAll(
          db.doc('securityAdmins/' + who.uid), db.doc('securityUsers/' + who.uid), db.doc('securitySessions/' + who.uid),
          targetAdminRef, targetSessionRef, testerRef, db.doc('securityTesters/' + b.uid)
        );
        if (actorRole.data()?.enabled !== true) throw new AccessError('admin_required', 'Aapki admin permission hata di gayi hai.');
        checkAccount(actorAccount.data(), Date.now(), true); checkSession(actorSession.data(), who.claims.sid);
        const config = testerDoc.data() || {}, currentEmails = (config.emails || []).map(value => String(value).toLowerCase());
        const emails = currentEmails.filter(value => value !== email);
        if (b.role === 'tester') emails.push(email);
        tx.set(targetAdminRef, { enabled: b.role === 'admin', updatedAt: now, updatedBy: who.uid }, { merge: true });
        tx.set(testerRef, { emails: [...new Set(emails)], anims: config.anims || '{}', limit: config.limit || 0, updatedAt: new Date(now).toISOString(), by: who.claims.email || '' }, { merge: true });
        tx.set(db.doc('securityTesters/' + b.uid), { uid: b.uid, email, name: target.displayName || '', status: b.role === 'tester' ? 'approved' : 'revoked', updatedAt: now, reviewedAt: now, reviewedBy: who.uid, ...(b.role === 'tester' ? { approvedAt: now, approvedBy: who.uid } : {}) }, { merge: true });
        const wasAdmin = targetAdmin.data()?.enabled === true, wasTester = targetTester.data()?.status === 'approved';
        if (((wasAdmin && b.role !== 'admin') || (wasTester && b.role !== 'tester')) && targetSession.exists) tx.set(targetSessionRef, { revoked: true, expiresAt: now }, { merge: true });
        tx.create(auditRef, { admin: who.uid, target: b.uid, action: 'set_role', role: b.role, at: now });
      });
      return send(res, 200, { ok: true, uid: b.uid, role: b.role });
    }
    if (b.action === 'reviewTester') {
      if (!validId(b.uid) || !['approved', 'rejected'].includes(b.status)) throw new AccessError('invalid_action', 'Is request ke liye approve ya reject chunein.', 400);
      if (b.uid === who.uid) throw new AccessError('self_tester_review', 'Aap apni hi tester request approve nahi kar sakte.');
      const targetRef = db.doc('securityTesters/' + b.uid), auditRef = db.collection('securityAudit').doc();
      await db.runTransaction(async tx => {
        const [actorRole, actorAccount, actorSession, request] = await tx.getAll(
          db.doc('securityAdmins/' + who.uid), db.doc('securityUsers/' + who.uid), db.doc('securitySessions/' + who.uid), targetRef
        );
        if (actorRole.data()?.enabled !== true) throw new AccessError('admin_required', 'Aapki admin permission hata di gayi hai.');
        checkAccount(actorAccount.data(), Date.now(), true); checkSession(actorSession.data(), who.claims.sid);
        if (request.data()?.status !== 'pending') throw new AccessError('request_not_pending', 'Ye tester request ab pending nahi hai.', 409);
        tx.set(targetRef, { status: b.status, reviewedAt: now, reviewedBy: who.uid, updatedAt: now, ...(b.status === 'approved' ? { approvedAt: now, approvedBy: who.uid } : {}) }, { merge: true });
        tx.create(auditRef, { admin: who.uid, target: b.uid, action: 'tester_' + b.status, at: now });
      });
      return send(res, 200, { ok: true, uid: b.uid, status: b.status });
    }
    if (b.action === 'deviceDecision') {
      if (!validId(b.deviceId) || !validId(b.uid) || typeof b.approve !== 'boolean') throw new AccessError('invalid_action', 'Device ka faisla sahi nahi hai.', 400);
      await db.runTransaction(async tx => {
        const d = db.doc('securityDevices/' + b.deviceId), [snap, role,actor,actorSession] = await tx.getAll(d, db.doc('securityAdmins/' + who.uid),db.doc('securityUsers/'+who.uid),db.doc('securitySessions/'+who.uid));
        if (!role.data()?.enabled) throw new AccessError('admin_required', 'Aapki admin permission hata di gayi hai.');
        checkAccount(actor.data(),Date.now(),true);checkSession(actorSession.data(),who.claims.sid);
        const accounts = new Set(snap.data()?.accounts || []), denied = new Set(snap.data()?.denied || []);
        if (b.approve) { accounts.add(b.uid); denied.delete(b.uid); } else { accounts.delete(b.uid); denied.add(b.uid); }
        tx.set(d, { accounts: [...accounts], denied: [...denied] }, { merge: true });
        tx.set(db.doc('securitySessions/' + b.uid), { revoked: true, expiresAt: now }, { merge: true });
        tx.set(db.doc('securityUsers/' + b.uid), { reauthAfter: Math.floor(now/1000) }, { merge: true });
        tx.create(db.collection('securityAudit').doc(), { admin: who.uid, target: b.uid, deviceId: b.deviceId, action: b.approve ? 'approve_device' : 'reject_device', at: now });
      });
      return send(res, 200, { ok: true });
    }
    throw new AccessError('unknown_action', 'Ye action pehchana nahi gaya.', 400);
  } catch (e) { return failure(res, e); }
}
