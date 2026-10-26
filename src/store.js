// IndexedDB transactions capture their owner and project before any asynchronous work.
export const STORES = ['characters','animations','backgrounds','props','swaps','project','audio','draft'];
let active, conn;
const listeners = new Set();
export const context = () => active && {...active};
export const selectProject = (uid,id) => { if(!uid || !id) throw Error('Account aur project dono zaroori hain'); active={uid,id}; };
export const clearProject = () => {active=null;};
export const onStoreChange = fn => {listeners.add(fn); return ()=>listeners.delete(fn);};
const scope = () => {if(!active) throw Error('Pehle koi project kholein'); return {...active};};
function open() {
 return conn ||= new Promise((resolve,reject)=>{
  const r=indexedDB.open('12toons-projects-v1',2);
  r.onupgradeneeded=()=>{
   if(!r.result.objectStoreNames.contains('records'))r.result.createObjectStore('records',{keyPath:['uid','project','store','id']});
   if(!r.result.objectStoreNames.contains('projects'))r.result.createObjectStore('projects',{keyPath:['uid','id']});
   if(!r.result.objectStoreNames.contains('meta'))r.result.createObjectStore('meta',{keyPath:'id'});
   if(!r.result.objectStoreNames.contains('library'))r.result.createObjectStore('library',{keyPath:['uid','id']});
  };
  r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();conn=null;};resolve(r.result);};
  r.onerror=()=>{conn=null;reject(r.error);};
 });
}
async function tx(names,mode,fn) {
 const db=await open();
 return new Promise((resolve,reject)=>{
  const t=db.transaction(names,mode); let out;
  try {out=fn(t);}catch(e){t.abort();reject(e);return;}
  t.oncomplete=()=>resolve(typeof out==='function'?out():out?.result);
  t.onerror=t.onabort=()=>reject(t.error||Error('Local save beech me ruk gaya'));
 });
}
export const projectMeta=(uid,id)=>tx(['projects'],'readonly',t=>t.objectStore('projects').get([uid,id]));
export const listProjects=uid=>tx(['projects'],'readonly',t=>{
 const r=t.objectStore('projects').getAll();return ()=>r.result.filter(p=>p.uid===uid);
});
// a short number (not a UUID) so a user can read it out loud and support can look it up in the admin panel
const shortId=()=>String(Math.floor(100000000+Math.random()*900000000));
export async function createProject(uid,kind,name='Untitled project') {
 if(!uid||!['animation','character'].includes(kind))throw Error('Project sahi nahi hai');
 for(let attempt=0;;attempt++) {
  const p={uid,id:shortId(),kind,name:name.trim().slice(0,120)||'Untitled project',revision:0,generation:1,dirty:true,updatedAt:Date.now()};
  try{await tx(['projects'],'readwrite',t=>t.objectStore('projects').add(p));return p;}
  catch(e){if(attempt>=4)throw e;}   // id already used on this device (astronomically rare) — try another
 }
}
export async function updateProject(uid,id,patch) {
 await tx(['projects'],'readwrite',t=>{
  const s=t.objectStore('projects'),r=s.get([uid,id]);
  r.onsuccess=()=>{if(!r.result){t.abort();return;}s.put({...r.result,...patch,uid,id,generation:r.result.generation+1,dirty:true,updatedAt:Date.now()});};
 }); listeners.forEach(fn=>fn({uid,id}));
}
export const renameProject=(uid,id,name)=>{if(!name.trim())throw Error('Naam likhna zaroori hai');return updateProject(uid,id,{name:name.trim().slice(0,120)});};
export const deleteProject=(uid,id)=>updateProject(uid,id,{deleted:true});
export async function all(store) {
 const c=scope();return tx(['records'],'readonly',t=>{
  const r=t.objectStore('records').getAll();return ()=>r.result.filter(v=>v.uid===c.uid&&v.project===c.id&&v.store===store).map(v=>v.value);
 });
}
export async function get(store,id) {
 const c=scope(),r=await tx(['records'],'readonly',t=>t.objectStore('records').get([c.uid,c.id,store,id]));return r?.value;
}
async function mutate(store,id,value,remove=false) {
 if(!STORES.includes(store))throw Error('Store sahi nahi hai');
 const c=scope();
 await tx(['records','projects'],'readwrite',t=>{
  const ps=t.objectStore('projects'),r=ps.get([c.uid,c.id]);
  r.onsuccess=()=>{
   if(!r.result||r.result.deleted){t.abort();return;}
   const rs=t.objectStore('records');
   if(remove)rs.delete([c.uid,c.id,store,id]);else rs.put({uid:c.uid,project:c.id,store,id,value});
   ps.put({...r.result,generation:r.result.generation+1,dirty:true,updatedAt:Date.now()});
  };
 });listeners.forEach(fn=>fn(c));
}
export const put=(store,value)=>mutate(store,value.id,value);
export const del=(store,id)=>mutate(store,id,null,true);
export async function loadCharacters() {
 const c=scope();
 return tx(['records','library','projects'],'readwrite',t=>{
  const rs=t.objectStore('records'),items=rs.getAll(),library=t.objectStore('library').getAll(),ps=t.objectStore('projects'),pr=ps.get([c.uid,c.id]);let result;
  pr.onsuccess=()=>{
   const mine=items.result.filter(v=>v.uid===c.uid&&v.project===c.id&&v.store==='characters').map(v=>v.value);
   const ids=new Set(mine.map(v=>v.id)),fresh=library.result.filter(v=>v.uid===c.uid&&!ids.has(v.id)).map(v=>v.value);
   for(const value of fresh)rs.put({uid:c.uid,project:c.id,store:'characters',id:value.id,value});
   if(fresh.length&&pr.result)ps.put({...pr.result,generation:pr.result.generation+1,dirty:true});
   result=[...mine,...fresh];
  };return ()=>result;
 });
}
export async function saveCharacter(value) {
 const c=scope();await put('characters',value);
 await tx(['library'],'readwrite',t=>t.objectStore('library').put({uid:c.uid,id:value.id,value,at:Date.now()}));
}
export async function deleteCharacter(id) {
 const c=scope();await del('characters',id);
 await tx(['library'],'readwrite',t=>t.objectStore('library').delete([c.uid,id]));
}
export const snapshot=(uid,id)=>tx(['records','projects'],'readonly',t=>{
 const r=t.objectStore('records').getAll(),p=t.objectStore('projects').get([uid,id]);
 return ()=>({meta:p.result,records:r.result.filter(v=>v.uid===uid&&v.project===id).map(({store,value})=>({store,value}))});
});
export async function acknowledge(uid,id,generation,revision) {
 await tx(['projects'],'readwrite',t=>{
  const s=t.objectStore('projects'),r=s.get([uid,id]);
  r.onsuccess=()=>{if(r.result)s.put({...r.result,revision,pending:null,dirty:r.result.generation!==generation});};
 });
}
export async function setPending(uid,id,pending) {
 await tx(['projects'],'readwrite',t=>{
  const s=t.objectStore('projects'),r=s.get([uid,id]);
  r.onsuccess=()=>{if(r.result)s.put({...r.result,pending});};
 });
}
export async function copyProject(uid,id) {
 const source=await snapshot(uid,id), p=await createProject(uid,source.meta.kind,source.meta.name+' (local copy)');
 await tx(['records'],'readwrite',t=>{
  for(const {store,value} of source.records)t.objectStore('records').put({uid,project:p.id,store,id:value.id,value});
 });
 return p;
}
/** the server refused this project's short ID — another account already holds it (the ID space is small enough that this can genuinely happen).
 *  This project was never synced under the old ID (that is why the refusal happened before anything else), so the old local copy is purged outright
 *  rather than left behind as a tombstone; nothing is lost, only the ID changes. */
