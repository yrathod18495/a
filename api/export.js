// Export (local + cloud). Both share this one file because Vercel's Hobby plan caps the project at 12 serverless functions —
// splitting cloud export into its own api/cloud-export.js pushed the count to 13 and every deploy since then was rejected.
// See docs/CLOUD-EXPORT.md for the cloud export design; the actions below are named cloudCreate / cloudCancel / cloudStatus /
// cloudFetch / cloudPresign / cloudProgress / cloudComplete / cloudFail to avoid clashing with this file's own `status`.
import { services } from '../server/firebase-admin.js';
import { maintenanceOn } from '../server/maintenance.js';
import { access, bodyOf, send, failure, maintenanceBlocks } from '../server/access.js';
import { AccessError } from '../server/security-policy.js';
import { effectiveTier, setTier } from '../server/entitlements.js';
import { EXPORT_LIMIT_SECONDS, limitFor, withinLimit, limitMessage } from '../shared/export-limits.js';
import { kv } from '../server/rtdb.js';
import { assetKey, stateKey, getUrl, readText, objectExists, confirmAssets, signUploads, putUrl, videoKey, videoUrl, deleteKey, MAX_FILE, MAX_VIDEO, MAX_VIDEOS_TOTAL, VIDEO_TTL_MS } from '../server/r2-storage.js';
import { createJob, getJob, jobBySecret, updateJob, cancelJob, publicJob, listVideos, videosPath, TERMINAL } from '../server/cloud-export-store.js';

