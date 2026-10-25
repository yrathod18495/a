// Files go between the browser and Cloudflare R2 directly, with short-lived signed links made by /api/r2 (one request per file; nothing is
// pushed through the server). Files are named by their SHA-256, so a file that is already in the cloud is never uploaded again, and a file
// that was downloaded once is kept in this browser (Cache Storage) and never downloaded again.
import { apiCall } from './session.js';
const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const hashBytes = async (bytes) => hex(await crypto.subtle.digest('SHA-256', bytes));
export const hashBlob = async (blob) => hashBytes(await blob.arrayBuffer());
const BATCH = 200, PARALLEL = 4, CACHE = '12toons-assets-v1';

async function pool(jobs, run) {
  let next = 0, failure = null;
  await Promise.all(Array.from({ length: Math.min(PARALLEL, jobs.length) }, async () => {
    while (!failure && next < jobs.length) { const job = jobs[next++]; try { await run(job); } catch (e) { failure = failure || e; } }
  }));
  if (failure) throw failure;
}
function cloudError(e, what) {
  if (e instanceof TypeError) { const err = Error(`Cloud storage se ${what} nahi ho paya. Internet check karein; agar ye baar baar ho to admin se R2 ki CORS setting dobara dekhne ko kahein.`); err.code = 'r2_unreachable'; return err; }
  return e;
}
async function put(target, blob) {
  let r;
  try { r = await fetch(target.url, { method: 'PUT', headers: target.headers, body: blob }); } catch (e) { throw cloudError(e, 'upload'); }
  if (!r.ok) { const err = Error(r.status === 403 ? 'Upload ka link khatam ho gaya ya sahi nahi tha. Dobara try karein.' : `Cloud storage ne upload nahi liya (${r.status}). Dobara try karein.`); err.code = 'r2_put_failed'; throw err; }
}

/**
 * Upload files (`assets`: Map hash -> Blob) and, optionally, one project snapshot (`state`: {projectId, opId, blob}).
 * Only the files the cloud does not have yet are sent.
 */
// Hashes this browser has already put into R2 for this account: they are neither sent to the server nor checked again.
const KNOWN_LIMIT = 4000, knownKey = (uid) => 'toons-uploaded-' + uid;
const knownSet = (uid) => { try { return new Set(JSON.parse(localStorage.getItem(knownKey(uid)) || '[]')); } catch { return new Set(); } };
const rememberKnown = (uid, set) => { try { localStorage.setItem(knownKey(uid), JSON.stringify([...set].slice(-KNOWN_LIMIT))); } catch { /* optional */ } };
export async function uploadAssets(uid, assets, state = null) {
  const known = knownSet(uid), list = [...assets].filter(([hash]) => !known.has(hash));
  for (const [hash, blob] of list) if (blob.size > 40 * 1024 * 1024) throw Error('File 40 MB ki limit se badi hai.');
  if (!list.length && !state) return { sent: 0, fresh: [] };
  let sent = 0, first = true;
  const fresh = [];
  for (let i = 0; i < Math.max(1, list.length); i += BATCH) {
    const part = list.slice(i, i + BATCH), body = { action: 'sign', items: part.map(([hash, blob]) => ({ hash, size: blob.size })) };
    if (first && state) body.state = { projectId: state.projectId, opId: state.opId, size: state.blob.size };
    if (!part.length && !body.state) break;
    const signed = await apiCall('/api/r2', body, uid);
    for (const hash of signed.have || []) known.add(hash);
    const jobs = part.filter(([hash]) => signed.upload[hash]).map(([hash, blob]) => [signed.upload[hash], blob]);
    for (const [hash, blob] of part) if (signed.upload[hash]) fresh.push({ hash, size: blob.size });
    if (signed.state) jobs.push([signed.state, state.blob]);
    await pool(jobs, ([target, blob]) => put(target, blob));
    for (const f of fresh) known.add(f.hash);
    rememberKnown(uid, known);
    sent += jobs.length; first = false;
  }
  return { sent, fresh };
}
/** tell the server these files are now in R2 (it checks, counts them once and registers them); projects do this inside "commit" */
export async function confirmAssets(uid, assets) {
  const items = [...assets].map(([hash, blob]) => ({ hash, size: blob.size }));
  for (let i = 0; i < items.length; i += BATCH) await apiCall('/api/r2', { action: 'confirm', items: items.slice(i, i + BATCH) }, uid);
}

const cacheKey = (uid, hash) => `https://assets.12toons.local/${uid}/${hash}`;
async function cached(uid, hash) {
  try { const r = await (await caches.open(CACHE)).match(cacheKey(uid, hash)); return r ? await r.blob() : null; } catch { return null; }
}
async function remember(uid, hash, blob) { try { await (await caches.open(CACHE)).put(cacheKey(uid, hash), new Response(blob)); } catch { /* the cache is only a shortcut */ } }

export async function fetchBlob(url, what = 'download') {
  let r;
  try { r = await fetch(url); } catch (e) { throw cloudError(e, what); }
  if (!r.ok) { const err = Error('Cloud file abhi nahi mil rahi. Thodi der baad dobara try karein.'); err.code = 'r2_get_failed'; throw err; }
  return r.blob();
}
/** download files by hash (each is checked against its hash); `known` can carry sizes to check too. Returns Map hash -> Blob */
export async function downloadAssets(uid, hashes, sizes = new Map()) {
  const wanted = [...new Set(hashes)], out = new Map(), missing = [];
  for (const hash of wanted) { const hit = await cached(uid, hash); if (hit) out.set(hash, hit); else missing.push(hash); }
  for (let i = 0; i < missing.length; i += BATCH) {
    const { urls } = await apiCall('/api/r2', { action: 'urls', hashes: missing.slice(i, i + BATCH) }, uid);
    await pool(missing.slice(i, i + BATCH), async (hash) => {
      const blob = await fetchBlob(urls[hash]);
      if (sizes.has(hash) && blob.size !== sizes.get(hash) || await hashBlob(blob) !== hash) throw Error('Cloud file kharab nikli (integrity check fail hua). Dobara try karein.');
      out.set(hash, blob); await remember(uid, hash, blob);
    });
  }
  return out;
}
