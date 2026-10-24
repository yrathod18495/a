// What the admin decided about the layers of the Character Studio:
//   names:  { '<character>' | '*': { 'slot|key': 'Display name', '@Group': 'Display group name' } }
//   hidden: { '<character>' | '*': ['slot|key', ...] }   (not shown in the layer list for users; the picture itself stays on the character)
// Stored in Firestore config/layers (see cloud.js) and applied in charstudio.js.
import { loadLayerRules, cachedLayerRules } from './cloud.js';
import { hinglish, GROUPS } from './layernames.js';

let rules = { names: {}, hidden: {} };
export const setLayerRules = (r) => { rules = { names: (r && r.names) || {}, hidden: (r && r.hidden) || {} }; };
export const getLayerRules = () => rules;
export const layerId = (slot, key) => `${slot}|${key}`;
export const layerName = (base, slot, key, fallback) => { const id = layerId(slot, key); return (base && rules.names[base]?.[id]) || rules.names['*']?.[id] || hinglish(slot, key) || fallback; };
export const groupName = (base, group) => { const id = `@${group}`; return (base && rules.names[base]?.[id]) || rules.names['*']?.[id] || GROUPS[group] || group; };
export const layerHidden = (base, slot, key) => { const id = layerId(slot, key); return !!(rules.hidden['*']?.includes(id) || (base && rules.hidden[base]?.includes(id))); };

/** cached copy first, then the published one (waits at most 2.5 s) */
export async function refreshLayerRules() {
  setLayerRules(cachedLayerRules());
  try { const r = await Promise.race([loadLayerRules(), new Promise((res) => setTimeout(() => res(null), 2500))]); if (r) setLayerRules(r); } catch { /* keep the cached rules */ }
}
