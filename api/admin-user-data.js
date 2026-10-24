import { objectHead, readObject } from '../server/r2-storage.js';
import { services } from '../server/firebase-admin.js';
import { access, bodyOf, send, failure } from '../server/access.js';
import { AccessError } from '../server/security-policy.js';
import { summarizeProjectSnapshot, validateManifest } from '../server/project-manifest.js';

const validUid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{10,128}$/.test(value);
const validProjectId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
const MAX_SNAPSHOT_PREVIEW = 8 * 1024 * 1024;

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST required' });
  try {
    const b = await bodyOf(req, 12000), who = await access(req, { admin: true }), { db } = services();
    if (b.action !== 'userProjects' && b.action !== 'projectDetails') throw new AccessError('invalid_action', 'Unsupported user data action.', 400);
    if (!validUid(b.uid)) throw new AccessError('invalid_user', 'Invalid user.', 400);

    if (b.action === 'userProjects') {
      const snap = await db.collection(`workspaces/${b.uid}/projects`).orderBy('updatedAt', 'desc').limit(100).get();
      return send(res, 200, {
        projects: snap.docs.map(doc => {
          const row = doc.data();
          return { id: doc.id, name: row.name || 'Untitled project', kind: row.kind || 'unknown', deleted: row.deleted === true, revision: Number(row.revision || 0), firstCloudSavedAt: row.firstCloudSavedAt || doc.createTime?.toMillis?.() || null, updatedAt: row.updatedAt || doc.updateTime?.toMillis?.() || null };
        }),
        hasMore: snap.docs.length === 100,
      });
    }

    if (!validProjectId(b.projectId)) throw new AccessError('invalid_project', 'Invalid project.', 400);
    const projectRef = db.doc(`workspaces/${b.uid}/projects/${b.projectId}`), projectSnap = await projectRef.get();
    if (!projectSnap.exists) throw new AccessError('not_found', 'Project not found.', 404);
    const project = projectSnap.data(), detail = { audioCount: 0, audioFiles: [], audioFilesTruncated: false, snapshotAvailable: false };
    if (project.deleted) detail.snapshotMessage = 'This project is marked deleted; no current cloud snapshot is available.';
    if (!project.deleted && typeof project.stateKey === 'string' && new RegExp(`^projects/${b.projectId}/snapshots/[A-Za-z0-9_-]+$`).test(project.stateKey)) {
      try {
        const head = await objectHead(b.uid, project.stateKey);
        if (head.exists && head.size <= MAX_SNAPSHOT_PREVIEW) {
          const state = await readObject(b.uid, project.stateKey);
          const manifest = JSON.parse(state.toString('utf8'));
          validateManifest(manifest);
          Object.assign(detail, summarizeProjectSnapshot(manifest), { snapshotAvailable: true });
        } else detail.snapshotMessage = head.exists ? 'Project snapshot exceeds the preview size limit.' : 'Project snapshot is no longer available in cloud storage.';
      } catch (error) {
        detail.snapshotMessage = error.status ? error.message : 'Could not read this cloud project snapshot.';
      }
    } else if (!project.deleted) detail.snapshotMessage = 'This project has no saved cloud snapshot.';

    const activitySnap = await projectRef.collection('activity').orderBy('at', 'desc').limit(50).get();
    const history = activitySnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return send(res, 200, {
      project: { id: b.projectId, name: project.name || 'Untitled project', kind: project.kind || 'unknown', deleted: project.deleted === true, revision: Number(project.revision || 0), firstCloudSavedAt: project.firstCloudSavedAt || projectSnap.createTime?.toMillis?.() || null, updatedAt: project.updatedAt || projectSnap.updateTime?.toMillis?.() || null },
      ...detail,
      history,
      historyHasMore: history.length === 50,
    });
  } catch (error) { return failure(res, error); }
}
