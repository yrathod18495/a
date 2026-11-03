import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateSeconds, prettyTime, estimateMegabytes, rememberSpeed, lastSpeed, rememberSize, sizeRatio, DEFAULT_SIZE_RATIO } from '../shared/export-estimate.js';

test('time: scales with the video length, the picture size and the frame rate; live recording takes as long as the video', () => {
  const base = { duration: 60, pixels: 1280 * 720, fps: 30 };
  const a = estimateSeconds({ ...base, cores: 4 }), b = estimateSeconds({ ...base, duration: 120, cores: 4 });
  assert.equal(a.basis, 'guess'); assert.ok(Math.abs(b.seconds / a.seconds - 2) < 1e-9);                       // twice the video, twice the time
  assert.ok(estimateSeconds({ ...base, pixels: 1920 * 1080, cores: 4 }).seconds > a.seconds * 1.5);          // 1080p is slower than 720p
  assert.ok(estimateSeconds({ ...base, fps: 15, cores: 4 }).seconds < a.seconds * 0.6);                      // fewer frames per second is faster
  assert.ok(estimateSeconds({ ...base, cores: 8 }).seconds < a.seconds);                                      // more cores, faster
  assert.deepEqual(estimateSeconds({ ...base, live: true }), { seconds: 63, basis: 'live' });
});
test('time: a measurement of the last export is used and scaled to the new settings', () => {
  const last = { speed: 2, pixels: 1280 * 720, fps: 30 };                                                     // the last export ran at 2× real time
  const same = estimateSeconds({ duration: 60, pixels: 1280 * 720, fps: 30, last });
  assert.equal(same.basis, 'last'); assert.ok(Math.abs(same.seconds - 30) < 1e-9);                            // 60 s of video at 2× = 30 s
  assert.ok(Math.abs(estimateSeconds({ duration: 60, pixels: 1280 * 720, fps: 15, last }).seconds - 15) < 1e-9);          // half the frames: half the time
});
test('pretty time and size (the audio track is counted)', () => {
  assert.equal(prettyTime(3), '5 s'); assert.equal(prettyTime(42), '40 s'); assert.equal(prettyTime(300), '5 min'); assert.equal(prettyTime(7200), '2.0 h');
  assert.ok(Math.abs(estimateMegabytes({ videoBps: 8e6, duration: 10, audio: false }) - 10) < 1e-9);          // 8 Mbit/s for 10 s = 10 MB
  assert.ok(Math.abs(estimateMegabytes({ videoBps: 8e6, duration: 10, audio: true }) - 10.24) < 1e-9);        // + 0.192 Mbit/s of sound
});
test('the measured speed is remembered between exports', () => {
  const data = new Map(), storage = { setItem: (k, v) => data.set(k, v), getItem: (k) => data.get(k) ?? null };
  assert.equal(lastSpeed(storage), null);
  assert.equal(rememberSpeed({ duration: 0.1, seconds: 1, pixels: 1, fps: 30 }, storage), null);              // too short to measure
  const e = rememberSpeed({ duration: 30, seconds: 15, pixels: 1280 * 720, fps: 30 }, storage);
  assert.equal(e.speed, 2); assert.deepEqual({ ...lastSpeed(storage), at: 0 }, { ...e, at: 0 });
});

test('size: a real file is smaller than bitrate × length; the estimate learns the ratio from the last finished export', () => {
  const store = new Map(), storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(sizeRatio('mp4', storage), DEFAULT_SIZE_RATIO.mp4);                                            // nothing measured yet: the cautious default
  assert.ok(Math.abs(estimateMegabytes({ videoBps: 8e6, duration: 10, audio: false, ratio: 0.1 }) - 1) < 1e-9);   // a tenth of the promised size
  // a 10 s video with sound that came out as 1.5 MB while 8 Mbit/s was asked for
  const ratio = rememberSize({ bytes: 1.5e6, duration: 10, videoBps: 8e6, audio: true, format: 'mp4' }, storage);
  assert.ok(ratio > 0.1 && ratio < 0.2);
  assert.equal(sizeRatio('mp4', storage), ratio); assert.equal(sizeRatio('webm', storage), DEFAULT_SIZE_RATIO.webm);   // per format
  assert.equal(rememberSize({ bytes: 0, duration: 10, videoBps: 8e6, format: 'mp4' }, storage), null);          // nonsense is ignored
});
