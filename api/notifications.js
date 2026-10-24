import { createHash } from 'node:crypto';
import { services } from '../server/firebase-admin.js';
import { access, bodyOf, send, failure } from '../server/access.js';
import { AccessError } from '../server/security-policy.js';

const tokenId = token => createHash('sha256').update(token).digest('hex');

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST required' });
  try {
    const b = await bodyOf(req, 12000);
    const who = await access(req, { write: true });
    const { db } = services();
    if (process.env.MAINTENANCE_MODE !== 'false' && !who.admin) throw new AccessError('maintenance', '12toons is temporarily under maintenance.', 503);

    if (b.action === 'register') {
      if (typeof b.token !== 'string' || b.token.length < 20 || b.token.length > 4096) throw new AccessError('invalid_token', 'Invalid notification registration.', 400);
      const id = tokenId(b.token), ref = db.collection('pushTokens').doc(id), now = Date.now();
      await ref.set({ uid: who.uid, token: b.token, updatedAt: now }, { merge: true });
      return send(res, 200, { enabled: true });
    }
    if (b.action === 'remove') {
      if (typeof b.token !== 'string' || b.token.length < 20 || b.token.length > 4096) throw new AccessError('invalid_token', 'Invalid notification registration.', 400);
      const ref = db.collection('pushTokens').doc(tokenId(b.token)), snapshot = await ref.get();
      if (snapshot.data()?.uid === who.uid) await ref.delete();
      return send(res, 200, { enabled: false });
    }
    throw new AccessError('invalid_action', 'Unsupported notification action.', 400);
  } catch (e) { return failure(res, e); }
}
