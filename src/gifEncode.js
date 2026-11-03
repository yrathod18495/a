// The GIF encoder for the animation previews, tuned for the smallest file at a good picture:
//  - ONE palette for the whole animation (made from samples of every frame), so a colour has the same number in every frame;
//  - after the first frame only what changed is stored: a pixel that looks the same as on the screen already is "transparent" (stays as it is);
//  - "the same" allows a tiny difference (`tolerance`, in colour steps), which removes the flicker of smooth gradients and shrinks the file a lot.
import { GIFEncoder, quantize, applyPalette } from 'gifenc';

/** frames: ArrayBuffers of RGBA pixels (size × size). Returns the GIF bytes (Uint8Array). */
export function encodeFrames(frames, { size, fps, colors = 256, tolerance = 6 }) {
  const n = size * size;
  // one palette from a sample of all frames (every 3rd pixel of every frame: plenty for flat cartoon colours)
  const step = 3, sample = new Uint8ClampedArray(Math.ceil(n / step) * 4 * frames.length);
  let o = 0;
  for (const buffer of frames) { const d = new Uint8ClampedArray(buffer); for (let p = 0; p < n; p += step) { const q = p * 4; sample[o++] = d[q]; sample[o++] = d[q + 1]; sample[o++] = d[q + 2]; sample[o++] = 255; } }
  const palette = quantize(sample.subarray(0, o), Math.min(255, colors), { format: 'rgb565' }), tIndex = palette.length;     // the last slot is "transparent"
  const full = palette.concat([[0, 0, 0]]);
  const gif = GIFEncoder(), delay = Math.round(1000 / fps), tol2 = tolerance * tolerance * 3;
  let shown = null;                                           // what the screen shows now, as palette indexes
  frames.forEach((buffer, i) => {
    const data = new Uint8ClampedArray(buffer), rgba = new Uint8ClampedArray(n * 4);
    for (let p = 0, q = 0; p < n; p++, q += 4) { rgba[q] = data[q]; rgba[q + 1] = data[q + 1]; rgba[q + 2] = data[q + 2]; rgba[q + 3] = 255; }
    const index = applyPalette(rgba, palette, 'rgb565');
    if (i === 0) { shown = Uint8Array.from(index); gif.writeFrame(index, size, size, { palette: full, delay, repeat: 0, dispose: 1 }); return; }
    const out = new Uint8Array(n);
    for (let p = 0; p < n; p++) {
      const now = index[p], was = shown[p];
      if (now === was) { out[p] = tIndex; continue; }
      const a = palette[now], b = palette[was], dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
      if (dr * dr + dg * dg + db * db <= tol2) out[p] = tIndex;           // looks the same: leave it
      else { out[p] = now; shown[p] = now; }
    }
    gif.writeFrame(out, size, size, { delay, transparent: true, transparentIndex: tIndex, dispose: 1 });          // the first frame's palette is the global one
  });
  gif.finish();
  return gif.bytes();
}
