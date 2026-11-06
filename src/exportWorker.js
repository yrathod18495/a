// Renders and encodes frame slices in parallel. The parent chooses a bounded worker count
// for the render machine; each worker owns an independent DragonBones/WebGL stage and encoder.
import { Stage } from './db/stage.js';
import { connectGpuEncoder } from './gpu-encode.js';

let stage, job;

async function init(msg) {
  job = msg.job;
  stage = new Stage({ maxTex: job.maxTex });
  stage.bg.preset = job.bg.preset;
  stage.setSize(job.aspect, job.short);
  if (job.bg.image) await stage.setBackgroundImage(job.bg.image);
  if (job.bgClips?.length) await stage.setBackgroundClips(job.bgClips, job.bgBlank);
  stage.grade = job.grade || null; stage.gradeKeys = job.gradeKeys || [];
  stage.fx = job.fx || [];
  await stage.setProps(job.props || []);
  for (const def of job.chars) await stage.loadCharacter(def);
  if (job.tearSprite) await stage.setTearSprite(job.tearSprite);
  stage.setLayers(job.layers);
  stage.camKeys = job.camKeys || [];
  if (stage.W !== job.W || stage.H !== job.H) throw new Error('size mismatch');
}

const PIX = { RGBA: 'rgba', RGBX: 'rgb0', BGRA: 'bgra', BGRX: 'bgr0' };          // what a canvas frame can be, named the way ffmpeg names it
let link = null;
/** the GPU-encoder version of a slice: the raw frames go to ffmpeg (on the GPU) instead of through this worker's own video encoder */
async function gpuSegment({ id, from, to }) {
  const { fps, bitrate, W, H, voice, plan } = job, dt = 1 / fps, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clock = { warm: 0, render: 0, submit: 0, wait: 0, flush: 0 }, now = () => performance.now();
  link ||= await connectGpuEncoder(job.gpuenc);
  // Each frame is compressed to a JPEG here (quality 0.95) and ffmpeg decodes it again: a raw frame is 3.7 MB at 720p and 33 MB at 4K, far more than
  // the few CPU cores of a cloud machine can copy around at 40+ frames a second (measured: 16 fps raw against 60 fps with JPEG), and the picture then
  // goes through the GPU encoder at the final bitrate anyway. When this canvas cannot make a JPEG, raw frames are sent instead.
  const jpeg = typeof stage.out.convertToBlob === 'function';
  let pix = 'mjpeg', size = 0;
  if (!jpeg) { const probe = new VideoFrame(stage.out, { timestamp: 0 }); pix = PIX[probe.format]; size = probe.allocationSize(); probe.close(); if (!pix) throw new Error('This picture format cannot be sent to the GPU encoder.'); }
  link.send({ t: 'slice', id, w: W, h: H, fps, pix, bitrate });
  const warm = Math.min(from, Math.round(fps * 0.75));
  let t = now();
  for (let i = from - warm; i < from; i++) stage.render(i / fps, dt, voice, plan);
  clock.warm = now() - t;
  const rowBytes = W * 4;
  for (let i = from; i < to; i++) {
    t = now(); stage.render(i / fps, i === from && !warm ? 0 : dt, voice, plan); clock.render += now() - t;
    t = now();
    let bytes;
    if (jpeg) bytes = new Uint8Array(await (await stage.out.convertToBlob({ type: 'image/jpeg', quality: 0.95 })).arrayBuffer());
    else {
      const vf = new VideoFrame(stage.out, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      bytes = new Uint8Array(size); const layout = await vf.copyTo(bytes); vf.close();
      if (layout[0].stride !== rowBytes) { const packed = new Uint8Array(rowBytes * H); for (let y = 0; y < H; y++) packed.set(bytes.subarray(y * layout[0].stride, y * layout[0].stride + rowBytes), y * rowBytes); bytes = packed; }
    }
    link.send(bytes);
    clock.submit += now() - t; t = now();
    while (link.ws.bufferedAmount > Math.max(2e6, (jpeg ? bytes.length : size) * 4)) { if (link.closed) throw new Error('The GPU encoder connection closed.'); await sleep(1); }          // the encoder is the slower side: wait instead of filling memory
    clock.wait += now() - t;
    if ((i - from) % 2 === 1) self.postMessage({ type: 'progress', frames: 2 });
  }
  t = now(); link.send({ t: 'end', id }); const done = await link.wait('sliceDone'); clock.flush = now() - t;
  if (!done.ok) throw new Error(`GPU encoder: ${done.error || 'a slice failed'}`);
  self.postMessage({ type: 'progress', frames: (to - from) % 2 });
  self.postMessage({ type: 'segment', id, chunks: [], config: null, clock, frames: to - from });
}

async function segment({ id, from, to }) {
  if (job.gpuenc) return gpuSegment({ id, from, to });
  const { fps, codec, bitrate, W, H, voice, plan } = job, dt = 1 / fps;
  const chunks = []; let config = null, failure = null;
  const enc = new VideoEncoder({
    output: (c, meta) => {
      const data = new ArrayBuffer(c.byteLength); c.copyTo(data);
      chunks.push({ type: c.type, timestamp: c.timestamp, duration: c.duration, data });
      if (!config && meta?.decoderConfig) { const d = meta.decoderConfig; config = { codec: d.codec, codedWidth: d.codedWidth, codedHeight: d.codedHeight, colorSpace: d.colorSpace ? { primaries: d.colorSpace.primaries, transfer: d.colorSpace.transfer, matrix: d.colorSpace.matrix, fullRange: d.colorSpace.fullRange } : undefined, description: d.description ? new Uint8Array(d.description).slice().buffer : undefined }; }
    },
    error: (e) => { failure = e; },
  });
  enc.configure({ codec, width: W, height: H, bitrate, framerate: fps, latencyMode: job.latencyMode || 'quality', bitrateMode: job.bitrateMode, ...(job.hardwareAcceleration ? { hardwareAcceleration: job.hardwareAcceleration } : {}) });
  // hair / cloth physics need a moment to settle, so warm up a little before the first frame we keep
  const warm = Math.min(from, Math.round(fps * 0.75)), clock = { warm: 0, render: 0, submit: 0, wait: 0, flush: 0 }, now = () => performance.now();
  let t = now();
  for (let i = from - warm; i < from; i++) stage.render(i / fps, dt, voice, plan);
  clock.warm = now() - t;
  // Keep the hardware encoder fed without allowing unbounded frame memory.
  // 4K frames are large; 1080p and below can safely pipeline more frames.
  const queueLimit = W * H >= 3840 * 2160 ? 4 : W * H >= 1920 * 1080 ? 8 : 12;
  for (let i = from; i < to; i++) {
    if (failure) throw failure;
    t = now(); stage.render(i / fps, i === from && !warm ? 0 : dt, voice, plan); clock.render += now() - t;
    t = now();
    const vf = new VideoFrame(stage.out, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
    enc.encode(vf, { keyFrame: i === from || i % (fps * 2) === 0 }); vf.close();
    clock.submit += now() - t; t = now();
    while (enc.encodeQueueSize > queueLimit) await new Promise((r) => setTimeout(r, 2));
    clock.wait += now() - t;
    if ((i - from) % 2 === 1) self.postMessage({ type: 'progress', frames: 2 });
  }
  t = now(); await enc.flush(); clock.flush = now() - t; enc.close();
  if (failure) throw failure;
  self.postMessage({ type: 'progress', frames: (to - from) % 2 });
  self.postMessage({ type: 'segment', id, chunks, config, clock, frames: to - from }, chunks.map((c) => c.data));
}

self.onmessage = async (e) => {
  try {
    if (e.data.type === 'init') { await init(e.data); self.postMessage({ type: 'ready' }); }
    else if (e.data.type === 'segment') await segment(e.data);
  } catch (err) { self.postMessage({ type: 'error', message: String(err?.message || err) }); }
};
