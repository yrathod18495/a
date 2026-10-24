import { AccessError } from './security-policy.js';
export function validateManifest(manifest) {
 const bad=()=>{throw new AccessError('invalid_snapshot','Invalid project snapshot.',400);};
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

export function summarizeProjectSnapshot(manifest, limit = 1000) {
 const rows = manifest.records || [], project = rows.find(r => r.store === 'project' && r.value?.id === 'current')?.value;
 const lineInfo = new Map((Array.isArray(project?.lines) ? project.lines : []).filter(line => line?.id).map(line => [line.id, line]));
 const audio = rows.filter(r => r.store === 'audio' && r.value?.id);
 const files = audio.slice(0, limit).map(({ value }) => {
  const line = lineInfo.get(value.id) || {};
  return {
   id: String(value.id).slice(0, 128),
   filename: typeof line.file === 'string' ? line.file.slice(0, 240) : '',
   speaker: typeof line.speaker === 'string' ? line.speaker.slice(0, 120) : '',
   order: Number.isSafeInteger(line.order) ? line.order : null,
   available: !!value.raw?.__asset,
  };
 });
 return { audioCount: audio.length, audioFiles: files, audioFilesTruncated: audio.length > limit };
}
