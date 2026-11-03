// How long an export will take and how big the file will be, shown before the user starts it.
// The time comes from how fast the last export on this device was (if there was one), scaled to the new picture size and frame rate;
// without a measurement it is a rough guess from the number of CPU cores, and says so.
const KEY = '12toons.exportSpeed';
export const AUDIO_MBPS = 0.192;                         // the voice / music track the export writes (192 kbit/s)

export function estimateSeconds({ duration, pixels, fps, live = false, last = null, cores = 4 }) {
  if (live) return { seconds: duration + 3, basis: 'live' };                           // recording live takes as long as the video
  const ref = last && last.speed > 0 ? last : { speed: 0.3 * Math.max(1, Math.min(cores, 8)), pixels: 1280 * 720, fps: 30 };      // 1280×720 at 30 fps: about 0.3× real time per core
  const speed = ref.speed * Math.pow(ref.pixels / Math.max(1, pixels), 0.9) * (ref.fps / Math.max(1, fps));
  return { seconds: duration / Math.max(0.05, speed), basis: last && last.speed > 0 ? 'last' : 'guess' };
}
export const prettyTime = (s) => (s < 90 ? `${Math.max(5, Math.round(s / 5) * 5)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);
export const BASIS_TEXT = { live: 'A live recording takes as long as the video.', last: 'Based on how fast your last export was on this device.', guess: 'A rough guess. It becomes accurate after your first export.' };
// `ratio`: how much of the requested video bitrate the encoder really uses. Cartoon pictures are easy to compress, so a real file is far smaller than "bitrate × length";
// the ratio is measured from the last export on this device (see rememberSize), and until then a cautious default is used.
export const DEFAULT_SIZE_RATIO = { mp4: 0.15, webm: 0.35 };
export function estimateMegabytes({ videoBps, duration, audio, ratio = 1 }) { return ((videoBps * ratio / 1e6 + (audio ? AUDIO_MBPS : 0)) * duration) / 8; }

const SIZE_KEY = '12toons.exportSizeRatio';
/** remembers how big the finished file was compared with what the bitrate promised, per format */
export function rememberSize({ bytes, duration, videoBps, audio, format }, storage = globalThis.localStorage) {
  if (!(bytes > 0 && duration > 0.5 && videoBps > 0)) return null;
  const videoActual = Math.max(0, (bytes * 8) / duration - (audio ? AUDIO_MBPS * 1e6 : 0)), ratio = Math.min(1.2, Math.max(0.02, videoActual / videoBps));
  try { const all = JSON.parse(storage.getItem(SIZE_KEY) || '{}'); all[format] = { ratio, at: Date.now() }; storage.setItem(SIZE_KEY, JSON.stringify(all)); } catch { /* optional */ }
  return ratio;
}
export function sizeRatio(format, storage = globalThis.localStorage) {
  try { const v = JSON.parse(storage.getItem(SIZE_KEY) || '{}')[format]; if (v && v.ratio > 0) return v.ratio; } catch { /* use the default */ }
  return DEFAULT_SIZE_RATIO[format] ?? 0.2;
}

export function rememberSpeed({ duration, seconds, pixels, fps }, storage = globalThis.localStorage) {
  if (!(duration > 0.5 && seconds > 0.2)) return null;
  const entry = { speed: duration / seconds, pixels, fps, at: Date.now() };
  try { storage.setItem(KEY, JSON.stringify(entry)); } catch { /* optional */ }
  return entry;
}
export function lastSpeed(storage = globalThis.localStorage) {
  try { const v = JSON.parse(storage.getItem(KEY) || 'null'); return v && v.speed > 0 && v.pixels > 0 && v.fps > 0 ? v : null; } catch { return null; }
}
