import { syncFailure } from './sync-feedback.js';
import { auth } from './firebase.js';
import { apiCall } from './session.js';
import { listProjects, snapshot, acknowledge, restoreSnapshot, onStoreChange, context, setPending, copyProject } from './store.js';
import { packRecords, unpackRecords } from './project-codec.js';
import { uploadAssets, downloadAssets, fetchBlob } from './binary-cloud.js';
import { summarizeProjectSnapshot } from '../shared/project-summary.js';
const listeners = new Set(), jobs = new Map(), timers = new Map();
export const syncStatus = { text: 'Saved locally', error: '', issue: null, projectId: null };
export const onSyncStatus = fn => { listeners.add(fn); fn(syncStatus); return () => listeners.delete(fn); };
function status(text, error = '', issue = null, projectId = null) { Object.assign(syncStatus, { text, error, issue, projectId }); listeners.forEach(fn => fn(syncStatus)); }
export async function syncProject(uid, id) {
  if (uid === 'debug') return;
  const key = uid + '/' + id;
  if (jobs.has(key)) return jobs.get(key);
  const run = async () => {
    if (!navigator.onLine) { status('Offline'); return; }
    const { meta, records } = await snapshot(uid, id);
    if (!meta?.dirty) return;
    status('Saving', '', null, id);
    try {
      let pending=meta.pending;
      if(!pending) {
        const operationId = crypto.randomUUID();
        let assets = [], summary = null;
        if (!meta.deleted) {
          const files = new Map();
          const manifest = await packRecords(records, async (k, blob) => { files.set(k.slice(7), blob); });
          // new pictures / audio and the snapshot go straight to R2 with signed links; files the cloud already has are skipped
          await uploadAssets(uid, files, { projectId: id, opId: operationId, blob: new Blob([JSON.stringify(manifest)], { type: 'application/json' }) });
          assets = manifest.assets.map(a => ({ hash: a.key.slice(7), size: a.size }));
          summary = summarizeProjectSnapshot(manifest);
        }
        pending={generation:meta.generation,body:{ action: 'commit', id, kind: meta.kind, name: meta.name, deleted: !!meta.deleted, operationId, expected: meta.revision, assets, summary }};
        await setPending(uid,id,pending);
      }
      const { revision } = await apiCall('/api/projects', pending.body, uid);
      await acknowledge(uid, id, pending.generation, revision);
      if ((await snapshot(uid,id)).meta.dirty) {status('Saving', '', null, id);schedule({uid,id},3000);}
      else status('Saved to Cloud', '', null, id);
    } catch (e) {
      const issue = syncFailure(e);
      status(e.code === 'conflict' ? 'Conflict' : !navigator.onLine ? 'Offline' : 'Sync Failed', e.message, issue, id);
      if (issue.retryable) schedule({ uid, id }, 30000);
      throw e;
    }
  };
  const job = (navigator.locks ? navigator.locks.request('12toons-sync-' + key, run) : run()).finally(() => jobs.delete(key));
  jobs.set(key, job);return job;
}
// Saving to the cloud costs requests (R2 writes are billed per request), so edits are gathered: the save runs SAVE_QUIET after the last edit,
// and at the latest SAVE_MAX after the first unsaved edit. Leaving or hiding the tab saves at once. Local saving is instant and not affected.
export const SAVE_QUIET = 45000, SAVE_MAX = 180000;
const firstEdit = new Map();
function schedule(c, delay = SAVE_QUIET) {
  const key=c.uid+'/'+c.id, now=Date.now(); if(!firstEdit.has(key))firstEdit.set(key,now);
  const wait=Math.max(0,Math.min(delay,firstEdit.get(key)+SAVE_MAX-now));
  clearTimeout(timers.get(key));
  timers.set(key,setTimeout(()=>{timers.delete(key);firstEdit.delete(key);if(auth.currentUser?.uid===c.uid)syncProject(c.uid,c.id).catch(()=>{});},wait));
}
/** save every project that has unsaved changes right now (tab hidden / closing, or the user pressed Save) */
export function flushSync() {
  for(const [key,timer] of [...timers]){clearTimeout(timer);timers.delete(key);firstEdit.delete(key);const [uid,id]=[key.slice(0,key.indexOf('/')),key.slice(key.indexOf('/')+1)];if(auth.currentUser?.uid===uid)syncProject(uid,id).catch(()=>{});}
}
globalThis.document?.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushSync();});
window.addEventListener('pagehide',flushSync);
onStoreChange(c=>schedule(c));
window.addEventListener('online',()=>syncAll().catch(()=>{}));
window.addEventListener('offline',()=>status('Offline'));
export async function syncAll() {
  const uid=auth.currentUser?.uid;if(!uid)return;
  const errors=[];
  for(const p of await listProjects(uid))if(p.dirty)try{await syncProject(uid,p.id);}catch(e){errors.push(e);}
  if(errors.length)throw errors[0];
}
/** download a cloud snapshot: the manifest from its signed link, then every file it names (files this browser already has come from its cache) */
async function openSnapshot(uid,p) {
  if(!p.stateUrl)throw Error('Cloud snapshot nahi mila. Thodi der baad dobara try karein.');
  const manifest=JSON.parse(await(await fetchBlob(p.stateUrl)).text()),sizes=new Map(manifest.assets.map(a=>[a.key.slice(7),a.size]));
  const files=await downloadAssets(uid,[...sizes.keys()],sizes);
  return unpackRecords(manifest,async k=>files.get(k.slice(7)));
}
export async function refreshProjects(uid) {
  if(uid==='debug'||!navigator.onLine)return;
  const {projects}=await apiCall('/api/projects',{action:'list'},uid), local=new Map((await listProjects(uid)).map(p=>[p.id,p]));
  for(const p of projects) {
    const old=local.get(p.id);
    if(old?.dirty){if(old.revision!==p.revision)status('Conflict','Local changes and a newer cloud revision both exist.');continue;}
    if(old?.revision===p.revision)continue;
    const records=p.deleted?[]:await openSnapshot(uid,p);
    await restoreSnapshot(uid,p,records);
  }
}
export const syncCurrent=()=>{const c=context();return c?syncProject(c.uid,c.id):Promise.resolve();};
export async function resolveConflict(uid,id) {
 if(!navigator.onLine)throw Error('Conflict hatane ke liye internet se dobara judein. Aapka local kaam safe hai.');
 const local=await snapshot(uid,id),{projects}=await apiCall('/api/projects',{action:'list'},uid),remote=projects.find(p=>p.id===id);
 if(!remote||remote.revision===local.meta.revision)throw Error('Cloud par isse naya version nahi hai. Is project ko dobara sync karke dekhein.');
 const records=remote.deleted?[]:await openSnapshot(uid,remote);
 const backup=await copyProject(uid,id);
 await acknowledge(uid,id,local.meta.generation,local.meta.revision);
 await restoreSnapshot(uid,remote,records);
 return backup;
}
