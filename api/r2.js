// Every file request validates the current Firebase session. The browser talks to R2 itself, but only with short-lived signed URLs made here.
import { access, bodyOf, send, failure } from '../server/access.js';
import { services } from '../server/firebase-admin.js';
import { kv } from '../server/rtdb.js';
import { configured, signUploads, confirmAssets, signDownloads } from '../server/r2-storage.js';
const maintenanceEnabled = () => process.env.MAINTENANCE_MODE !== 'false';
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Ye request sahi nahi hai. Page reload karke dobara try karein.' });
  try {
    const b = await bodyOf(req, 200 * 1024);
    if (b.action === 'status') return send(res, 200, { configured: configured() });
    if (!configured()) return send(res, 503, { error: 'Server par cloud storage (R2) abhi set nahi hai.' });
    const write = ['sign', 'confirm'].includes(b.action);
    const who = await access(req, { write }), { uid } = who;
    if (maintenanceEnabled() && !who.admin) return send(res, 503, { code: 'maintenance', error: '12toons par abhi maintenance chal raha hai. Thodi der baad try karein.' });
    if (b.action === 'sign') return send(res, 200, await signUploads(uid, kv(services()), { items: b.items || [], state: b.state || null }));
    if (b.action === 'confirm') return send(res, 200, await confirmAssets(uid, kv(services()), b.items || []));
    if (b.action === 'urls') return send(res, 200, { urls: await signDownloads(uid, b.hashes || []) });
    return send(res, 400, { error: 'Ye file action supported nahi hai. Is browser tab ko reload karein.' });
  } catch (e) { return failure(res, e); }
}
