import test from 'node:test';
import assert from 'node:assert/strict';
import { LOADING_LINES, nextLine } from '../shared/loading-lines.js';

test('the loading lines are plain English, short, unique, and the first one is the slogan', () => {
  assert.ok(LOADING_LINES.length >= 6);
  assert.equal(new Set(LOADING_LINES).size, LOADING_LINES.length);
  assert.equal(LOADING_LINES[0], 'Your story, your toons.');
  for (const line of LOADING_LINES) { assert.ok(line.length <= 80, line); assert.ok(/^[\x20-\x7E]+$/.test(line), line); assert.doesNotMatch(line, /\b(yaar|kro|hai|bhai|nahi)\b/i); }
});
test('the next line wraps around to the first', () => {
  assert.equal(nextLine(0), 1);
  assert.equal(nextLine(LOADING_LINES.length - 1), 0);
  assert.equal(nextLine(0, ['a']), 0);
});
