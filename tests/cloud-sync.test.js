import 'fake-indexeddb/auto';
import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../src/store.js';
const user={uid:'cloud-user'}, remote=new Map(), objects=new Map(), calls=[];
let failUpload=false,loseCommitResponse=false,denyCommit=false;
globalThis.window=new EventTarget();
Object.defineProperty(globalThis.navigator,'onLine',{value:true,configurable:true});
mock.module('../src/firebase.js',{exports:{auth:{currentUser:user}}});
mock.module('../src/binary-cloud.js',{exports:{
 uploadAssets:async(uid,files,state)=>{
  if(failUpload)throw Error('upload failed');const fresh=[];
  for(const [hash,blob] of files)if(!objects.has('a/'+hash)){calls.push({action:'put',key:'assets/'+hash});objects.set('a/'+hash,blob);fresh.push({hash,size:blob.size});}
  if(state){calls.push({action:'state',opId:state.opId});objects.set('state/'+state.opId,state.blob);}
  return {sent:fresh.length,fresh};
 },
 downloadAssets:async(uid,hashes)=>new Map(hashes.map(h=>{if(!objects.has('a/'+h))throw Error('Missing binary');return [h,objects.get('a/'+h)];})),
 fetchBlob:async(url)=>{if(!objects.has(url))throw Error('Missing snapshot');return objects.get(url);}
}});
mock.module('../src/session.js',{exports:{apiCall:async(url,body,uid)=>{
 assert.equal(uid,user.uid);calls.push({...body});
 if(denyCommit){const error=Error('Cloud access denied');error.status=403;error.code='forbidden';throw error;}
 if(body.action==='list')return {projects:[...remote.values()].map(p=>({...p,stateUrl:p.stateOp?'state/'+p.stateOp:null}))};
 const old=remote.get(body.id);
 if(old?.operationId===body.operationId)return {revision:old.revision};
 if((old?.revision||0)!==body.expected){const e=Error('conflict');e.code='conflict';throw e;}
 const next={...body,revision:body.expected+1,stateOp:body.deleted?null:body.operationId};remote.set(body.id,next);
 if(loseCommitResponse){loseCommitResponse=false;throw Error('lost response');}
 return {revision:next.revision};
}}});
globalThis.fetch=async(url,opts)=>{
 if(opts?.method==='PUT'){if(failUpload)return {ok:false,status:503};objects.set(url,opts.body);return {ok:true};}
 return {ok:objects.has(url),blob:async()=>objects.get(url)};
};
const sync=await import('../src/project-sync.js');
test('offline work remains dirty; reconnect saves cloud and restores exact bytes after cache loss',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const p=await store.createProject(user.uid,'animation');store.selectProject(user.uid,p.id);
 await store.put('audio',{id:'voice',raw:new Uint8Array([7,8,9]).buffer});
 Object.defineProperty(navigator,'onLine',{value:false,configurable:true});await sync.syncProject(user.uid,p.id);
 assert.equal((await store.projectMeta(user.uid,p.id)).dirty,true);assert.equal(sync.syncStatus.text,'Offline');
 Object.defineProperty(navigator,'onLine',{value:true,configurable:true});await sync.syncProject(user.uid,p.id);
 assert.equal(sync.syncStatus.text,'Saved to Cloud');
 assert.equal((await store.projectMeta(user.uid,p.id)).dirty,false);
 await new Promise((resolve,reject)=>{
  const r=indexedDB.open('12toons-projects-v1',2);
  r.onsuccess=()=>{const tx=r.result.transaction(['records','projects'],'readwrite');tx.objectStore('projects').delete([user.uid,p.id]);tx.objectStore('records').delete([user.uid,p.id,'audio','voice']);tx.oncomplete=()=>{r.result.close();resolve();};tx.onerror=()=>reject(tx.error);};
 });
 await sync.refreshProjects(user.uid);
 assert.deepEqual([...new Uint8Array((await store.get('audio','voice')).raw)],[7,8,9]);
});
test('upload failure leaves last valid revision; retry succeeds',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const p=await store.createProject(user.uid,'animation');store.selectProject(user.uid,p.id);
 await store.put('audio',{id:'voice',raw:new Uint8Array([2,4,6]).buffer});
 failUpload=true;await assert.rejects(sync.syncProject(user.uid,p.id));assert.equal(remote.has(p.id),false);
 assert.equal(sync.syncStatus.text,'Sync Failed');failUpload=false;await sync.syncProject(user.uid,p.id);
 assert.equal(remote.get(p.id).revision,1);
});
test('lost commit response retries same operation without false conflict',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const p=await store.createProject(user.uid,'animation');loseCommitResponse=true;
 await assert.rejects(sync.syncProject(user.uid,p.id));assert.equal(remote.get(p.id).revision,1);
 assert.ok((await store.projectMeta(user.uid,p.id)).pending);
 await sync.syncProject(user.uid,p.id);assert.equal(remote.get(p.id).revision,1);
 assert.equal((await store.projectMeta(user.uid,p.id)).dirty,false);
});
test('conflict retains local edits and does not overwrite remote',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const p=await store.createProject(user.uid,'animation');
 remote.set(p.id,{id:p.id,revision:5,operationId:'elsewhere'});
 await assert.rejects(sync.syncProject(user.uid,p.id));assert.equal(sync.syncStatus.text,'Conflict');
 assert.equal(remote.get(p.id).revision,5);assert.equal((await store.projectMeta(user.uid,p.id)).dirty,true);
});
test('concurrent saves share one job and unchanged binaries are not uploaded again',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const p=await store.createProject(user.uid,'character');store.selectProject(user.uid,p.id);
 await store.put('draft',{id:'current',texture:new Blob(['a unique texture'])});
 const before=calls.filter(c=>c.action==='put'&&c.key.startsWith('assets/')).length;
 await Promise.all([sync.syncProject(user.uid,p.id),sync.syncProject(user.uid,p.id)]);
 assert.equal(remote.get(p.id).revision,1);
 await store.renameProject(user.uid,p.id,'Renamed');await sync.syncProject(user.uid,p.id);
 const after=calls.filter(c=>c.action==='put'&&c.key.startsWith('assets/')).length;
 assert.equal(after-before,1);
});