export async function reassignProjectId(uid,id) {
 const source=await snapshot(uid,id);
 if(!source.meta)throw Error('Project sahi nahi hai');
 const p=await createProject(uid,source.meta.kind,source.meta.name);
 await tx(['records','projects'],'readwrite',t=>{
  for(const {store,value} of source.records)t.objectStore('records').put({uid,project:p.id,store,id:value.id,value});
  t.objectStore('projects').delete([uid,id]);
  const rs=t.objectStore('records'),scan=rs.openCursor();
  scan.onsuccess=()=>{const c=scan.result;if(c){if(c.value.uid===uid&&c.value.project===id)c.delete();c.continue();}};
 });
 if(active&&active.uid===uid&&active.id===id)active={uid,id:p.id};
 return p;
}
export async function restoreSnapshot(uid,meta,records) {
 if(!meta?.id||!Array.isArray(records)||records.some(r=>!STORES.includes(r.store)||!r.value?.id))throw Error('Snapshot sahi nahi hai');
 await tx(['records','projects','library'],'readwrite',t=>{
  const ps=t.objectStore('projects'),old=ps.get([uid,meta.id]);
  old.onsuccess=()=>{
   if(old.result?.dirty){t.abort();return;}
   const rs=t.objectStore('records'),scan=rs.openCursor();
   scan.onsuccess=()=>{const c=scan.result;if(c){if(c.value.uid===uid&&c.value.project===meta.id)c.delete();c.continue();}else{
    for(const {store,value} of records){
     rs.put({uid,project:meta.id,store,id:value.id,value});
     if(store==='characters'){
      const library=t.objectStore('library'),previous=library.get([uid,value.id]);
      previous.onsuccess=()=>{if(!previous.result||Number(previous.result.at||0)<=Number(meta.updatedAt||0))library.put({uid,id:value.id,value,at:meta.updatedAt||0});};
     }
    }
    ps.put({...meta,uid,generation:0,dirty:false});
   }};
  };
 });
}
export async function resetAll() {
 const c=scope();
 await tx(['records','projects'],'readwrite',t=>{
  const rs=t.objectStore('records'),scan=rs.openCursor();
  scan.onsuccess=()=>{const v=scan.result;if(v){if(v.value.uid===c.uid&&v.value.project===c.id)v.delete();v.continue();}};
  const ps=t.objectStore('projects'),r=ps.get([c.uid,c.id]);
  r.onsuccess=()=>{if(r.result)ps.put({...r.result,generation:r.result.generation+1,dirty:true});};
 });listeners.forEach(fn=>fn(c));
}
// Original database remains untouched. Legacy saves have no trustworthy owner.
export async function legacySnapshot() {
 if(indexedDB.databases&&!(await indexedDB.databases()).some(d=>d.name==='toon-studio'))return [];
 return new Promise((resolve,reject)=>{
  const r=indexedDB.open('toon-studio');
  r.onsuccess=()=>{
   const db=r.result,names=[...db.objectStoreNames].filter(n=>STORES.includes(n));
   if(!names.length){db.close();resolve([]);return;}
   const t=db.transaction(names,'readonly'),records=[];
   for(const store of names){const q=t.objectStore(store).getAll();q.onsuccess=()=>q.result.forEach(value=>records.push({store,value}));}
   t.oncomplete=()=>{db.close();resolve(records);};t.onerror=()=>{db.close();reject(t.error);};
  };r.onerror=()=>reject(r.error);
 });
}
export async function migrateLegacy(uid) {
 const records=await legacySnapshot();if(!records.length)return null;
 const meta={uid,id:crypto.randomUUID(),kind:'animation',name:'Recovered legacy project',revision:0,generation:1,dirty:true,updatedAt:Date.now()};
 await tx(['records','projects','meta'],'readwrite',t=>{
  const ms=t.objectStore('meta'),r=ms.get('legacy-owner');
  r.onsuccess=()=>{
   if(r.result){t.abort();return;}
   for(const {store,value} of records)t.objectStore('records').put({uid,project:meta.id,store,id:value.id,value});
   t.objectStore('projects').add(meta);ms.add({id:'legacy-owner',uid,project:meta.id});
  };
 });return meta;
}
export async function importLegacyCloud(uid, records) {
 if(!Array.isArray(records)||records.some(r=>!STORES.includes(r.store)||!r.value?.id))throw Error('Purana cloud backup sahi nahi hai');
 const meta={uid,id:crypto.randomUUID(),kind:'animation',name:'Recovered legacy cloud project',revision:0,generation:1,dirty:true,updatedAt:Date.now()};
 await tx(['records','projects','meta'],'readwrite',t=>{
  const ms=t.objectStore('meta'),r=ms.get('legacy-cloud-'+uid);
  r.onsuccess=()=>{
   if(r.result){t.abort();return;}
   for(const {store,value} of records)t.objectStore('records').put({uid,project:meta.id,store,id:value.id,value});
   t.objectStore('projects').add(meta);ms.add({id:'legacy-cloud-'+uid,project:meta.id});
  };
 });return meta;
}

