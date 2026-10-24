import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {memoryFirestore,response} from './fake-firestore.js';
process.env.MAINTENANCE_MODE='false';
const db=memoryFirestore(),tokens=new Map();
const auth={verifyIdToken:async token=>{if(!tokens.has(token))throw Error('bad token');return tokens.get(token);},createCustomToken:async(uid,claims)=>JSON.stringify({uid,...claims}),listUsers:async()=>({users:[{uid:'existing-user-from-auth',email:'existing@gmail.com',metadata:{creationTime:'2026-01-01'}}]})};
mock.module('../server/firebase-admin.js',{exports:{services:()=>({db,auth})}});
const {default:security}=await import('../api/security.js');
const {access}=await import('../server/access.js');
const request=(token,body)=>({method:'POST',headers:{authorization:'Bearer '+token},body});
async function call(token,body){const res=response();await security(request(token,body),res);return res;}
const uid='user_12345678901234567890',other='user_98765432109876543210';
function loginToken(key,id=uid){
 tokens.set(key,{uid:id,email:id+'@gmail.com',email_verified:true,auth_time:Math.floor(Date.now()/1000),firebase:{sign_in_provider:'google.com'}});
}
test('actual acquisition handler serializes simultaneous devices; backend rejects loser',async()=>{
 loginToken('google');
 const results=await Promise.all([call('google',{action:'acquire',deviceId:'device_111111111111',secret:'secret_111111111111'}),call('google',{action:'acquire',deviceId:'device_222222222222',secret:'secret_222222222222'})]);
 assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,409]);
 const winner=JSON.parse(results.find(r=>r.statusCode===200).body.token);
 tokens.set('session',{...tokens.get('google'),sid:winner.sid,firebase:{sign_in_provider:'custom'}});
 assert.equal((await access(request('session',{}))).uid,uid);
 await assert.rejects(access(request('google',{})),e=>e.code==='session_invalid');
});
test('actual handler logs and blocks second Gmail on associated device',async()=>{
 loginToken('other',other);
 const active=db.data.get('securitySessions/'+uid);
 const r=await call('other',{action:'acquire',deviceId:active.deviceId,secret:'secret_333333333333'});
 assert.equal(r.statusCode,403);assert.equal(r.body.code,'device_review');
 assert.ok([...db.data.values()].some(e=>e.uid===other&&e.code==='device_review'));
});
test('nonadmin cannot moderate; admin actions enforced on backend and audited',async()=>{
 assert.equal((await call('session',{action:'moderate',uid:other,status:'blocked'})).statusCode,403);
 db.data.set('securityAdmins/'+uid,{enabled:true});
 for(const status of ['blocked','restricted','suspended','active']){
  const r=await call('session',{action:'moderate',uid:other,status,...(status==='suspended'?{until:Date.now()+100000}:{})});
  assert.equal(r.statusCode,200);assert.equal(db.data.get('securityUsers/'+other).status,status);
  db.data.set('securitySessions/'+other,{sid:'target',expiresAt:Date.now()+100000,revoked:false});
  tokens.set('target',{...tokens.get('other'),sid:'target'});
  if(status==='active')assert.equal((await access(request('target',{}),{write:true})).uid,other);
  else await assert.rejects(access(request('target',{}),{write:true}));
 }
 assert.equal([...db.data.keys()].filter(k=>k.startsWith('securityAudit/')).length,4);
});
test('device approval and rejection are persisted with audit; cached custom token cannot reacquire',async()=>{
 const deviceId=db.data.get('securitySessions/'+uid).deviceId;
 for(const approve of [true,false]){
  const r=await call('session',{action:'deviceDecision',deviceId,uid:other,approve});assert.equal(r.statusCode,200);
  assert.equal(db.data.get('securityDevices/'+deviceId).accounts.includes(other),approve);
 }
 const r=await call('session',{action:'acquire',deviceId,secret:'secret_111111111111'});
 assert.equal(r.statusCode,401);
});
test('admin overview includes registered users from Firebase Auth and excludes session secrets',async()=>{
 const r=await call('session',{action:'overview'});assert.equal(r.statusCode,200);
 assert.equal(r.body.users[0].email,'existing@gmail.com');assert.ok(r.body.sessions.every(s=>!('secretHash' in s)));
 const done=await call('session',{action:'overview',cursors:{users:null,sessions:null,devices:null,events:null,audit:null}});
 assert.deepEqual(done.body.users,[]);assert.deepEqual(done.body.events,[]);
});
test('logout revokes backend session immediately',async()=>{
 assert.equal((await call('session',{action:'logout'})).statusCode,200);
 await assert.rejects(access(request('session',{})),e=>e.code==='session_invalid');
});
test('maintenance blocks non-admin sessions and acquisition while verified admins retain API access',async()=>{
 process.env.MAINTENANCE_MODE='true';
 loginToken('maintenance-user',other);
 const denied=await call('maintenance-user',{action:'acquire',deviceId:'device_maintenance_123',secret:'secret_maintenance_123'});
 assert.equal(denied.statusCode,503);assert.equal(denied.body.code,'maintenance');
 const status=await call('public',{action:'maintenanceStatus'});
 assert.equal(status.statusCode,200);assert.equal(status.body.maintenance,true);
 db.data.set('securityAdmins/'+uid,{enabled:true});
 db.data.set('securityUsers/'+uid,{status:'active'});
 db.data.set('securitySessions/'+uid,{sid:'maintenance-admin',expiresAt:Date.now()+100000,revoked:false});
 tokens.set('maintenance-admin',{uid,email_verified:true,sid:'maintenance-admin'});
 assert.equal((await call('maintenance-admin',{action:'overview'})).statusCode,200);
 process.env.MAINTENANCE_MODE='false';
});
