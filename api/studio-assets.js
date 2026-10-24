import manifest from '../public/12toons/characters.json' with { type: 'json' };
import { animationData, animationTarget, ANIMATION_LAYERS, MAX_ANIMATION_BYTES } from '../src/managed-animation.js';
import { services } from '../server/firebase-admin.js';
import { access, bodyOf, send, failure } from '../server/access.js';
import { configured, objectHead, readRange, readObject, CHUNK_SIZE } from '../server/r2-storage.js';
import { AccessError } from '../server/security-policy.js';

const idOK = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{12,80}$/.test(value);
const maintenanceEnabled = () => process.env.MAINTENANCE_MODE !== 'false';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST required' });
  try {
    const b = await bodyOf(req, 16_000), isAdminAction = ['save', 'delete'].includes(b.action);
    const who = await access(req, { write: isAdminAction, admin: isAdminAction });
    if (maintenanceEnabled() && !who.admin) throw new AccessError('maintenance', '12toons is temporarily under maintenance.', 503);
    const { db } = services(), col = db.collection('studioAssets');

    if (b.action === 'list') {
      const snap = await col.get();
      const assets = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((a) => a.enabled === true);
      assets.sort((a, z) => String(a.type).localeCompare(String(z.type)) || String(a.name).localeCompare(String(z.name)));
      return send(res, 200, { assets });
    }

    if (b.action === 'save') {
      const animation = b.type === 'animation';
      if (!idOK(b.id) || !['background', 'prop', 'animation'].includes(b.type) || typeof b.name !== 'string' || !b.name.trim() || b.name.length > 100 ||
          typeof b.key !== 'string' || !/^assets\/[a-f0-9]{64}$/.test(b.key) || !Number.isSafeInteger(b.size) || b.size < 1 || b.size > (animation ? MAX_ANIMATION_BYTES : 40 * 1024 * 1024) ||
          typeof b.mime !== 'string' || (animation ? b.mime !== 'application/json' || !animationTarget(b.target, manifest) || !ANIMATION_LAYERS.includes(b.layer) || !Number.isFinite(b.frameRate) || b.frameRate < 1 || b.frameRate > 120 : !b.mime.startsWith('image/')))
        throw new AccessError('invalid_asset', 'Choose a valid asset and character pose.', 400);
      if (!configured()) throw new AccessError('storage_unavailable', 'Cloud storage is not configured.', 503);
      const head = await objectHead(who.uid, b.key);
      if (!head.exists || head.size !== b.size || head.digest !== b.key.slice(7)) throw new AccessError('incomplete_upload', 'The image upload could not be verified.', 409);
      let animationMeta = {};
      if (animation) {
        let data; try { data = animationData(JSON.parse((await readObject(who.uid, b.key)).toString('utf8'))); } catch { throw new AccessError('invalid_animation', 'Choose valid DragonBones animation JSON.', 400); }
        animationMeta = { target: b.target, layer: b.layer, frameRate: b.frameRate, length: data.duration / b.frameRate };
      }
      const asset = { ...animationMeta, id: b.id, type: b.type, name: b.name.trim(), key: b.key, size: b.size, mime: b.mime, ownerUid: who.uid, enabled: true, updatedAt: new Date().toISOString() };
      await col.doc(b.id).set(asset);
      return send(res, 200, { asset });
    }

    if (b.action === 'delete') {
      if (!idOK(b.id)) throw new AccessError('invalid_asset', 'Invalid asset.', 400);
      const ref = col.doc(b.id), existing = (await ref.get()).data();
      if (existing?.type === 'animation') await ref.set({ enabled: false }, { merge: true });
      else await ref.delete();
      return send(res, 200, { ok: true });
    }

    if (b.action === 'animation') {
      if (!idOK(b.id)) throw new AccessError('invalid_asset', 'Invalid animation.', 400);
      const asset = (await col.doc(b.id).get()).data();
      // Retired clips remain readable by existing projects, but leave the library list.
      if (asset?.type !== 'animation' || asset.size > MAX_ANIMATION_BYTES) throw new AccessError('not_found', 'Animation not found.', 404);
      return send(res, 200, { animation: { ...animationData(JSON.parse((await readObject(asset.ownerUid, asset.key)).toString('utf8'))), _sourceFrameRate: asset.frameRate } });
    }

    if (b.action === 'get') {
      if (!idOK(b.id)) throw new AccessError('invalid_asset', 'Invalid asset.', 400);
      const snap = await col.doc(b.id).get(), asset = snap.data();
      if (!asset?.enabled) throw new AccessError('not_found', 'Asset not found.', 404);
      const start = b.start ?? 0, length = b.length ?? CHUNK_SIZE;
      if (!Number.isSafeInteger(length) || length > CHUNK_SIZE) throw new AccessError('invalid_range', 'Invalid image range.', 400);
      return send(res, 200, await readRange(asset.ownerUid, asset.key, start, length));
    }

    throw new AccessError('unknown_action', 'Unknown asset action.', 400);
  } catch (error) { return failure(res, error); }
}
