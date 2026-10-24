// Timeline editing maths shared by the studio, the scene lengths and the tests. Everything is in seconds.
export const MIN_CLIP = 0.2, STEP = 0.05, EMPTY_SCENE = 8, MIN_SCENE = 1;
export const snap = (value, step = STEP) => +(Math.round(value / step) * step).toFixed(2);

/**
 * Drag one clip: 'move' shifts it, 'right' makes it longer / shorter, 'left' trims its head (the clip starts later and `off`, the part of
 * the media that is skipped, grows). `room` is how far the head may be pulled back out: an animation can go back to its own beginning (`off`),
 * a background or a prop range as far as 0 (Infinity).
 */
export function resizeClip({ mode, start, dur, off = 0, delta, min = MIN_CLIP, room = off }) {
  if (mode === 'move') return { start: Math.max(0, snap(start + delta)), dur, off };
  if (mode === 'right') return { start, dur: Math.max(min, snap(dur + delta)), off };
  let next = snap(start + delta);
  next = Math.min(next, start + dur - min);        // keep a minimum length
  next = Math.max(next, 0, start - room);          // not before 0, not further back than the media allows
  const used = +(next - start).toFixed(2);
  return { start: next, dur: +(dur - used).toFixed(2), off: Number.isFinite(off) ? +Math.max(0, off + used).toFixed(2) : off };
}

/**
 * How long a scene without audio is. Clips that have a length (an animation picked for a character, animation clips, background clips,
 * a prop / effect with an end time) decide it; with none of those it is an empty 8 s scene. Movement and camera keys can only stretch it.
 */
export function contentLength(doc) {
  const ends = [];
  for (const [key, value] of Object.entries(doc.solo || {})) if (value?.bodyLen > 0 && (doc.speakers || []).some((speaker) => speaker.key === key && speaker.charId)) ends.push(Math.max(MIN_SCENE, value.bodyLen));
  for (const clips of Object.values(doc.manual || {})) for (const clip of clips) ends.push(clip.start + clip.dur);
  for (const clip of doc.bgClips || []) ends.push(clip.start + clip.dur);
  for (const prop of doc.props || []) if (prop.end != null) ends.push(prop.end);
  let end = ends.length ? Math.max(...ends) : EMPTY_SCENE;
  for (const key of [...(doc.camKeys || []), ...Object.values(doc.charKeys || {}).flat()]) end = Math.max(end, key.t + 0.5);
  return Math.ceil(Math.max(MIN_SCENE, end) * 100) / 100;
}
