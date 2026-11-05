// Cloud export jobs: render a video on a server instead of the user's own device.
// Stored in the Realtime Database (same place project data lives): cloudExports/<uid>/<jobId>.
// The owner's own browser tab is authenticated normally (Firebase ID token) and may only create, cancel and read its own jobs.
// The render worker (a separate machine — see docs/CLOUD-EXPORT.md) is never signed in as the user at all: it proves it owns a job
// with the random `secret` minted at creation, which is never sent back to the owner's normal (authenticated) calls.
import crypto from 'node:crypto';
import { AccessError } from './security-policy.js';

export const TERMINAL = new Set(['done', 'error', 'cancelled']);
const TTL_MS = 3 * 60 * 60 * 1000; // a job no one picks up or finishes within 3 hours is stale

export const jobPath = (uid, id) => `cloudExports/${uid}/${id}`;
const isId = (v) => typeof v === 'string' && /^[a-zA-Z0-9_-]{6,64}$/.test(v);

/** a new job id + a random, unguessable secret (the only thing that lets the anonymous render page act on this job) */
export async function createJob(store, uid, { projectId, projectName = '', sceneId = null, settings, seconds, scenes, scope }) {
  const id = 'cexp_' + crypto.randomBytes(12).toString('hex'), secret = crypto.randomBytes(24).toString('hex');
  const job = {
    uid, projectId, projectName, sceneId, settings, seconds, scenes, scope,
    secret, status: 'pending', progress: 0, size: null, error: null,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  await store.set(jobPath(uid, id), job);
  return { id, job };
}
export async function getJob(store, uid, id) {
  if (!isId(id)) throw new AccessError('invalid_job', 'The export job is not valid.', 400);
  const job = await store.get(jobPath(uid, id));
  if (!job) throw new AccessError('job_not_found', 'This export job was not found. It may have already finished or expired.', 404);
  return job;
}
/** the owner's own view of a job: never includes the secret */
export const publicJob = (id, job) => { const { secret, uid, ...rest } = job; return { id, ...rest }; };

/** find a job across every account by its (uid, id) pair proven by the secret — used by every call the anonymous render page makes */
export async function jobBySecret(store, uid, id, secret) {
  const job = await getJob(store, uid, id);
  if (typeof secret !== 'string' || !secret || job.secret !== secret) throw new AccessError('invalid_secret', 'This render link is not valid.', 403);
  if (Date.now() - job.createdAt > TTL_MS) throw new AccessError('job_expired', 'This export job has expired.', 410);
  return job;
}
export async function updateJob(store, uid, id, patch) {
  await store.update(jobPath(uid, id), { ...patch, updatedAt: Date.now() });
}
/** the owner may cancel their own job only while it has not already finished */
export async function cancelJob(store, uid, id) {
  const job = await getJob(store, uid, id);
  if (TERMINAL.has(job.status)) return job;
  await updateJob(store, uid, id, { status: 'cancelled' });
  return { ...job, status: 'cancelled' };
}

/** finished videos stay for 3 days (listed in cloudVideos/<uid>/<jobId>), then are deleted from R2 and from this list */
export const videosPath = (uid) => `cloudVideos/${uid}`;
export async function listVideos(store, uid, deleteFile) {
  const rows = (await store.get(videosPath(uid))) || {}, now = Date.now(), live = [];
  for (const [id, v] of Object.entries(rows)) {
    if (v.expiresAt <= now) { await deleteFile(id); await store.remove(`${videosPath(uid)}/${id}`); } else live.push({ id, ...v });
  }
  return live.sort((a, b) => b.createdAt - a.createdAt);
}
