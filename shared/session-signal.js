// "Signed in somewhere else": the server keeps the id of the account's current session in sessionSignals/{uid}. A device that holds an older
// session id is told the moment it changes, so it signs out at once instead of at the next check.
export const REPLACED_MESSAGE = 'You were signed out because this account was signed in on another device. Please sign in again.';

/**
 * `subscribe(uid, callback)` listens to the signal document and returns a function that stops listening; the callback gets the document
 * data ({ sid }) or null. `onReplaced` runs once, when the signal names a different session than `sid`.
 */
export function watchSessionSignal({ uid, sid, subscribe, onReplaced }) {
  if (!uid || !sid || typeof subscribe !== 'function') return () => {};
  let done = false, stop = () => {};
  const callback = (data) => {
    if (done || !data || typeof data.sid !== 'string' || !data.sid || data.sid === sid) return;
    done = true; stop(); onReplaced(data);
  };
  try { stop = subscribe(uid, callback) || stop; } catch { /* no live channel: the regular check still finds out */ }
  if (done) stop();
  return () => { done = true; stop(); };
}

/**
 * Does this sign-in need a new session? `token` is what Firebase's getIdTokenResult() gives.
 * A fresh Google sign-in always does: the account keeps its last session id as a claim, so such a token carries an OLD id that must not be trusted.
 * Only a token the app got from its own session (a page reload after the custom-token sign-in) already belongs to a session worth checking.
 */
export const needsNewSession = (token) => !token?.claims?.sid || token?.signInProvider === 'google.com';