const MAX_SECONDS = 24 * 3600;
const validGrant = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{4,40}$/.test(value);
const validUid = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,128}$/.test(value);
const idOK = (v) => typeof v === 'string' && /^[a-zA-Z0-9_-]{6,128}$/.test(v);
const QUALITIES = new Set([480, 720, 1080, 1440, 2160]), FPS = new Set([24, 30, 40, 60, 90]), LEVELS = new Set(['std', 'high', 'max']), FORMATS = new Set(['webm', 'mp4']);
function cleanSettings(s) {
  if (!s || typeof s !== 'object') throw new AccessError('invalid_settings', 'The export settings are not valid.', 400);
  const quality = QUALITIES.has(+s.quality) ? +s.quality : 1080, fps = FPS.has(+s.fps) ? +s.fps : 30;
  const level = LEVELS.has(s.level) ? s.level : 'high', format = FORMATS.has(s.format) ? s.format : 'mp4';
  return { quality, fps, level, format };
}
// the anonymous cloud-export render worker never carries a Firebase sign-in — it proves ownership of one job with its secret instead
const SECRET_ACTIONS = new Set(['cloudStudio', 'cloudFetch', 'cloudPresign', 'cloudProgress', 'cloudComplete', 'cloudFail']);

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'This request is not valid. Please reload the page and try again.' });
  try {
    const b = await bodyOf(req), { db } = services();

    if (SECRET_ACTIONS.has(b.action)) {
      const store = kv(services());
      if (!idOK(b.uid) || !idOK(b.jobId)) throw new AccessError('invalid_job', 'The export job is not valid.', 400);
      const job = await jobBySecret(store, b.uid, b.jobId, b.secret);
      if (TERMINAL.has(job.status) && b.action !== 'cloudFetch') return send(res, 200, { ok: true, status: job.status }); // already finished elsewhere

      if (b.action === 'cloudStudio') {
        // the render page reads the shared character / animation library exactly like the owner's own studio does, as the job's owner, read-only
        const inner = b.body && typeof b.body === 'object' ? b.body : {};
        if (b.route !== 'studio-assets' || !['list', 'animation', 'get', 'character:list', 'character:files'].includes(inner.action)) throw new AccessError('forbidden', 'This request is not allowed while rendering in the cloud.', 403);
        return (await import('./studio-assets.js')).default({ method: 'POST', headers: {}, body: inner, cloudOwner: job.uid }, res);
      }
      if (b.action === 'cloudFetch') {
        if (!TERMINAL.has(job.status)) await updateJob(store, b.uid, b.jobId, { status: 'rendering' });
        const proj = await store.get(`projects/${job.uid}/${job.projectId}`);
        if (!proj || proj.deleted || !proj.stateOp) throw new AccessError('project_not_found', 'The project for this export was not found.', 404);
        const manifest = JSON.parse(await readText(stateKey(job.uid, job.projectId, proj.stateOp)));
        const hashes = (manifest.assets || []).map((a) => String(a.key).slice('assets/'.length));
        const assetUrls = Object.fromEntries(await Promise.all(hashes.map(async (h) => [h, await getUrl(assetKey(job.uid, h))])));
        return send(res, 200, { settings: job.settings, scope: job.scope, meta: { id: job.projectId, kind: 'animation', revision: proj.revision, updatedAt: proj.updatedAt || Date.now() }, manifest, assetUrls });
      }
      if (b.action === 'cloudPresign') {
        const size = Number(b.size);
        if (!Number.isSafeInteger(size) || size < 1 || size > MAX_VIDEO) throw new AccessError('invalid_file', 'The rendered video is too large to store (limit 1 GB). Please choose a lower quality.', 400);
        const kept = await listVideos(store, job.uid, (id) => deleteKey(videoKey(job.uid, id)));
        if (kept.reduce((n, v) => n + v.size, 0) + size > MAX_VIDEOS_TOTAL) throw new AccessError('quota_exceeded', 'Your saved cloud videos are using all the space. Please delete an old one and try again.', 413);
        return send(res, 200, { upload: await putUrl(videoKey(job.uid, b.jobId), size) });
      }
      if (b.action === 'cloudProgress') {
        const patch = { status: 'rendering' };
        if (b.progress !== undefined) patch.progress = Math.max(0, Math.min(1, Number(b.progress) || 0));
        if (['loading', 'preparing', 'rendering', 'uploading'].includes(b.phase)) patch.phase = b.phase;
        await updateJob(store, b.uid, b.jobId, patch);
        return send(res, 200, { ok: true });
      }
      if (b.action === 'cloudComplete') {
        const size = Number(b.size);
        if (!Number.isSafeInteger(size) || size < 1 || size > MAX_VIDEO) throw new AccessError('invalid_file', 'The rendered video is not valid.', 400);
        const head = await objectExists(videoKey(job.uid, b.jobId));
        if (!head.exists || head.size !== size) throw new AccessError('incomplete_upload', 'The video upload did not finish. Please try again.', 409);
        const now = Date.now(), s2 = job.settings || {};
        await store.set(`${videosPath(job.uid)}/${b.jobId}`, { projectId: job.projectId, projectName: job.projectName || '', size, seconds: job.seconds, quality: s2.quality, fps: s2.fps, createdAt: now, expiresAt: now + VIDEO_TTL_MS });
        await updateJob(store, b.uid, b.jobId, { status: 'done', progress: 1, size });
        return send(res, 200, { ok: true });
      }
      if (b.action === 'cloudFail') {
        await updateJob(store, b.uid, b.jobId, { status: 'error', error: String(b.message || 'The video could not be rendered.').slice(0, 300) });
        return send(res, 200, { ok: true });
      }
    }

    const who = await access(req, { write: ['authorize', 'complete', 'cloudCreate', 'cloudCancel', 'cloudDelete'].includes(b.action), admin: b.action === 'adminSetTier' });
    if (!who.admin && await maintenanceOn(db)) throw new AccessError('maintenance', '12toons is under maintenance right now. Please try again shortly.', 503);
    if (b.action === 'status') {
      const tier = await effectiveTier(db, who);
      return send(res, 200, { tier, limitSeconds: limitFor(tier), limits: EXPORT_LIMIT_SECONDS });
    }
    if (b.action === 'authorize') {
      const seconds = Number(b.seconds), scenes = Math.min(200, Math.max(1, Math.floor(Number(b.scenes) || 1))), scope = b.scope === 'all' ? 'all' : 'current';
      if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_SECONDS) throw new AccessError('invalid_length', 'The video length is not valid.', 400);
      const tier = await effectiveTier(db, who), limitSeconds = limitFor(tier), allowed = withinLimit(seconds, tier);
      const ref = db.collection(`workspaces/${who.uid}/exports`).doc();
      await ref.set({ id: ref.id, uid: who.uid, tier, limitSeconds, seconds: +seconds.toFixed(2), scenes, scope, status: allowed ? 'granted' : 'denied', createdAt: Date.now() });
      if (!allowed) return send(res, 403, { code: 'export_limit', error: limitMessage(seconds, tier), tier, limitSeconds, seconds });
      return send(res, 200, { grantId: ref.id, tier, limitSeconds });
    }
    if (b.action === 'complete') {
      if (!validGrant(b.grantId)) throw new AccessError('invalid_grant', 'The export reference is not valid.', 400);
      const ref = db.doc(`workspaces/${who.uid}/exports/${b.grantId}`), snap = await ref.get();
      if (!snap.exists) throw new AccessError('grant_not_found', 'Export reference not found.', 404);
      if (snap.data().status === 'granted') await ref.set({ status: b.ok === false ? 'failed' : 'completed', completedAt: Date.now() }, { merge: true });
      return send(res, 200, { ok: true });
    }
    if (b.action === 'adminSetTier') {
      if (!validUid(b.uid)) throw new AccessError('invalid_user', 'Please choose a valid user.', 400);
      await setTier(db, b.uid, b.tier, who.uid);
      return send(res, 200, { ok: true, uid: b.uid, tier: b.tier });
    }
    if (b.action === 'cloudCreate') {
      if (!idOK(b.projectId)) throw new AccessError('invalid_project', 'Please save the project before using cloud export.', 400);
      const seconds = Number(b.seconds), scenes = Math.min(200, Math.max(1, Math.floor(Number(b.scenes) || 1))), scope = b.scope === 'all' ? 'all' : 'current';
      if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_SECONDS) throw new AccessError('invalid_length', 'The video length is not valid.', 400);
      const tier = await effectiveTier(db, who);
      if (!withinLimit(seconds, tier)) throw new AccessError('export_limit', limitMessage(seconds, tier), 403);
      const store = kv(services());
      const proj = await store.get(`projects/${who.uid}/${b.projectId}`);
      if (!proj || proj.deleted) throw new AccessError('project_not_found', 'This project was not found. Please save it to the cloud first.', 404);
      const { id, job } = await createJob(store, who.uid, { projectId: b.projectId, projectName: String(proj.name || proj.title || '').slice(0, 80), settings: cleanSettings(b.settings), seconds, scenes, scope });
      return send(res, 200, { jobId: id, job: publicJob(id, job) });
    }
    if (b.action === 'cloudCancel') {
      if (!idOK(b.jobId)) throw new AccessError('invalid_job', 'The export job is not valid.', 400);
      const store = kv(services()), job = await getJob(store, who.uid, b.jobId);
      if (job.uid !== who.uid) throw new AccessError('not_found', 'This export job was not found.', 404);
      return send(res, 200, { job: publicJob(b.jobId, await cancelJob(store, who.uid, b.jobId)) });
    }
    if (b.action === 'cloudStatus') {
      if (!idOK(b.jobId)) throw new AccessError('invalid_job', 'The export job is not valid.', 400);
      const store = kv(services()), job = await getJob(store, who.uid, b.jobId);
      if (job.uid !== who.uid) throw new AccessError('not_found', 'This export job was not found.', 404);
      return send(res, 200, { job: publicJob(b.jobId, job) });
    }
    if (b.action === 'cloudList') {
      const store = kv(services());
      return send(res, 200, { videos: await listVideos(store, who.uid, (id) => deleteKey(videoKey(who.uid, id))) });
    }
    if (b.action === 'cloudDownload' || b.action === 'cloudDelete') {
      if (!idOK(b.jobId)) throw new AccessError('invalid_job', 'The export job is not valid.', 400);
      const store = kv(services()), row = await store.get(`${videosPath(who.uid)}/${b.jobId}`);
      if (!row || row.expiresAt <= Date.now()) throw new AccessError('video_gone', 'This video is no longer available. Cloud videos are kept for 3 days.', 404);
      if (b.action === 'cloudDelete') { await deleteKey(videoKey(who.uid, b.jobId)); await store.remove(`${videosPath(who.uid)}/${b.jobId}`); return send(res, 200, { ok: true }); }
      return send(res, 200, { url: await videoUrl(videoKey(who.uid, b.jobId), `toon-${(row.quality || 'video')}p-${b.jobId.slice(-6)}.mp4`) });
    }
    throw new AccessError('unknown_action', 'This export action was not recognized.', 400);
  } catch (e) { return failure(res, e); }
}
