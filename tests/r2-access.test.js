import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {memoryFirestore,response} from './fake-firestore.js';
process.env.MAINTENANCE_MODE='false';
const db=memoryFirestore(),uid='r2-user';
mock.module('../server/firebase-admin.js',{exports:{services:()=>({db,auth:{verifyIdToken:async()=>({uid,email_verified:true,sid:'valid'})}})}});
Object.assign(process.env,{CLOUDFLARE_R2_ACCOUNT_ID:'test',CLOUDFLARE_R2_ACCESS_KEY_ID:'test',CLOUDFLARE_R2_SECRET_ACCESS_KEY:'test',CLOUDFLARE_R2_BUCKET_NAME:'test'});
const {default:handler}=await import('../api/r2.js');
async function call(action){const res=response();await handler({method:'POST',headers:{authorization:'Bearer fake'},body:{action,key:'assets/file',size:1}},res);return res;}
test('R2 signing is denied to blocked, suspended, revoked and restricted writers before reaching S3',async()=>{
 db.data.set('securitySessions/'+uid,{sid:'valid',expiresAt:Date.now()+100000,revoked:false});
 for(const status of ['blocked','suspended','restricted']){
  db.data.set('securityUsers/'+uid,{status,until:Date.now()+100000});
  for(const action of (status==='restricted'?['put','delete','putChunk','complete']:['put','get','delete','list','head','putChunk','complete']))assert.equal((await call(action)).statusCode,403);
 }
 db.data.set('securityUsers/'+uid,{status:'active'});
 db.data.set('securitySessions/'+uid,{sid:'valid',expiresAt:Date.now()+100000,revoked:true});
 assert.equal((await call('get')).statusCode,401);
});
