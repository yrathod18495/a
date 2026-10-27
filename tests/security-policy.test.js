import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAccount, checkSession, checkAcquisition, nextRevision } from '../server/security-policy.js';
test('a second browser is asked before taking over a live session, however old it is; the same browser can resume; a revoked session is free',()=>{
 const s={sid:'one',secretHash:'secret1'};
 assert.throws(()=>checkAcquisition(s,null,'u','secret2',50),e=>e.code==='session_active');
 assert.throws(()=>checkAcquisition(s,null,'u','secret2',9e12),e=>e.code==='session_active');
 assert.doesNotThrow(()=>checkAcquisition(s,null,'u','secret1',50));
 assert.doesNotThrow(()=>checkAcquisition(s,null,'u','secret2',50,true));
 assert.doesNotThrow(()=>checkAcquisition({...s,revoked:true},null,'u','secret2',50));
});
test('a browser may be used by any number of different Gmail accounts; only one active session per account is enforced',()=>{
 assert.doesNotThrow(()=>checkAcquisition(null,{accounts:['gmail1']},'gmail2','s',0));
 assert.doesNotThrow(()=>checkAcquisition(null,{accounts:['gmail1','gmail2'],denied:['gmail2']},'gmail2','s',0));
});
test('blocked, restricted, suspended and restored accounts',()=>{
 assert.throws(()=>checkAccount({status:'blocked'},50));
 assert.doesNotThrow(()=>checkAccount({status:'restricted'},50,false));
 assert.throws(()=>checkAccount({status:'restricted'},50,true));
 assert.throws(()=>checkAccount({status:'suspended',until:100},50));
 assert.doesNotThrow(()=>checkAccount({status:'suspended',until:100},101));
 assert.doesNotThrow(()=>checkAccount({status:'active'},50,true));
});
test('a revoked or replaced session cannot authorize, but a session never times out',()=>{
 assert.throws(()=>checkSession({sid:'old',revoked:true},'old',50));
 assert.throws(()=>checkSession({sid:'new'},'old',50));
 assert.throws(()=>checkSession({sid:'old'},undefined,50));
 assert.doesNotThrow(()=>checkSession({sid:'old'},'old',50));
 assert.doesNotThrow(()=>checkSession({sid:'old'},'old',9e12));
});
test('revisions reject stale commits and accept retry of committed operation',()=>{
 assert.equal(nextRevision(null,0,'a'),1);
 assert.throws(()=>nextRevision({revision:2,operationId:'b'},1,'c'),e=>e.code==='conflict');
 assert.equal(nextRevision({revision:2,operationId:'b'},1,'b'),2);
});
