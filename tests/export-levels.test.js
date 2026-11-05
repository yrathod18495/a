import test from 'node:test';
import assert from 'node:assert/strict';
import { avcCodecsFor, vp9CodecsFor, heavyForPlayback } from '../src/export-levels.js';
import { bitrateFor } from '../src/exporter.js';

test('the H.264 level follows the picture size and the frames per second', () => {
  assert.equal(avcCodecsFor(1280, 720, 30)[0], 'avc1.640028');         // 720p30 fits level 4.0
  assert.equal(avcCodecsFor(1920, 1080, 30)[0], 'avc1.640028');
  assert.equal(avcCodecsFor(1920, 1080, 60)[0], 'avc1.64002A');         // 1080p60 needs 4.2
  assert.equal(avcCodecsFor(3840, 2160, 30)[0], 'avc1.640033');         // 4K30: 5.1 (a 4K frame is too big for 5.0)
  assert.equal(avcCodecsFor(3840, 2160, 60)[0], 'avc1.640034');         // 4K60: 5.2
  assert.equal(avcCodecsFor(3840, 2160, 90)[0], 'avc1.64003C');         // 4K90 is above every level up to 5.2: level 6.0
});
test('the VP9 level follows the picture size and the frames per second (never below 4.0)', () => {
  assert.equal(vp9CodecsFor(1280, 720, 30)[0], 'vp09.00.40.08');
  assert.equal(vp9CodecsFor(3840, 2160, 30)[0], 'vp09.00.50.08');
  assert.equal(vp9CodecsFor(3840, 2160, 60)[0], 'vp09.00.51.08');
  assert.equal(vp9CodecsFor(3840, 2160, 90)[0], 'vp09.00.52.08');
});
test('4K above 60 fps is flagged as heavy to play; 4K60 and 2K90 are not', () => {
  assert.equal(heavyForPlayback(3840, 2160, 90), true);
  assert.equal(heavyForPlayback(3840, 2160, 60), false);
  assert.equal(heavyForPlayback(2560, 1440, 90), false);
  assert.equal(heavyForPlayback(854, 480, 24), false);
});
test('more frames per second get a higher bitrate, but not three times as much', () => {
  const b30 = bitrateFor(1920, 1080, 'high', 'mp4', 30), b90 = bitrateFor(1920, 1080, 'high', 'mp4', 90);
  assert.ok(b90 > b30 * 1.5 && b90 < b30 * 3);
  assert.equal(bitrateFor(1920, 1080, 'high', 'mp4'), b30);
});
