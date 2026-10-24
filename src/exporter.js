import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer';

/*
 * Two output formats:
 *  - WebM (VP9 + Opus): same sharpness at roughly half the file size
 *  - MP4  (H.264 + AAC): plays everywhere (older phones, editors, WhatsApp ...)
 * Bitrate is per pixel, independent of fps (a 15 fps video keeps the same sharpness per frame).
 */
export const BITRATE_LEVELS = { mp4: { std: 0.2, high: 0.4, max: 0.7 }, webm: { std: 0.045, high: 0.08, max: 0.16 } };
export const bitrateFor = (W, H, level = 'high', format = 'webm') => {
  const k = (BITRATE_LEVELS[format] || BITRATE_LEVELS.mp4)[level] ?? 0.12;
  return Math.round(Math.min(80_000_000, Math.max(format === 'webm' ? 1_200_000 : 2_500_000, W * H * 30 * k)));
};
const yieldUI = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = r; c.port2.postMessage(0); });
const SR = 48000;

/** Best codec pair this device can encode for the wanted format (falls back to the other format when needed). */
async function pickCodecs(W, H, bitrate, FPS, format = 'webm', silent = false) {
  if (!window.VideoEncoder || !window.VideoFrame || (!silent && (!window.AudioEncoder || !window.AudioData))) return null;
  const vp9 = [['vp9', 'vp09.00.40.08'], ['vp9', 'vp09.00.41.08'], ['vp9', 'vp09.00.50.08']];
  const avc = [['avc', 'avc1.640028'], ['avc', 'avc1.4d0028'], ['avc', 'avc1.42E028'], ['avc', 'avc1.640032'], ['avc', 'avc1.640033']];
  const tryOrder = format === 'webm' ? [['webm', vp9], ['mp4', [...avc, ...vp9]]] : [['mp4', [...avc, ...vp9]]];
  for (const [fmt, vlist] of tryOrder) {
    let video = null;
    for (const [name, codec] of vlist) {
      try { if ((await VideoEncoder.isConfigSupported({ codec, width: W, height: H, bitrate, framerate: FPS })).supported) { video = { name, codec }; break; } } catch { /* try next */ }
    }
    if (!video) continue;
    if (silent) return { format: fmt, video, audio: null, bitrateMode: fmt === 'webm' ? 'variable' : 'constant' };
    const alist = fmt === 'webm' ? [['opus', 'opus']] : [['aac', 'mp4a.40.2'], ['opus', 'opus']];
    for (const [name, codec] of alist) {
      try { if ((await AudioEncoder.isConfigSupported({ codec, sampleRate: SR, numberOfChannels: 2, bitrate: 192000 })).supported) return { format: fmt, video, audio: { name, codec }, bitrateMode: fmt === 'webm' ? 'variable' : 'constant' }; } catch { /* try next */ }
    }
  }
  return null;
}
export const canExportOffline = async (W, H, fps = 30, format = 'webm', silent = false) => !!(await pickCodecs(W, H, 4_000_000, fps, format, silent));
const hasVoice = (clips) => clips.some((c) => c.buffer);

/** voice lines -> one stereo track -> encoded audio chunks */
async function encodeAudio(clips, total, codecs) {
  const oc = new OfflineAudioContext(2, Math.ceil(total * SR), SR);
  for (const c of clips) { const src = oc.createBufferSource(); src.buffer = c.buffer; src.connect(oc.destination); src.start(c.start); }
  const mix = await oc.startRendering(), out = [];
  let failure = null;
  const aenc = new AudioEncoder({ output: (c, m) => out.push([c, m]), error: (e) => { failure = e; } });
  aenc.configure({ codec: codecs.audio.codec, sampleRate: SR, numberOfChannels: 2, bitrate: 192000 });
  const chans = [mix.getChannelData(0), mix.getChannelData(1)];
  for (let off = 0; off < mix.length; off += SR) {
    const n = Math.min(SR, mix.length - off), data = new Float32Array(n * 2);
    data.set(chans[0].subarray(off, off + n), 0); data.set(chans[1].subarray(off, off + n), n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((off / SR) * 1e6), data });
    aenc.encode(ad); ad.close();
  }
  await aenc.flush(); aenc.close();
  if (failure) throw failure;
  return out;
}

