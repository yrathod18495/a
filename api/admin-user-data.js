import { services } from '../server/firebase-admin.js';
import { access, bodyOf, send, failure } from '../server/access.js';
import { AccessError } from '../server/security-policy.js';
import { kv } from '../server/rtdb.js';

const validUid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{10,128}$/.test(value);
const validProjectId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Ye request sahi nahi hai. Page reload karke dobara try karein.' });
  try {
    const b = await bodyOf(req, 12000), who = await access(req, { admin: true }), store = kv(services());
    if (b.action !== 'userProjects' && b.action !== 'projectDetails') throw new AccessError('invalid_action', 'Ye action abhi supported nahi hai.', 400);
    if (!validUid(b.uid)) throw new AccessError('invalid_user', 'User sahi nahi hai. Dobara chunein.', 400);

    if (b.action === 'userProjects') {
      const rows = Object.entries((await store.get(`projects/${b.uid}`)) || {}).sort((x, y) => (y[1].updatedAt || 0) - (x[1].updatedAt || 0));
      return send(res, 200, {
        projects: rows.slice(0, 100).map(([id, row]) => ({ id, name: row.name || 'Untitled project', kind: row.kind || 'unknown', deleted: row.deleted === true, revision: Number(row.revision || 0), firstCloudSavedAt: row.firstCloudSavedAt || null, updatedAt: row.updatedAt || null, saveStatus: row.saveStatus || 'saved', audioCount: Number(row.summary?.audioCount || 0) })),
        hasMore: rows.length > 100,
      });
    }

    if (!validProjectId(b.projectId)) throw new AccessError('invalid_project', 'Project sahi nahi hai. Dobara chunein.', 400);
    const project = await store.get(`projects/${b.uid}/${b.projectId}`);
    if (!project) throw new AccessError('not_found', 'Ye project nahi mila.', 404);
    const summary = project.summary || {}, detail = { audioCount: Number(summary.audioCount || 0), audioFiles: summary.audioFiles || [], audioFilesTruncated: summary.audioFilesTruncated === true, snapshotAvailable: !project.deleted && !!project.stateOp };
    if (project.deleted) detail.snapshotMessage = 'This project is marked deleted; no current cloud snapshot is available.';
    else if (!project.stateOp) detail.snapshotMessage = 'This project has no saved cloud snapshot.';
    const history = (project.activity || []).slice().reverse().map((entry) => ({ id: entry.operationId, projectId: b.projectId, name: project.name || 'Untitled project', kind: project.kind || 'unknown', ...entry }));
    return send(res, 200, {
      project: { id: b.projectId, name: project.name || 'Untitled project', kind: project.kind || 'unknown', deleted: project.deleted === true, revision: Number(project.revision || 0), firstCloudSavedAt: project.firstCloudSavedAt || null, updatedAt: project.updatedAt || null, saveStatus: project.saveStatus || 'saved' },
      ...detail,
      history,
      historyHasMore: false,
    });
  } catch (error) { return failure(res, error); }
}
