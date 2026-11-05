// Effects: ready-made looks (Night, Ghost, Blur ...) that the user lays on the timeline for a time range.
// An effect works on the whole scene (characters, props and background together) or on one picture (a character, a prop, the background).
// The numbers are shared by the studio panel, the preview thumbnails, the WebGL pass and the export, so what the user sees is what is exported.
import { GRADE_CONTROLS, DEFAULT_GRADE, hexToRgb } from './color-grade.js';

/** the controls that only effects have (the Colour tab keeps its own list) */
export const FX_EXTRA = [
  { group: 'Look', key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.01, neutral: 1, item: true },
  { group: 'Look', key: 'blur', label: 'Blur', min: 0, max: 1, step: 0.01, neutral: 0 },
  { group: 'Look', key: 'glow', label: 'Glow', min: 0, max: 1, step: 0.01, neutral: 0 },
  { group: 'Look', key: 'ghost', label: 'Ghost trail', min: 0, max: 1, step: 0.01, neutral: 0 },
  { group: 'Look', key: 'ghostShift', label: 'Ghost distance', min: -1, max: 1, step: 0.01, neutral: 0.3 },
  { group: 'Look', key: 'pixelate', label: 'Pixelate', min: 0, max: 1, step: 0.01, neutral: 0 },
  { group: 'Look', key: 'split', label: 'Colour split', min: 0, max: 1, step: 0.01, neutral: 0 },
];
/** every control, in the order of the edit panel */
export const FX_CONTROLS = [
  ...FX_EXTRA.filter((c) => c.group === 'Look'),
  ...GRADE_CONTROLS.map((c) => (c.group === 'Basic' ? { ...c, group: 'Light' } : c)),
];
export const FX_GROUPS = ['Look', 'Light', 'Colour', 'Tone', 'Finish'];
export const DEFAULT_FX = { ...Object.fromEntries(FX_CONTROLS.map((c) => [c.key, c.neutral])), tint: '#ffffff' };
// a value of "ghostShift" only matters while ghost > 0, so it is not part of "does this change the picture"
const NEUTRAL_ONLY = new Set(['ghostShift']);
const HEX = /^#[0-9a-f]{6}$/i;
/** a safe set of numbers: unknown keys dropped, numbers clamped, missing ones neutral */
export function cleanFx(input) {
  const out = { ...DEFAULT_FX };
  if (!input || typeof input !== 'object') return out;
  for (const c of FX_CONTROLS) { const v = Number(input[c.key]); if (Number.isFinite(v)) out[c.key] = Math.min(c.max, Math.max(c.min, v)); }
  if (typeof input.tint === 'string' && HEX.test(input.tint)) out.tint = input.tint.toLowerCase();
  return out;
}
/** does this change the picture at all? */
export const fxActive = (p) => !!p && FX_CONTROLS.some((c) => !NEUTRAL_ONLY.has(c.key) && Math.abs((Number(p[c.key] ?? c.neutral)) - c.neutral) > 1e-4);

export const FX_TARGETS = Object.freeze(['scene', 'char', 'prop', 'bg']);
/** 'scene' | 'char:<key>' | 'prop:<id>' | 'bg' */
export const targetOf = (fx) => String(fx?.target || 'scene');
export const targetKind = (target) => String(target || 'scene').split(':')[0];
export const targetId = (target) => String(target || '').split(':').slice(1).join(':');

