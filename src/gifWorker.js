// Makes the GIF file of one animation off the main thread: palette + pixels in, GIF bytes out (several of these run side by side).
import { GIFEncoder, quantize, applyPalette } from 'gifenc';

self.onmessage = (e) => {
  const { id, frames, size, fps, colors } = e.data;
  try {
    const gif = GIFEncoder();
    for (const buffer of frames) {
      const data = new Uint8ClampedArray(buffer), palette = quantize(data, colors);
      gif.writeFrame(applyPalette(data, palette), size, size, { palette, delay: Math.round(1000 / fps), repeat: 0 });
    }
    gif.finish();
    const bytes = gif.bytes(), out = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    self.postMessage({ id, bytes: out }, [out]);
  } catch (error) { self.postMessage({ id, error: String(error?.message || error) }); }
};
