import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {memoryFirestore,response} from './fake-firestore.js';
process.env.MAINTENANCE_MODE='false';
const db=memoryFirestore(),objects=new Map(),uid='binary-user';let putCount=0,revokeDuringRead=false;
const hash=b=>createHash('sha256').update(b).digest('hex');
function missing(){const e=Error('missing');e.$metadata={httpStatusCode:404};throw e;}
class HeadObjectCommand{constructor(input){this.input=input;}}
class GetObjectCommand{constructor(input){this.input=input;}}
class PutObjectCommand{constructor(input){this.input=input;}}
class ListObjectsV2Command{constructor(input){this.input=input;}}
class S3Client{
 async send(cmd){
  const p=cmd.input,o=objects.get(p.Key);
  if(cmd instanceof HeadObjectCommand){if(!o)missing();return {ContentLength:o.data.length,Metadata:o.metadata,ContentType:o.type};}
  if(cmd instanceof GetObjectCommand){
   if(!o)missing();let data=o.data;
   if(p.Range){const m=p.Range.match(/bytes=(\d+)-(\d+)/);data=data.subarray(Number(m[1]),Number(m[2])+1);}
   return {Body:{transformToByteArray:async()=>data}};
  }
  if(cmd instanceof PutObjectCommand){
   if(o&&p.IfNoneMatch==='*'){const e=Error('exists');e.$metadata={httpStatusCode:412};throw e;}
   putCount++;objects.set(p.Key,{data:Buffer.from(p.Body),metadata:p.Metadata,type:p.ContentType});return {};
  }
  if(cmd instanceof ListObjectsV2Command)return {Contents:[...objects].filter(([k])=>k.startsWith(p.Prefix)).map(([Key,o])=>({Key,Size:o.data.length}))};
  throw Error('Unexpected storage command');
 }
}
mock.module('@aws-sdk/client-s3',{exports:{S3Client,HeadObjectCommand,GetObjectCommand,PutObjectCommand,ListObjectsV2Command}});
mock.module('../server/firebase-admin.js',{exports:{services:()=>({db,auth:{verifyIdToken:async()=>({uid,email_verified:true,sid:'session'})}})}});
Object.assign(process.env,{CLOUDFLARE_R2_ACCOUNT_ID:'test',CLOUDFLARE_R2_ACCESS_KEY_ID:'test',CLOUDFLARE_R2_SECRET_ACCESS_KEY:'test',CLOUDFLARE_R2_BUCKET_NAME:'test'});
db.data.set('securityUsers/'+uid,{status:'active'});db.data.set('securitySessions/'+uid,{sid:'session',revoked:false,expiresAt:Date.now()+600000});
const {default:handler}=await import('../api/r2.js');
mock.module('../src/session.js',{exports:{apiCall:async(url,body,owner)=>{
 assert.equal(owner,uid);const r=response();await handler({method:'POST',headers:{authorization:'Bearer fake'},body},r);
 if(r.statusCode!==200){const e=Error(r.body.error);Object.assign(e,{status:r.statusCode,code:r.body.code});throw e;}
 assert.equal('url' in r.body,false);
 if(revokeDuringRead&&body.action==='get'){revokeDuringRead=false;db.data.get('securitySessions/'+uid).revoked=true;}
 return r.body;
}}});
const {uploadBinary,downloadBinary}=await import('../src/binary-cloud.js');
test('actual gateway handlers round-trip multi-chunk binary; unchanged upload deduplicates',async()=>{
 const bytes=Buffer.alloc(2*1024*1024+37,123);bytes[bytes.length-1]=9;
 const key='assets/'+hash(bytes),blob=new Blob([bytes],{type:'audio/wav'});
 await uploadBinary(uid,key,blob);const count=putCount;
 const restored=await downloadBinary(uid,key);assert.deepEqual(Buffer.from(await restored.arrayBuffer()),bytes);assert.equal(restored.type,'audio/wav');
 await uploadBinary(uid,key,blob);assert.equal(putCount,count);
});
test('revocation between download chunks blocks the next authenticated request',async()=>{
 const bytes=Buffer.alloc(2*1024*1024+37,123);bytes[bytes.length-1]=9;
 revokeDuringRead=true;
 await assert.rejects(downloadBinary(uid,'assets/'+hash(bytes)),e=>e.status===401);
 db.data.get('securitySessions/'+uid).revoked=false;
});
test('gateway reads legacy raw R2 files without changing them',async()=>{
 objects.set('u/'+uid+'/sync/audio/old/raw',{data:Buffer.from('old voice'),type:'audio/wav'});
 assert.equal(await(await downloadBinary(uid,'sync/audio/old/raw')).text(),'old voice');
});
test('malformed checksums, cross-folder paths and incomplete upload manifests are rejected',async()=>{
 for(const body of [
  {action:'putChunk',key:'chunks/'+'0'.repeat(64),data:Buffer.from('wrong').toString('base64')},
  {action:'head',key:'../other-account'},
  {action:'complete',key:'assets/'+'0'.repeat(64),chunks:[],size:1,type:'audio/wav',digest:'0'.repeat(64)}
 ]){
  const r=response();await handler({method:'POST',headers:{authorization:'Bearer fake'},body},r);assert.ok(r.statusCode>=400);
 }
});
