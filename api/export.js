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
import { assetKey, stateKey, getUrl, readText, objectExists, confirmAssets, signUploads, MAX_FILE } from '../server/r2-storage.js';
import { createJob, getJob, jobBySecret, updateJob, cancelJob, publicJob, TERMINAL } from '../server/cloud-export-store.js';

const MAX_SECONDS = 24 * 3600;
const validGrant = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{4,40}$/.test(value);
const validUid = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,128}$/.test(value);
const idOK = (v) => typeof v === 'string' && /^[a-zA-Z0-9_-]{6,128}$/.test(v);
const QUALITIES = new Set([480, 720, 1080, 1440, 2160]), FPS = new Set([24, 30, 60, 90]), LEVELS = new Set(['std', 'high', 'max']), FORMATS = new Set(['webm', 'mp4']);
function cleanSettings(s) {
  if (!s || typeof s !== 'object') throw new AccessError('invalid_settings', 'The export settings are not valid.', 400);
  const quality = QUALITIES.has(+s.quality) ? +s.quality : 1080, fps = FPS.has(+s.fps) ? +s.fps : 30;
  const level = LEVELS.has(s.level) ? s.level : 'high', format = FORMATS.has(s.format) ? s.format : 'mp4';
  return { quality, fps, level, format };
}
// the anonymous cloud-export render worker never carries a Firebase sign-in — it proves ownership of one job with its secret instead
const SECRET_ACTIONS = new Set(['cloudFetch', 'cloudPresign', 'cloudProgress', 'cloudComplete', 'cloudFail']);

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'This request is not valid. Please reload the page and try again.' });
  try {
    const b = await bodyOf(req), { db } = services();

    if (SECRET_ACTIONS.has(b.action)) {
      const store = kv(services());
      if (!idOK(b.uid) || !idOK(b.jobId)) throw new AccessError('invalid_job', 'The export job is not valid.', 400);
      const job = await jobBySecret(store, b.uid, b.jobId, b.secret);
      if (TERMINAL.has(job.status) && b.action !== 'cloudFetch') return send(res, 200, { ok: true, status: job.status }); // already finished elsewhere

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
        const hash = String(b.hash || ''), size = Number(b.size);
        if (!/^[a-f0-9]{64}$/.test(hash) || !Number.isSafeInteger(size) || size < 1 || size > MAX_FILE) throw new AccessError('invalid_file', 'The rendered video is not valid.', 400);
        const signed = await signUploads(job.uid, store, { items: [{ hash, size }] });
        return send(res, 200, { upload: signed.upload[hash] || null, have: signed.have.includes(hash) });
      }
      if (b.action === 'cloudProgress') {
        const progress = Math.max(0, Math.min(1, Number(b.progress) || 0));
        await updateJob(store, b.uid, b.jobId, { status: 'rendering', progress });
        return send(res, 200, { ok: true });
      }
      if (b.action === 'cloudComplete') {
        const hash = String(b.hash || ''), size = Number(b.size);
        if (!/^[a-f0-9]{64}$/.test(hash) || !Number.isSafeInteger(size) || size < 1 || size > MAX_FILE) throw new AccessError('invalid_file', 'The rendered video is not valid.', 400);
        if (!(await objectExists(assetKey(job.uid, hash))).exists) throw new AccessError('incomplete_upload', 'The video upload did not finish. Please try again.', 409);
        await confirmAssets(job.uid, store, [{ hash, size }]);
        await updateJob(store, b.uid, b.jobId, { status: 'done', progress: 1, hash, size });
        return send(res, 200, { ok: true });
      }
      if (b.action === 'cloudFail') {
        await updateJob(store, b.uid, b.jobId, { status: 'error', error: String(b.message || 'The video could not be rendered.').slice(0, 300) });
        return send(res, 200, { ok: true });
      }
    }

    const who = await access(req, { write: ['authorize', 'complete', 'cloudCreate', 'cloudCancel'].includes(b.action), admin: b.action === 'adminSetTier' });
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
      const { id, job } = await createJob(store, who.uid, { projectId: b.projectId, settings: cleanSettings(b.settings), seconds, scenes, scope });
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
    throw new AccessError('unknown_action', 'This export action was not recognized.', 400);
  } catch (e) { return failure(res, e); }
}
