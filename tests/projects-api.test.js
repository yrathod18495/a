import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {memoryFirestore,response} from './fake-firestore.js';
process.env.MAINTENANCE_MODE='false';
const db=memoryFirestore(),uid='projects-user',assets=new Map();
db.data.set('securityUsers/'+uid,{status:'active'});
db.data.set('securitySessions/'+uid,{sid:'ok',expiresAt:Date.now()+100000,revoked:false});
mock.module('../server/firebase-admin.js',{exports:{services:()=>({db,auth:{verifyIdToken:async()=>({uid,email_verified:true,sid:'ok'})}})}});
mock.module('../server/r2-storage.js',{exports:{
 readObject:async(uid,key)=>{const item=assets.get('u/'+uid+'/'+key);if(!item)throw Error('Missing object');return Buffer.from(item.text);},
 objectHead:async(uid,key)=>{const item=assets.get('u/'+uid+'/'+key);return item?{exists:true,size:item.size,digest:key.slice(7)}:{exists:false};}
}});
const {default:handler}=await import('../api/projects.js');
const id='project_123456789012',op='operation_123456789012',key='projects/'+id+'/snapshots/'+op,asset='assets/'+'a'.repeat(64);
const payload={action:'commit',id,kind:'animation',name:'Project',expected:0,operationId:op,stateKey:key};
async function call(body){const r=response();await handler({method:'POST',headers:{authorization:'Bearer fake'},body},r);return r;}
test('missing binary or invalid manifest cannot replace cloud metadata',async()=>{
 const manifest={version:1,records:[{store:'audio',value:{id:'voice',raw:{__asset:asset,kind:'Blob'}}}],assets:[{key:asset,size:4}]};
 assets.set('u/'+uid+'/'+key,{text:JSON.stringify(manifest),size:100});
 assert.equal((await call(payload)).statusCode,409);assert.equal(db.data.has('workspaces/'+uid+'/projects/'+id),false);
 assets.set('u/'+uid+'/'+asset,{size:3});assert.equal((await call(payload)).statusCode,409);
 assets.set('u/'+uid+'/'+asset,{size:4});
 assert.equal((await call(payload)).statusCode,200);
 assert.equal(db.data.get('workspaces/'+uid+'/projects/'+id).revision,1);
});
test('commit retry is idempotent, stale save conflicts and blocked owner cannot commit',async()=>{
 assert.equal((await call(payload)).body.revision,1);
 assert.equal((await call({...payload,operationId:'operation_987654321098',deleted:true})).statusCode,409);
 db.data.set('securityUsers/'+uid,{status:'blocked'});
 assert.equal((await call({...payload,expected:1,deleted:true})).statusCode,403);
 assert.equal(db.data.get('workspaces/'+uid+'/projects/'+id).deleted,false);
});
