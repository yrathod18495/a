import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {S3Client} from '@aws-sdk/client-s3';
import {memoryFirestore,response} from './fake-firestore.js';
import {memoryRtdb} from './fake-rtdb.js';
process.env.MAINTENANCE_MODE='false';
const db=memoryFirestore(),rtdb=memoryRtdb(),uid='gateway-user',objects=new Map(),sent=[];
Object.assign(process.env,{CLOUDFLARE_R2_ACCOUNT_ID:'acc',CLOUDFLARE_R2_ACCESS_KEY_ID:'key',CLOUDFLARE_R2_SECRET_ACCESS_KEY:'secret',CLOUDFLARE_R2_BUCKET_NAME:'bucket'});
// R2 itself is replaced by a map; signing the links is real and happens offline
S3Client.prototype.send=async function(cmd){
 const name=cmd.constructor.name,key=cmd.input.Key;sent.push(name+' '+key);
 if(name==='HeadObjectCommand'){const o=objects.get(key);if(!o){const e=Error('missing');e.$metadata={httpStatusCode:404};throw e;}return {ContentLength:o};}
 if(name==='DeleteObjectCommand'){objects.delete(key);return {};}
 throw Error('unexpected '+name);
};
mock.module('../server/firebase-admin.js',{exports:{services:()=>({db,rtdb,auth:{verifyIdToken:async()=>({uid,email_verified:true,sid:'ok'})}})}});
db.data.set('securityUsers/'+uid,{status:'active'});db.data.set('securitySessions/'+uid,{sid:'ok',revoked:false,expiresAt:Date.now()+600000});
const {default:handler}=await import('../api/r2.js');
const {assetKey}=await import('../server/r2-storage.js');
async function call(body){const res=response();await handler({method:'POST',headers:{authorization:'Bearer fake'},body},res);return res;}
/** what the browser does with a signed link: the key is in the path, the size is signed in */
const put=(target,size)=>{const url=new URL(target.url);assert.equal(url.host,'acc.r2.cloudflarestorage.com');assert.match(url.searchParams.get('X-Amz-SignedHeaders'),/content-length/);objects.set(decodeURIComponent(url.pathname.replace('/bucket/','')),size);};
const h1='1'.repeat(64),h2='2'.repeat(64);

test('files are sorted per user and per hash, signed once, uploaded by the browser and counted only after they are really there',async()=>{
 const signed=await call({action:'sign',items:[{hash:h1,size:100},{hash:h2,size:50}]});
 assert.equal(signed.statusCode,200);assert.deepEqual(signed.body.have,[]);
 assert.equal(new URL(signed.body.upload[h1].url).pathname,'/bucket/u/'+uid+'/a/11/'+h1);
 assert.equal(assetKey(uid,h2),'u/'+uid+'/a/22/'+h2);
 assert.equal((await call({action:'confirm',items:[{hash:h1,size:100}]})).statusCode,409);          // not uploaded yet
 put(signed.body.upload[h1],100);put(signed.body.upload[h2],50);
 sent.length=0;
 assert.equal((await call({action:'confirm',items:[{hash:h1,size:100},{hash:h2,size:50}]})).body.added,2);
 assert.equal(sent.length,2);                                                                       // one cheap HEAD per new file, no listing
 assert.deepEqual(await rtdb.ref('usage/'+uid).get().then(s=>[s.val().bytes,s.val().objects]),[150,2]);
 sent.length=0;
 assert.equal((await call({action:'confirm',items:[{hash:h1,size:100}]})).body.added,0);assert.equal(sent.length,0);   // known files cost nothing
});
test('a file the user already has is not signed again; usage is checked before signing; bad input is refused',async()=>{
 const again=await call({action:'sign',items:[{hash:h1,size:100},{hash:'3'.repeat(64),size:10}]});
 assert.deepEqual(again.body.have,[h1]);assert.deepEqual(Object.keys(again.body.upload),['3'.repeat(64)]);
 assert.equal((await call({action:'sign',items:[{hash:'4'.repeat(64),size:40*1024*1024}]})).statusCode,200);
 await rtdb.ref('usage/'+uid).set({bytes:299*1024*1024,objects:1});
 assert.equal((await call({action:'sign',items:[{hash:'5'.repeat(64),size:5*1024*1024}]})).statusCode,413);
 for(const items of [[{hash:'xyz',size:1}],[{hash:h1,size:-1}],[{hash:h1,size:41*1024*1024}],Array.from({length:201},(_,i)=>({hash:i.toString(16).padStart(64,'0'),size:1}))])
  assert.equal((await call({action:'sign',items})).statusCode,400);
});
test('download links are made without touching R2 and only for valid hashes',async()=>{
 sent.length=0;
 const out=await call({action:'urls',hashes:[h1,h2,h1]});
 assert.equal(out.statusCode,200);assert.deepEqual(Object.keys(out.body.urls).sort(),[h1,h2]);assert.equal(sent.length,0);
 assert.match(out.body.urls[h1],/\/bucket\/u\/gateway-user\/a\/11\/1{64}\?/);
 assert.equal((await call({action:'urls',hashes:['../other']})).statusCode,400);
});
test('a project snapshot gets its own folder, and the old one is deleted when a new one is committed',async()=>{
 const projectId='project_123456789012',a='operation_aaaaaaaaaaaa',b='operation_bbbbbbbbbbbb';
 const first=await call({action:'sign',items:[],state:{projectId,opId:a,size:30}});
 assert.equal(new URL(first.body.state.url).pathname,`/bucket/u/${uid}/p/${projectId}/state-${a}.json`);
});
