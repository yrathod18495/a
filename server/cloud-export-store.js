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
  // A read can briefly see a half-written job while another request on this same server instance is updating it (the database client applies a
  // write locally before the server confirms it): the job then looks missing or the secret looks wrong for a moment. Look again before refusing.
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const job = await getJob(store, uid, id);
      if (typeof secret !== 'string' || !secret || job.secret !== secret) throw new AccessError('invalid_secret', 'This render link is not valid.', 403);
      if (Date.now() - job.createdAt > TTL_MS) throw new AccessError('job_expired', 'This export job has expired.', 410);
      return job;
    } catch (e) {
      lastError = e;
      if (!['job_not_found', 'invalid_secret'].includes(e?.code) || attempt === 2) break;
      await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
    }
  }
  throw lastError;
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

/**
 * A progress update from the render page. Updates are sent without waiting for each other and can arrive out of order (separate server
 * instances), which made the bar and the phase text jump back and forth. Each update carries a number (`seq`) from the page: an older
 * one that arrives late is ignored, and the percentage never goes down.
 */
const PHASE_RANK = { loading: 1, preparing: 2, rendering: 3, uploading: 4 };
export async function applyProgress(store, uid, id, { progress, phase, seq } = {}) {
  await store.transact(jobPath(uid, id), (cur) => {
    // The first call of a Realtime Database transaction usually gets `null` (nothing cached yet). Returning `undefined` would ABORT it and the update
    // would be lost, so `null` is handed back: the database then compares with the real value and calls this again with it.
    if (cur === null) return null;
    if (TERMINAL.has(cur.status)) return undefined;
    if (Number.isInteger(seq) && seq <= (cur.seq || 0)) return undefined;
    const next = { ...cur, status: 'rendering', updatedAt: Date.now() };
    if (progress !== undefined) next.progress = Math.max(cur.progress || 0, progress);
    if (phase && (PHASE_RANK[phase] ?? 0) >= (PHASE_RANK[cur.phase] ?? 0)) next.phase = phase;          // never back: a helper machine joining later says "loading" again
    if (Number.isInteger(seq)) next.seq = seq;
    return next;
  });
}

/* ---------------------------------------------------------------------------------------------------------------------------
 * One video rendered by several machines. The video is cut into slices of about 4 s; every machine that opens the job's render page
 * claims slices one at a time from this shared list (cloudExports/<uid>/<id>/parts), renders them and hands them in. The first page
 * to create the list is the "leader": it renders slices too, waits for all of them, joins them with the sound and uploads the video.
 * A claimed slice has a lease: a machine that vanishes (Colab disconnected) loses it after PART_LEASE_MS and someone else takes it.
 * ------------------------------------------------------------------------------------------------------------------------- */
export const PART_LEASE_MS = 150_000;
export const partsPath = (uid, id) => `${jobPath(uid, id)}/parts`;
export const partKey = (uid, id, n) => `u/${uid}/j/${id}/part-${Number(n)}.bin`;
const byId = (items) => Object.entries(items || {}).map(([k, v]) => [Number(k), v]).sort((a, b) => a[0] - b[0]);

/** creates the slice list unless it exists: `leader` is true for exactly one caller */
export async function initParts(store, uid, id, { frames, fps, slices }) {
  let created = false;
  const out = await store.transact(partsPath(uid, id), (cur) => {
    created = false;
    if (cur) return undefined;
    created = true;
    return { frames, fps, count: slices.length, items: Object.fromEntries(slices.map((s) => [s.id, { from: s.from, to: s.to, st: 'open' }])) };
  });
  return { leader: !!(out.committed && created) };
}

/** hands out the next free slice (or one whose lease ran out), or null */
export async function claimPart(store, uid, id, who, now = Date.now()) {
  let got = null;
  await store.transact(partsPath(uid, id), (cur) => {
    got = null;
    if (!cur) return cur;
    for (const [n, it] of byId(cur.items)) {
      if (it.st === 'open' || (it.st === 'taken' && now - (it.lease || 0) > PART_LEASE_MS)) {
        cur.items[n] = { ...it, st: 'taken', by: who, lease: now, frames: 0 };
        got = { id: n, from: it.from, to: it.to };
        break;
      }
    }
    return got ? cur : undefined;
  });
  return got;
}

/** a machine says it is still working on these slices (renews the lease) and how many frames it has done in each */
export async function beatParts(store, uid, id, who, entries, now = Date.now()) {
  await store.transact(partsPath(uid, id), (cur) => {
    if (!cur) return cur;
    let changed = false;
    for (const e of entries || []) {
      const it = cur.items?.[e.id];
      if (it && it.st === 'taken' && it.by === who) { cur.items[e.id] = { ...it, lease: now, frames: Math.max(it.frames || 0, Math.min(Number(e.frames) || 0, it.to - it.from)) }; changed = true; }
    }
    return changed ? cur : undefined;
  });
}

/** a slice is finished. The first one to hand it in wins; `local` means the leader holds the result itself (nothing was uploaded) */
export async function finishPart(store, uid, id, who, { part, size = 0, local = false }) {
  let accepted = false;
  await store.transact(partsPath(uid, id), (cur) => {
    accepted = false;
    if (!cur) return cur;
    const it = cur.items?.[part];
    if (!it || it.st === 'done') return undefined;
    cur.items[part] = { from: it.from, to: it.to, st: 'done', by: who, size: Number(size) || 0, local: !!local };
    accepted = true;
    return cur;
  });
  return { accepted };
}

export const partsSummary = (parts) => {
  const items = byId(parts?.items), total = items.length, done = items.filter(([, i]) => i.st === 'done');
  const frames = parts?.frames || 0, doneFrames = done.reduce((n, [, i]) => n + (i.to - i.from), 0);
  const running = items.filter(([, i]) => i.st === 'taken').reduce((n, [, i]) => n + (i.frames || 0), 0);
  return { total, done: done.length, allDone: total > 0 && done.length === total, progress: frames ? Math.min(1, (doneFrames + running) / frames) : 0,
    items: Object.fromEntries(items.map(([n, i]) => [n, { st: i.st, local: !!i.local, size: i.size || 0, from: i.from, to: i.to }])) };
};

/** does this job still have a slice a helper machine could take? (used by the worker deciding whether to join a running job) */
export const hasFreeParts = (parts, now = Date.now()) => byId(parts?.items).some(([, i]) => i.st === 'open' || (i.st === 'taken' && now - (i.lease || 0) > PART_LEASE_MS));
