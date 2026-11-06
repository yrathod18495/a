import { gpuEncodeConfig, connectGpuEncoder } from './gpu-encode.js';
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from 'mp4-muxer';
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from 'webm-muxer';
import { audibleClips, playClip } from './audio-mix.js';
import { avcCodecsFor, vp9CodecsFor } from './export-levels.js';

/*
 * Two output formats:
 *  - WebM (VP9 + Opus): same sharpness at roughly half the file size
 *  - MP4  (H.264 + AAC): plays everywhere (older phones, editors, WhatsApp ...)
 * Bitrate is per pixel, independent of fps (a 15 fps video keeps the same sharpness per frame).
 */
export const BITRATE_LEVELS = { mp4: { std: 0.2, high: 0.4, max: 0.7 }, webm: { std: 0.045, high: 0.08, max: 0.16 } };
export const bitrateFor = (W, H, level = 'high', format = 'webm', fps = 30) => {
  const k = (BITRATE_LEVELS[format] || BITRATE_LEVELS.mp4)[level] ?? 0.12, more = Math.pow(Math.max(1, fps / 30), 0.6);          // more frames per second need more bits (not three times: neighbouring frames are alike)
  return Math.round(Math.min(fps > 60 ? 110_000_000 : 80_000_000, Math.max(format === 'webm' ? 1_200_000 : 2_500_000, W * H * 30 * k * more)));
};
const yieldUI = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = r; c.port2.postMessage(0); });
const SR = 48000;

function isCloudRenderPage() {
  return typeof location !== 'undefined' && /^#\/cloudrender(?:\/|$)/.test(location.hash);
}

let cachedNvidiaWebGL;
function hasNvidiaWebGL() {
  if (cachedNvidiaWebGL !== undefined) return cachedNvidiaWebGL;
  cachedNvidiaWebGL = false;
  if (typeof document === 'undefined') return false;
  let gl;
  try {
    const canvas = document.createElement('canvas');
    gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return false;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    cachedNvidiaWebGL = /nvidia|tesla\s+t4/i.test(String(renderer));
  } catch { cachedNvidiaWebGL = false; }
  finally {
    try { gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* best effort */ }
  }
  return cachedNvidiaWebGL;
}

