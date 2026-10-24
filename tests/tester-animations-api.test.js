import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {memoryFirestore,response} from './fake-firestore.js';
process.env.MAINTENANCE_MODE='true';
const db=memoryFirestore(),tokens=new Map();
const auth={verifyIdToken:async token=>{if(!tokens.has(token))throw Error('invalid');return tokens.get(token);}};
mock.module('../server/firebase-admin.js',{exports:{services:()=>({db,auth})}});
const {default:handler}=await import('../api/security.js');
const tester='approved_tester_123456',admin='admin_settings_123456',regular='regular_user_1234567';
for(const uid of [tester,admin,regular]){tokens.set(uid,{uid,sid:uid,email_verified:true,email:uid+'@example.test'});db.data.set('securitySessions/'+uid,{sid:uid,expiresAt:Date.now()+120000,revoked:false});}
db.data.set('securityTesters/'+tester,{status:'approved'});db.data.set('securityAdmins/'+admin,{enabled:true});
async function call(uid,body){const res=response();await handler({method:'POST',headers:{authorization:'Bearer '+uid},body},res);return res;}
test('approved testers read admin animation settings during maintenance, with no email disclosure',async()=>{
 db.data.set('config/testers',{emails:['private@example.test'],anims:JSON.stringify({'*':[9000,9001],neha:['9002']}),limit:5});
 const res=await call(tester,{action:'testerAnimations'});assert.equal(res.statusCode,200);assert.deepEqual(res.body.anims,{'*':['9000','9001'],neha:['9002']});assert.deepEqual(res.body.emails,[]);
 assert.equal((await call(regular,{action:'testerAnimations'})).statusCode,403);
});
test('only a verified admin session can change settings; next tester read sees saved grants and removals',async()=>{
 assert.equal((await call(tester,{action:'saveTesterAnimations',anims:{'*':['9000']},limit:0})).statusCode,403);
 const saved=await call(admin,{action:'saveTesterAnimations',anims:{'*':['9000','Walk']},limit:0});assert.equal(saved.statusCode,200);
 assert.deepEqual((await call(tester,{action:'testerAnimations'})).body.anims,{'*':['9000','Walk']});
 await call(admin,{action:'saveTesterAnimations',anims:{},limit:0});assert.deepEqual((await call(tester,{action:'testerAnimations'})).body.anims,{});
 assert.deepEqual(db.data.get('config/testers').emails,['private@example.test']);
});
test('legacy object settings normalize IDs; invalid input and missing/revoked sessions are rejected',async()=>{
 db.data.set('config/testers',{anims:{neha:[9000]},limit:0});assert.deepEqual((await call(tester,{action:'testerAnimations'})).body.anims,{neha:['9000']});
 assert.equal((await call(admin,{action:'saveTesterAnimations',anims:{'*':'all'},limit:0})).statusCode,400);
 assert.equal((await call(admin,{action:'saveTesterAnimations',anims:{},limit:-1})).statusCode,400);
 db.data.get('securitySessions/'+tester).revoked=true;assert.equal((await call(tester,{action:'testerAnimations'})).statusCode,401);db.data.get('securitySessions/'+tester).revoked=false;
 db.data.set('securityTesters/'+tester,{status:'revoked'});assert.equal((await call(tester,{action:'testerAnimations'})).statusCode,403);db.data.set('securityTesters/'+tester,{status:'approved'});
 db.data.set('securityUsers/'+tester,{status:'blocked'});assert.equal((await call(tester,{action:'testerAnimations'})).statusCode,403);
});

 test('admin preview access does not require tester grants and cannot be requested by an ordinary account',async()=>{
  db.data.set('config/testers',{anims:'{}',limit:1});
  const result=await call(admin,{action:'testerAnimations'});
  assert.equal(result.statusCode,200);assert.equal(result.body.admin,true);assert.deepEqual(result.body.anims,{});
  db.data.set('securityUsers/'+tester,{status:'active'});
  const limited=await call(tester,{action:'testerAnimations',admin:true});assert.equal(limited.statusCode,200);assert.equal(limited.body.admin,false);
  assert.equal((await call(regular,{action:'testerAnimations',admin:true})).statusCode,403);
  db.data.get('securitySessions/'+admin).revoked=true;assert.equal((await call(admin,{action:'testerAnimations'})).statusCode,401);db.data.get('securitySessions/'+admin).revoked=false;
 });

test('admin part rules persist and update tester reads; animation-only saves preserve part rules',async()=>{
 db.data.set('securityUsers/'+tester,{status:'active'});
 const rules={hiddenGroups:{'*':['Hair'],neha:['Face']},blockedDownloads:{neha:['head|face']}};
 const saved=await call(admin,{action:'saveTesterAnimations',anims:{'*':['9000']},limit:0,...rules});assert.equal(saved.statusCode,200);
 const read=await call(tester,{action:'testerAnimations'});assert.deepEqual(read.body.hiddenGroups,rules.hiddenGroups);assert.deepEqual(read.body.blockedDownloads,rules.blockedDownloads);
 assert.equal((await call(tester,{action:'saveTesterAnimations',...rules})).statusCode,403);
 assert.equal((await call(admin,{action:'saveTesterAnimations',hiddenGroups:{'*':'all'}})).statusCode,400);
 await call(admin,{action:'saveTesterAnimations',anims:{},limit:0});
 assert.deepEqual((await call(tester,{action:'testerAnimations'})).body.hiddenGroups,rules.hiddenGroups);
 await call(admin,{action:'saveTesterAnimations',hiddenGroups:{},blockedDownloads:{}});
 assert.deepEqual((await call(tester,{action:'testerAnimations'})).body.blockedDownloads,{});
});

test('character exclusions override global grants in persisted tester permissions and survive animation-only saves',async()=>{
 const rules={anims:{'*':['9000','9001']},blockedAnims:{neha:['9000','9001']},limit:0};
 assert.equal((await call(admin,{action:'saveTesterAnimations',...rules})).statusCode,200);
 const read=await call(tester,{action:'testerAnimations'});assert.deepEqual(read.body.blockedAnims,rules.blockedAnims);
 await call(admin,{action:'saveTesterAnimations',anims:{'*':['9000']},limit:0});
 assert.deepEqual((await call(tester,{action:'testerAnimations'})).body.blockedAnims,rules.blockedAnims);
 assert.equal((await call(tester,{action:'saveTesterAnimations',blockedAnims:{}})).statusCode,403);
});

test('per-character allow survives a global None when saved and read back by a tester',async()=>{
 const rules={anims:{neha:['9000','9001']},blockedAnims:{'*':['9000','9001']},limit:0};
 assert.equal((await call(admin,{action:'saveTesterAnimations',...rules})).statusCode,200);
 const read=await call(tester,{action:'testerAnimations'});
 assert.equal(read.statusCode,200);assert.deepEqual(read.body.anims,rules.anims);assert.deepEqual(read.body.blockedAnims,rules.blockedAnims);
});
