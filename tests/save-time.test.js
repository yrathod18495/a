import test from 'node:test';
import assert from 'node:assert/strict';
import { agoText, saveLabel } from '../shared/save-time.js';

test('agoText reads like a person would say it', () => {
  assert.equal(agoText(0), 'just now'); assert.equal(agoText(9000), 'just now');
  assert.equal(agoText(10000), '10 s ago'); assert.equal(agoText(34000), '30 s ago'); assert.equal(agoText(59000), '50 s ago');
  assert.equal(agoText(60000), '1 min ago'); assert.equal(agoText(125000), '2 min ago'); assert.equal(agoText(59 * 60000), '59 min ago');
  assert.equal(agoText(60 * 60000), '1 h ago'); assert.equal(agoText(5 * 3600000), '5 h ago');
  assert.equal(agoText(30 * 3600000), 'yesterday'); assert.equal(agoText(3 * 86400000), '3 days ago');
  assert.equal(agoText(-5000), 'just now');                                          // a clock that went back
});
test('the time is added only where the state means "saved"', () => {
  const now = 1_000_000;
  assert.equal(saveLabel('Saved to cloud', 'saved', now - 125000, now), 'Saved to cloud · 2 min ago');
  assert.equal(saveLabel('Saved locally', 'local', now - 5000, now), 'Saved locally · just now');
  assert.equal(saveLabel('Saved locally · syncing…', 'saving', now - 5000, now), 'Saved locally · syncing…');
  assert.equal(saveLabel('Saved locally · offline', 'offline', now - 5000, now), 'Saved locally · offline');
  assert.equal(saveLabel('Local save failed', 'error', now - 5000, now), 'Local save failed');
  assert.equal(saveLabel('Saved locally', 'local', null, now), 'Saved locally');             // no time known yet
});
