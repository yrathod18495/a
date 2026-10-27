// Project index and saves. The index (name, revision, summary, last few saves) lives in the Realtime Database; the snapshot file itself is in R2
// (the browser uploads it with a signed URL first). A save is: sign -> upload -> commit, and the server never downloads the snapshot.
import { access, bodyOf, send, failure, maintenanceBlocks } from '../server/access.js';
import { services } from '../server/firebase-admin.js';
import { kv } from '../server/rtdb.js';
import { AccessError, nextRevision } from '../server/security-policy.js';
import { cleanSummary } from '../shared/project-summary.js';
import { confirmAssets, objectExists, deleteKey, stateKey, assetKey, getUrl, isHash, MAX_PROJECT_ASSETS } from '../server/r2-storage.js';
const idOK = v => typeof v === 'string' && /^[a-zA-Z0-9_-]{6,128}$/.test(v);
const KEEP_ACTIVITY = 10;
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'This request is not valid. Please reload the page and try again.' });
  try {
    const b = await bodyOf(req, 400 * 1024), who = await access(req, { write: b.action === 'commit' || b.action === 'register', cache: true, admin: b.action === 'adminLookup' || b.action === 'adminCharacter' });
    if (await maintenanceBlocks(who)) throw new AccessError('maintenance', '12toons is under maintenance right now. Please try again shortly.', 503);
    const svc = services(), store = kv(svc), uid = who.uid;
    if (b.action === 'list') {
      const rows = (await store.get('projects/' + uid)) || {};
      const projects = await Promise.all(Object.entries(rows).map(async ([id, p]) => {
        const { activity, ...row } = p;
        return { id, ...row, stateUrl: !p.deleted && p.stateOp ? await getUrl(stateKey(uid, id, p.stateOp)) : null };
      }));
      return send(res, 200, { projects });
    }
    if (b.action === 'register') {
      // claims the short ID the instant a project is created, well before its first real cloud save — so support can find it (owner, kind)
      // even mid-edit; commit() below re-claims the same entry on every save, which is harmless (same uid, same value)
      if (!idOK(b.id) || !['animation', 'character'].includes(b.kind)) throw new AccessError('invalid_project', 'The project details are not valid.', 400);
      const claim = await store.transact(`projectIndex/${b.id}`, (seen) => (seen && seen.uid !== uid) ? undefined : { uid, kind: b.kind });
      if (!claim.committed) throw new AccessError('id_taken', 'This project ID already belongs to another account. Please create the project again.', 409);
      return send(res, 200, { ok: true });
    }
    if (b.action === 'adminLookup') {
      if (!idOK(b.id)) throw new AccessError('invalid_project', 'The project ID is not valid.', 400);
      const owner = await store.get(`projectIndex/${b.id}`);
      if (!owner) return send(res, 200, { found: false });
      const account = (await svc.db.doc('securityUsers/' + owner.uid).get()).data() || {};
      const row = await store.get(`projects/${owner.uid}/${b.id}`);
      if (!row) return send(res, 200, { found: true, pending: true, id: b.id, kind: owner.kind, owner: { uid: owner.uid, email: account.email || '', name: account.name || '' } });
      const { activity, ...project } = row;
      return send(res, 200, { found: true, id: b.id, owner: { uid: owner.uid, email: account.email || '', name: account.name || '' }, project, activity: activity || [] });
    }
    if (b.action === 'adminCharacter') {
      // the admin opens a tester's saved character: signed links to its manifest and to the pictures that manifest lists (the tester's own files)
      if (!/^[A-Za-z0-9_-]{4,64}$/.test(String(b.id || ''))) throw new AccessError('invalid_character', 'The character information is not valid.', 400);
      const row = (await svc.db.doc('testerCharacters/' + b.id).get()).data();
      if (!row?.ownerUid) return send(res, 200, { found: false });
      const pid = ('char_' + b.id).padEnd(16, '_'), project = await store.get(`projects/${row.ownerUid}/${pid}`);
      if (!project || project.deleted || !project.stateOp) return send(res, 200, { found: true, saved: false });
      const hashes = [...new Set(Array.isArray(b.hashes) ? b.hashes : [])];
      if (hashes.length > MAX_PROJECT_ASSETS || !hashes.every(isHash)) throw new AccessError('invalid_asset', 'The asset is not valid.', 400);
      const urls = Object.fromEntries(await Promise.all(hashes.map(async (hash) => [hash, await getUrl(assetKey(row.ownerUid, hash))])));
      return send(res, 200, { found: true, saved: true, stateUrl: await getUrl(stateKey(row.ownerUid, pid, project.stateOp)), urls });
    }
    if (!idOK(b.id)) throw new AccessError('invalid_project', 'This project is not valid. Please choose again.', 400);
    if (b.action === 'commit') {
      if (!idOK(b.operationId) || !Number.isSafeInteger(b.expected) || b.expected < 0 || !['animation', 'character'].includes(b.kind) || typeof b.name !== 'string' || !b.name.trim() || b.name.length > 120)
        throw new AccessError('invalid_project', 'The project details are not valid.', 400);
      const path = `projects/${uid}/${b.id}`, name = b.name.trim(), deleted = !!b.deleted;
      const current = await store.get(path);
      if (current?.operationId === b.operationId) return send(res, 200, { revision: current.revision });
      nextRevision(current, b.expected, b.operationId);                      // conflict is answered before any R2 work
      // the project id is short enough for a person to read aloud, so it must stay unique across every account, not just this one
      const claim = await store.transact(`projectIndex/${b.id}`, (seen) => (seen && seen.uid !== uid) ? undefined : { uid, kind: b.kind });
      if (!claim.committed) throw new AccessError('id_taken', 'This project ID already belongs to another account. Please create the project again.', 409);
      const assets = Array.isArray(b.assets) ? b.assets : [];
      if (!deleted) {
        if (assets.length > MAX_PROJECT_ASSETS || !assets.every((a) => isHash(a?.hash))) throw new AccessError('invalid_asset', 'The asset is not valid.', 400);
        if (!(await objectExists(stateKey(uid, b.id, b.operationId))).exists) throw new AccessError('incomplete_upload', 'The project snapshot upload did not finish. Please try again.', 409);
        await confirmAssets(uid, store, assets);
      }
      const summary = deleted ? cleanSummary(null) : cleanSummary(b.summary), now = Date.now();
      let previousOp = null, revision = null;
      const out = await store.transact(path, (seen) => {
        const old = seen ?? current;       // the real database may call this once with null as a first guess; the value read above is the better guess
        if (old?.operationId === b.operationId) { revision = old.revision; return undefined; }
        revision = nextRevision(old, b.expected, b.operationId); previousOp = old?.stateOp || null;
        const entry = { operationId: b.operationId, action: deleted ? 'deleted' : !old ? 'first_cloud_save' : 'saved', revision, at: now, audioCount: summary.audioCount };
        return {
          owner: uid, kind: b.kind, name, deleted, revision, operationId: b.operationId, stateOp: deleted ? null : b.operationId,
          firstCloudSavedAt: old?.firstCloudSavedAt || now, updatedAt: now, saveStatus: 'saved', summary,
          activity: [...(old?.activity || []), entry].slice(-KEEP_ACTIVITY),
        };
      });
      if (!out.committed && revision == null) throw new AccessError('conflict', 'The project has changed in the cloud. Keep your copy, or reload the cloud version.', 409);
      if (previousOp && previousOp !== (deleted ? null : b.operationId)) await deleteKey(stateKey(uid, b.id, previousOp));   // only the newest snapshot is kept
      if (deleted) await deleteKey(stateKey(uid, b.id, b.operationId));
      return send(res, 200, { revision });
    }
    throw new AccessError('unknown_action', 'This action was not recognized.', 400);
  } catch (e) { return failure(res, e); }
}
