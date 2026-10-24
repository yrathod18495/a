import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { hinglishify, friendlyError, hinglishFor } from '../shared/hinglish-errors.js';

test('raw Firebase, browser and network errors become Hinglish', () => {
  assert.match(hinglishify('Missing or insufficient permissions.'), /Firestore\) rules/);
  assert.match(friendlyError({ code: 'permission-denied', message: 'x' }), /Firestore\) rules/);
  assert.match(hinglishify('FirebaseError: auth/popup-blocked'), /^Browser ne login ki popup rok di/);
  assert.match(hinglishify('Could not load: Failed to fetch'), /^Could not load: Internet connection me dikkat/);
  assert.match(friendlyError({ code: 'auth/unauthorized-domain', message: 'x' }), /authorized domains/);
  assert.match(friendlyError({ code: 'resource-exhausted', message: '' }), /limit abhi poori/);
  assert.match(hinglishify('503 https://cdn.example/a.json'), /busy ya band/);
  assert.match(friendlyError(undefined), /Kuch gadbad ho gayi/);
});
test('messages that are already Hinglish, and normal text, pass through unchanged', () => {
  for (const text of ['Pehle verified account se sign in karein.', 'Done in 429s', 'Export rok diya gaya.', 'Video ki length sahi nahi hai.', '']) assert.equal(hinglishify(text), text);
  assert.equal(hinglishFor('Aapka session khatam ho gaya hai. Dobara sign in karein.'), '');
});

// Guard for future code: server error messages are shown to users, so they must be written in Hinglish (docs/ERROR-MESSAGES.md).
const ENGLISH = /\b(the|is|are|was|not|could|couldn't|must|please|invalid|failed|required|your|this|that|choose|enter|unknown|unsupported|no longer|cannot|did not|has not|try again)\b/i;
const HINGLISH = /\b(hai|hain|nahi|nahin|karein|kare|chunein|likhein|ho|hua|hui|gaya|gayi|ka|ki|ke|se|me|par|aap|apna|apni|dobara|pehle|abhi|zaroori|sakta|sakte|paya|payi)\b/i;
test('every server-side error message is written in Hinglish', () => {
  const offenders = [];
  for (const dir of ['api', 'server']) for (const file of readdirSync(new URL(`../${dir}/`, import.meta.url)).filter((name) => name.endsWith('.js'))) {
    readFileSync(new URL(`../${dir}/${file}`, import.meta.url), 'utf8').split('\n').forEach((line, index) => {
      for (const match of line.matchAll(/AccessError\(\s*(?:'[^']*'|`[^`]*`)\s*,\s*('(?:[^'\\]|\\.)*'|`[^`]*`)|\berror:\s*('(?:[^'\\]|\\.)*')|new Error\(\s*('(?:[^'\\]|\\.)*')/g)) {
        const text = [match[1], match[2], match[3]].find(Boolean);
        if (text && ENGLISH.test(text) && !HINGLISH.test(text)) offenders.push(`${dir}/${file}:${index + 1} ${text}`);
      }
    });
  }
  assert.deepEqual(offenders, [], 'English error messages found. Rewrite them in Hinglish (see docs/ERROR-MESSAGES.md):\n' + offenders.join('\n'));
});
