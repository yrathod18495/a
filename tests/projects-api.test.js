import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {S3Client} from '@aws-sdk/client-s3';
import {memoryFirestore,response} from './fake-firestore.js';
import {memoryRtdb} from './fake-rtdb.js';
process.env.MAINTENANCE_MODE='false';
const db=memoryFirestore(),rtdb=memoryRtdb(),uid='projects-user',objects=new Map(),sent=[];
Object.assign(process.env,{CLOUDFLARE_R2_ACCOUNT_ID:'acc',CLOUDFLARE_R2_ACCESS_KEY_ID:'key',CLOUDFLARE_R2_SECRET_ACCESS_KEY:'secret',CLOUDFLARE_R2_BUCKET_NAME:'bucket'});
S3Client.prototype.send=async function(cmd){
 const name=cmd.constructor.name,key=cmd.input.Key;sent.push(name);
 if(name==='HeadObjectCommand'){if(!objects.has(key)){const e=Error('missing');e.$metadata={httpStatusCode:404};throw e;}return {ContentLength:objects.get(key)};}
 if(name==='DeleteObjectCommand'){objects.delete(key);return {};}
 throw Error('unexpected '+name);
};
db.data.set('securityUsers/'+uid,{status:'active'});
db.data.set('securitySessions/'+uid,{sid:'ok',expiresAt:Date.now()+100000,revoked:false});
mock.module('../server/firebase-admin.js',{exports:{services:()=>({db,rtdb,auth:{verifyIdToken:async()=>({uid,email_verified:true,sid:'ok'})}})}});
const {default:handler}=await import('../api/projects.js');
const {stateKey,assetKey}=await import('../server/r2-storage.js');
const id='project_123456789012',op1='operation_123456789012',op2='operation_987654321098',hash='a'.repeat(64);
const payload={action:'commit',id,kind:'animation',name:'Project',expected:0,operationId:op1,assets:[{hash,size:4}],summary:{audioCount:1,audioFiles:[{id:'voice',filename:'v.wav',speaker:'Narrator',order:0,available:true}]}};
async function call(body){const r=response();await handler({method:'POST',headers:{authorization:'Bearer fake'},body},r);return r;}
const node=async()=>(await rtdb.ref(`projects/${uid}/${id}`).get()).val();

