import test from 'node:test';
import assert from 'node:assert/strict';
import { PREVIEW_MODES, previewMode, previewFrameDue, readPreviewMode, savePreviewMode } from '../src/preview-quality.js';

test('preview budgets strictly increase from low to high', () => {
  for (const field of ['short','maxTex']) { assert.ok(PREVIEW_MODES.low[field] < PREVIEW_MODES.medium[field]); assert.ok(PREVIEW_MODES.medium[field] < PREVIEW_MODES.high[field]); }
  for (const mode of Object.values(PREVIEW_MODES)) assert.ok(mode.fps >= 40);          // the preview never drops below 40 fps
  assert.equal(previewMode('invalid'), 'medium');
  assert.equal(PREVIEW_MODES.low.short, 360);
});
test('frame throttling preserves export cadence and device preference tolerates blocked storage', () => {
  assert.equal(previewFrameDue(10,0,'low'), false);
  assert.equal(previewFrameDue(30,0,'low'), true);
  assert.equal(previewFrameDue(40,0,'high'), true);
  assert.equal(previewFrameDue(1,0,'low',true), true);
  globalThis.localStorage = { getItem: () => 'low', setItem: (_, value) => assert.equal(value,'high') };
  assert.equal(readPreviewMode(),'low'); savePreviewMode('high');
  globalThis.localStorage = { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } };
  assert.equal(readPreviewMode(),'medium'); assert.doesNotThrow(()=>savePreviewMode('low'));
});
