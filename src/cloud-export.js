// Cloud export (the owner's own browser tab): submit a job, watch its progress, cancel it, get the finished video's link.
// The actual rendering happens on a separate machine — see docs/CLOUD-EXPORT.md. This file only talks to /api/export
// with the owner's normal, signed-in session; it never sees the job's secret (that is only for the anonymous render worker).
// Cloud export shares /api/export (not its own endpoint) because Vercel's Hobby plan caps serverless functions at 12.
import { apiCall } from './session.js';

export async function createCloudExport(uid, { projectId, seconds, scenes, scope, settings }) {
  const r = await apiCall('/api/export', { action: 'cloudCreate', projectId, seconds, scenes, scope, settings }, uid);
  return r.jobId;
}
export async function cancelCloudExport(uid, jobId) {
  const r = await apiCall('/api/export', { action: 'cloudCancel', jobId }, uid);
  return r.job;
}
/** once a job is done, a short-lived download link for its video (reuses the same signed-URL endpoint every other file in the app uses) */
export async function cloudExportDownloadUrl(uid, hash) {
  const r = await apiCall('/api/r2', { action: 'urls', hashes: [hash] }, uid);
  return r.urls[hash];
}
export async function cloudExportStatus(uid, jobId) {
  const r = await apiCall('/api/export', { action: 'cloudStatus', jobId }, uid);
  return r.job;
}
/** polls the job until it reaches a terminal state (done / error / cancelled) or `stop()` returns true; `onUpdate` is called on every poll */
export async function watchCloudExport(uid, jobId, { onUpdate, stop = () => false, intervalMs = 2500 } = {}) {
  for (;;) {
    if (stop()) return null;
    let job;
    try { job = await cloudExportStatus(uid, jobId); } catch (e) { onUpdate?.(null, e); await new Promise((r) => setTimeout(r, intervalMs)); continue; }
    onUpdate?.(job, null);
    if (['done', 'error', 'cancelled'].includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
