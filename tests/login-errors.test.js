import test from 'node:test';
import assert from 'node:assert/strict';
import { emailLoginMessage } from '../shared/login-errors.js';

test('sign-in errors are plain English and never reveal whether the email exists', () => {
  const wrong = 'The email or password is not correct. Please try again.';
  for (const code of ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found']) assert.equal(emailLoginMessage({ code }), wrong);
  assert.match(emailLoginMessage({ code: 'auth/invalid-email' }), /valid email/);
  assert.match(emailLoginMessage({ code: 'auth/too-many-requests' }), /wait a few minutes/);
  assert.match(emailLoginMessage({ code: 'auth/network-request-failed' }), /internet/);
  assert.match(emailLoginMessage({ code: 'auth/operation-not-allowed' }), /Email\/Password/);
  assert.match(emailLoginMessage({ message: 'Please verify your email first.' }), /not verified/);
});
test('an unknown error gets a safe generic message, not raw library text', () => {
  assert.equal(emailLoginMessage({ code: 'auth/something-new', message: 'Firebase: Error (auth/something-new).' }), 'Could not sign in. Please try again.');
  assert.equal(emailLoginMessage(null), 'Could not sign in. Please try again.');
  assert.equal(emailLoginMessage(new Error('boom')), 'Could not sign in. Please try again.');
});
