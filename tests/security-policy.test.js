import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAccount, checkSession, checkAcquisition, nextRevision } from '../server/security-policy.js';
test('second browser rejected while first lease lives; same secret can resume',()=>{
 const s={sid:'one',secretHash:'secret1',expiresAt:100};
 assert.throws(()=>checkAcquisition(s,null,'u','secret2',50),e=>e.code==='session_active');
 assert.doesNotThrow(()=>checkAcquisition(s,null,'u','secret1',50));
 assert.doesNotThrow(()=>checkAcquisition(s,null,'u','secret2',101));
});
test('same installation with another Gmail needs approval; rejection remains enforced',()=>{
 assert.throws(()=>checkAcquisition(null,{accounts:['gmail1']},'gmail2','s',0),e=>e.code==='device_review');
 assert.doesNotThrow(()=>checkAcquisition(null,{accounts:['gmail1','gmail2']},'gmail2','s',0));
 assert.throws(()=>checkAcquisition(null,{accounts:['gmail1','gmail2'],denied:['gmail2']},'gmail2','s',0),e=>e.code==='device_rejected');
});
test('blocked, restricted, suspended and restored accounts',()=>{
 assert.throws(()=>checkAccount({status:'blocked'},50));
 assert.doesNotThrow(()=>checkAccount({status:'restricted'},50,false));
 assert.throws(()=>checkAccount({status:'restricted'},50,true));
 assert.throws(()=>checkAccount({status:'suspended',until:100},50));
 assert.doesNotThrow(()=>checkAccount({status:'suspended',until:100},101));
 assert.doesNotThrow(()=>checkAccount({status:'active'},50,true));
});
test('cached token from revoked, expired or replaced session cannot authorize',()=>{
 assert.throws(()=>checkSession({sid:'old',expiresAt:100,revoked:true},'old',50));
 assert.throws(()=>checkSession({sid:'new',expiresAt:100},'old',50));
 assert.throws(()=>checkSession({sid:'old',expiresAt:100},'old',101));
 assert.throws(()=>checkSession({sid:'old',expiresAt:100},undefined,50));
 assert.doesNotThrow(()=>checkSession({sid:'old',expiresAt:100},'old',50));
});
test('revisions reject stale commits and accept retry of committed operation',()=>{
 assert.equal(nextRevision(null,0,'a'),1);
 assert.throws(()=>nextRevision({revision:2,operationId:'b'},1,'c'),e=>e.code==='conflict');
 assert.equal(nextRevision({revision:2,operationId:'b'},1,'b'),2);
});
