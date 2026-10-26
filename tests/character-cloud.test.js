import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {S3Client} from '@aws-sdk/client-s3';
import {memoryFirestore,response} from './fake-firestore.js';
import {memoryRtdb} from './fake-rtdb.js';
process.env.MAINTENANCE_MODE='false';
const db=memoryFirestore(),rtdb=memoryRtdb(),uid='char-user',objects=new Map();
Object.assign(process.env,{CLOUDFLARE_R2_ACCOUNT_ID:'acc',CLOUDFLARE_R2_ACCESS_KEY_ID:'key',CLOUDFLARE_R2_SECRET_ACCESS_KEY:'secret',CLOUDFLARE_R2_BUCKET_NAME:'bucket'});
S3Client.prototype.send=async function(cmd){
 const name=cmd.constructor.name,key=cmd.input.Key;
 if(name==='HeadObjectCommand'){if(!objects.has(key)){const e=Error('missing');e.$metadata={httpStatusCode:404};throw e;}return {ContentLength:objects.get(key)};}
 if(name==='DeleteObjectCommand'){objects.delete(key);return {};}
 throw Error('unexpected '+name);
};
db.data.set('securityUsers/'+uid,{status:'active'});
db.data.set('securitySessions/'+uid,{sid:'ok',expiresAt:Date.now()+100000,revoked:false});
mock.module('../server/firebase-admin.js',{namedExports:{services:()=>({db,rtdb,auth:{verifyIdToken:async()=>({uid,email_verified:true,sid:'ok'})}})}});
const {default:handler}=await import('../api/projects.js');
const {stateKey}=await import('../server/r2-storage.js');
const call=async body=>{const r=response();await handler({method:'POST',headers:{authorization:'Bearer fake'},body},r);return r;};
// same naming as src/cloud.js: a short character id still makes a valid project id, and the id can be read back from it
const cloudId=id=>('char_'+id).padEnd(16,'_'),charIdOf=pid=>pid.replace(/^char_/,'').replace(/_+$/,'');

test('a saved character is a small index row plus a manifest file in R2; it lists with its id and name, and deleting removes the manifest',async()=>{
 const id='c4xk9ab2f1k',pid=cloudId(id),op='operation_123456789012';
 assert.equal(charIdOf(pid),id);assert.equal(charIdOf(cloudId('c1')),'c1');
 objects.set(stateKey(uid,pid,op),900);
 const saved=await call({action:'commit',id:pid,kind:'character',name:'My hero',expected:0,operationId:op,assets:[],summary:null});
 assert.equal(saved.statusCode,200);
 const list=(await call({action:'list'})).body.projects;
 assert.deepEqual(list.map(p=>[charIdOf(p.id),p.kind,p.name,p.deleted]),[[id,'character','My hero',false]]);
 assert.match(list[0].stateUrl,/state-operation_123456789012\.json\?/);
 const gone=await call({action:'commit',id:pid,kind:'character',name:'deleted',deleted:true,expected:1,operationId:'operation_987654321098',assets:[],summary:null});
 assert.equal(gone.statusCode,200);
 assert.equal([...objects.keys()].some(k=>k.includes('/p/'+pid+'/')),false);
 assert.equal((await call({action:'list'})).body.projects[0].deleted,true);
});
