import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {memoryFirestore,response} from './fake-firestore.js';
import {memoryRtdb} from './fake-rtdb.js';
process.env.MAINTENANCE_MODE='false';
const db=memoryFirestore(),rtdb=memoryRtdb(),uid='r2-user';
mock.module('../server/firebase-admin.js',{exports:{services:()=>({db,rtdb,auth:{verifyIdToken:async()=>({uid,email_verified:true,sid:'valid'})}})}});
Object.assign(process.env,{CLOUDFLARE_R2_ACCOUNT_ID:'test',CLOUDFLARE_R2_ACCESS_KEY_ID:'test',CLOUDFLARE_R2_SECRET_ACCESS_KEY:'test',CLOUDFLARE_R2_BUCKET_NAME:'test'});
const {default:handler}=await import('../api/r2.js');
const hash='a'.repeat(64);
const bodies={sign:{items:[{hash,size:5}]},confirm:{items:[{hash,size:5}]},urls:{hashes:[hash]}};
async function call(action){const res=response();await handler({method:'POST',headers:{authorization:'Bearer fake'},body:{action,...bodies[action]}},res);return res;}
test('R2 links are denied to blocked, suspended, revoked and restricted users before anything is signed',async()=>{
 db.data.set('securitySessions/'+uid,{sid:'valid',expiresAt:Date.now()+100000,revoked:false});
 for(const status of ['blocked','suspended','restricted']){
  db.data.set('securityUsers/'+uid,{status,until:Date.now()+100000});
  for(const action of (status==='restricted'?['sign','confirm']:['sign','confirm','urls']))assert.equal((await call(action)).statusCode,403,status+' '+action);
 }
 db.data.set('securityUsers/'+uid,{status:'active'});
 assert.equal((await call('urls')).statusCode,200);
 db.data.set('securitySessions/'+uid,{sid:'valid',expiresAt:Date.now()+100000,revoked:true});
 assert.equal((await call('urls')).statusCode,401);
});
test('the old chunk protocol is gone: unknown actions are refused',async()=>{
 db.data.set('securitySessions/'+uid,{sid:'valid',expiresAt:Date.now()+100000,revoked:false});
 for(const action of ['putChunk','complete','head','get','put','delete','list'])assert.equal((await call(action)).statusCode,400,action);
});
