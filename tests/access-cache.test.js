import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {memoryFirestore,response} from './fake-firestore.js';
process.env.MAINTENANCE_MODE='false';
const db=memoryFirestore(),uid='cache-user-123456';let reads=0;
const getAll=db.getAll;db.getAll=async(...refs)=>{reads+=refs.length;return getAll(...refs);};
mock.module('../server/firebase-admin.js',{exports:{services:()=>({db,auth:{verifyIdToken:async()=>({uid,email_verified:true,sid:'ok'})}})}});
const {access,forgetAccess}=await import('../server/access.js');
const {default:security}=await import('../api/security.js');
const req={headers:{authorization:'Bearer x'}};
const now=()=>Date.now();
const reset=()=>{forgetAccess();reads=0;db.data.set('securityUsers/'+uid,{status:'active'});db.data.set('securitySessions/'+uid,{sid:'ok',revoked:false,expiresAt:4102444800000});};

test('without the cache (tests, local runs) every call reads the three documents',async()=>{
 delete process.env.ACCESS_CACHE_MS;reset();
 await access(req);await access(req);assert.equal(reads,6);
});
test('with the cache a burst of calls costs three reads; writes and the heartbeat always read fresh, so a block stops changes at once',async()=>{
 process.env.ACCESS_CACHE_MS='60000';reset();
 for(let i=0;i<10;i++)await access(req);assert.equal(reads,3);
 await access(req,{write:true,cache:true});assert.equal(reads,3);        // saving files / projects may use the same short-lived copy
 db.data.set('securityUsers/'+uid,{status:'blocked'});
 await access(req);assert.equal(reads,3);                                   // reads may use the few-seconds-old copy
 await assert.rejects(access(req,{write:true}),e=>e.code==='blocked');       // an admin action or payment is refused immediately
 await assert.rejects(access(req,{fresh:true}),e=>e.code==='blocked');
 forgetAccess(uid);await assert.rejects(access(req),e=>e.code==='blocked');
 delete process.env.ACCESS_CACHE_MS;
});
test('the heartbeat never writes the session and a revoked session is rejected',async()=>{
 delete process.env.ACCESS_CACHE_MS;reset();
 let writes=0;const update=db.doc('securitySessions/'+uid).constructor;
 const doc=db.doc;db.doc=(path)=>{const d=doc(path);if(path==='securitySessions/'+uid){const set=d.update?.bind(d);d.update=async(v)=>{writes++;return set?set(v):db.data.set(path,{...db.data.get(path),...v});};}return d;};
 const beat=async()=>{const res=response();await security({method:'POST',headers:req.headers,body:{action:'heartbeat'}},res);return res;};
 reads=0;assert.equal((await beat()).statusCode,200);assert.equal(writes,0);          // nothing to renew
 assert.equal(reads,0);                                                          // and the heartbeat reads just the session document (not the 3-document batch)
 db.data.set('securitySessions/'+uid,{sid:'ok',revoked:false,expiresAt:now()+60*1000});     // a session started before sessions stopped expiring
 assert.equal((await beat()).statusCode,200);assert.equal(writes,1);assert.equal(db.data.get('securitySessions/'+uid).expiresAt,4102444800000);   // upgraded once
 assert.equal((await beat()).statusCode,200);assert.equal(writes,1);                         // and never written again
 db.data.set('securitySessions/'+uid,{sid:'ok',revoked:true});
 assert.equal((await beat()).statusCode,401);
 db.doc=doc;
});
