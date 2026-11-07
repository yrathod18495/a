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
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';          // nobody is looking: ask less often
    await new Promise((r) => setTimeout(r, hidden ? Math.max(intervalMs, 10000) : job.status === 'pending' ? Math.max(intervalMs, 4000) : intervalMs));
  }
}

/** reads a response into a Blob while reporting how much has arrived: onProgress(loadedBytes, totalBytes) (total is 0 when unknown) */
async function readWithProgress(response, size, onProgress, signal) {
  const total = Number(response.headers.get('content-length')) || size || 0;
  if (!response.body?.getReader) { onProgress?.(0, total); const blob = await response.blob(); onProgress?.(blob.size, blob.size); return blob; }
  const reader = response.body.getReader(), chunks = []; let got = 0, last = 0;
  onProgress?.(0, total);
  for (;;) {
    if (signal?.aborted) { try { await reader.cancel(); } catch { /* already closed */ } throw new DOMException('The download was cancelled.', 'AbortError'); }
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    const now = performance.now();
    if (now - last > 200) { last = now; onProgress?.(got, total); }
  }
  onProgress?.(got, total || got);
  return new Blob(chunks, { type: 'video/mp4' });
}
/**
 * Saves a finished video as a proper "<name>.mp4" file, showing real progress. A normal link to another web address ignores the page's
 * chosen file name, so smaller videos are fetched here (with a progress callback) and saved with the right name and type; a big one
 * (a phone cannot hold it in memory) opens the signed link, which also names the file, and the browser shows its own progress:
 * onProgress(null, 0, 'browser') says so. onProgress(loaded, total) is called while a video is being fetched here.
 */
export async function saveCloudVideo(uid, jobId, name, size = 0, onProgress = null, signal = null) {
  const url = await cloudExportDownloadUrl(uid, jobId);
  let href = url, revoke = null;
  if (size && size < 150 * 1048576) {
    try {
      const r = await fetch(url, { signal });
      if (!r.ok) throw new Error(`The download failed (${r.status}).`);
      href = URL.createObjectURL(await readWithProgress(r, size, onProgress, signal)); revoke = href;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      console.warn('Cloud video: could not fetch it here, opening the link instead', e);
      onProgress?.(null, 0, 'browser');                    // the link itself still works; the browser shows its own progress
    }
  } else onProgress?.(null, 0, 'browser');
  const a = document.createElement('a'); a.href = href; a.download = name; document.body.append(a); a.click(); a.remove();
  if (revoke) setTimeout(() => URL.revokeObjectURL(revoke), 60000);
}
