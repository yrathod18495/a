import test from 'node:test';
import assert from 'node:assert/strict';
import { clampPanel, clampTimeline, loadLayout, saveLayout, presetMatch, EXPORT_PRESETS, DEFAULT_LAYOUT } from '../src/studio-layout.js';

const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('panel and timeline sizes stay within sensible bounds', () => {
  assert.equal(clampPanel(100, 1400), 240);
  assert.equal(clampPanel(2000, 1400), 720);
  assert.equal(clampPanel(2000, 900), 540);
  assert.equal(clampPanel(NaN, 1400), 310);
  assert.equal(clampTimeline(10, 800), 110);
  assert.equal(clampTimeline(900, 800), 480);
});
test('layout persists but never restores focus mode', () => {
  const store = memory();
  saveLayout({ ...DEFAULT_LAYOUT, focus: true, panelW: 400, tlH: 300, loop: true }, store);
  const back = loadLayout(store);
  assert.deepEqual(back, { focus: false, panelW: 400, tlH: 300, loop: true });
});
test('broken or missing storage falls back to defaults', () => {
  assert.deepEqual(loadLayout({ getItem: () => '{bad' }), DEFAULT_LAYOUT);
  assert.deepEqual(loadLayout(undefined), DEFAULT_LAYOUT);
  assert.doesNotThrow(() => saveLayout(DEFAULT_LAYOUT, { setItem() { throw new Error('quota'); } }));
});
test('export presets are recognised from the current settings', () => {
  const hd = EXPORT_PRESETS.find(p => p.id === 'hd');
  assert.equal(presetMatch({ quality: hd.quality, format: hd.format, fps: hd.fps, level: hd.level }), 'hd');
  assert.equal(presetMatch({ quality: 720, format: 'webm', fps: 30, level: 'high' }), null);
});
