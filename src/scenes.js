import { GAP, LEAD, TAIL } from './player.js';

export function emptyScene(aspect = '16:9') {
  return { lines: [], speakers: [], order: [], fits: {}, cast: {}, shots: {}, script: {}, solo: {}, manual: {}, charKeys: {}, camKeys: [], aspect, bgId: null, bgPreset: 0, swaps: {}, props: [] };
}
export function sceneDuration(doc, audio) {
  const lines = (doc.lines || []).map(line => audio.get(line.id)).filter(Boolean);
  if (lines.length) return LEAD + lines.reduce((sum, line) => sum + line.buffer.duration, 0) + GAP * (lines.length - 1) + TAIL;
  const solo = Object.entries(doc.solo || {}).filter(([key, value]) => value?.bodyLen > 0 && (doc.speakers || []).some(speaker => speaker.key === key && speaker.charId)).map(([, value]) => value.bodyLen);
  let end = solo.length ? Math.max(1, ...solo) : 8;
  for (const clips of Object.values(doc.manual || {})) for (const clip of clips) end = Math.max(end, clip.start + clip.dur);
  for (const key of [...(doc.camKeys || []), ...Object.values(doc.charKeys || {}).flat()]) end = Math.max(end, key.t + .5);
  return Math.ceil(end * 100) / 100;
}
export function sequencePlan(scenes, audio) {
  let end = 0;
  return scenes.map(scene => { const start = end; end += sceneDuration(scene.doc, audio); return { ...scene, start, end }; });
}

export function uniqueSceneName(scenes, base = null) {
  const names = new Set(scenes.map(scene => scene.name));
  if (!base) { let number = 1; while (names.has(`Scene ${number}`)) number++; return `Scene ${number}`; }
  let name = base, number = 2;
  while (names.has(name)) name = `${base} ${number++}`;
  return name;
}
