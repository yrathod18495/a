import manifest from '../public/12toons/characters.json' with { type: 'json' };
import { animationData, animationTarget, ANIMATION_LAYERS, MAX_ANIMATION_BYTES } from '../src/managed-animation.js';
import { services } from '../server/firebase-admin.js';
import { access, bodyOf, send, failure } from '../server/access.js';
import { configured, confirmAssets, readAssetText, signDownloads } from '../server/r2-storage.js';
import { kv } from '../server/rtdb.js';
import { AccessError } from '../server/security-policy.js';
import { cleanAssetMeta } from '../shared/studio-effects.js';

const idOK = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{12,80}$/.test(value);
const LIBRARY_CACHE_MS = 30_000;
let libraryCache = null;
const maintenanceEnabled = () => process.env.MAINTENANCE_MODE !== 'false';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Ye request sahi nahi hai. Page reload karke dobara try karein.' });
  try {
    const b = await bodyOf(req, 16_000), isAdminAction = ['save', 'delete'].includes(b.action);
    const who = await access(req, { write: isAdminAction, admin: isAdminAction });
    if (maintenanceEnabled() && !who.admin) throw new AccessError('maintenance', '12toons par abhi maintenance chal raha hai. Thodi der baad try karein.', 503);
    const store = kv(services());

    if (b.action === 'list') {
      // the library changes rarely and is read from the Realtime Database (no per-read charge); every server instance keeps it a short while
      if (!libraryCache || Date.now() - libraryCache.at > LIBRARY_CACHE_MS) {
        const assets = Object.values((await store.get('studioAssets')) || {}).filter((a) => a.enabled === true);
        assets.sort((a, z) => String(a.type).localeCompare(String(z.type)) || String(a.category || '').localeCompare(String(z.category || '')) || String(a.name).localeCompare(String(z.name)));
        libraryCache = { at: Date.now(), assets };
      }
      return send(res, 200, { assets: libraryCache.assets });
    }

    if (b.action === 'save') {
      const animation = b.type === 'animation';
      if (!idOK(b.id) || !['background', 'prop', 'effect', 'animation'].includes(b.type) || typeof b.name !== 'string' || !b.name.trim() || b.name.length > 100 ||
          typeof b.key !== 'string' || !/^assets\/[a-f0-9]{64}$/.test(b.key) || !Number.isSafeInteger(b.size) || b.size < 1 || b.size > (animation ? MAX_ANIMATION_BYTES : 40 * 1024 * 1024) ||
          typeof b.mime !== 'string' || (animation ? b.mime !== 'application/json' || !animationTarget(b.target, manifest) || !ANIMATION_LAYERS.includes(b.layer) || !Number.isFinite(b.frameRate) || b.frameRate < 1 || b.frameRate > 120 : !b.mime.startsWith('image/')))
        throw new AccessError('invalid_asset', 'Sahi asset aur character pose chunein.', 400);
      if (!configured()) throw new AccessError('storage_unavailable', 'Cloud storage abhi set nahi hai.', 503);
      await confirmAssets(who.uid, store, [{ hash: b.key.slice(7), size: b.size }]);   // the file must really be in R2 with this size
      let animationMeta = {};
      let imageMeta = {};
      if (!animation) { try { imageMeta = cleanAssetMeta(b.type, b); } catch (error) { throw new AccessError(error.code || 'invalid_asset', error.message, 400); } }
      if (animation) {
        let data; try { data = animationData(JSON.parse(await readAssetText(who.uid, b.key.slice(7)))); } catch { throw new AccessError('invalid_animation', 'Sahi DragonBones animation JSON file chunein.', 400); }
        animationMeta = { target: b.target, layer: b.layer, frameRate: b.frameRate, length: data.duration / b.frameRate };
      }
      const asset = { ...animationMeta, ...imageMeta, id: b.id, type: b.type, name: b.name.trim(), key: b.key, size: b.size, mime: b.mime, ownerUid: who.uid, enabled: true, updatedAt: new Date().toISOString() };
      await store.set(`studioAssets/${b.id}`, asset);
      libraryCache = null;
      return send(res, 200, { asset });
    }

    if (b.action === 'delete') {
      if (!idOK(b.id)) throw new AccessError('invalid_asset', 'Asset sahi nahi hai.', 400);
      const existing = await store.get(`studioAssets/${b.id}`);
      if (existing?.type === 'animation') await store.update(`studioAssets/${b.id}`, { enabled: false });
      else await store.remove(`studioAssets/${b.id}`);
      libraryCache = null;
      return send(res, 200, { ok: true });
    }

    if (b.action === 'animation') {
      if (!idOK(b.id)) throw new AccessError('invalid_asset', 'Animation sahi nahi hai.', 400);
      const asset = await store.get(`studioAssets/${b.id}`);
      // Retired clips remain readable by existing projects, but leave the library list.
      if (asset?.type !== 'animation' || asset.size > MAX_ANIMATION_BYTES) throw new AccessError('not_found', 'Animation nahi mili.', 404);
      return send(res, 200, { animation: { ...animationData(JSON.parse(await readAssetText(asset.ownerUid, asset.key.slice(7)))), _sourceFrameRate: asset.frameRate } });
    }

    if (b.action === 'get') {
      if (!idOK(b.id)) throw new AccessError('invalid_asset', 'Asset sahi nahi hai.', 400);
      const asset = await store.get(`studioAssets/${b.id}`);
      if (!asset?.enabled) throw new AccessError('not_found', 'Asset nahi mila.', 404);
      // the browser downloads the file straight from R2 with this short-lived link
      const hash = asset.key.slice(7), urls = await signDownloads(asset.ownerUid, [hash]);
      return send(res, 200, { url: urls[hash], size: asset.size, type: asset.mime });
    }

    throw new AccessError('unknown_action', 'Ye asset action pehchana nahi gaya.', 400);
  } catch (error) { return failure(res, error); }
}
