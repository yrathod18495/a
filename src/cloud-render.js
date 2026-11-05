// The anonymous render page (`#/cloudrender`). Opened only by the cloud export worker (see docs/CLOUD-EXPORT.md) — never by a person,
// and never signed in as the project's owner (that would sign them out of their own session everywhere else). It proves it owns one
// job with the job's random secret, downloads that project's last saved snapshot straight from R2, loads it into the studio exactly
// like a returning visitor's browser would, renders the video and uploads it — all with the exact same code real exports use.
import { unpackRecords } from './project-codec.js';
import { restoreSnapshot, selectProject } from './store.js';

/** a secret-authenticated call to /api/export (cloud export shares this endpoint — see docs/CLOUD-EXPORT.md) — no Firebase sign-in involved at all */
async function jobCall(uid, jobId, secret, action, extra = {}) {
  const r = await fetch('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, uid, jobId, secret, ...extra }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = Error(j.error || 'The cloud export request failed.'); e.code = j.code; throw e; }
  return j;
}
async function fetchBlobByUrl(url) {
  const r = await fetch(url);
  if (!r.ok) throw Error('A file for this export could not be downloaded.');
  return r.blob();
}
const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const hashBlob = async (blob) => hex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));

/** runs one cloud export job end to end; returns once the job has reached a terminal state (it always resolves — failures are reported to the job, not thrown) */
export async function runCloudRenderJob({ uid, jobId, secret }) {
  let job;
  try {
    job = await jobCall(uid, jobId, secret, 'cloudFetch');
  } catch (e) { console.error('Cloud export: could not start', e); return; }
  const phase = (name) => jobCall(uid, jobId, secret, 'cloudProgress', { phase: name }).catch(() => {});
  try {
    await phase('loading');
    const download = (key) => fetchBlobByUrl(job.assetUrls[key.slice('assets/'.length)]);
    const records = await unpackRecords(job.manifest, download);
    const meta = { ...job.meta, dirty: false, deleted: false };
    await restoreSnapshot(uid, meta, records);
    selectProject(uid, job.meta.id);
    const studio = await import('./main.js');
    studio.setHome?.(() => {});
    await studio.openStudio();
    await studio.runCloudExportJob({ uid, jobId, secret, settings: job.settings, jobCall });
  } catch (e) {
    console.error('Cloud export failed', e);
    try { await jobCall(uid, jobId, secret, 'cloudFail', { message: e.message }); } catch { /* best effort */ }
  }
}
