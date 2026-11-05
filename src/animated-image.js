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
