import { animationData, MAX_ANIMATION_BYTES } from './managed-animation.js';
import { auth } from './firebase.js';
import { apiCall } from './session.js';
import { uploadFile } from './cloud.js';

const CHUNK = 2 * 1024 * 1024;
const uid = () => auth.currentUser?.uid;
async function digest(blob) {
  const bytes = await blob.arrayBuffer();
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export async function listStudioAssets() {
  const owner = uid();
  if (!owner) throw new Error('Studio asset library dekhne ke liye sign in karein.');
  return (await apiCall('/api/studio-assets', { action: 'list' }, owner)).assets;
}
export async function saveStudioAsset(type, name, file) {
  const owner = uid();
  if (!owner) throw new Error('Studio assets jodne ke liye sign in karein.');
  if (!['background', 'prop'].includes(type) || !file?.type?.startsWith('image/')) throw new Error('Image file chunein.');
  if (file.size > 40 * 1024 * 1024) throw new Error('Image 40 MB ya usse chhoti honi chahiye.');
  const hash = await digest(file), key = `assets/${hash}`, id = crypto.randomUUID();
  await uploadFile(key, file, owner);
  return (await apiCall('/api/studio-assets', { action: 'save', id, type, name: name.trim().slice(0, 100) || file.name.slice(0, 100), key, size: file.size, mime: file.type }, owner)).asset;
}
export async function deleteStudioAsset(id) {
  return apiCall('/api/studio-assets', { action: 'delete', id }, uid());
}
export async function downloadStudioAsset(asset) {
  const owner = uid();
  if (!owner) throw new Error('Studio assets download karne ke liye sign in karein.');
  const parts = [];
  for (let start = 0; start < asset.size; start += CHUNK) {
    const out = await apiCall('/api/studio-assets', { action: 'get', id: asset.id, start, length: CHUNK }, owner);
    parts.push(Uint8Array.from(atob(out.data), (c) => c.charCodeAt(0)));
  }
  const blob = new Blob(parts, { type: asset.mime || 'image/png' });
  if (blob.size !== asset.size) throw new Error('Download hui image ka size library ke record se match nahi hua.');
  return blob;
}

export async function saveStudioAnimation(name, file, { target, layer = 'body', frameRate = 24 }) {
  const owner = uid();
  if (!owner) throw Error('Admin se sign in karna zaroori hai.');
  if (!file || file.size > MAX_ANIMATION_BYTES) throw Error('Animation JSON 4 MB ya usse chhoti honi chahiye.');
  const animation = animationData(JSON.parse(await file.text()));
  const blob = new Blob([JSON.stringify(animation)], { type: 'application/json' });
  const key = `assets/${await digest(blob)}`, id = crypto.randomUUID();
  await uploadFile(key, blob, owner);
  return (await apiCall('/api/studio-assets', { action: 'save', id, type: 'animation', name: name.trim().slice(0, 100) || file.name, key, size: blob.size, mime: 'application/json', target, layer, frameRate: Number(frameRate) }, owner)).asset;
}
export const loadStudioAnimation = async id => (await apiCall('/api/studio-assets', { action: 'animation', id }, uid())).animation;
