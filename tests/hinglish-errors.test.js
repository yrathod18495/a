import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { hinglishify, friendlyError, hinglishFor } from '../shared/hinglish-errors.js';

test('raw Firebase, browser and network errors become plain English', () => {
  assert.match(hinglishify('Missing or insufficient permissions.'), /Firestore\) rules/);
  assert.match(friendlyError({ code: 'permission-denied', message: 'x' }), /Firestore\) rules/);
  assert.match(hinglishify('FirebaseError: auth/popup-blocked'), /^The browser blocked the sign-in popup/);
  assert.match(hinglishify('Could not load: Failed to fetch'), /^Could not load: There is a problem with your internet connection/);
  assert.match(friendlyError({ code: 'auth/unauthorized-domain', message: 'x' }), /authorized domains/);
  assert.match(friendlyError({ code: 'resource-exhausted', message: '' }), /limit has been reached/);
  assert.match(hinglishify('503 https://cdn.example/a.json'), /busy or unavailable/);
  assert.match(friendlyError(undefined), /Something went wrong/);
});
test('messages that are already plain English, and normal text, pass through unchanged', () => {
  for (const text of ['Please sign in with a verified account.', 'Done in 429s', 'Export was stopped.', 'The video length is not valid.', '']) assert.equal(hinglishify(text), text);
  assert.equal(hinglishFor('Your session has expired. Please sign in again.'), '');
});

// Guard for future code: server error messages are shown to users, so they must be written in plain English (docs/ERROR-MESSAGES.md).
const ENGLISH = /\b(the|is|are|was|not|could|couldn't|must|please|invalid|failed|required|your|this|that|choose|enter|unknown|unsupported|no longer|cannot|did not|has not|try again)\b/i;
const HINGLISH = /\b(hai|hain|nahi|nahin|karein|kare|chunein|likhein|ho|hua|hui|gaya|gayi|ka|ki|ke|se|me|par|aap|apna|apni|dobara|pehle|abhi|zaroori|sakta|sakte|paya|payi)\b/i;
test('every server-side error message is written in plain English', () => {
  const offenders = [];
  for (const dir of ['api', 'server']) for (const file of readdirSync(new URL(`../${dir}/`, import.meta.url)).filter((name) => name.endsWith('.js'))) {
    readFileSync(new URL(`../${dir}/${file}`, import.meta.url), 'utf8').split('\n').forEach((line, index) => {
      for (const match of line.matchAll(/AccessError\(\s*(?:'[^']*'|`[^`]*`)\s*,\s*('(?:[^'\\]|\\.)*'|`[^`]*`)|\berror:\s*('(?:[^'\\]|\\.)*')|new Error\(\s*('(?:[^'\\]|\\.)*')/g)) {
        const text = [match[1], match[2], match[3]].find(Boolean);
        if (text && HINGLISH.test(text) && !ENGLISH.test(text)) offenders.push(`${dir}/${file}:${index + 1} ${text}`);
      }
    });
  }
  assert.deepEqual(offenders, [], 'Hinglish error messages found. Rewrite them in plain English (see docs/ERROR-MESSAGES.md):\n' + offenders.join('\n'));
});
