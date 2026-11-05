import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { S3Client } from '@aws-sdk/client-s3';
import { memoryFirestore, response } from './fake-firestore.js';
import { memoryRtdb } from './fake-rtdb.js';
process.env.MAINTENANCE_MODE = 'false';
const db = memoryFirestore(), rtdb = memoryRtdb(), uid = 'cloud-export-user', objects = new Map();
Object.assign(process.env, { CLOUDFLARE_R2_ACCOUNT_ID: 'acc', CLOUDFLARE_R2_ACCESS_KEY_ID: 'key', CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'secret', CLOUDFLARE_R2_BUCKET_NAME: 'bucket' });
S3Client.prototype.send = async function (cmd) {
  const name = cmd.constructor.name, key = cmd.input.Key;
  if (name === 'HeadObjectCommand') { if (!objects.has(key)) { const e = Error('missing'); e.$metadata = { httpStatusCode: 404 }; throw e; } return { ContentLength: objects.get(key) }; }
  if (name === 'GetObjectCommand') { const v = objects.get(key); if (!v) { const e = Error('missing'); e.$metadata = { httpStatusCode: 404 }; throw e; } return { ContentLength: v.length, Body: { transformToByteArray: async () => Buffer.from(v) } }; }
  throw Error('unexpected ' + name);
};
db.data.set('securityUsers/' + uid, { status: 'active' });
db.data.set('securitySessions/' + uid, { sid: 'ok', expiresAt: Date.now() + 100000, revoked: false });
mock.module('../server/firebase-admin.js', { exports: { services: () => ({ db, rtdb, auth: { verifyIdToken: async () => ({ uid, email_verified: true, sid: 'ok' }) } }) } });
const { default: handler } = await import('../api/cloud-export.js');
const { stateKey, assetKey } = await import('../server/r2-storage.js');

const projectId = 'proj_abcdef123', opId = 'op_1234567890';
const manifest = { version: 1, records: [{ store: 'project', value: { id: 'current' } }], assets: [] };
const call = async (body, auth = true) => { const r = response(); await handler({ method: 'POST', headers: auth ? { authorization: 'Bearer fake' } : {}, body }, r); return r; };

test('create needs a saved project and refuses a video that is too long for the plan', async () => {
  const noProject = await call({ action: 'create', projectId, seconds: 10, settings: {} });
  assert.equal(noProject.statusCode, 404);
  await rtdb.ref(`projects/${uid}/${projectId}`).set({ revision: 1, stateOp: opId, deleted: false });
  const tooLong = await call({ action: 'create', projectId, seconds: 999999, settings: {} });
  assert.equal(tooLong.statusCode, 403); assert.equal(tooLong.body.code, 'export_limit');
  const ok = await call({ action: 'create', projectId, seconds: 10, settings: { quality: 1080, fps: 30, level: 'high', format: 'mp4' } });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual([ok.body.job.status, ok.body.job.projectId, ok.body.job.progress], ['pending', projectId, 0]);
  assert.equal('secret' in ok.body.job, false); // the owner's own view never carries the job's secret
});

test('the render worker can only act on a job with the right secret, and never sees other jobs', async () => {
  await rtdb.ref(`projects/${uid}/${projectId}`).set({ revision: 1, stateOp: opId, deleted: false });
  const created = (await call({ action: 'create', projectId, seconds: 10, settings: {} })).body;
  const jobId = created.jobId, realSecret = (await rtdb.ref(`cloudExports/${uid}/${jobId}`).get()).val().secret;
  const wrong = await call({ action: 'fetch', uid, jobId, secret: 'nope' }, false);
  assert.equal(wrong.statusCode, 403);
  objects.set(stateKey(uid, projectId, opId), JSON.stringify(manifest));
  const fetched = await call({ action: 'fetch', uid, jobId, secret: realSecret }, false);
  assert.equal(fetched.statusCode, 200);
  assert.deepEqual(fetched.body.manifest, manifest);
  assert.equal((await rtdb.ref(`cloudExports/${uid}/${jobId}`).get()).val().status, 'rendering');
  // progress updates
  await call({ action: 'progress', uid, jobId, secret: realSecret, progress: 0.4 }, false);
  assert.equal((await rtdb.ref(`cloudExports/${uid}/${jobId}`).get()).val().progress, 0.4);
  // complete: the uploaded video must really be in R2 first
  const hash = 'b'.repeat(64);
  const notUploaded = await call({ action: 'complete', uid, jobId, secret: realSecret, hash, size: 10 }, false);
  assert.equal(notUploaded.statusCode, 409);
  objects.set(assetKey(uid, hash), Buffer.alloc(10));
  const done = await call({ action: 'complete', uid, jobId, secret: realSecret, hash, size: 10 }, false);
  assert.equal(done.statusCode, 200);
  const job = (await rtdb.ref(`cloudExports/${uid}/${jobId}`).get()).val();
  assert.deepEqual([job.status, job.hash, job.size], ['done', hash, 10]);
  // the owner can now read it back through the normal, signed-in call (no secret involved)
  const status = await call({ action: 'status', jobId });
  assert.equal(status.body.job.status, 'done');
  // a second render worker action on the same (finished) job is a harmless no-op, not an error
  const again = await call({ action: 'progress', uid, jobId, secret: realSecret, progress: 0.9 }, false);
  assert.equal(again.statusCode, 200); assert.equal(again.body.status, 'done');
});

test('the owner can cancel a job that is still running; a job id that is not theirs (or does not exist) is just not found', async () => {
  await rtdb.ref(`projects/${uid}/${projectId}`).set({ revision: 1, stateOp: opId, deleted: false });
  const { jobId } = (await call({ action: 'create', projectId, seconds: 10, settings: {} })).body;
  const cancelled = await call({ action: 'cancel', jobId });
  assert.equal(cancelled.body.job.status, 'cancelled');
  const cancelledAgain = await call({ action: 'cancel', jobId }); // already terminal: cancelling again is a harmless no-op
  assert.equal(cancelledAgain.body.job.status, 'cancelled');
  const missing = await call({ action: 'status', jobId: 'cexp_doesnotexist' });
  assert.equal(missing.statusCode, 404);
});