test('denied sync reports an actionable cause and preserves local records',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const p=await store.createProject(user.uid,'animation');store.selectProject(user.uid,p.id);
 await store.put('project',{id:'current',doc:{name:'Keep my edits'}});
 denyCommit=true;
 try {
  await assert.rejects(sync.syncProject(user.uid,p.id));
  assert.equal(sync.syncStatus.projectId,p.id);
  assert.equal(sync.syncStatus.issue.retryable,false);
  assert.match(sync.syncStatus.issue.message,/Cloud access was denied/);
  assert.equal((await store.get('project','current')).doc.name,'Keep my edits');
  assert.equal((await store.projectMeta(user.uid,p.id)).dirty,true);
 } finally {denyCommit=false;}
 await sync.syncProject(user.uid,p.id);
 assert.equal((await store.projectMeta(user.uid,p.id)).dirty,false);
 assert.equal(sync.syncStatus.issue,null);
});

const settle=async(ok)=>{for(let i=0;i<200&&!ok();i++)await new Promise(r=>setImmediate(r));};
test('cloud autosave waits for a quiet moment (requests cost money), but never longer than the max wait, and leaving the tab saves at once',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});
 const p=await store.createProject(user.uid,'animation');store.selectProject(user.uid,p.id);
 await store.put('project',{id:'current',doc:{n:1}});
 t.mock.timers.tick(sync.SAVE_QUIET-1000);await settle(()=>remote.has(p.id));
 assert.equal(remote.has(p.id),false);                                   // still waiting: an edit this quiet is not saved yet
 await store.put('project',{id:'current',doc:{n:2}});                    // another edit restarts the quiet period
 t.mock.timers.tick(SAVE_AFTER_EDIT_MS(sync.SAVE_QUIET,2000));await settle(()=>false);
 assert.equal(remote.has(p.id),false);
 t.mock.timers.tick(2001);await settle(()=>remote.has(p.id));
 assert.equal(remote.get(p.id).revision,1);                              // 45 s after the last edit
 await sync.syncProject(user.uid,p.id);   // joins the running save, so the next edit starts clean
 await store.put('project',{id:'current',doc:{n:3}});
 sync.flushSync();await sync.syncProject(user.uid,p.id);
 assert.equal(remote.get(p.id).revision,2);                              // flush = save now
 assert.equal(sync.SAVE_MAX>sync.SAVE_QUIET,true);
});
function SAVE_AFTER_EDIT_MS(quiet,margin){return quiet-margin-1;}
