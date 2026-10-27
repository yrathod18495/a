import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { memoryFirestore, response } from './fake-firestore.js';
process.env.MAINTENANCE_MODE = 'true';
const db = memoryFirestore(), tokens = new Map();
const admin = 'admin_review_12345678', uid = 'tester_request_12345678';
const auth = {
 verifyIdToken: async token => { if (!tokens.has(token)) throw Error('Invalid token'); return tokens.get(token); },
 createCustomToken: async (uid, claims) => JSON.stringify({uid, ...claims}),
 setCustomUserClaims: async () => {},
 getUser: async uid => ({ uid, email: uid+'@example.test', displayName: 'Tester' }),
};
mock.module('../server/firebase-admin.js', {exports:{services:()=>({db,auth})}});
const {default: handler} = await import('../api/security.js');
const google = uid => ({uid,email:uid+'@example.test',name:'Tester',email_verified:true,auth_time:Math.floor(Date.now()/1000),firebase:{sign_in_provider:'google.com'}});
tokens.set(uid,google(uid));tokens.set(admin,{...google(admin),sid:'admin-session'});
db.data.set('securityAdmins/'+admin,{enabled:true});
db.data.set('securitySessions/'+admin,{sid:'admin-session',expiresAt:Date.now()+100000,revoked:false});
const acquire = {action:'acquire',scope:'tester',deviceId:'tester_device_123456',secret:'tester_secret_123456'};
async function call(token, body) { const res=response(); await handler({method:'POST',headers:{authorization:'Bearer '+token},body},res); return res; }

test('Google tester request is persisted during maintenance and appears for admin approve/reject',async()=>{
 assert.equal((await call(uid,{action:'testerStatus'})).body.status,'none');
 assert.equal((await call(uid,{action:'testerApply'})).body.status,'pending');
 assert.equal((await call(uid,{action:'testerApply'})).body.status,'pending');
 const requests=(await call(admin,{action:'testerRequests'})).body.requests;
 assert.equal(requests.length,1);assert.equal(requests[0].uid,uid);assert.equal(requests[0].email,uid+'@example.test');
 // Maintenance no longer blocks sign-in itself: a pending (not yet approved) tester can still acquire a session; the app gates access after login.
 assert.equal((await call(uid,acquire)).statusCode,200);
 assert.equal((await call(admin,{action:'reviewTester',uid,status:'rejected'})).statusCode,200);
 assert.equal((await call(uid,{action:'testerStatus'})).body.status,'rejected');
 assert.equal((await call(uid,{action:'testerApply'})).body.status,'pending');
 assert.equal((await call(admin,{action:'reviewTester',uid,status:'approved'})).statusCode,200);
 assert.equal((await call(uid,{action:'testerStatus'})).body.status,'approved');
 assert.equal((await call(admin,{action:'testerRequests'})).body.requests.length,0);
});

test('approved tester obtains a secure session during maintenance without opening admin APIs',async()=>{
 const result=await call(uid,acquire);assert.equal(result.statusCode,200);
 const session=JSON.parse(result.body.token);tokens.set('tester-session',{...google(uid),sid:session.sid,firebase:{sign_in_provider:'custom'}});
 assert.equal((await call('tester-session',{action:'heartbeat'})).statusCode,200);
 assert.equal((await call('tester-session',{action:'testerAnimations'})).statusCode,200);
 assert.equal((await call('tester-session',{action:'overview'})).statusCode,403);
 assert.equal((await call('tester-session',{action:'assignRole',uid:admin,role:'tester'})).statusCode,403);
 // A client-provided tester intent cannot grant a role, but signing in is never blocked by maintenance.
 const outsider='outsider_user_12345678';tokens.set(outsider,google(outsider));
 assert.equal((await call(outsider,acquire)).statusCode,200);
 assert.equal((await call(outsider,{action:'testerRequests'})).statusCode,401);
});

test('manual tester role assignment grants access; removal revokes it',async()=>{
 const manual='manual_tester_12345678';tokens.set(manual,google(manual));
 assert.equal((await call(admin,{action:'assignRole',uid:manual,role:'tester'})).statusCode,200);
 assert.equal((await call(manual,{action:'testerStatus'})).body.status,'approved');
 const result=await call(manual,{...acquire,deviceId:'manual_device_123456',secret:'manual_secret_123456'});
 assert.equal(result.statusCode,200);tokens.set('manual-session',{...google(manual),sid:JSON.parse(result.body.token).sid});
 assert.equal((await call(admin,{action:'assignRole',uid:manual,role:'user'})).statusCode,200);
 assert.equal((await call('manual-session',{action:'testerAnimations'})).statusCode,401);
 assert.equal((await call(manual,acquire)).statusCode,200);
});

test('tester intent preserves fresh Google, blocked account and device/session checks',async()=>{
 tokens.set('old-google',{...google(uid),auth_time:Math.floor(Date.now()/1000)-600});
 assert.equal((await call('old-google',acquire)).body.code,'fresh_login_required');
 assert.equal((await call('tester-session',acquire)).body.code,'fresh_login_required');
 db.data.set('securityUsers/'+uid,{status:'blocked'});
 assert.equal((await call(uid,{action:'testerApply'})).body.code,'blocked');
 assert.equal((await call(uid,{action:'testerStatus'})).body.code,'blocked');
 assert.equal((await call(uid,acquire)).body.code,'blocked');
 db.data.set('securityUsers/'+uid,{status:'active'});
 assert.equal((await call(uid,{...acquire,secret:'different_secret_123456'})).body.code,'session_active');
});
