// Characters the admin uploaded (server/characters-api.js, served by api/studio-assets.js): reading them for the studio, and storing a new one from the admin screen.
// Files are addressed by their SHA-256, so each browser downloads a file once and keeps it (Cache API): no second download, no R2 read.
import { auth } from './firebase.js';
import { apiCall } from './session.js';
import { uploadAssets, fetchBlob, hashBlob } from './binary-cloud.js';
import { refSha, storageOf } from '../shared/character-package.js';

const API = '/api/studio-assets', CACHE = '12toons-characters-v1', cacheUrl = (sha) => `https://characters.12toons.local/${sha}`;
const owner = () => auth.currentUser?.uid || 'debug';
const call = ({ action, ...body }) => apiCall(API, { action: `character:${action}`, ...body }, owner());      // the studio library function serves characters too

/* ---------- reading ---------- */
/** the characters the admin published, each with its category's animations: [{ id, name, category, categoryName, views, animations, thumb }] */
export async function listCloudCharacters() { return (await call({ action: 'list' })).characters || []; }

const memory = new Map();         // sha -> Promise<Blob> for this page
async function fromCache(sha) { try { const hit = await (await caches.open(CACHE)).match(cacheUrl(sha)); return hit ? await hit.blob() : null; } catch { return null; } }
async function keep(sha, blob) { try { await (await caches.open(CACHE)).put(cacheUrl(sha), new Response(blob)); } catch { /* only a shortcut */ } }
async function gunzipBase64(b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).blob();
}
/** the files of these references as Blobs (Map sha -> Blob); cached files are not asked for again */
export async function getFiles(refs) {
  const out = new Map(), missing = [];
  await Promise.all(refs.filter(Boolean).map(async (r) => {
    const sha = refSha(r);
    if (!sha || out.has(sha)) return;
    if (memory.has(sha)) { out.set(sha, await memory.get(sha)); return; }
    const hit = await fromCache(sha);
    if (hit) { out.set(sha, hit); memory.set(sha, Promise.resolve(hit)); } else if (!missing.some((m) => refSha(m) === sha)) missing.push(r);
  }));
  for (let i = 0; i < missing.length; i += 60) {
    const part = missing.slice(i, i + 60), answer = await call({ action: 'files', refs: part.map((r) => (r.db ? { db: r.db } : { r2: r.r2, size: r.size })) });
    await Promise.all(part.map(async (r) => {
      const sha = refSha(r);
      const job = (async () => {
        let blob;
        if (r.db) { if (!answer.db?.[sha]) throw new Error('A character file is missing. Please ask the admin to upload the character again.'); blob = await gunzipBase64(answer.db[sha]); }
        else { if (!answer.r2?.[sha]) throw new Error('A character picture is missing. Please ask the admin to upload the character again.'); blob = await fetchBlob(answer.r2[sha]); if (r.size && blob.size !== r.size) throw new Error('A character picture did not download completely. Please try again.'); }
        if (await hashBlob(blob) !== sha) throw new Error('A character file came back damaged. Please try again.');
        await keep(sha, blob);
        return blob;
      })();
      memory.set(sha, job);
      try { out.set(sha, await job); } catch (e) { memory.delete(sha); throw e; }
    }));
  }
  return out;
}
export async function getJson(ref) { return JSON.parse(await (await getFiles([ref])).get(refSha(ref)).text()); }
const urls = new Map();
/** a picture (thumbnail, GIF preview) as an object URL, downloaded once */
export async function pictureUrl(ref) {
  const sha = refSha(ref);
  if (!sha) return null;
  if (!urls.has(sha)) urls.set(sha, getFiles([ref]).then((m) => URL.createObjectURL(m.get(sha))).catch((e) => { urls.delete(sha); throw e; }));
  return urls.get(sha);
}
/** one view of a character as the studio needs it: { ske, tex: [{ json, image }] } */
export async function loadCloudView(character, viewId) {
  const v = character.views?.[viewId];
  if (!v) throw new Error('This view of the character is not available.');
  const files = await getFiles([v.skeleton, ...v.textures.flatMap((t) => [t.json, t.page])]);
  const json = (r) => files.get(refSha(r)).text().then(JSON.parse);
  const ske = await json(v.skeleton), tex = await Promise.all(v.textures.map(async (t) => ({ json: await json(t.json), image: files.get(refSha(t.page)) })));
  return { ske, tex };
}

