// The level written into the video codec string must match the picture size and the frames per second, or players and hardware decoders may refuse the file or play it badly
// (4K at 90 fps is far above H.264 level 4.0, for example). Pure numbers, no browser needed.

/** H.264: [level byte, max macroblocks per second, max macroblocks per frame] (a macroblock is 16 x 16 pixels) */
export const AVC_LEVELS = [[0x28, 245760, 8192], [0x2a, 522240, 8704], [0x32, 589824, 22080], [0x33, 983040, 36864], [0x34, 2073600, 36864], [0x3c, 4177920, 139264], [0x3d, 8355840, 139264], [0x3e, 16711680, 139264]];
/** VP9: [level code, max luma samples per second, max picture size]; never below 4.0 */
export const VP9_LEVELS = [['40', 83558400, 2228224], ['41', 160432128, 2228224], ['50', 311951360, 8912896], ['51', 588251136, 8912896], ['52', 1176502272, 8912896], ['60', 1176502272, 35651584], ['61', 2353004544, 35651584], ['62', 4706009088, 35651584]];

/** H.264 codec strings that fit W x H at `fps`, lowest level first (High, then Main, then Baseline of each) */
export function avcCodecsFor(W, H, fps = 30) {
  const mbs = Math.ceil(W / 16) * Math.ceil(H / 16), fits = AVC_LEVELS.filter(([, rate, frame]) => mbs * fps <= rate && mbs <= frame).slice(0, 2);
  const levels = fits.length ? fits : [AVC_LEVELS.at(-1)];
  const hex = (n) => n.toString(16).toUpperCase().padStart(2, '0');
  return levels.flatMap(([lv]) => [`avc1.6400${hex(lv)}`, `avc1.4D00${hex(lv)}`, `avc1.42E0${hex(lv)}`]);
}
/** VP9 codec strings that fit W x H at `fps`, lowest level first */
export function vp9CodecsFor(W, H, fps = 30) {
  const px = W * H, fits = VP9_LEVELS.filter(([, rate, size]) => px * fps <= rate && px <= size).slice(0, 3);
  return (fits.length ? fits : [VP9_LEVELS.at(-1)]).map(([lv]) => `vp09.00.${lv}.08`);
}
/** a picture size and frame rate that most computers and phones cannot play smoothly, even when the file is made correctly */
export const heavyForPlayback = (W, H, fps) => W * H * fps > 3840 * 2160 * 60 * 1.01;
