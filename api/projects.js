import { readObject, objectHead } from '../server/r2-storage.js';
import { services } from '../server/firebase-admin.js';
import { access, bodyOf, send, failure } from '../server/access.js';
import { AccessError, nextRevision, checkAccount, checkSession } from '../server/security-policy.js';
import { validateManifest, summarizeProjectSnapshot } from '../server/project-manifest.js';
const idOK = v => typeof v === 'string' && /^[a-zA-Z0-9_-]{16,128}$/.test(v);
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST required' });
  try {
    const b = await bodyOf(req), who = await access(req, { write: b.action === 'commit' }), { db } = services();
    if (process.env.MAINTENANCE_MODE !== 'false' && !who.admin) throw new AccessError('maintenance', '12toons is temporarily under maintenance.', 503);
    const col = db.collection('workspaces/' + who.uid + '/projects');
    if (b.action === 'list') {
      const snap = await col.get(); return send(res, 200, { projects: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
    }
    if (!idOK(b.id)) throw new AccessError('invalid_project', 'Invalid project.', 400);
    if (b.action === 'commit') {
      if (!idOK(b.operationId) || !Number.isSafeInteger(b.expected) || b.expected < 0 || !['animation', 'character'].includes(b.kind) || typeof b.name !== 'string' || !b.name.trim() || b.name.length > 120)
        throw new AccessError('invalid_project', 'Invalid project metadata.', 400);
      const ref = col.doc(b.id), current = await ref.get();
      if (current.data()?.operationId === b.operationId) return send(res, 200, { revision: current.data().revision });
      nextRevision(current.data(), b.expected, b.operationId);
      let snapshotSummary = { audioCount: 0, audioFiles: [], audioFilesTruncated: false };
      if (!b.deleted) {
        const pattern = new RegExp('^projects/' + b.id + '/snapshots/[a-zA-Z0-9_-]+$');
        if (typeof b.stateKey !== 'string' || !pattern.test(b.stateKey)) throw new AccessError('invalid_snapshot', 'Invalid snapshot path.', 400);
        const manifest = JSON.parse((await readObject(who.uid,b.stateKey)).toString('utf8'));
        for (const asset of validateManifest(manifest)) {
          if (!/^assets\/[a-f0-9]{64}$/.test(asset.key) || !Number.isSafeInteger(asset.size)) throw new AccessError('invalid_asset', 'Invalid asset.', 400);
          const head = await objectHead(who.uid,asset.key);
          if (!head.exists || head.size !== asset.size || head.digest !== asset.key.slice(7)) throw new AccessError('incomplete_upload', 'Asset upload incomplete.', 409);
        }
        snapshotSummary = summarizeProjectSnapshot(manifest);
      }
      const activityRef = ref.collection('activity').doc(b.operationId);
      const revision = await db.runTransaction(async tx => {
        const [old, user, session, priorActivity] = await tx.getAll(ref, db.doc('securityUsers/' + who.uid), db.doc('securitySessions/' + who.uid), activityRef);
        checkAccount(user.data(), Date.now(), true); checkSession(session.data(), who.claims.sid);
        const rev = nextRevision(old.data(), b.expected, b.operationId);
        if (old.data()?.operationId !== b.operationId) tx.set(ref, {
          owner: who.uid, kind: b.kind, name: b.name.trim(), deleted: !!b.deleted,
          revision: rev, operationId: b.operationId, stateKey: b.deleted ? null : b.stateKey,
          firstCloudSavedAt: old.data()?.firstCloudSavedAt || (!old.exists ? Date.now() : null), updatedAt: Date.now(), saveStatus: 'saved',
        });
        if (old.data()?.operationId !== b.operationId && !priorActivity.exists) tx.create(activityRef, {
          projectId: b.id, name: b.name.trim(), kind: b.kind,
          action: b.deleted ? 'deleted' : !old.exists ? 'first_cloud_save' : 'saved',
          revision: rev, at: Date.now(), audioCount: b.deleted ? 0 : snapshotSummary.audioCount,
          audioFiles: b.deleted ? [] : snapshotSummary.audioFiles,
          audioFilesTruncated: b.deleted ? false : snapshotSummary.audioFilesTruncated,
        });
        return rev;
      });
      return send(res, 200, { revision });
    }
    throw new AccessError('unknown_action', 'Unknown action.', 400);
  } catch (e) { return failure(res, e); }
}