test('a save needs the snapshot and every new file to be in R2 first; nothing else is read or written',async()=>{
 assert.equal((await call(payload)).statusCode,409);assert.equal(await node(),null);                 // snapshot missing
 objects.set(stateKey(uid,id,op1),100);
 assert.equal((await call(payload)).statusCode,409);assert.equal(await node(),null);                 // file missing
 objects.set(assetKey(uid,hash),3);assert.equal((await call(payload)).statusCode,409);               // wrong size
 objects.set(assetKey(uid,hash),4);
 sent.length=0;
 assert.equal((await call(payload)).statusCode,200);
 assert.deepEqual(sent,['HeadObjectCommand','HeadObjectCommand']);                                   // snapshot + the one new file: no downloads, no listing
 const saved=await node();
 assert.deepEqual([saved.revision,saved.stateOp,saved.kind,saved.deleted,saved.summary.audioCount,saved.activity.length],[1,op1,'animation',false,1,1]);
 assert.equal(saved.summary.audioFiles[0].filename,'v.wav');
 assert.equal(db.data.size>=2,true);                                                                 // only the security documents exist in Firestore
 assert.deepEqual([...db.data.keys()].filter(k=>k.startsWith('workspaces/')),[]);
});
test('retry is idempotent, stale saves conflict, a newer save deletes the older snapshot and files already known are not checked again',async()=>{
 assert.equal((await call(payload)).body.revision,1);
 assert.equal((await call({...payload,operationId:op2,expected:0})).statusCode,409);
 objects.set(stateKey(uid,id,op2),120);sent.length=0;
 assert.equal((await call({...payload,operationId:op2,expected:1})).body.revision,2);
 assert.deepEqual(sent,['HeadObjectCommand','DeleteObjectCommand']);                                // new snapshot checked, old one deleted, known file skipped
 assert.equal(objects.has(stateKey(uid,id,op1)),false);assert.equal(objects.has(stateKey(uid,id,op2)),true);
 const list=await call({action:'list'});
 assert.equal(list.body.projects.length,1);assert.match(list.body.projects[0].stateUrl,new RegExp('/bucket/u/'+uid+'/p/'+id+'/state-'+op2+'\\.json\\?'));
 assert.equal('activity' in list.body.projects[0],false);
});
test('only the last ten saves are kept in the activity list; a blocked owner cannot commit; deleting removes the snapshot',async()=>{
 let rev=2;
 for(let i=0;i<12;i++){const op='operation_'+String(i).padStart(12,'0');objects.set(stateKey(uid,id,op),10);assert.equal((await call({...payload,operationId:op,expected:rev})).statusCode,200);rev++;}
 assert.equal((await node()).activity.length,10);
 db.data.set('securityUsers/'+uid,{status:'blocked'});
 assert.equal((await call({...payload,expected:rev,deleted:true,operationId:'operation_zzzzzzzzzzzz'})).statusCode,403);
 db.data.set('securityUsers/'+uid,{status:'active'});
 assert.equal((await call({...payload,expected:rev,deleted:true,operationId:'operation_zzzzzzzzzzzz'})).statusCode,200);
 assert.deepEqual([(await node()).deleted,(await node()).stateOp],[true,null]);
 assert.equal([...objects.keys()].some(k=>k.includes('/p/'+id+'/')),false);
});

test('a brand-new project tells the owner on Telegram once; registering it again, or a refused ID, says nothing',async()=>{
 const messages=[],realFetch=globalThis.fetch;
 process.env.TELEGRAM_BOT_TOKEN='123:TOKEN';process.env.TELEGRAM_CHAT_ID='-100555';
 globalThis.fetch=async(url,init)=>{if(String(url).startsWith('https://api.telegram.org/'))messages.push([String(url),JSON.parse(init.body)]);return {ok:true,status:200};};
 try{
  const reg={action:'register',id:'502674123',kind:'animation',name:'My first film'};
  assert.equal((await call(reg)).statusCode,200);
  assert.equal(messages.length,1);assert.equal(messages[0][0],'https://api.telegram.org/bot123:TOKEN/sendMessage');assert.equal(messages[0][1].chat_id,'-100555');
  assert.match(messages[0][1].text,/My first film/);assert.match(messages[0][1].text,/502674123/);assert.match(messages[0][1].text,/Animator Studio/);
  assert.equal((await call(reg)).statusCode,200);assert.equal(messages.length,1);                           // the same project again: no second message
  assert.equal((await call({...reg,id:'502674124',kind:'character',name:'Hero'})).statusCode,200);assert.equal(messages.length,2);assert.match(messages[1][1].text,/Character Editor/);
  await rtdb.ref('projectIndex/777000111').set({uid:'someone-else',kind:'animation'});
  assert.equal((await call({...reg,id:'777000111'})).statusCode,409);assert.equal(messages.length,2);        // an ID of another account: refused, nothing sent
  // the bot is not set up: registering still works and nothing is sent
  delete process.env.TELEGRAM_BOT_TOKEN;
  assert.equal((await call({...reg,id:'502674125'})).statusCode,200);assert.equal(messages.length,2);
  // Telegram is down: the project is still registered
  process.env.TELEGRAM_BOT_TOKEN='123:TOKEN';globalThis.fetch=async()=>{throw new Error('offline');};
  assert.equal((await call({...reg,id:'502674126'})).statusCode,200);
 }finally{globalThis.fetch=realFetch;delete process.env.TELEGRAM_BOT_TOKEN;delete process.env.TELEGRAM_CHAT_ID;}
});
