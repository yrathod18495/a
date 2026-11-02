// How the voice lines (and the music) are mixed. The live player and the video export both use this, so what you hear in the editor is what ends up in the video.

/** a line is heard unless it is muted; when any line is on solo, only the solo lines are heard */
export const audibleClips = (clips) => { const solo = clips.some((c) => c.solo); return clips.filter((c) => !c.muted && (!solo || c.solo)); };

/**
 * The volume curve of one clip as breakpoints [seconds into the clip, gain], starting at `from` (where playback starts inside the clip).
 * `volume` is the line's level (1 = unchanged), the fades go from silence up to it / from it down to silence at the end of the clip.
 */
export function envelopePoints({ volume = 1, fadeIn = 0, fadeOut = 0, length }, from = 0) {
  const v = Math.max(0, volume), len = Math.max(0.01, length);
  let fi = Math.max(0, Math.min(fadeIn, len)), fo = Math.max(0, Math.min(fadeOut, len));
  if (fi + fo > len) { const k = len / (fi + fo); fi *= k; fo *= k; }          // the two fades never overlap
  const at = (x) => v * (fi > 0 ? Math.min(1, x / fi) : 1) * (fo > 0 ? Math.min(1, (len - x) / fo) : 1);
  const pts = [[from, at(from)]];
  if (fi > from) pts.push([fi, v]);
  if (fo > 0 && len - fo > Math.max(from, fi)) pts.push([len - fo, v]);
  pts.push([len, fo > 0 ? 0 : v]);
  return pts;
}
/** put the curve on a GainNode: `when` is the context time at which `from` seconds of the clip are played */
export function applyEnvelope(gainNode, clip, when, from = 0) {
  const pts = envelopePoints({ volume: clip.volume, fadeIn: clip.fadeIn, fadeOut: clip.fadeOut, length: clip.length ?? clip.end - clip.start }, from);
  const t = (x) => when + (x - from);
  gainNode.gain.setValueAtTime(pts[0][1], when);
  for (const [x, v] of pts.slice(1)) gainNode.gain.linearRampToValueAtTime(v, Math.max(when, t(x)));
}
/** connect a decoded line to `outputs` through its own volume / fade, and start it; returns the source (to stop it) */
export function playClip(ctx, clip, outputs, when, offset) {
  const src = ctx.createBufferSource(), gain = ctx.createGain();
  src.buffer = clip.buffer; src.connect(gain); for (const o of [].concat(outputs)) gain.connect(o);
  applyEnvelope(gain, clip, when, offset);
  const left = Math.max(0.01, clip.end - clip.start - offset);
  if (clip.loop && clip.buffer.duration > 0) {                // background music: repeats until the clip ends
    src.loop = true; src.loopStart = 0; src.loopEnd = clip.buffer.duration;
    src.start(when, ((clip.trimStart || 0) + offset) % clip.buffer.duration); src.stop(when + left);
  } else src.start(when, (clip.trimStart || 0) + offset, left);
  return src;
}