/* ---------- storing (admin) ---------- */
async function gzipBase64(blob) {
  const gz = new Uint8Array(await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  let s = ''; for (let i = 0; i < gz.length; i += 0x8000) s += String.fromCharCode(...gz.subarray(i, i + 0x8000));
  return btoa(s);
}
/**
 * Stores a checked package and saves the character. `files`: Map path -> Blob (from the ZIP); `gifs`: Map `${view}/${animation}` -> Blob;
 * `thumb`: Blob; `withAnimations`: false = use the existing category's animations. `progress(text, done, total)` is called as it goes.
 */
export async function storeCharacter({ manifest, files, gifs = new Map(), thumb = null, withAnimations = true, progress = () => {} }) {
  const refs = new Map(), r2 = new Map(), small = [];
  const add = async (key, blob, path) => {
    const sha = await hashBlob(blob);
    if (storageOf(path, blob.size) === 'db') { refs.set(key, { db: sha }); if (!small.some((s) => s.sha === sha)) small.push({ sha, blob }); }
    else { refs.set(key, { r2: sha, size: blob.size }); r2.set(sha, blob); }
  };
  const fileOf = (path) => { const b = files.get(path); if (!b) throw new Error(`The ZIP has no ${path}.`); return b; };
  progress('Preparing the files…', 0, 1);
  for (const v of manifest.views) {
    await add(`${v.id}:skeleton`, fileOf(v.skeleton), v.skeleton);
    for (const [i, t] of v.textures.entries()) {
      const json = JSON.parse(await fileOf(t).text()), page = t.slice(0, t.lastIndexOf('/') + 1) + json.imagePath;
      await add(`${v.id}:tex${i}`, fileOf(t), t); await add(`${v.id}:page${i}`, fileOf(page), page);
    }
    if (withAnimations) for (const a of v.animations) {
      await add(`${v.id}:anim:${a.name}`, fileOf(a.file), a.file);
      const gif = gifs.get(`${v.id}/${a.name}`); if (gif) await add(`${v.id}:gif:${a.name}`, gif, 'preview.gif');
    }
  }
  if (thumb) await add('thumb', thumb, 'thumb.webp');
  const total = small.length + r2.size; let done = 0;
  for (const f of small) { progress(`Saving files ${++done} / ${total}…`, done, total); await call({ action: 'putFile', sha: f.sha, gz: await gzipBase64(f.blob) }); }
  if (r2.size) { progress(`Uploading pictures (${r2.size})…`, done, total); await uploadAssets(owner(), r2); done += r2.size; }
  progress('Saving the character…', total, total);
  const record = { character: { id: manifest.character.id, name: manifest.character.name, thumb: refs.get('thumb') || null, views: {} }, category: { id: manifest.category.id, name: manifest.category.name } };
  for (const v of manifest.views) record.character.views[v.id] = { label: v.label, skeleton: refs.get(`${v.id}:skeleton`), textures: v.textures.map((_, i) => ({ json: refs.get(`${v.id}:tex${i}`), page: refs.get(`${v.id}:page${i}`) })) };
  if (withAnimations) {
    record.category.views = {};
    for (const v of manifest.views) record.category.views[v.id] = { animations: v.animations.map((a) => ({ name: a.name, label: a.label, group: a.group, layer: a.layer, length: a.length, file: refs.get(`${v.id}:anim:${a.name}`), gif: refs.get(`${v.id}:gif:${a.name}`) || null, gifName: a.gifName })) };
  }
  return call({ action: 'commit', ...record });
}
export const deleteCloudCharacter = (id) => call({ action: 'delete', id });
