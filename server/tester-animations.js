import { AccessError } from './security-policy.js';

function partMap(value, name) {
  let raw;
  try { raw = typeof value === 'string' ? JSON.parse(value) : (value ?? {}); }
  catch { throw new AccessError('invalid_parts', `${name}'s permissions are not valid.`, 400); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length > 256) throw new AccessError('invalid_parts', `${name}'s permissions are not valid.`, 400);
  const out = Object.create(null);
  for (const [scope, ids] of Object.entries(raw)) {
    if (!/^(\*|[a-zA-Z0-9_-]{1,128})$/.test(scope) || !Array.isArray(ids) || ids.length > 10000 || ids.some(id => typeof id !== 'string' || !id.length || id.length > 512)) throw new AccessError('invalid_parts', `${name}'s permissions are not valid.`, 400);
    if (ids.length) out[scope] = [...new Set(ids)];
  }
  return out;
}

export function testerAnimations(data = {}) {
  let raw;
  try { raw = typeof data.anims === 'string' ? JSON.parse(data.anims || '{}') : (data.anims || {}); }
  catch { throw new AccessError('invalid_animations', 'The animation permissions are not valid.', 400); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length > 256)
    throw new AccessError('invalid_animations', 'The animation permissions are not valid.', 400);
  const anims = Object.create(null);
  for (const [scope, ids] of Object.entries(raw)) {
    if (!/^(\*|[a-zA-Z0-9_-]{1,128})$/.test(scope) || !Array.isArray(ids) || ids.length > 10000 || ids.some(id => !['string', 'number'].includes(typeof id) || !String(id).length || String(id).length > 200))
      throw new AccessError('invalid_animations', 'The animation permissions are not valid.', 400);
    if (ids.length) anims[scope] = [...new Set(ids.map(String))];
  }
  const limit = Number(data.limit || 0);
  if (!Number.isInteger(limit) || limit < 0 || limit > 10000)
    throw new AccessError('invalid_limit', 'Please choose an animation limit between 0 and 10000.', 400);
  return { anims, limit, blockedAnims: partMap(data.blockedAnims, 'animation exclusion'), hiddenGroups: partMap(data.hiddenGroups, 'group'), blockedDownloads: partMap(data.blockedDownloads, 'download'), at: data.updatedAt || data.at || '', emails: [] };
}