/** writes video + audio chunks interleaved in time order and returns the finished file */
function mux({ codecs, W, H, FPS }, video, audio) {
  let m, target, mime, ext;
  if (codecs.format === 'webm') {
    target = new WebmTarget(); mime = 'video/webm'; ext = 'webm';
    m = new WebmMuxer({ target, video: { codec: 'V_VP9', width: W, height: H, frameRate: FPS }, ...(codecs.audio ? { audio: { codec: 'A_OPUS', sampleRate: SR, numberOfChannels: 2 } } : {}) });
  } else {
    target = new Mp4Target(); mime = 'video/mp4'; ext = 'mp4';
    m = new Mp4Muxer({ target, fastStart: 'in-memory', video: { codec: codecs.video.name, width: W, height: H, frameRate: FPS }, ...(codecs.audio ? { audio: { codec: codecs.audio.name, sampleRate: SR, numberOfChannels: 2 } } : {}) });
  }
  let i = 0, j = 0;
  while (i < video.length || j < audio.length) {
    if (j >= audio.length || (i < video.length && video[i][0].timestamp <= audio[j][0].timestamp)) { m.addVideoChunk(...video[i++]); } else { m.addAudioChunk(...audio[j++]); }
  }
  m.finalize();
  return { blob: new Blob([target.buffer], { type: mime }), ext, info: `${codecs.video.name.toUpperCase()}${codecs.audio ? '/' + codecs.audio.name.toUpperCase() : ' · no sound'} ${W}×${H}` };
}

/**
 * Frame-by-frame export on one thread: every frame is rendered and encoded exactly once and the audio is mixed offline,
 * so the result is always complete (same length as the audio) no matter how slow the phone is.
 */
export async function exportOffline({ stage, clips, plan, total, onProgress, cancelled, fps: FPS = 30, level = 'high', format = 'webm', beforeFrame }) {
  const W = stage.W, H = stage.H;
  const silent = !hasVoice(clips);
  let codecs = await pickCodecs(W, H, bitrateFor(W, H, level, format), FPS, format, silent);
  if (!codecs) throw new Error('unsupported');
  const bitrate = bitrateFor(W, H, level, codecs.format), frames = Math.ceil(total * FPS);
  const audioChunks = silent ? [] : await encodeAudio(clips, total, codecs);
  const video = []; let failure = null;
  const venc = new VideoEncoder({ output: (c, m) => video.push([c, m]), error: (e) => { failure = e; } });
  venc.configure({ codec: codecs.video.codec, width: W, height: H, bitrate, framerate: FPS, latencyMode: 'quality', bitrateMode: codecs.bitrateMode });
  for (let i = 0; i < frames; i++) {
    if (cancelled()) throw new Error('cancelled');
    if (failure) throw failure;
    const frame = beforeFrame ? await beforeFrame(i / FPS) : { time: i / FPS, clips, plan };
    stage.render(frame.time, i === 0 ? 0 : 1 / FPS, frame.clips, frame.plan);
    const vf = new VideoFrame(stage.out, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
    venc.encode(vf, { keyFrame: i % (FPS * 2) === 0 }); vf.close();
    while (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4)); // back-pressure keeps memory flat
    if (i % 6 === 0) { onProgress(i / frames); await yieldUI(); }
  }
  await venc.flush(); venc.close();
  if (failure) throw failure;
  onProgress(1);
  return mux({ codecs, W, H, FPS }, video, audioChunks);
}

/** how many parallel renderers this device can reasonably run */
export function workerCount() {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return 0;
  const q = new URLSearchParams(location.search).get('workers'), forced = q === null ? NaN : +q; // e.g. ?workers=4 to experiment, ?workers=0 = one thread
  if (forced >= 0 && forced <= 8) return forced;
  const cores = navigator.hardwareConcurrency || 4, coarse = matchMedia('(pointer: coarse)').matches;
  return Math.max(1, Math.min(coarse ? 3 : 4, Math.floor(cores / 2)));
}

/**
 * Parallel export: the timeline is cut into slices, several workers render + encode slices at the same time,
 * and the slices are stitched together in order. `job` describes the scene (see exportWorker.js).
 */
