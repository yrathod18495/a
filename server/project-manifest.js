import { AccessError } from './security-policy.js';
export { summarizeProjectSnapshot } from '../shared/project-summary.js';
/** the snapshot is only read back by the owner's browser; this checks its shape when a tool wants to look inside (the server no longer reads it on every save) */
export function validateManifest(manifest) {
 const bad=()=>{throw new AccessError('invalid_snapshot','Project snapshot sahi nahi hai.',400);};
 const stores=new Set(['characters','animations','backgrounds','swaps','project','audio','draft']);
 if(manifest.version!==1||!Array.isArray(manifest.records)||!Array.isArray(manifest.assets)||manifest.assets.length>10000)bad();
 const assets=new Map();
 for(const a of manifest.assets){if(typeof a.key!=='string'||!/^assets\/[a-f0-9]{64}$/.test(a.key)||!Number.isSafeInteger(a.size)||a.size<0||assets.has(a.key))bad();assets.set(a.key,a);}
 function walk(v){
  if(!v||typeof v!=='object')return;
  if(v.__asset){if(!assets.has(v.__asset))bad();return;}
  for(const x of Object.values(v))walk(x);
 }
 const records=new Set();
 for(const r of manifest.records){
  if(!stores.has(r.store)||!r.value?.id||records.has(r.store+'/'+r.value.id))bad();
  records.add(r.store+'/'+r.value.id);walk(r.value);
 }
 return [...assets.values()];
}
