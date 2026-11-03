// The animation previews as a tiny looping video (H.264 in an MP4: plays in every phone browser) instead of a GIF:
// the same picture in roughly a tenth of the bytes. Used by the admin upload (in a worker, beside the drawing of the next animation).
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

const codecFor = (size) => (size > 576 ? 'avc1.42E01F' : 'avc1.42E01E');          // baseline profile, level 3.1 for the bigger pictures
/** can this browser make the preview video? (false: the GIF is used instead) */
export async function canEncodePreview(size, fps, bitrate) {
  try { return !!(globalThis.VideoEncoder && globalThis.VideoFrame && (await VideoEncoder.isConfigSupported({ codec: codecFor(size), width: size, height: size, bitrate, framerate: fps })).supported); } catch { return false; }
}
/** frames: ArrayBuffers of RGBA pixels (size × size). Returns the MP4 bytes. */
export async function encodeMp4(frames, { size, fps, bitrate }) {
  const target = new ArrayBufferTarget(), muxer = new Muxer({ target, fastStart: 'in-memory', video: { codec: 'avc', width: size, height: size, frameRate: fps } });
  let failure = null;
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failure = e; } });
  encoder.configure({ codec: codecFor(size), width: size, height: size, bitrate, framerate: fps, latencyMode: 'quality', avc: { format: 'avc' } });
  for (let i = 0; i < frames.length; i++) {
    if (failure) throw failure;
    const frame = new VideoFrame(new Uint8ClampedArray(frames[i]), { format: 'RGBA', codedWidth: size, codedHeight: size, timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
    encoder.encode(frame, { keyFrame: i % Math.max(1, fps * 3) === 0 }); frame.close();
    while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 2));
  }
  await encoder.flush(); encoder.close();
  if (failure) throw failure;
  muxer.finalize();
  return new Uint8Array(target.buffer);
}
