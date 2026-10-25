// The real browser code (project sync + binary cloud) talking to the real API handlers, with R2 played by a local HTTP server.
import 'fake-indexeddb/auto';
import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {memoryFirestore,response} from './fake-firestore.js';
import {memoryRtdb} from './fake-rtdb.js';
import {startFakeS3} from './fake-s3-server.js';
import * as store from '../src/store.js';
process.env.MAINTENANCE_MODE='false';
const s3=await startFakeS3(),user={uid:'e2e-user-123456'},db=memoryFirestore(),rtdb=memoryRtdb(),mem=new Map();
Object.assign(process.env,{CLOUDFLARE_R2_ACCOUNT_ID:'acc',CLOUDFLARE_R2_ACCESS_KEY_ID:'k',CLOUDFLARE_R2_SECRET_ACCESS_KEY:'s',CLOUDFLARE_R2_BUCKET_NAME:'bucket',CLOUDFLARE_R2_ENDPOINT:s3.url});
db.data.set('securityUsers/'+user.uid,{status:'active'});db.data.set('securitySessions/'+user.uid,{sid:'ok',expiresAt:Date.now()+1e6,revoked:false});
globalThis.window=new EventTarget();globalThis.localStorage={getItem:k=>mem.get(k)??null,setItem:(k,v)=>mem.set(k,String(v)),removeItem:k=>mem.delete(k)};
Object.defineProperty(globalThis.navigator,'onLine',{value:true,configurable:true});
mock.module('../server/firebase-admin.js',{exports:{services:()=>({db,rtdb,auth:{verifyIdToken:async()=>({uid:user.uid,email_verified:true,sid:'ok'})}})}});
mock.module('../src/firebase.js',{exports:{auth:{currentUser:user}}});
const handlers={'/api/r2':(await import('../api/r2.js')).default,'/api/projects':(await import('../api/projects.js')).default};
mock.module('../src/session.js',{exports:{apiCall:async(url,body,uid)=>{
 assert.equal(uid,user.uid);const res=response();await handlers[url]({method:'POST',headers:{authorization:'Bearer x'},body},res);
 if(res.statusCode!==200){const e=Error(res.body.error);Object.assign(e,{status:res.statusCode,code:res.body.code});throw e;}
 return res.body;
}}});
const sync=await import('../src/project-sync.js');
const wipeLocal=()=>new Promise((resolve,reject)=>{const r=indexedDB.open('12toons-projects-v1',2);r.onsuccess=()=>{const names=[...r.result.objectStoreNames],tx=r.result.transaction(names,'readwrite');for(const n of names)tx.objectStore(n).clear();tx.oncomplete=()=>{r.result.close();resolve();};tx.onerror=()=>reject(tx.error);};r.onerror=()=>reject(r.error);});

test('save to the cloud and open it again on an empty browser: signed upload, one commit, sorted keys, exact bytes back',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const p=await store.createProject(user.uid,'animation');store.selectProject(user.uid,p.id);
 const voice=new Uint8Array(300000).map((_,i)=>i%251);
 await store.put('audio',{id:'voice',raw:voice.buffer});
 await store.put('project',{id:'current',lines:[{id:'voice',file:'hello.wav',speaker:'Narrator',order:0}]});
 await sync.syncProject(user.uid,p.id);
 assert.equal(sync.syncStatus.text,'Saved to Cloud');
 const keys=[...s3.objects.keys()];
 assert.equal(keys.length,2);                                                                        // the picture / audio and the snapshot
 assert.ok(keys.some(k=>new RegExp('^u/'+user.uid+'/a/[0-9a-f]{2}/[0-9a-f]{64}$').test(k)));
 assert.ok(keys.some(k=>new RegExp('^u/'+user.uid+'/p/'+p.id+'/state-[0-9a-f-]+\\.json$').test(k)));
 const node=(await rtdb.ref(`projects/${user.uid}/${p.id}`).get()).val();
 assert.deepEqual([node.revision,node.summary.audioCount,node.summary.audioFiles[0].filename],[1,1,'hello.wav']);
 assert.equal((await rtdb.ref(`usage/${user.uid}`).get()).val().bytes,300000);
 // a second save of an unchanged file uploads only the new snapshot and deletes the old one
 s3.log.length=0;await store.put('project',{id:'current',lines:[{id:'voice',file:'hello2.wav',speaker:'Narrator',order:0}]});
 await sync.syncProject(user.uid,p.id);
 assert.deepEqual(s3.log.filter(l=>l.startsWith('PUT')).length,1);assert.equal(s3.objects.size,2);
 assert.equal((await rtdb.ref(`usage/${user.uid}`).get()).val().bytes,300000);                       // the audio was counted once
 // another device: nothing local, everything comes back from R2
 await wipeLocal();
 await sync.refreshProjects(user.uid);
 store.selectProject(user.uid,p.id);
 assert.deepEqual([...new Uint8Array((await store.get('audio','voice')).raw)].slice(0,5),[...voice.slice(0,5)]);
 assert.equal((await store.get('project','current')).lines[0].file,'hello2.wav');
});
test.after(()=>s3.close());
