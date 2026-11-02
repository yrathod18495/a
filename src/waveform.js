// The picture of the sound inside an audio clip on the timeline.
export const PEAKS_PER_SECOND = 200;
const cache = new WeakMap();

/** the loudest sample of every 1/PEAKS_PER_SECOND second of a recording (0..1); computed once per recording */
export function computePeaks(samples, sampleRate, perSecond = PEAKS_PER_SECOND) {
  const per = Math.max(1, Math.floor(sampleRate / perSecond)), out = new Float32Array(Math.ceil(samples.length / per));
  for (let i = 0; i < out.length; i++) { let m = 0; const end = Math.min(samples.length, (i + 1) * per); for (let k = i * per; k < end; k++) { const v = samples[k] < 0 ? -samples[k] : samples[k]; if (v > m) m = v; } out[i] = m; }
  return out;
}
export function peaksOf(buffer) {
  let hit = cache.get(buffer);
  if (!hit) { hit = computePeaks(buffer.getChannelData(0), buffer.sampleRate); cache.set(buffer, hit); }
  return hit;
}
const maxCache = new WeakMap();
/** the loudest peak of the whole recording (so a quiet recording still fills the clip) */
export function peakMax(buffer) { let m = maxCache.get(buffer); if (m == null) { m = 0; for (const v of peaksOf(buffer)) if (v > m) m = v; m = Math.max(m, 0.02); maxCache.set(buffer, m); } return m; }
/** `width` bars for the part of the recording between `from` and `to` seconds: each one is the loudest peak in its slice */
export function barsFor(peaks, from, to, width, perSecond = PEAKS_PER_SECOND) {
  const bars = new Float32Array(Math.max(0, width)), span = Math.max(1e-6, to - from);
  for (let x = 0; x < bars.length; x++) {
    const a = Math.floor((from + (span * x) / bars.length) * perSecond), b = Math.max(a + 1, Math.ceil((from + (span * (x + 1)) / bars.length) * perSecond));
    let m = 0; for (let i = Math.max(0, a); i < Math.min(peaks.length, b); i++) if (peaks[i] > m) m = peaks[i];
    bars[x] = m;
  }
  return bars;
}
/** draw the bars into a canvas, mirrored around the middle; the loudest sound of the whole recording fills the height */
export function drawWave(canvas, bars, { colour = 'rgba(255,255,255,.75)', gain = 1 } = {}) {
  const w = canvas.width = Math.max(1, bars.length), h = canvas.height = Math.max(8, canvas.clientHeight || 40), g = canvas.getContext('2d');
  g.clearRect(0, 0, w, h); g.fillStyle = colour;
  for (let x = 0; x < bars.length; x++) { const half = Math.max(0.5, Math.min(1, bars[x] * gain) * (h / 2 - 1)); g.fillRect(x, h / 2 - half, 1, half * 2); }
}
