// Colour grading of the whole scene (background, characters, props and effects together).
// The numbers here are shared by the studio panel, the WebGL grade pass and the export, so a graded preview and the exported video match.

/** every control: key, label, range and the neutral value (the value that changes nothing) */
export const GRADE_CONTROLS = [
  { group: 'Basic', key: 'brightness', label: 'Brightness', min: 0, max: 2, step: 0.01, neutral: 1 },
  { group: 'Basic', key: 'contrast', label: 'Contrast', min: -1, max: 1, step: 0.01, neutral: 0 },
  { group: 'Basic', key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.01, neutral: 1 },
  { group: 'Basic', key: 'vibrance', label: 'Vibrance', min: -1, max: 1, step: 0.01, neutral: 0 },
  { group: 'Basic', key: 'exposure', label: 'Exposure', min: -3, max: 3, step: 0.05, neutral: 0 },
  { group: 'Basic', key: 'gamma', label: 'Gamma', min: 0.3, max: 3, step: 0.01, neutral: 1 },
  { group: 'Colour', key: 'hue', label: 'Hue', min: -180, max: 180, step: 1, neutral: 0 },
  { group: 'Colour', key: 'temperature', label: 'Temperature', min: -100, max: 100, step: 1, neutral: 0 },
  { group: 'Colour', key: 'tintAmount', label: 'Tint strength', min: 0, max: 1, step: 0.01, neutral: 0 },
  { group: 'Tone', key: 'shadows', label: 'Shadows', min: -1, max: 1, step: 0.01, neutral: 0 },
  { group: 'Tone', key: 'highlights', label: 'Highlights', min: -1, max: 1, step: 0.01, neutral: 0 },
  { group: 'Tone', key: 'fade', label: 'Fade (matte)', min: 0, max: 1, step: 0.01, neutral: 0 },
  { group: 'Finish', key: 'sharpen', label: 'Sharpen', min: 0, max: 2, step: 0.02, neutral: 0 },
  { group: 'Finish', key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.01, neutral: 0 },
  { group: 'Finish', key: 'grain', label: 'Film grain', min: 0, max: 1, step: 0.01, neutral: 0 },
];

export const DEFAULT_GRADE = { ...Object.fromEntries(GRADE_CONTROLS.map((c) => [c.key, c.neutral])), tint: '#ffffff' };

/** ready-made looks; each only lists what it changes */
export const GRADE_PRESETS = [
  { id: 'normal', label: 'Normal', grade: {} },
  { id: 'warm', label: 'Warm sunset', grade: { temperature: 35, tintAmount: 0.15, tint: '#ffb86b', saturation: 1.1, contrast: 0.08 } },
  { id: 'cool', label: 'Cool morning', grade: { temperature: -35, tintAmount: 0.12, tint: '#9cc8ff', brightness: 1.05 } },
  { id: 'cinema', label: 'Cinematic', grade: { contrast: 0.22, saturation: 0.9, shadows: -0.15, highlights: -0.1, vignette: 0.35, temperature: 8 } },
  { id: 'vintage', label: 'Vintage', grade: { saturation: 0.75, fade: 0.25, temperature: 20, tintAmount: 0.18, tint: '#e8c48a', vignette: 0.3, grain: 0.25 } },
  { id: 'bw', label: 'Black & white', grade: { saturation: 0, contrast: 0.18 } },
  { id: 'sepia', label: 'Sepia', grade: { saturation: 0.25, tintAmount: 0.55, tint: '#c8935a', contrast: 0.1 } },
  { id: 'night', label: 'Night', grade: { brightness: 0.7, exposure: -0.4, temperature: -45, tintAmount: 0.3, tint: '#4d6bff', saturation: 0.8, vignette: 0.4 } },
  { id: 'vivid', label: 'Vivid pop', grade: { saturation: 1.35, vibrance: 0.3, contrast: 0.15, sharpen: 0.3 } },
  { id: 'dream', label: 'Dreamy', grade: { brightness: 1.1, contrast: -0.15, fade: 0.2, saturation: 1.1, highlights: 0.2, tintAmount: 0.1, tint: '#ffc6e8' } },
];

const HEX = /^#[0-9a-f]{6}$/i;
/** a safe grade: unknown keys dropped, numbers clamped to their range, missing ones neutral */
export function cleanGrade(input) {
  const out = { ...DEFAULT_GRADE };
  if (!input || typeof input !== 'object') return out;
  for (const c of GRADE_CONTROLS) { const v = Number(input[c.key]); if (Number.isFinite(v)) out[c.key] = Math.min(c.max, Math.max(c.min, v)); }
  if (typeof input.tint === 'string' && HEX.test(input.tint)) out.tint = input.tint.toLowerCase();
  return out;
}
/** does this grade change the picture at all? (when not, the stage skips the extra pass and renders straight to the screen) */
export const gradeActive = (grade) => !!grade && GRADE_CONTROLS.some((c) => Math.abs((Number(grade[c.key]) ?? c.neutral) - c.neutral) > 1e-4);
export const presetGrade = (id) => cleanGrade(GRADE_PRESETS.find((p) => p.id === id)?.grade);
/** the preset whose settings equal this grade, if any */
export const presetOf = (grade) => GRADE_PRESETS.find((p) => { const want = presetGrade(p.id), g = cleanGrade(grade); return GRADE_CONTROLS.every((c) => Math.abs(want[c.key] - g[c.key]) < 1e-4) && (!gradeActive(want) || want.tint === g.tint || want.tintAmount === 0); })?.id ?? null;
export const hexToRgb = (hex) => { const n = parseInt(HEX.test(hex) ? hex.slice(1) : 'ffffff', 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

const toHex = (rgb) => `#${rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
/**
 * The grade at time `t` when the user keyed it over time: [{t, grade}]. Before the first key / after the last one the grade holds;
 * in between every number (and the tint colour) glides from one key to the next. With no keys the scene's own grade is used.
 */
export function gradeAt(keys, t, base) {
  if (!keys?.length) return base;
  const list = keys.slice().sort((a, b) => a.t - b.t);
  if (t <= list[0].t) return cleanGrade(list[0].grade);
  if (t >= list.at(-1).t) return cleanGrade(list.at(-1).grade);
  const i = list.findIndex((k, j) => t >= k.t && t < list[j + 1].t), a = cleanGrade(list[i].grade), b = cleanGrade(list[i + 1].grade);
  const u0 = (t - list[i].t) / Math.max(1e-6, list[i + 1].t - list[i].t), u = u0 * u0 * (3 - 2 * u0), out = { ...a };
  for (const c of GRADE_CONTROLS) out[c.key] = a[c.key] + (b[c.key] - a[c.key]) * u;
  const ca = hexToRgb(a.tint), cb = hexToRgb(b.tint);
  out.tint = toHex(ca.map((v, k) => v + (cb[k] - v) * u));
  return out;
}