export async function exportParallel({ job, clips, total, onProgress, cancelled, workers }) {
  const FPS = job.fps, W = job.W, H = job.H;
  const silent = !hasVoice(clips);
  const codecs = await pickCodecs(W, H, bitrateFor(W, H, job.level, job.format), FPS, job.format, silent);
  if (!codecs) throw new Error('unsupported');
  const bitrate = bitrateFor(W, H, job.level, codecs.format), frames = Math.ceil(total * FPS);
  const audioPromise = silent ? Promise.resolve([]) : encodeAudio(clips, total, codecs);   // mixed + encoded here while the workers start up

  // slices of ~4 s (at least 3 per worker, so a slower core just takes fewer slices)
  const segLen = Math.max(FPS * 2, Math.min(FPS * 6, Math.ceil(frames / (workers * 3))));
  const queue = []; for (let from = 0, id = 0; from < frames; from += segLen, id++) queue.push({ id, from, to: Math.min(frames, from + segLen) });
  const results = new Map(); let done = 0, failed = null;
  const pool = [];
  const killAll = () => pool.forEach((w) => w.terminate());
  const jobMsg = { type: 'init', job: { ...job, codec: codecs.video.codec, bitrate, bitrateMode: codecs.bitrateMode } };

  await new Promise((resolve, reject) => {
    let running = workers;
    const fail = (m) => { if (!failed) { failed = new Error(m); killAll(); reject(failed); } };
    for (let k = 0; k < workers; k++) {
      let w;
      try { w = new Worker(new URL('./exportWorker.js', import.meta.url), { type: 'module' }); } catch (e) { fail(`worker: ${e.message}`); return; }
      pool.push(w);
      const next = () => {
        if (cancelled()) { fail('cancelled'); return; }
        const seg = queue.shift();
        if (seg) w.postMessage({ type: 'segment', ...seg });
        else if (--running === 0) resolve();
      };
      w.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'ready') next();
        else if (m.type === 'progress') { done += m.frames; onProgress(Math.min(0.99, done / frames)); }
        else if (m.type === 'segment') { results.set(m.id, m); next(); }
        else if (m.type === 'error') fail(m.message);
      };
      w.onerror = (e) => fail(e.message || 'worker crashed');
      w.postMessage(jobMsg);
    }
  });
  killAll();

  // stitch the slices in order
  const video = [];
  let first = true;
  for (const id of [...results.keys()].sort((a, b) => a - b)) {
    const seg = results.get(id);
    for (const c of seg.chunks) {
      const meta = first ? { decoderConfig: { ...seg.config, description: seg.config.description ? new Uint8Array(seg.config.description) : undefined } } : undefined;
      video.push([new EncodedVideoChunk({ type: c.type, timestamp: c.timestamp, duration: c.duration, data: c.data }), meta]);
      first = false;
    }
  }
  const res = mux({ codecs, W, H, FPS }, video, await audioPromise);
  onProgress(1);
  return { ...res, info: `${res.info} · ${workers} workers` };
}

/* ---------- fallback for browsers without WebCodecs (older Safari / Firefox): real-time recording ---------- */
const TYPES = ['video/webm;codecs=vp9,opus', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'];
export const pickType = () => (window.MediaRecorder && TYPES.find((t) => MediaRecorder.isTypeSupported(t))) || null;

export function exportRealtime({ canvas, stage, audioStream, player, onProgress, level = 'high' }) {
  const mime = pickType();
  if (!mime) throw new Error('This browser cannot export video. Please use Chrome, Edge or a recent Safari.');
  // frames are pushed by hand right after each render, so the video never stalls even when the phone is slow
  const stream = canvas.captureStream(0), vtrack = stream.getVideoTracks()[0];
  if (stage && vtrack?.requestFrame) stage.onFrame = () => vtrack.requestFrame();
  audioStream.getAudioTracks().forEach((t) => stream.addTrack(t));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrateFor(canvas.width, canvas.height, level, mime.startsWith('video/webm') ? 'webm' : 'mp4'), audioBitsPerSecond: 192_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  return new Promise(async (resolve, reject) => {
    rec.onerror = (e) => reject(e.error || new Error('recording failed'));
    rec.onstop = () => { if (stage) stage.onFrame = null; resolve({ blob: new Blob(chunks, { type: mime.split(';')[0] }), ext: mime.startsWith('video/mp4') ? 'mp4' : 'webm', info: 'live recording' }); };
    player.stop(); player.muteSpeakers(true);
    rec.start(250);
    await player.play();
    const tick = () => {
      onProgress(player.time / player.total);
      if (player.time >= player.total - 0.02 || !player.playing) { player.pause(); player.muteSpeakers(false); setTimeout(() => rec.state !== 'inactive' && rec.stop(), 300); }
      else requestAnimationFrame(tick);
    };
    tick();
  });
}
