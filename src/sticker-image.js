// A sticker (scar, blood mark, stitches, patch ...) is always stored as a PNG with a see-through background, at most 1024 px on its longest side:
// an SVG is drawn once here, a bigger picture is made smaller. The editor puts several stickers on one picture page, so small files matter.
export const STICKER_MAX_SIDE = 1024;
export async function stickerPng(file) {
  if (!file?.type?.startsWith('image/') && !/\.svg$/i.test(file?.name || '')) throw new Error('Please choose a PNG, WebP or SVG picture.');
  let src, w, h, close = () => {};
  if (/svg/i.test(file.type) || /\.svg$/i.test(file.name || '')) {
    const url = URL.createObjectURL(file), im = new Image(); im.src = url;
    try { await im.decode(); } catch { URL.revokeObjectURL(url); throw new Error('This SVG could not be read.'); }
    w = im.naturalWidth || STICKER_MAX_SIDE; h = im.naturalHeight || STICKER_MAX_SIDE; src = im; close = () => URL.revokeObjectURL(url);
  } else { src = await createImageBitmap(file); w = src.width; h = src.height; close = () => src.close?.(); }
  try {
    const k = STICKER_MAX_SIDE / Math.max(w, h), scale = /svg/i.test(file.type) || /\.svg$/i.test(file.name || '') ? k : Math.min(1, k);          // an SVG is vector: it is drawn at full size; a picture is only made smaller
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    if (!blob) throw new Error('This picture could not be converted.');
    return new File([blob], (file.name || 'sticker').replace(/\.[^.]+$/, '') + '.png', { type: 'image/png' });
  } finally { close(); }
}
