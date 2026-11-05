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
/** a short-lived download link for a finished video (cloud videos are kept for 3 days) */
export async function cloudExportDownloadUrl(uid, jobId) {
  const r = await apiCall('/api/export', { action: 'cloudDownload', jobId }, uid);
  return r.url;
}
export async function listCloudVideos(uid) { return (await apiCall('/api/export', { action: 'cloudList' }, uid)).videos; }
export async function deleteCloudVideo(uid, jobId) { await apiCall('/api/export', { action: 'cloudDelete', jobId }, uid); }
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

/**
 * Saves a finished video as a proper "<name>.mp4" file. A normal link to another web address ignores the page's chosen file name
 * (the browser then used the storage file name, which has no ending), so smaller videos are fetched and saved from here with the
 * right name and type; a big one (a phone cannot hold it in memory) opens the signed link, which also names the file.
 */
export async function saveCloudVideo(uid, jobId, name, size = 0) {
  const url = await cloudExportDownloadUrl(uid, jobId);
  let href = url, revoke = null;
  if (size && size < 150 * 1048576) {
    try { const r = await fetch(url); if (r.ok) { href = URL.createObjectURL(new Blob([await r.blob()], { type: 'video/mp4' })); revoke = href; } } catch { /* the link itself still works */ }
  }
  const a = document.createElement('a'); a.href = href; a.download = name; document.body.append(a); a.click(); a.remove();
  if (revoke) setTimeout(() => URL.revokeObjectURL(revoke), 60000);
}
