// An animated picture (GIF, animated WebP / PNG) becomes ONE sprite sheet picture + its grid and speed, so a prop or an effect made from it
// plays in the studio and in the exported video exactly like the sprite-sheet effects do. A still picture is returned as null (use it as it is).
const MAX_FRAMES = 48, MAX_SHEET = 4096;
const SUPPORTED = /^image\/(gif|webp|png|apng)$/;

/** @returns {Promise<null | { file: File, sheet: {cols, rows, fps}, frameW: number, frameH: number, frames: number }>} */
export async function animatedToSheet(file, { maxFrames = MAX_FRAMES, maxSheet = MAX_SHEET } = {}) {
  if (!file || !SUPPORTED.test(file.type || '') || typeof ImageDecoder === 'undefined') return null;
  let decoder;
  try {
    decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: file.type === 'image/apng' ? 'image/png' : file.type });
    await decoder.tracks.ready;
    const count = decoder.tracks.selectedTrack?.frameCount || 1;
    if (count < 2) return null;
    const take = Math.min(count, maxFrames), indexes = Array.from({ length: take }, (_, i) => Math.min(count - 1, Math.floor((i * count) / take)));
    const frames = []; let seconds = 0;
    for (const index of indexes) {
      const { image } = await decoder.decode({ frameIndex: index });
      const bitmap = await createImageBitmap(image); seconds += (image.duration || 100000) / 1e6; image.close();
      frames.push(bitmap);
    }
    const w = frames[0].width, h = frames[0].height, cols = Math.min(16, Math.ceil(Math.sqrt(take))), rows = Math.ceil(take / cols);
    const k = Math.min(1, maxSheet / (cols * w), maxSheet / (rows * h)), cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
    const canvas = document.createElement('canvas'); canvas.width = cw * cols; canvas.height = ch * rows;
    const g = canvas.getContext('2d');
    frames.forEach((bitmap, i) => { g.drawImage(bitmap, (i % cols) * cw, Math.floor(i / cols) * ch, cw, ch); bitmap.close?.(); });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return null;
    const whole = (seconds / take) * count, fps = Math.min(60, Math.max(1, +(take / Math.max(0.02, whole)).toFixed(1)));          // the sheet plays as long as the original did
    const name = (file.name || 'animated').replace(/\.[^.]+$/, '') + '-sheet.png';
    return { file: new File([blob], name, { type: 'image/png' }), sheet: { cols, rows, fps, frames: take }, frameW: cw, frameH: ch, frames: take };
  } catch { return null; }
  finally { try { decoder?.close(); } catch { /* nothing to close */ } }
}

/**
 * A short video becomes the same kind of sprite sheet (a looping, silent animated picture): the first `maxSeconds` seconds, about `fps` pictures a second,
 * at most `maxFrames` pictures in all. The browser decodes the video (an MP4 with H.264 or a WebM works everywhere; the sound is not kept).
 * @returns {Promise<{ file: File, sheet: {cols, rows, fps, frames}, frameW: number, frameH: number, frames: number, seconds: number, cut: boolean }>}
 */
export async function videoToSheet(file, { maxSeconds = 8, maxFrames = 48, maxSheet = 4096, fps = 6, maxCell = 640 } = {}) {
  const url = URL.createObjectURL(file), video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.preload = 'auto'; video.src = url;
  const once = (event, ms = 8000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { video.removeEventListener(event, ok); reject(new Error('The video took too long to read. Please try a shorter or smaller file.')); }, ms);
    const ok = () => { clearTimeout(timer); resolve(); };
    video.addEventListener(event, ok, { once: true });
    video.addEventListener('error', () => { clearTimeout(timer); reject(new Error('This video could not be read by your browser. Please try an MP4 (H.264) or a WebM file.')); }, { once: true });
  });
  try {
    await once('loadedmetadata');
    if (!Number.isFinite(video.duration)) {            // a recorded WebM can report no length until the end is reached once
      const known = once('durationchange', 4000).catch(() => {}); video.currentTime = 1e101; await known; video.currentTime = 0; await once('seeked', 4000).catch(() => {});
    }
    const total = Number.isFinite(video.duration) ? video.duration : 0, seconds = Math.min(total, maxSeconds);
    if (!(seconds > 0) || !video.videoWidth) throw new Error('This video has no pictures to use. Please try another file.');
    const take = Math.max(2, Math.min(maxFrames, Math.round(seconds * fps))), vw = video.videoWidth, vh = video.videoHeight;
    const cols = Math.min(8, Math.ceil(Math.sqrt(take))), rows = Math.ceil(take / cols);
    const k = Math.min(1, maxSheet / (cols * vw), maxSheet / (rows * vh), maxCell / vw), cw = Math.max(1, Math.round(vw * k)), ch = Math.max(1, Math.round(vh * k));
    const canvas = document.createElement('canvas'); canvas.width = cw * cols; canvas.height = ch * rows;
    const g = canvas.getContext('2d');
    for (let i = 0; i < take; i++) {
      const seek = once('seeked', 6000);
      video.currentTime = Math.min(Math.max(0, seconds - 0.001), (i / take) * seconds);
      await seek;
      g.drawImage(video, (i % cols) * cw, Math.floor(i / cols) * ch, cw, ch);
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('The video could not be turned into a picture. Please try another file.');
    const name = (file.name || 'video').replace(/\.[^.]+$/, '') + '-clip.png', speed = +(take / seconds).toFixed(2);
    return { file: new File([blob], name, { type: 'image/png' }), sheet: { cols, rows, fps: speed, frames: take }, frameW: cw, frameH: ch, frames: take, seconds, cut: total > maxSeconds + 0.05 };
  } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
}
