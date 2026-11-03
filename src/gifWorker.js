// Makes the preview file of one animation off the main thread: pixels in, file bytes out (several of these run side by side).
// kind 'mp4' = a small H.264 video; kind 'gif' = a GIF (when this browser cannot make the video).
import { encodeFrames } from './gifEncode.js';
import { encodeMp4 } from './previewVideo.js';

self.onmessage = async (e) => {
  const { id, kind, frames, size, fps, colors, bitrate } = e.data;
  try {
    const bytes = kind === 'mp4' ? await encodeMp4(frames, { size, fps, bitrate }) : encodeFrames(frames, { size, fps, colors });
    const out = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    self.postMessage({ id, bytes: out }, [out]);
  } catch (error) { self.postMessage({ id, error: String(error?.message || error) }); }
};
