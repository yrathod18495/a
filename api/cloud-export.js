// Cloud export: the video is rendered on a separate machine (see docs/CLOUD-EXPORT.md) instead of the user's own device.
//
// Two kinds of caller use this one endpoint:
//  - the owner's own browser tab, signed in normally (Firebase ID token): create / cancel / status.
//  - the anonymous render worker, proven only by the job's random `secret` (it is never signed in as the user — doing that would
//    sign the user out of their own session everywhere else, since an account is only ever signed in on one device at a time):
//    fetch / presign / progress / complete / fail.
import { access, bodyOf, send, failure, maintenanceBlocks } from '../server/access.js';
import { services } from '../server/firebase-admin.js';
import { kv } from '../server/rtdb.js';
import { AccessError } from '../server/security-policy.js';
import { withinLimit, limitMessage } from '../shared/export-limits.js';
import { effectiveTier } from '../server/entitlements.js';
import { assetKey, stateKey, getUrl, readText, objectExists, confirmAssets, signUploads, MAX_FILE } from '../server/r2-storage.js';
import { createJob, getJob, jobBySecret, updateJob, cancelJob, publicJob, TERMINAL } from '../server/cloud-export-store.js';

const idOK = (v) => typeof v === 'string' && /^[a-zA-Z0-9_-]{6,128}$/.test(v);
const MAX_SECONDS = 24 * 3600;
const QUALITIES = new Set([480, 720, 1080, 1440, 2160]), FPS = new Set([24, 30, 60, 90]), LEVELS = new Set(['std', 'high', 'max']), FORMATS = new Set(['webm', 'mp4']);

