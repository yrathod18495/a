// Cloudflare R2: only big files live here. Layout of the bucket (everything of one user stays under u/<uid>/):
//   u/<uid>/a/<first 2 hex>/<sha256>          pictures, audio, character pages (content addressed, shared by all projects of the user)
//   u/<uid>/p/<projectId>/state-<opId>.json   the project snapshot (only the latest one is kept; older ones are deleted on commit)
// Browsers upload and download straight to R2 with short-lived presigned URLs (one request per file, no Vercel body limit, no chunk recipes).
// R2 charges per request (Class A = write / list, Class B = read; egress is free), so the server never lists the bucket: sizes and
// usage are counted in the Realtime Database (assets/<uid>/<hash> = size, usage/<uid> = {bytes, objects}).
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AccessError } from './security-policy.js';

export const MAX_FILE = 40 * 1024 * 1024, MAX_USER = 300 * 1024 * 1024, MAX_ITEMS = 200;
export const MAX_PROJECT_ASSETS = 2000;
export const UPLOAD_TTL = 600, DOWNLOAD_TTL = 900;     // seconds a signed URL stays valid
const env = (k) => process.env[k] || '';
export const configured = () => !!(env('CLOUDFLARE_R2_ACCOUNT_ID') && env('CLOUDFLARE_R2_ACCESS_KEY_ID') && env('CLOUDFLARE_R2_SECRET_ACCESS_KEY') && env('CLOUDFLARE_R2_BUCKET_NAME'));
let s3;
export const client = () => s3 ||= new S3Client({
  region: 'auto', endpoint: 'https://' + env('CLOUDFLARE_R2_ACCOUNT_ID') + '.r2.cloudflarestorage.com', forcePathStyle: true,
  credentials: { accessKeyId: env('CLOUDFLARE_R2_ACCESS_KEY_ID'), secretAccessKey: env('CLOUDFLARE_R2_SECRET_ACCESS_KEY') },
  requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
});

export const isHash = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const isId = (v) => typeof v === 'string' && /^[a-zA-Z0-9_-]{16,128}$/.test(v);
export const assetKey = (uid, hash) => `u/${uid}/a/${hash.slice(0, 2)}/${hash}`;
export const stateKey = (uid, projectId, opId) => `u/${uid}/p/${projectId}/state-${opId}.json`;
const bad = (msg = 'File ki jaankari sahi nahi hai.') => new AccessError('invalid_file', msg, 400);
const bucket = () => env('CLOUDFLARE_R2_BUCKET_NAME');

async function head(key) {
  try {
    const h = await client().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return { exists: true, size: h.ContentLength };
  } catch (e) { if (e.$metadata?.httpStatusCode === 404) return { exists: false }; throw e; }
}
export const objectExists = head;
/** deleting is free on R2 */
export const deleteKey = (key) => client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key })).catch(() => {});

const putUrl = async (key, size) => ({
  url: await getSignedUrl(client(), new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: 'application/octet-stream', ContentLength: size }), { expiresIn: UPLOAD_TTL }),
  headers: { 'Content-Type': 'application/octet-stream' },
});
export const getUrl = (key) => getSignedUrl(client(), new GetObjectCommand({ Bucket: bucket(), Key: key }), { expiresIn: DOWNLOAD_TTL });

function cleanItems(items, max = MAX_ITEMS) {
  if (!Array.isArray(items) || items.length > max) throw bad('Ek baar me bahut zyada files hain.');
  const seen = new Map();
  for (const it of items) {
    if (!isHash(it?.hash) || !Number.isSafeInteger(it.size) || it.size < 0 || it.size > MAX_FILE) throw bad('File ya uska size sahi nahi hai (limit 40 MB).');
    seen.set(it.hash, it.size);
  }
  return seen;
}

/**
 * Which of these files still has to be uploaded, and the signed URL for each. `store` is the Realtime Database wrapper (server/rtdb.js kv()).
 * Files the user already has (registered by hash) are skipped, so the same picture is never sent twice.
 */
export async function signUploads(uid, store, { items = [], state = null }) {
  const wanted = cleanItems(items), registry = (await store.get(`assets/${uid}`)) || {}, upload = {}, have = [];
  let extra = 0;
  for (const [hash, size] of wanted) { if (registry[hash] != null) have.push(hash); else extra += size; }
  if (state) {
    if (!isId(state.projectId) || !isId(state.opId) || !Number.isSafeInteger(state.size) || state.size < 1 || state.size > MAX_FILE) throw bad('Project snapshot ki jaankari sahi nahi hai.');
    extra += state.size;
  }
  const usage = (await store.get(`usage/${uid}`)) || {};
  if ((usage.bytes || 0) + extra > MAX_USER) throw new AccessError('quota_exceeded', 'Cloud storage ki limit poori ho gayi. Purane projects ya files hatakar dobara try karein.', 413);
  for (const [hash, size] of wanted) if (registry[hash] == null) upload[hash] = await putUrl(assetKey(uid, hash), size);
  const out = { upload, have };
  if (state) out.state = await putUrl(stateKey(uid, state.projectId, state.opId), state.size);
  return out;
}

/** after the browser uploaded: check the files really are in R2 (a HEAD is a cheap Class B read), then count them once */
export async function confirmAssets(uid, store, items) {
  const wanted = cleanItems(items, MAX_PROJECT_ASSETS), registry = (await store.get(`assets/${uid}`)) || {}, fresh = [];
  for (const [hash, size] of wanted) {
    if (registry[hash] != null) continue;
    const h = await head(assetKey(uid, hash));
    if (!h.exists || h.size !== size) throw new AccessError('incomplete_upload', 'File ka upload poora nahi hua. Dobara try karein.', 409);
    fresh.push([hash, size]);
  }
  if (!fresh.length) return { added: 0 };
  const bytes = fresh.reduce((sum, [, size]) => sum + size, 0);
  await store.update(`assets/${uid}`, Object.fromEntries(fresh));
  await store.transact(`usage/${uid}`, (u) => ({ bytes: (u?.bytes || 0) + bytes, objects: (u?.objects || 0) + fresh.length, updatedAt: Date.now() }));
  return { added: fresh.length, bytes };
}

/** signed download URLs for assets (no request to R2 happens until the browser fetches them) */
export async function signDownloads(uid, hashes) {
  if (!Array.isArray(hashes) || hashes.length > MAX_ITEMS || !hashes.every(isHash)) throw bad();
  return Object.fromEntries(await Promise.all([...new Set(hashes)].map(async (h) => [h, await getUrl(assetKey(uid, h))])));
}

const animationCache = new Map();
/** a small JSON asset (a shared animation) read once per server instance and kept: the file is content addressed, so it never changes */
export async function readAssetText(uid, hash, maxBytes = 4 * 1024 * 1024) {
  const id = uid + '/' + hash;
  if (animationCache.has(id)) return animationCache.get(id);
  const out = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: assetKey(uid, hash) }));
  if (out.ContentLength > maxBytes) throw new AccessError('too_large', 'File bahut badi hai.', 413);
  const text = Buffer.from(await out.Body.transformToByteArray()).toString('utf8');
  if (animationCache.size >= 20) animationCache.delete(animationCache.keys().next().value);
  animationCache.set(id, text);
  return text;
}
