import test from 'node:test';
import assert from 'node:assert/strict';
import { syncFailure, syncPresentation } from '../src/sync-feedback.js';

test('auth, access and conflicts give useful actions without blind retry', () => {
  for (const error of [{ status: 401 }, { status: 403 }, { code: 'conflict' }, { code: 'session_revoked' }]) {
    const result = syncFailure({ message: 'server detail', ...error });
    assert.equal(result.retryable, false); assert.equal(result.detail, 'server detail');
  }
  assert.match(syncFailure({ status: 401 }).message, /Sign in again/);
  assert.match(syncFailure({ code: 'conflict' }).message, /My Projects/);
});
test('network failures can retry; storage setup and quota errors need corrective action', () => {
  assert.equal(syncFailure(Error('Failed to fetch')).retryable, true);
  assert.equal(syncFailure({ status: 503, message: 'R2 is not configured on the server.' }).retryable, false);
  assert.match(syncFailure({ code: 'quota_exceeded' }).message, /storage is full/);
});
test('offline, pending and failed sync never claim a successful cloud save', () => {
  for (const text of ['Offline', 'Saving', 'Sync Failed', 'Conflict']) {
    assert.match(syncPresentation({ text }).label, /^Saved locally/);
    assert.notEqual(syncPresentation({ text }).tone, 'saved');
  }
  assert.equal(syncPresentation({ text: 'Saved to Cloud' }).tone, 'saved');
});