function cleanSettings(s) {
  if (!s || typeof s !== 'object') throw new AccessError('invalid_settings', 'The export settings are not valid.', 400);
  const quality = QUALITIES.has(+s.quality) ? +s.quality : 1080, fps = FPS.has(+s.fps) ? +s.fps : 30;
  const level = LEVELS.has(s.level) ? s.level : 'high', format = FORMATS.has(s.format) ? s.format : 'mp4';
  return { quality, fps, level, format };
}
const SECRET_ACTIONS = new Set(['fetch', 'presign', 'progress', 'complete', 'fail']);

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'This request is not valid. Please reload the page and try again.' });
  try {
    const b = await bodyOf(req, 50 * 1024);
    const svc = services(), store = kv(svc);

    // the render worker never carries a Firebase sign-in — it proves ownership of one job with the secret instead
    if (SECRET_ACTIONS.has(b.action)) {
      if (!idOK(b.uid) || !idOK(b.jobId)) throw new AccessError('invalid_job', 'The export job is not valid.', 400);
      const job = await jobBySecret(store, b.uid, b.jobId, b.secret);
      if (TERMINAL.has(job.status) && b.action !== 'fetch') return send(res, 200, { ok: true, status: job.status }); // already finished elsewhere; nothing left to do

      if (b.action === 'fetch') {
        if (!TERMINAL.has(job.status)) await updateJob(store, b.uid, b.jobId, { status: 'rendering' });
        const proj = await store.get(`projects/${job.uid}/${job.projectId}`);
        if (!proj || proj.deleted || !proj.stateOp) throw new AccessError('project_not_found', 'The project for this export was not found.', 404);
        const manifest = JSON.parse(await readText(stateKey(job.uid, job.projectId, proj.stateOp)));
        const hashes = (manifest.assets || []).map((a) => String(a.key).slice('assets/'.length));
        const assetUrls = Object.fromEntries(await Promise.all(hashes.map(async (h) => [h, await getUrl(assetKey(job.uid, h))])));
        return send(res, 200, { settings: job.settings, scope: job.scope, meta: { id: job.projectId, kind: 'animation', revision: proj.revision, updatedAt: proj.updatedAt || Date.now() }, manifest, assetUrls });
      }
      if (b.action === 'presign') {
        const hash = String(b.hash || ''), size = Number(b.size);
        if (!/^[a-f0-9]{64}$/.test(hash) || !Number.isSafeInteger(size) || size < 1 || size > MAX_FILE) throw new AccessError('invalid_file', 'The rendered video is not valid.', 400);
        const signed = await signUploads(job.uid, store, { items: [{ hash, size }] });
        return send(res, 200, { upload: signed.upload[hash] || null, have: signed.have.includes(hash) });
      }
      if (b.action === 'progress') {
        const progress = Math.max(0, Math.min(1, Number(b.progress) || 0));
        await updateJob(store, b.uid, b.jobId, { status: 'rendering', progress });
        return send(res, 200, { ok: true });
      }
      if (b.action === 'complete') {
        const hash = String(b.hash || ''), size = Number(b.size);
        if (!/^[a-f0-9]{64}$/.test(hash) || !Number.isSafeInteger(size) || size < 1 || size > MAX_FILE) throw new AccessError('invalid_file', 'The rendered video is not valid.', 400);
        if (!(await objectExists(assetKey(job.uid, hash))).exists) throw new AccessError('incomplete_upload', 'The video upload did not finish. Please try again.', 409);
        await confirmAssets(job.uid, store, [{ hash, size }]);
        await updateJob(store, b.uid, b.jobId, { status: 'done', progress: 1, hash, size });
        return send(res, 200, { ok: true });
      }
      if (b.action === 'fail') {
        await updateJob(store, b.uid, b.jobId, { status: 'error', error: String(b.message || 'The video could not be rendered.').slice(0, 300) });
        return send(res, 200, { ok: true });
      }
    }

    // every other action is the owner's own, normal, signed-in call
    const who = await access(req, { write: ['create', 'cancel'].includes(b.action), cache: true });
    if (await maintenanceBlocks(who)) throw new AccessError('maintenance', '12toons is under maintenance right now. Please try again shortly.', 503);
    if (b.action === 'create') {
      if (!idOK(b.projectId)) throw new AccessError('invalid_project', 'Please save the project before using cloud export.', 400);
      const seconds = Number(b.seconds), scenes = Math.min(200, Math.max(1, Math.floor(Number(b.scenes) || 1))), scope = b.scope === 'all' ? 'all' : 'current';
      if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_SECONDS) throw new AccessError('invalid_length', 'The video length is not valid.', 400);
      const tier = await effectiveTier(services().db, who);
      if (!withinLimit(seconds, tier)) throw new AccessError('export_limit', limitMessage(seconds, tier), 403);
      const proj = await store.get(`projects/${who.uid}/${b.projectId}`);
      if (!proj || proj.deleted) throw new AccessError('project_not_found', 'This project was not found. Please save it to the cloud first.', 404);
      const { id, job } = await createJob(store, who.uid, { projectId: b.projectId, settings: cleanSettings(b.settings), seconds, scenes, scope });
      return send(res, 200, { jobId: id, job: publicJob(id, job) });
    }
    if (b.action === 'cancel') {
      if (!idOK(b.jobId)) throw new AccessError('invalid_job', 'The export job is not valid.', 400);
      const job = await getJob(store, who.uid, b.jobId);
      if (job.uid !== who.uid) throw new AccessError('not_found', 'This export job was not found.', 404);
      return send(res, 200, { job: publicJob(b.jobId, await cancelJob(store, who.uid, b.jobId)) });
    }
    if (b.action === 'status') {
      if (!idOK(b.jobId)) throw new AccessError('invalid_job', 'The export job is not valid.', 400);
      const job = await getJob(store, who.uid, b.jobId);
      if (job.uid !== who.uid) throw new AccessError('not_found', 'This export job was not found.', 404);
      return send(res, 200, { job: publicJob(b.jobId, job) });
    }
    throw new AccessError('unknown_action', 'This export action was not recognized.', 400);
  } catch (e) { return failure(res, e); }
}
