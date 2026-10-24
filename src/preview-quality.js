export const PREVIEW_MODES = Object.freeze({
  low: Object.freeze({ label: 'Low · fastest', short: 180, maxTex: 512, fps: 12 }),
  medium: Object.freeze({ label: 'Medium · balanced', short: 480, maxTex: 1024, fps: 24 }),
  high: Object.freeze({ label: 'High · sharpest', short: 1080, maxTex: 4096, fps: 60 }),
});
export const previewMode = value => Object.hasOwn(PREVIEW_MODES, value) ? value : 'medium';
export function readPreviewMode() {
  try { return previewMode(localStorage.getItem('12toons-preview-quality')); } catch { return 'medium'; }
}
export function savePreviewMode(value) {
  try { localStorage.setItem('12toons-preview-quality', previewMode(value)); } catch { /* Device storage is optional. */ }
}
export function previewFrameDue(now, lastFrame, mode, exporting = false) {
  return exporting || now - lastFrame >= 1000 / PREVIEW_MODES[previewMode(mode)].fps - .5;
}
