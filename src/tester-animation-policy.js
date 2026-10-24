const has = (map, scope, id) => { const ids = map instanceof Map ? map.get(scope) : map?.[scope]; return ids instanceof Set ? ids.has(id) : !!ids?.some(value => String(value) === id); };
export function testerAnimationAllowed(grants, blocked, base, value) {
  const id = String(value);
  // A character-specific choice overrides the inherited global default.
  if (base && has(blocked, base, id)) return false;
  if (base && has(grants, base, id)) return true;
  return !has(blocked, '*', id) && has(grants, '*', id);
}
// Shared by single, category and preset controls. Both explicit Allow and None override the global default.
export function changeTesterAnimation(grants, blocked, scope, value, enabled) {
  const id = String(value);
  if (!grants.has(scope)) grants.set(scope, new Set());
  if (enabled) {
    grants.get(scope).add(id);
    for (const key of scope === '*' ? Object.keys(blocked) : [scope]) blocked[key] = (blocked[key] || []).filter(value => String(value) !== id);
  } else {
    for (const ids of scope === '*' ? grants.values() : [grants.get(scope)]) ids.delete(id);
    blocked[scope] = [...new Set([...(blocked[scope] || []), id])];
  }
  return true;
}