/** Best codec pair this device can encode for the wanted format (falls back to the other format when needed). */
async function pickCodecs(W, H, bitrate, FPS, format = 'webm', silent = false) {
  if (!window.VideoEncoder || !window.VideoFrame || (!silent && (!window.AudioEncoder || !window.AudioData))) return null;
  // Cloud rendering on an NVIDIA GPU should prefer the hardware encoder (e.g. T4 NVENC).
  // If the browser cannot support that preference for this codec/size/fps, retry its default selection.
  const acceleration = isCloudRenderPage() && hasNvidiaWebGL() ? ['prefer-hardware', null] : [null];
  // the level in the codec string is chosen from the picture size and the fps (4K at 60 fps is H.264 level 5.2, at 90 fps level 6.0), not one fixed level
  const vp9 = vp9CodecsFor(W, H, FPS).map((c) => ['vp9', c]), avc = avcCodecsFor(W, H, FPS).map((c) => ['avc', c]);
  const tryOrder = format === 'webm' ? [['webm', vp9], ['mp4', [...avc, ...vp9]]] : [['mp4', [...avc, ...vp9]]];
  for (const [fmt, vlist] of tryOrder) {
    let video = null;
    for (const [name, codec] of vlist) {
      for (const hardwareAcceleration of acceleration) {
        const config = { codec, width: W, height: H, bitrate, framerate: FPS, ...(hardwareAcceleration ? { hardwareAcceleration } : {}) };
        try {
          if ((await VideoEncoder.isConfigSupported(config)).supported) {
            video = { name, codec, ...(hardwareAcceleration ? { hardwareAcceleration } : {}) };
            if (isCloudRenderPage()) console.info(`Cloud export: ${name} encoder selected${hardwareAcceleration ? ' (hardware preferred)' : ' (browser default)'}.`);
            break;
          }
        } catch { /* try default or next codec */ }
      }
      if (video) break;
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
const hasVoice = (clips, music) => clips.some((c) => c.buffer) || (music || []).some((m) => m.buffer && !m.muted);

/** voice lines -> one stereo track -> encoded audio chunks */
/** all the sound of the video mixed into one buffer: the voice lines (mute / solo / volume / fades) and the background music (`music` = [{buffer, start, end, volume, fadeIn, fadeOut, muted}]) */
export async function mixAudio(clips, total, music = []) {
  const oc = new OfflineAudioContext(2, Math.ceil(total * SR), SR);
  for (const m of music) if (m.buffer && !m.muted && m.end > m.start) playClip(oc, { ...m, loop: true }, oc.destination, m.start, 0);
  for (const c of audibleClips(clips)) playClip(oc, c, oc.destination, c.start, 0);
  return oc.startRendering();
}
async function encodeAudio(clips, total, codecs, music = []) {
  const mix = await mixAudio(clips, total, music), out = [];
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
export async function exportOffline({ stage, clips, plan, total, onProgress, cancelled, fps: FPS = 30, level = 'high', format = 'webm', beforeFrame, music = [] }) {
  const W = stage.W, H = stage.H;
  const silent = !hasVoice(clips, music);
  let codecs = await pickCodecs(W, H, bitrateFor(W, H, level, format, FPS), FPS, format, silent);
  if (!codecs) throw new Error('unsupported');
  const bitrate = bitrateFor(W, H, level, codecs.format, FPS), frames = Math.ceil(total * FPS);
  const audioChunks = silent ? [] : await encodeAudio(clips, total, codecs, music);
  const video = []; let failure = null;
  const venc = new VideoEncoder({ output: (c, m) => video.push([c, m]), error: (e) => { failure = e; } });
  venc.configure({ codec: codecs.video.codec, width: W, height: H, bitrate, framerate: FPS, latencyMode: 'quality', bitrateMode: codecs.bitrateMode, ...(codecs.video.hardwareAcceleration ? { hardwareAcceleration: codecs.video.hardwareAcceleration } : {}) });
  for (let i = 0; i < frames; i++) {
    if (cancelled()) throw new Error('cancelled');
    if (failure) throw failure;
    const frame = beforeFrame ? await beforeFrame(i / FPS) : { time: i / FPS, clips, plan };
    stage.render(frame.time, i === 0 ? 0 : 1 / FPS, frame.clips, frame.plan);
    const vf = new VideoFrame(stage.out, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
    venc.encode(vf, { keyFrame: i % (FPS * 2) === 0 }); vf.close();
    while (venc.encodeQueueSize > 6) { if (cancelled()) throw new Error('cancelled'); await new Promise((r) => setTimeout(r, 4)); } // back-pressure keeps memory flat; still checked here so Cancel is not stuck behind a full encoder queue
    await yieldUI(); if (i % 6 === 0) onProgress(i / frames);          // yield every frame so the tab stays responsive (Cancel, repaint) during a heavy single-thread export; the percentage itself need not update as often
  }
  await venc.flush(); venc.close();
  if (failure) throw failure;
  onProgress(1);
  return mux({ codecs, W, H, FPS }, video, audioChunks);
}

/** how many parallel renderers this device can reasonably run */
export function workerCount() {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return 0;
  const q = new URLSearchParams(location.search).get('workers'), forced = q === null ? NaN : +q; // ?workers=4 overrides; ?workers=0 forces single-thread mode
  if (Number.isInteger(forced) && forced >= 0 && forced <= 8) return forced;
  const cores = Math.max(1, navigator.hardwareConcurrency || 2), coarse = matchMedia('(pointer: coarse)').matches;
  // The cloud renderer is a dedicated GPU machine, not a phone. On NVIDIA WebGL,
  // use up to the available logical CPUs (capped at four) for frame-slice workers.
  // This is what lets a two-vCPU Colab T4 use two workers instead of floor(2 / 2) = one.
  if (isCloudRenderPage() && hasNvidiaWebGL()) {
    const count = Math.max(1, Math.min(4, cores));
    console.info(`Cloud export: NVIDIA WebGL detected; using ${count} frame worker(s) on ${cores} logical CPU(s).`);
    return count;
  }
  return Math.max(1, Math.min(coarse ? 3 : 4, Math.floor(cores / 2)));
}

/**
 * Parallel export: the timeline is cut into slices, several workers render + encode slices at the same time,
 * and the slices are stitched together in order. `job` describes the scene (see exportWorker.js).
 */
export async function exportParallel({ job, clips, total, onProgress, cancelled, workers, music = [] }) {
  const FPS = job.fps, W = job.W, H = job.H;
  const silent = !hasVoice(clips, music);
  // On the cloud machine the worker can offer a GPU video encoder (ffmpeg + NVENC): frames go there instead of this browser's CPU encoder.
  let gpu = null; const gpuCfg = gpuEncodeConfig();
  if (gpuCfg) { try { gpu = await connectGpuEncoder(gpuCfg); console.info(`Cloud export: GPU encoder connected (${gpu.codec}).`); } catch (e) { console.warn('GPU encoder not available, using the browser encoder:', e.message); } }
  const codecs = gpu ? { format: 'mp4', video: { name: 'avc', codec: 'gpu' }, audio: null, bitrateMode: 'constant' } : await pickCodecs(W, H, bitrateFor(W, H, job.level, job.format, FPS), FPS, job.format, silent);
  if (!codecs) throw new Error('unsupported');
  const bitrate = bitrateFor(W, H, job.level, codecs.format, FPS), frames = Math.ceil(total * FPS);
  const audioPromise = gpu || silent ? Promise.resolve([]) : encodeAudio(clips, total, codecs, music);   // mixed + encoded here while the workers start up

  // slices of ~4 s (at least 3 per worker, so a slower core just takes fewer slices)
  // 4–8 second slices balance worker scheduling against repeated per-slice
  // DragonBones/cloth warm-up. More workers still receive at least ~2 slices each.
  const segLen = isCloudRenderPage()
    ? Math.max(FPS * 4, Math.min(FPS * 8, Math.ceil(frames / (workers * 2))))
    : Math.max(FPS * 2, Math.min(FPS * 6, Math.ceil(frames / (workers * 3))));          // phones and computers keep the original split
  const queue = []; for (let from = 0, id = 0; from < frames; from += segLen, id++) queue.push({ id, from, to: Math.min(frames, from + segLen) });
  const results = new Map(); let done = 0, failed = null;
  const clockTotal = {}, startedAt = performance.now();          // where the workers spent their time: shows whether drawing or encoding is the slow part
  const pool = [];
  const killAll = () => pool.forEach((w) => w.terminate());
  // the cloud machine encodes in software on few CPU cores (Chrome has no NVENC on Linux): the lighter 'realtime' mode costs the CPU much less than 'quality'
  const jobMsg = { type: 'init', job: { ...job, ...(gpu ? { gpuenc: gpuCfg } : {}), latencyMode: isCloudRenderPage() ? 'realtime' : 'quality', codec: codecs.video.codec, bitrate, bitrateMode: codecs.bitrateMode, ...(codecs.video.hardwareAcceleration ? { hardwareAcceleration: codecs.video.hardwareAcceleration } : {}) } };

  let watch = 0;
  await new Promise((resolve, reject) => {
    let running = workers;
    const fail = (m) => { if (!failed) { failed = new Error(m); killAll(); reject(failed); } };
    watch = setInterval(() => { if (cancelled()) fail('cancelled'); }, 80);          // Cancel works at once: the workers are stopped now, not when they finish their slice
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
        else if (m.type === 'segment') { results.set(m.id, m); if (m.clock) for (const k of Object.keys(m.clock)) clockTotal[k] = (clockTotal[k] || 0) + m.clock[k]; next(); }
        else if (m.type === 'error') fail(m.message);
      };
      w.onerror = (e) => fail(e.message || 'worker crashed');
      w.postMessage(jobMsg);
    }
  }).catch((e) => { gpu?.close(); throw e; }).finally(() => clearInterval(watch));
  killAll();
  if (gpu) return finishOnGpu({ gpu, results, clips, total, music, silent, onProgress, frames, workers, W, H, clockTotal, startedAt });

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
  if (isCloudRenderPage()) {
    const sum = Object.values(clockTotal).reduce((a, b) => a + b, 0) || 1, pct = (k) => `${Math.round(((clockTotal[k] || 0) / sum) * 100)}%`, secs = (performance.now() - startedAt) / 1000;
    console.info(`Cloud export timing: ${frames} frames in ${secs.toFixed(1)} s (${(frames / secs).toFixed(1)} fps) on ${workers} worker(s) · worker time: drawing ${pct('render')}, handing frames to the encoder ${pct('submit')}, waiting for a busy encoder ${pct('wait')}, finishing the encoder ${pct('flush')}, warm-up ${pct('warm')}`);
  }
  const res = mux({ codecs, W, H, FPS }, video, await audioPromise);
  onProgress(1);
  return { ...res, info: `${res.info} · ${workers} workers${codecs.video.hardwareAcceleration ? ' · hardware encode preferred' : ''}` };
}

/** the slices are encoded: send the sound, ask the worker to join everything, and take the finished MP4 back */
async function finishOnGpu({ gpu, results, clips, total, music, silent, onProgress, frames, workers, W, H, clockTotal, startedAt }) {
  try {
    if (!silent) {
      const mix = await mixAudio(clips, total, music), n = mix.length, inter = new Float32Array(n * 2), left = mix.getChannelData(0), right = mix.getChannelData(1);
      for (let i = 0; i < n; i++) { inter[2 * i] = left[i]; inter[2 * i + 1] = right[i]; }
      gpu.send({ t: 'audio' }); gpu.send(inter.buffer);
    }
    const pieces = []; let got = 0, want = Infinity, whenAll = null;
    const all = new Promise((resolve) => { whenAll = resolve; });
    gpu.onBinary = (buffer) => { pieces.push(buffer); got += buffer.byteLength; if (got >= want) whenAll(); };
    gpu.send({ t: 'finish', slices: [...results.keys()].sort((a, b) => a - b) });
    const head = await gpu.wait('final');
    if (!head.ok) throw new Error(`GPU encoder: ${head.error || 'could not join the video'}`);
    want = head.size; if (got >= want) whenAll();
    await all;
    const sum = Object.values(clockTotal).reduce((a, b) => a + b, 0) || 1, pct = (k) => `${Math.round(((clockTotal[k] || 0) / sum) * 100)}%`, secs = (performance.now() - startedAt) / 1000;
    console.info(`Cloud export timing (GPU encode): ${frames} frames in ${secs.toFixed(1)} s (${(frames / secs).toFixed(1)} fps) on ${workers} worker(s) · worker time: drawing ${pct('render')}, copying + sending frames ${pct('submit')}, waiting for the GPU encoder ${pct('wait')}, finishing slices ${pct('flush')}, warm-up ${pct('warm')}`);
    onProgress(1);
    return { blob: new Blob(pieces, { type: 'video/mp4' }), ext: 'mp4', info: `H.264${silent ? ' · no sound' : '/AAC'} ${W}×${H} · GPU encode (${gpu.codec}) · ${workers} workers` };
  } finally { gpu.close(); }
}

/* ---------- fallback for browsers without WebCodecs (older Safari / Firefox): real-time recording ---------- */
const TYPES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
export const pickType = () => (window.MediaRecorder && TYPES.find((t) => MediaRecorder.isTypeSupported(t))) || null;

export function exportRealtime({ canvas, stage, audioStream, player, onProgress, level = 'high' }) {
  const mime = pickType();
  if (!mime) throw new Error('Video export is not supported in this browser. Please use Chrome, Edge or a recent Safari.');
  // frames are pushed by hand right after each render, so the video never stalls even when the phone is slow
  const stream = canvas.captureStream(0), vtrack = stream.getVideoTracks()[0];
  if (stage && vtrack?.requestFrame) stage.onFrame = () => vtrack.requestFrame();
  audioStream.getAudioTracks().forEach((t) => stream.addTrack(t));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrateFor(canvas.width, canvas.height, level, mime.startsWith('video/webm') ? 'webm' : 'mp4'), audioBitsPerSecond: 192_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  return new Promise(async (resolve, reject) => {
    rec.onerror = (e) => reject(e.error || new Error('Recording failed. Please try again.'));
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
