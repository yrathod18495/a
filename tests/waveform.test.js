import test from 'node:test';
import assert from 'node:assert/strict';
import { computePeaks, barsFor } from '../src/waveform.js';

test('peaks are the loudest sample of every slice', () => {
  const rate = 1000, samples = new Float32Array(2000);                  // 2 s; one loud burst at 0.5 s and a quieter one at 1.5 s
  samples[500] = 0.9; samples[1500] = -0.4;
  const peaks = computePeaks(samples, rate, 100);                        // 100 per second: 10 samples each
  assert.equal(peaks.length, 200);
  assert.ok(Math.abs(peaks[50] - 0.9) < 1e-6); assert.ok(Math.abs(peaks[150] - 0.4) < 1e-6);          // the negative sample counts as loud too
  assert.equal(peaks[0], 0);
});
test('bars cover only the part of the recording that is on the timeline (a trimmed clip)', () => {
  const peaks = new Float32Array(200); peaks.fill(0.1, 0, 100); peaks.fill(0.8, 100, 200);                // first second quiet, second second loud
  const all = barsFor(peaks, 0, 2, 4, 100); assert.deepEqual([...all].map((v) => +v.toFixed(1)), [0.1, 0.1, 0.8, 0.8]);
  const tail = barsFor(peaks, 1, 2, 4, 100); assert.deepEqual([...tail].map((v) => +v.toFixed(1)), [0.8, 0.8, 0.8, 0.8]);          // trimmed head: only the loud second
  const head = barsFor(peaks, 0, 1, 2, 100); assert.deepEqual([...head].map((v) => +v.toFixed(1)), [0.1, 0.1]);
  assert.equal(barsFor(peaks, 0, 1, 0, 100).length, 0);
});
