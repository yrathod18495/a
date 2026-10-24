import { auth } from './firebase.js';
import { apiCall } from './session.js';
import { listProjects, snapshot, acknowledge, restoreSnapshot, onStoreChange, context, setPending, copyProject } from './store.js';
import { packRecords, unpackRecords } from './project-codec.js';
import { uploadBinary as upload, downloadBinary as download } from './binary-cloud.js';
const listeners = new Set(), jobs = new Map(), timers = new Map();
export const syncStatus = { text: 'Saved locally', error: '' };
export const onSyncStatus = fn => { listeners.add(fn); fn(syncStatus); return () => listeners.delete(fn); };
function status(text, error = '') { Object.assign(syncStatus, { text, error }); listeners.forEach(fn => fn(syncStatus)); }
export async function syncProject(uid, id) {
  if (uid === 'debug') return;
  const key = uid + '/' + id;
  if (jobs.has(key)) return jobs.get(key);
  const run = async () => {
    if (!navigator.onLine) { status('Offline'); return; }
    const { meta, records } = await snapshot(uid, id);
    if (!meta?.dirty) return;
    status('Saving');
    try {
      let pending=meta.pending;
      if(!pending) {
        const operationId = crypto.randomUUID(), stateKey = 'projects/' + id + '/snapshots/' + operationId;
        if (!meta.deleted) {
          const manifest = await packRecords(records, (k,b) => upload(uid,k,b,true));
          await upload(uid, stateKey, new Blob([JSON.stringify(manifest)], { type: 'application/json' }));
        }
        pending={generation:meta.generation,body:{ action: 'commit', id, kind: meta.kind, name: meta.name, deleted: !!meta.deleted, stateKey, operationId, expected: meta.revision }};
        await setPending(uid,id,pending);
      }
      const { revision } = await apiCall('/api/projects', pending.body, uid);
      await acknowledge(uid, id, pending.generation, revision);
      if ((await snapshot(uid,id)).meta.dirty) {status('Saving');schedule({uid,id});}
      else status('Saved to Cloud');
    } catch (e) {
      status(e.code === 'conflict' ? 'Conflict' : !navigator.onLine ? 'Offline' : 'Sync Failed', e.message);
      if (e.code !== 'conflict' && e.status !== 401 && e.status !== 403) schedule({ uid, id }, 15000);
      throw e;
    }
  };
  const job = (navigator.locks ? navigator.locks.request('12toons-sync-' + key, run) : run()).finally(() => jobs.delete(key));
  jobs.set(key, job);return job;
}
function schedule(c, delay = 1200) {
  const key=c.uid+'/'+c.id;clearTimeout(timers.get(key));
  timers.set(key,setTimeout(()=>{timers.delete(key);if(auth.currentUser?.uid===c.uid)syncProject(c.uid,c.id).catch(()=>{});},delay));
}
onStoreChange(c=>schedule(c));
window.addEventListener('online',()=>syncAll().catch(()=>{}));
window.addEventListener('offline',()=>status('Offline'));
export async function syncAll() {
  const uid=auth.currentUser?.uid;if(!uid)return;
  const errors=[];
  for(const p of await listProjects(uid))if(p.dirty)try{await syncProject(uid,p.id);}catch(e){errors.push(e);}
  if(errors.length)throw errors[0];
}
export async function refreshProjects(uid) {
  if(uid==='debug'||!navigator.onLine)return;
  const {projects}=await apiCall('/api/projects',{action:'list'},uid), local=new Map((await listProjects(uid)).map(p=>[p.id,p]));
  for(const p of projects) {
    const old=local.get(p.id);
    if(old?.dirty){if(old.revision!==p.revision)status('Conflict','Local changes and a newer cloud revision both exist.');continue;}
    if(old?.revision===p.revision)continue;
    const records=p.deleted?[]:await unpackRecords(JSON.parse(await (await download(uid,p.stateKey)).text()),k=>download(uid,k));
    await restoreSnapshot(uid,p,records);
  }
}
export const syncCurrent=()=>{const c=context();return c?syncProject(c.uid,c.id):Promise.resolve();};
export async function resolveConflict(uid,id) {
 if(!navigator.onLine)throw Error('Reconnect to resolve the conflict. Your local work is safe.');
 const local=await snapshot(uid,id),{projects}=await apiCall('/api/projects',{action:'list'},uid),remote=projects.find(p=>p.id===id);
 if(!remote||remote.revision===local.meta.revision)throw Error('No newer cloud version exists. Retry syncing this project.');
 const records=remote.deleted?[]:await unpackRecords(JSON.parse(await(await download(uid,remote.stateKey)).text()),k=>download(uid,k));
 const backup=await copyProject(uid,id);
 await acknowledge(uid,id,local.meta.generation,local.meta.revision);
 await restoreSnapshot(uid,remote,records);
 return backup;
}
