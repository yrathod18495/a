import test from 'node:test';
import assert from 'node:assert/strict';
import { watchSessionSignal, REPLACED_MESSAGE } from '../shared/session-signal.js';

const channel = () => { const listeners = new Set(); return { subscribe: (uid, cb) => { listeners.add(cb); return () => listeners.delete(cb); }, push: (data) => [...listeners].forEach((cb) => cb(data)), count: () => listeners.size }; };

test('a signal naming a different session signs this device out, once, and stops listening', () => {
  const ch = channel(); let replaced = 0;
  watchSessionSignal({ uid: 'u', sid: 'mine', subscribe: ch.subscribe, onReplaced: () => { replaced += 1; } });
  ch.push({ sid: 'mine' }); ch.push(null); ch.push({});                      // the own session, an empty document, nothing useful: ignored
  assert.equal(replaced, 0);
  ch.push({ sid: 'someone-else' });
  assert.equal(replaced, 1); assert.equal(ch.count(), 0);
  ch.push({ sid: 'another' }); assert.equal(replaced, 1);
});
test('stopping the watch removes the listener and no later signal is acted on', () => {
  const ch = channel(); let replaced = 0;
  const stop = watchSessionSignal({ uid: 'u', sid: 'mine', subscribe: ch.subscribe, onReplaced: () => { replaced += 1; } });
  assert.equal(ch.count(), 1); stop(); assert.equal(ch.count(), 0);
  ch.push({ sid: 'x' }); assert.equal(replaced, 0);
});
test('no session id, no user, or a broken channel: nothing happens and nothing throws', () => {
  assert.equal(typeof watchSessionSignal({ uid: 'u', sid: undefined, subscribe: () => { throw Error('x'); }, onReplaced() {} }), 'function');
  assert.equal(typeof watchSessionSignal({ uid: '', sid: 'a', subscribe: () => () => {}, onReplaced() {} }), 'function');
  assert.equal(typeof watchSessionSignal({ uid: 'u', sid: 'a', subscribe: () => { throw Error('offline'); }, onReplaced() {} }), 'function');
});
test('a signal that arrives before the listener is returned still signs the device out', () => {
  let replaced = 0, stopped = 0;
  watchSessionSignal({ uid: 'u', sid: 'mine', subscribe: (uid, cb) => { cb({ sid: 'new' }); return () => { stopped += 1; }; }, onReplaced: () => { replaced += 1; } });
  assert.equal(replaced, 1); assert.ok(stopped >= 1);
});
test('the message tells the user plainly what happened', () => {
  assert.match(REPLACED_MESSAGE, /signed in on another device/); assert.match(REPLACED_MESSAGE, /sign in again/);
});
