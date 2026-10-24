// Renders and encodes slices of the video in parallel (one of these runs per CPU core).
// Receives the whole scene once ('init'), then renders frame ranges ('segment') and sends the encoded chunks back.
import { Stage } from './db/stage.js';

let stage, job;

async function init(msg) {
  job = msg.job;
  stage = new Stage({ maxTex: job.maxTex });
  stage.bg.preset = job.bg.preset;
  stage.setSize(job.aspect, job.short);
  if (job.bg.image) await stage.setBackgroundImage(job.bg.image);
  await stage.setProps(job.props || []);
  for (const def of job.chars) await stage.loadCharacter(def);
  if (job.tearSprite) await stage.setTearSprite(job.tearSprite);
  stage.setLayers(job.layers);
  stage.camKeys = job.camKeys || [];
  if (stage.W !== job.W || stage.H !== job.H) throw new Error('size mismatch');
}

async function segment({ id, from, to }) {
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
  enc.configure({ codec, width: W, height: H, bitrate, framerate: fps, latencyMode: 'quality', bitrateMode: job.bitrateMode });
  // hair / cloth physics need a moment to settle, so warm up a little before the first frame we keep
  const warm = Math.min(from, Math.round(fps * 0.75));
  for (let i = from - warm; i < from; i++) stage.render(i / fps, dt, voice, plan);
  for (let i = from; i < to; i++) {
    if (failure) throw failure;
    stage.render(i / fps, i === from && !warm ? 0 : dt, voice, plan);
    const vf = new VideoFrame(stage.out, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
    enc.encode(vf, { keyFrame: i === from || i % (fps * 2) === 0 }); vf.close();
    while (enc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 2));
    if ((i - from) % 8 === 7) self.postMessage({ type: 'progress', frames: 8 });
  }
  await enc.flush(); enc.close();
  if (failure) throw failure;
  self.postMessage({ type: 'progress', frames: (to - from) % 8 });
  self.postMessage({ type: 'segment', id, chunks, config }, chunks.map((c) => c.data));
}

self.onmessage = async (e) => {
  try {
    if (e.data.type === 'init') { await init(e.data); self.postMessage({ type: 'ready' }); }
    else if (e.data.type === 'segment') await segment(e.data);
  } catch (err) { self.postMessage({ type: 'error', message: String(err?.message || err) }); }
};
