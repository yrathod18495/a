import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as s from '../src/store.js';
import { packRecords, unpackRecords } from '../src/project-codec.js';

test('multiple projects: create, edit, reopen, rename, delete without mixing data', async()=>{
 const a=await s.createProject('alice','animation','A'), b=await s.createProject('alice','animation','B');
 s.selectProject('alice',a.id);await s.put('project',{id:'current',camera:{zoom:2},timeline:[1,2]});
 s.selectProject('alice',b.id);assert.deepEqual(await s.all('project'),[]);
 await s.put('project',{id:'current',camera:{zoom:7}});
 s.selectProject('alice',a.id);assert.equal((await s.get('project','current')).camera.zoom,2);
 await s.renameProject('alice',a.id,'Renamed');assert.equal((await s.projectMeta('alice',a.id)).name,'Renamed');
 await s.deleteProject('alice',b.id);assert.equal((await s.projectMeta('alice',b.id)).deleted,true);
 assert.equal((await s.get('project','current')).camera.zoom,2);
});
test('pending writes capture account/project before account switching',async()=>{
 const a=await s.createProject('owner1','character'),b=await s.createProject('owner2','character');
 s.selectProject('owner1',a.id);const pending=s.put('draft',{id:'current',face:{eyes:2}});
 s.selectProject('owner2',b.id);await pending;assert.equal(await s.get('draft','current'),undefined);
 assert.equal((await s.snapshot('owner1',a.id)).records[0].value.face.eyes,2);
});
test('local reset affects only the current project',async()=>{
 const a=await s.createProject('reset','animation'),b=await s.createProject('reset','animation');
 s.selectProject('reset',a.id);await s.put('audio',{id:'voice',raw:new Uint8Array([1,2])});
 s.selectProject('reset',b.id);await s.put('audio',{id:'voice',raw:new Uint8Array([3,4])});await s.resetAll();
 assert.deepEqual(await s.all('audio'),[]);s.selectProject('reset',a.id);assert.equal((await s.all('audio')).length,1);
});
test('cloud acknowledgement never clears newer local edits',async()=>{
 const p=await s.createProject('ack','animation');s.selectProject('ack',p.id);
 const snap=await s.snapshot('ack',p.id);await s.put('project',{id:'current',value:2});
 await s.acknowledge('ack',p.id,snap.meta.generation,1);
 const meta=await s.projectMeta('ack',p.id);assert.equal(meta.dirty,true);assert.equal(meta.revision,1);
});
test('restore is atomic and refuses to overwrite unsynced work',async()=>{
 const p=await s.createProject('restore','animation');s.selectProject('restore',p.id);await s.put('project',{id:'current',value:'mine'});
 await assert.rejects(s.restoreSnapshot('restore',{id:p.id,revision:4},[{store:'project',value:{id:'current',value:'cloud'}}]));
 assert.equal((await s.get('project','current')).value,'mine');
 const meta=await s.projectMeta('restore',p.id);await s.acknowledge('restore',p.id,meta.generation,1);
 await s.restoreSnapshot('restore',{id:p.id,revision:4},[{store:'project',value:{id:'current',value:'cloud'}}]);
 assert.equal((await s.get('project','current')).value,'cloud');
});
test('audio, textures, typed array slices and draft edits round-trip with exact bytes',async()=>{
 const backing=new Uint16Array([99,10,20,88]), records=[{store:'draft',value:{id:'current',voice:new Uint8Array([0,128,255]).buffer,texture:new Blob(['pixels'],{type:'image/png'}),view:backing.subarray(1,3),edits:[['face',{hue:7}]]}}];
 const blobs=new Map(),manifest=await packRecords(records,async(k,b)=>blobs.set(k,b));
 const out=await unpackRecords(manifest,async k=>blobs.get(k));
 assert.deepEqual(new Uint8Array(out[0].value.voice),new Uint8Array([0,128,255]));
 assert.equal(await out[0].value.texture.text(),'pixels');assert.equal(out[0].value.texture.type,'image/png');
 assert.ok(out[0].value.view instanceof Uint16Array);assert.deepEqual([...out[0].value.view],[10,20]);assert.equal(out[0].value.edits[0][1].hue,7);
});
test('same-size changed binaries get distinct hashes; duplicate binaries upload once',async()=>{
 const keys=[],m=await packRecords([new Blob(['one']),new Blob(['two']),new Blob(['one'])],async k=>keys.push(k));
 assert.equal(keys.length,2);assert.notEqual(keys[0],keys[1]);assert.equal(m.assets.length,2);
});
test('failed upload cannot produce a publishable manifest',async()=>{
 await assert.rejects(packRecords([new Blob(['voice'])],async()=>{throw Error('upload failed');}),/upload failed/);
});
test('corrupt or missing binary rejects restore',async()=>{
 const m=await packRecords([new Blob(['voice'])],async()=>{});
 await assert.rejects(unpackRecords(m,async()=>new Blob(['other'])),/integrity/);
 await assert.rejects(unpackRecords(m,async()=>{throw Error('404');}),/404/);
});
test('legacy migration copies once, preserves original and refuses another owner',async()=>{
 await new Promise((resolve,reject)=>{
  const r=indexedDB.open('toon-studio',5);
  r.onupgradeneeded=()=>r.result.createObjectStore('project',{keyPath:'id'});
  r.onsuccess=()=>{const t=r.result.transaction('project','readwrite');t.objectStore('project').put({id:'current',value:'old work'});t.oncomplete=()=>{r.result.close();resolve();};};r.onerror=()=>reject(r.error);
 });
 const p=await s.migrateLegacy('legacy-owner');assert.equal((await s.snapshot('legacy-owner',p.id)).records[0].value.value,'old work');
 assert.equal((await s.legacySnapshot())[0].value.value,'old work');
 await assert.rejects(s.migrateLegacy('someone-else'));
});
test('published characters cross studios within one account; deleting does not resurrect them',async()=>{
 const a=await s.createProject('artist','character'),b=await s.createProject('artist','animation'),other=await s.createProject('stranger','animation');
 s.selectProject('artist',a.id);await s.saveCharacter({id:'character',ske:{name:'DragonBones'},tex:[]});
 s.selectProject('artist',b.id);assert.equal((await s.loadCharacters()).length,1);
 s.selectProject('stranger',other.id);assert.equal((await s.loadCharacters()).length,0);
 s.selectProject('artist',b.id);await s.deleteCharacter('character');assert.equal((await s.loadCharacters()).length,0);
 s.selectProject('artist',a.id);assert.equal((await s.all('characters')).length,1);
});
