import { GAP, LEAD, TAIL } from './player.js';
import { contentLength } from '../shared/timeline-edit.js';

export function emptyScene(aspect = '16:9') {
  return { lines: [], speakers: [], order: [], fits: {}, cast: {}, shots: {}, script: {}, solo: {}, manual: {}, charKeys: {}, paths: {}, camKeys: [], aspect, bgId: null, bgPreset: 0, bgClips: [], props: [] };
}
/** the length of one audio line after the creator trimmed its start and end on the timeline */
export const lineLength = (buffer, meta = {}) => Math.max(0.2, buffer.duration - (meta.trimStart || 0) - (meta.trimEnd || 0));
export function sceneDuration(doc, audio) {
  const lines = (doc.lines || []).filter(line => audio.get(line.id));
  if (lines.length) return LEAD + lines.reduce((sum, line) => sum + lineLength(audio.get(line.id).buffer, line), 0) + GAP * (lines.length - 1) + TAIL;
  return contentLength(doc);
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
