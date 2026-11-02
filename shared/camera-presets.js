// One-click camera moves. Each preset turns into a few camera keyframes {t, zoom, cx, cy, ease} (cx / cy are 0..1 of the canvas).
// `from` is where the camera is at the start (the playhead) and `to` where it would be at the end if nothing were added, so a shake can hand the camera back.
export const SHAKE = { small: { zoom: 1.04, amp: 0.006 }, medium: { zoom: 1.08, amp: 0.014 }, strong: { zoom: 1.12, amp: 0.026 } };
export const PRESETS = { 'zoom-in': 'Slow zoom in', 'zoom-out': 'Slow zoom out', 'pan-left': 'Pan left', 'pan-right': 'Pan right', 'pan-up': 'Pan up', 'pan-down': 'Pan down', shake: 'Shake' };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), r4 = (v) => +v.toFixed(4);
const rand = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

export function presetKeys(kind, { t, dur, from, to = from, strength = 'medium', seed = 1 }) {
  const t1 = +(t + dur).toFixed(2), key = (time, state, ease = 'smooth') => ({ t: +time.toFixed(2), zoom: r4(clamp(state.zoom, 1, 6)), cx: r4(clamp(state.cx, 0, 1)), cy: r4(clamp(state.cy, 0, 1)), ease });
  if (kind === 'zoom-in') return [key(t, from), key(t1, { ...from, zoom: from.zoom * 1.35 })];
  if (kind === 'zoom-out') return [key(t, from), key(t1, { ...from, zoom: Math.max(1, from.zoom / 1.35) })];
  if (kind.startsWith('pan-')) {
    const z = Math.max(from.zoom, 1.4), half = 0.5 / z, lo = half, hi = 1 - half, side = kind.slice(4);          // at this zoom the camera can travel from `lo` to `hi` without leaving the picture
    const horizontal = side === 'left' || side === 'right', forward = side === 'right' || side === 'down';
    const a = forward ? lo : hi, b = forward ? hi : lo;
    return horizontal ? [key(t, { zoom: z, cx: a, cy: from.cy }), key(t1, { zoom: z, cx: b, cy: from.cy })] : [key(t, { zoom: z, cx: from.cx, cy: a }), key(t1, { zoom: z, cx: from.cx, cy: b })];
  }
  if (kind === 'shake') {
    const s = SHAKE[strength] || SHAKE.medium, n = Math.max(2, Math.round(dur * 14)), r = rand(seed), keys = [key(t, from)];
    for (let i = 1; i < n; i++) keys.push(key(t + (dur * i) / n, { zoom: from.zoom * s.zoom, cx: from.cx + (r() * 2 - 1) * s.amp, cy: from.cy + (r() * 2 - 1) * s.amp }, 'linear'));
    keys.push(key(t1, to));                                // the camera goes back to what it was doing
    return keys;
  }
  throw new Error('Unknown camera preset');
}
/** the camera keys of the scene after a preset was applied between its first and last key: keys inside that time are replaced */
export function withPreset(existing, newKeys) {
  const a = newKeys[0].t, b = newKeys.at(-1).t;
  return [...existing.filter((k) => k.t < a - 1e-6 || k.t > b + 1e-6), ...newKeys];
}
