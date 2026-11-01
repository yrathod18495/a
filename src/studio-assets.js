import { animationData, MAX_ANIMATION_BYTES } from './managed-animation.js';
import { auth } from './firebase.js';
import { apiCall } from './session.js';
import { uploadAssets, fetchBlob } from './binary-cloud.js';
import { THUMB_MAX_CHARS, THUMB_PATTERN } from '../shared/studio-effects.js';

const uid = () => auth.currentUser?.uid;
async function digest(blob) {
  const bytes = await blob.arrayBuffer();
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const LIST_KEY = '12toons-studio-assets', LIST_TTL_MS = 5 * 60 * 1000;
const readListCache = (owner) => { try { const c = JSON.parse(sessionStorage.getItem(LIST_KEY) || 'null'); return c && c.uid === owner && Date.now() - c.at < LIST_TTL_MS ? c.assets : null; } catch { return null; } };
const forgetList = () => { try { sessionStorage.removeItem(LIST_KEY); } catch { /* optional */ } };
/** the shared library; kept for a few minutes in this tab so opening the studio again does not read the database again */
export async function listStudioAssets({ fresh = false } = {}) {
  const owner = uid();
  if (!owner) throw new Error('Please sign in to view the studio asset library.');
  const cached = fresh ? null : readListCache(owner);
  if (cached) return cached;
  const assets = (await apiCall('/api/studio-assets', { action: 'list' }, owner)).assets;
  try { sessionStorage.setItem(LIST_KEY, JSON.stringify({ uid: owner, at: Date.now(), assets })); } catch { /* optional */ }
  return assets;
}
/** a tiny preview picture (first frame of a sprite sheet) stored with the asset, so the library never downloads full files just to show a grid */
export async function makeThumb(file, sheet = null) {
  const bitmap = await createImageBitmap(file), cols = sheet?.cols || 1, rows = sheet?.rows || 1, sw = bitmap.width / cols, sh = bitmap.height / rows;
  try {
    for (const edge of [160, 128, 96, 64]) {
      const k = Math.min(1, edge / Math.max(sw, sh)), canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(sw * k)); canvas.height = Math.max(1, Math.round(sh * k));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, sw, sh, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.8, 0.6, 0.4]) { const url = canvas.toDataURL('image/webp', quality); if (url.length <= THUMB_MAX_CHARS && THUMB_PATTERN.test(url)) return url; }
    }
  } finally { bitmap.close?.(); }
  return '';
}
/** Smaller files cost less to store and to download for every creator: props and backgrounds are scaled to at most 2048 px
 * (backgrounds 2560 px) and saved as WebP (transparency kept) when that is smaller. Effects (sprite sheets), GIFs and SVGs stay as they are. */
export async function optimizeImage(type, file) {
  if (!['prop', 'background'].includes(type) || !/^image\/(png|jpeg|webp|bmp)$/.test(file.type)) return file;
  let bitmap; try { bitmap = await createImageBitmap(file); } catch { return file; }
  try {
    const max = type === 'background' ? 2560 : 2048, k = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * k)); canvas.height = Math.max(1, Math.round(bitmap.height * k));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
    if (!out || out.type !== 'image/webp' || out.size >= file.size) return file;
    return new File([out], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' });
  } finally { bitmap.close?.(); }
}
export async function saveStudioAsset(type, name, file, meta = {}) {
  const owner = uid();
  if (!owner) throw new Error('Please sign in to add studio assets.');
  if (!['background', 'prop', 'effect'].includes(type) || !file?.type?.startsWith('image/')) throw new Error('Please choose an image file.');
  file = await optimizeImage(type, file);
  if (file.size > 40 * 1024 * 1024) throw new Error('The image must be 40 MB or smaller.');
  const hash = await digest(file), key = `assets/${hash}`, id = crypto.randomUUID();
  await uploadAssets(owner, new Map([[hash, file]]));
  const thumb = type === 'background' ? '' : (meta.thumb ?? await makeThumb(file, meta.sheet).catch(() => ''));
  const asset = (await apiCall('/api/studio-assets', { action: 'save', id, type, name: name.trim().slice(0, 100) || file.name.slice(0, 100), key, size: file.size, mime: file.type, ...meta, thumb }, owner)).asset;
  forgetList();
  return asset;
}
export async function deleteStudioAsset(id) {
  const result = await apiCall('/api/studio-assets', { action: 'delete', id }, uid());
  forgetList();
  return result;
}
// A library file never changes (its name is its SHA-256), so each browser downloads it once and keeps it: no server call, no R2 read next time.
const ASSET_CACHE = '12toons-studio-assets-v1', cacheUrl = (asset) => `https://studio-assets.12toons.local/${asset.key}`;
export async function downloadStudioAsset(asset) {
  const owner = uid();
  if (!owner) throw new Error('Please sign in to download studio assets.');
  try { const hit = await (await caches.open(ASSET_CACHE)).match(cacheUrl(asset)); if (hit) { const b = await hit.blob(); if (b.size === asset.size) return new Blob([b], { type: asset.mime || 'image/png' }); } } catch { /* the cache is only a shortcut */ }
  const out = await apiCall('/api/studio-assets', { action: 'get', id: asset.id }, owner);     // a short-lived R2 link; the file itself does not pass through the server
  const blob = await fetchBlob(out.url);
  if (blob.size !== asset.size) throw new Error('The downloaded image\'s size does not match the library record.');
  try { await (await caches.open(ASSET_CACHE)).put(cacheUrl(asset), new Response(blob)); } catch { /* not kept */ }
  return new Blob([blob], { type: asset.mime || 'image/png' });
}

export async function saveStudioAnimation(name, file, { target, layer = 'body', frameRate = 24 }) {
  const owner = uid();
  if (!owner) throw Error('You must sign in as an admin.');
  if (!file || file.size > MAX_ANIMATION_BYTES) throw Error('The animation JSON must be 4 MB or smaller.');
  const animation = animationData(JSON.parse(await file.text()));
  const blob = new Blob([JSON.stringify(animation)], { type: 'application/json' });
  const key = `assets/${await digest(blob)}`, id = crypto.randomUUID();
  await uploadAssets(owner, new Map([[key.slice(7), blob]]));
  const asset = (await apiCall('/api/studio-assets', { action: 'save', id, type: 'animation', name: name.trim().slice(0, 100) || file.name, key, size: blob.size, mime: 'application/json', target, layer, frameRate: Number(frameRate) }, owner)).asset;
  forgetList();
  return asset;
}
export const loadStudioAnimation = async id => (await apiCall('/api/studio-assets', { action: 'animation', id }, uid())).animation;