/** the ready-made looks. Each lists only what it changes. */
export const FX_TEMPLATES = Object.freeze([
  { id: 'night', name: 'Night', group: 'Mood', dot: '#2b3a78', params: { brightness: 0.7, exposure: -0.4, temperature: -45, tintAmount: 0.3, tint: '#4d6bff', saturation: 0.8, vignette: 0.4 } },
  { id: 'evening', name: 'Evening', group: 'Mood', dot: '#f08a4b', params: { brightness: 0.92, temperature: 38, tintAmount: 0.3, tint: '#ff9a5a', saturation: 1.1, contrast: 0.08, vignette: 0.2 } },
  { id: 'dawn', name: 'Dawn', group: 'Mood', dot: '#f3b6c8', params: { brightness: 1.04, temperature: 12, tintAmount: 0.22, tint: '#ffb7d0', fade: 0.08, glow: 0.12 } },
  { id: 'gloomy', name: 'Gloomy', group: 'Mood', dot: '#6c7a88', params: { brightness: 0.85, saturation: 0.55, contrast: 0.1, tintAmount: 0.2, tint: '#8aa0b4', vignette: 0.3 } },
  { id: 'warm', name: 'Warm sunset', group: 'Colour', dot: '#ffb86b', params: { temperature: 35, tintAmount: 0.15, tint: '#ffb86b', saturation: 1.1, contrast: 0.08 } },
  { id: 'cool', name: 'Cool morning', group: 'Colour', dot: '#9cc8ff', params: { temperature: -35, tintAmount: 0.12, tint: '#9cc8ff', brightness: 1.05 } },
  { id: 'vintage', name: 'Vintage', group: 'Colour', dot: '#e8c48a', params: { saturation: 0.75, fade: 0.25, temperature: 20, tintAmount: 0.18, tint: '#e8c48a', vignette: 0.3, grain: 0.25 } },
  { id: 'sepia', name: 'Sepia', group: 'Colour', dot: '#c8935a', params: { saturation: 0.25, tintAmount: 0.55, tint: '#c8935a', contrast: 0.1 } },
  { id: 'noir', name: 'Black & white', group: 'Colour', dot: '#8b8f9a', params: { saturation: 0, contrast: 0.25, vignette: 0.3, grain: 0.12 } },
  { id: 'vivid', name: 'Vivid pop', group: 'Colour', dot: '#ff5fa2', params: { saturation: 1.35, vibrance: 0.3, contrast: 0.15, sharpen: 0.3 } },
  { id: 'dream', name: 'Dreamy glow', group: 'Style', dot: '#ffc6e8', params: { brightness: 1.08, contrast: -0.12, fade: 0.15, glow: 0.55, blur: 0.08, tintAmount: 0.1, tint: '#ffc6e8' } },
  { id: 'blur', name: 'Blurry', group: 'Style', dot: '#a9b4c4', params: { blur: 0.5 } },
  { id: 'ghost', name: 'Ghost', group: 'Style', dot: '#cfe8ff', params: { opacity: 0.6, ghost: 0.7, ghostShift: 0.35, saturation: 0.4, brightness: 1.1, glow: 0.3, tintAmount: 0.15, tint: '#bfe0ff' } },
  { id: 'glow', name: 'Neon glow', group: 'Style', dot: '#7cf7ff', params: { glow: 0.85, saturation: 1.3, contrast: 0.1, brightness: 1.05 } },
  { id: 'glitch', name: 'Glitch', group: 'Fun', dot: '#ff3c6e', params: { split: 0.7, grain: 0.3, contrast: 0.15, sharpen: 0.4 } },
  { id: 'pixel', name: 'Pixel art', group: 'Fun', dot: '#7fd16a', params: { pixelate: 0.45, saturation: 1.2, contrast: 0.1 } },
  { id: 'spooky', name: 'Spooky', group: 'Fun', dot: '#3b4a3c', params: { saturation: 0.35, brightness: 0.8, contrast: 0.2, tintAmount: 0.25, tint: '#4f7a5a', vignette: 0.6, grain: 0.2 } },
  { id: 'underwater', name: 'Underwater', group: 'Fun', dot: '#3fb8c9', params: { blur: 0.12, tintAmount: 0.35, tint: '#2fb7c9', brightness: 0.95, saturation: 1.1, temperature: -20, ghost: 0.2, ghostShift: 0.1 } },
  { id: 'memory', name: 'Memory', group: 'Fun', dot: '#d9d2c0', params: { blur: 0.14, fade: 0.3, saturation: 0.5, vignette: 0.55, glow: 0.2, tintAmount: 0.15, tint: '#e8dcc0' } },
]);
export const FX_TEMPLATE_GROUPS = ['Mood', 'Colour', 'Style', 'Fun'];
export const fxTemplate = (id) => FX_TEMPLATES.find((t) => t.id === id) || null;

/** a new effect on the timeline */
export function newFx(tpl, { id, target = 'scene', start = 0, end = 5, ramp = 0.3 } = {}) {
  const t = typeof tpl === 'string' ? fxTemplate(tpl) : tpl;
  return { id, tpl: t?.id || 'custom', name: t?.name || 'Custom', target, start, end, ramp, params: cleanFx(t?.params), visible: true };
}
/** how strongly an effect works at time t (0 .. 1): it fades in and out over `ramp` seconds at both ends; outside its time range it does nothing */
export function fxWeight(fx, t) {
  if (!fx || fx.visible === false || t < fx.start || t >= fx.end) return 0;
  const len = Math.max(0.001, fx.end - fx.start), ramp = Math.min(Math.max(0, fx.ramp ?? 0.3), len / 2);
  if (ramp <= 0) return 1;
  const k = Math.min((t - fx.start) / ramp, (fx.end - t) / ramp, 1), u = Math.max(0, k);
  return u * u * (3 - 2 * u);
}
/** the numbers of an effect at strength w: every control glides between neutral (w = 0) and its set value (w = 1) */
export function scaleFx(params, w) {
  const p = cleanFx(params), out = { ...p };
  for (const c of FX_CONTROLS) out[c.key] = c.neutral + (p[c.key] - c.neutral) * w;
  return out;
}
const MULTIPLY = new Set(['brightness', 'saturation', 'gamma', 'opacity']);
/** several effects on the same picture at once: brightness / saturation / gamma / opacity multiply, everything else adds; the tint is the strongest one */
export function mergeFx(list) {
  const out = { ...DEFAULT_FX }; let tintWeight = -1;
  for (const p of list) {
    for (const c of FX_CONTROLS) {
      if (c.key === 'ghostShift') continue;
      const d = p[c.key] ?? c.neutral;
      out[c.key] = MULTIPLY.has(c.key) ? out[c.key] * d / (c.neutral || 1) : out[c.key] + (d - c.neutral);
    }
    if ((p.ghost ?? 0) > 0.001) out.ghostShift = p.ghostShift;
    if ((p.tintAmount ?? 0) > tintWeight) { tintWeight = p.tintAmount; out.tint = p.tint; }
  }
  return cleanFx(out);
}
/** what is on at time t: { scene: merged numbers or null, items: Map('char:key' | 'prop:id' | 'bg' -> merged numbers) } */
export function fxAt(list, t) {
  const per = new Map();
  for (const fx of list || []) {
    const w = fxWeight(fx, t); if (w <= 0) continue;
    const p = scaleFx(fx.params, w); if (!fxActive(p)) continue;
    const key = targetOf(fx); (per.get(key) || per.set(key, []).get(key)).push(p);
  }
  const items = new Map(); let scene = null;
  for (const [key, ps] of per) { const m = mergeFx(ps); if (key === 'scene') scene = m; else items.set(key, m); }
  return { scene, items };
}
export { hexToRgb };
