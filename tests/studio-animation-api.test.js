import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {memoryFirestore,response} from './fake-firestore.js';
process.env.MAINTENANCE_MODE='false';
const db=memoryFirestore(),uid='admin-animation-user',objects=new Map();
db.data.set('securityUsers/'+uid,{status:'active'});
db.data.set('securitySessions/'+uid,{sid:'ok',expiresAt:Date.now()+100000,revoked:false});
mock.module('../server/firebase-admin.js',{exports:{services:()=>({db,auth:{verifyIdToken:async()=>({uid,email_verified:true,sid:'ok'})}})}});
mock.module('../server/r2-storage.js',{exports:{configured:()=>true,CHUNK_SIZE:2*1024*1024,readRange:async()=>{},readObject:async(_,key)=>objects.get(key),objectHead:async(_,key)=>objects.has(key)?{exists:true,size:objects.get(key).length,digest:key.slice(7)}:{exists:false}}});
const {default:handler}=await import('../api/studio-assets.js');
async function call(body){const res=response();await handler({method:'POST',headers:{authorization:'Bearer test'},body},res);return res;}
const key='assets/'+'a'.repeat(64),id='published_animation_123';
const clip={duration:48,bone:[{name:'root',translateFrame:[{duration:48,x:1,y:0}]}]};
objects.set(key,Buffer.from(JSON.stringify(clip)));
const payload={action:'save',id,type:'animation',name:'Admin walk',target:'ad-neha-front-side',layer:'body',frameRate:24,key,size:objects.get(key).length,mime:'application/json'};
test('ordinary signed-in users cannot publish animation metadata',async()=>{
 const result=await call(payload);assert.equal(result.statusCode,403);assert.equal(db.data.has('studioAssets/'+id),false);
});
test('admin publishing validates rig target and stored DragonBones bytes',async()=>{
 db.data.set('securityAdmins/'+uid,{enabled:true});
 assert.equal((await call({...payload,target:'unknown-pose'})).statusCode,400);
 objects.set(key,Buffer.from('{}'));
 assert.equal((await call({...payload,size:2})).statusCode,400);
 objects.set(key,Buffer.from(JSON.stringify(clip)));
 const result=await call(payload);assert.equal(result.statusCode,200);assert.equal(result.body.asset.length,2);
 assert.equal((await call({action:'list'})).body.assets.length,1);
});
test('hidden animations leave the library but remain playable by existing projects',async()=>{
 assert.equal((await call({action:'delete',id})).statusCode,200);
 assert.equal((await call({action:'list'})).body.assets.length,0);
 db.data.delete('securityAdmins/'+uid);
 const result=await call({action:'animation',id});assert.equal(result.statusCode,200);assert.deepEqual(result.body.animation,{...clip,_sourceFrameRate:24});
 assert.equal((await call(payload)).statusCode,403);
});
