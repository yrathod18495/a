// Which studio tools are on for normal users (set by the admin, see shared/studio-tools.js). A normal user does not see a tool that is off; an admin still sees it, lighter.
let flags = {}, admin = false;
const listeners = new Set();
/** `features`: the server's feature switches (only `tool_*` keys matter here); `isAdmin`: leave out to keep the last value */
export function setToolFlags(features, isAdmin) {
  const next = {}; for (const [k, v] of Object.entries(features || {})) if (k.startsWith('tool_')) next[k.slice(5)] = v !== false;
  const same = JSON.stringify(next) === JSON.stringify(flags) && (isAdmin === undefined || !!isAdmin === admin);
  flags = next; if (isAdmin !== undefined) admin = !!isAdmin;
  if (!same) for (const f of listeners) { try { f(); } catch (e) { console.warn('tool switch listener failed', e); } }
}
export const toolOn = (key) => flags[key] !== false;
/** shown in the tool bar: on for everybody, or off but this is an admin */
export const toolShown = (key) => toolOn(key) || admin;
/** an admin sees it, but normal users do not (it is drawn lighter) */
export const toolOffForUsers = (key) => admin && !toolOn(key);
export const toolFlagsAsFeatures = () => Object.fromEntries(Object.entries(flags).map(([k, v]) => [`tool_${k}`, v]));
export const onToolsChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
