// LEGACY NAMES: this file, and its exports hinglishify/friendlyError/hinglishFor, are named for the old
// Hinglish-only policy. They are kept as-is (many call sites import them by these exact names) but now
// produce plain English, per the current rule in CLAUDE.md.
// This file turns the raw English errors that come from Firebase, the browser, the network and payment gateways into
// plain, user-friendly English. Our own messages are already written in plain English at the place where they are
// thrown; this is the safety net for everything else.
const RULES = [
  [/missing or insufficient permissions|permission-denied|permission_denied/i,
    'You do not have permission for this, or Firebase (Firestore) rules are blocking it. Please sign in again; if it still fails, ask an admin to check the Firestore rules.'],
  [/unauthenticated|auth\/(user-token-expired|id-token-expired|requires-recent-login|user-disabled|invalid-user-token)/i,
    'Your session has expired. Please sign in again.'],
  [/auth\/unauthorized-domain/i,
    'Signing in from this website address is not allowed yet. This domain needs to be added to the authorized domains in Firebase Authentication.'],
  [/auth\/popup-blocked/i, 'The browser blocked the sign-in popup. Please allow popups and try again.'],
  [/auth\/network-request-failed|failed to fetch|networkerror|network request failed|load failed|err_internet_disconnected|err_network/i,
    'There is a problem with your internet connection, or the server is not reachable right now. Please check your connection and try again.'],
  [/auth\/too-many-requests|too many requests|(?:status|http|error)\s*429|^429 https?:/i, 'Too many attempts. Please wait a moment and try again.'],
  [/resource-exhausted|quota exceeded|quota-exceeded/i, 'The server or Firebase limit has been reached. Please try again shortly.'],
  [/deadline-exceeded|timed out|timeout/i, 'This took too long. Please check your internet and try again.'],
  [/failed-precondition.*index|requires an index/i, 'A required index has not been created in Firestore. An admin needs to create the index in the Firebase Console.'],
  [/failed-precondition/i, 'This cannot be done right now. Please reload the page and try again.'],
  [/not-found/i, 'What you were looking for was not found.'],
  [/already-exists/i, 'This already exists.'],
  [/aborted|cancelled by the user/i, 'The task was interrupted. Please try again.'],
  [/unavailable|service unavailable|(?:status|http|error)\s*50[234]|^50[234] https?:/i, 'The server is busy or unavailable right now. Please try again shortly.'],
  [/quotaexceedederror|storage.*full|no space left/i, 'There is not enough space on this device. Please remove some old files and try again.'],
  [/webgl|graphics memory|out of memory|context lost/i, 'Graphics memory ran low. Try lowering the preview quality and try again.'],
  [/server error|internal error|(?:status|http|error)\s*500|^500 https?:/i, 'Something went wrong on the server. Please try again shortly.'],
];
export const hinglishFor = (text) => RULES.find(([pattern]) => pattern.test(String(text || '')))?.[1] || '';

/** a message safe to show: raw technical English becomes plain English, our own plain English passes through unchanged */
export function hinglishify(message) {
  const text = String(message ?? '');
  const hit = hinglishFor(text);
  if (!hit) return text;
  const cut = text.lastIndexOf(': '), prefix = cut > 0 ? text.slice(0, cut) : '';
  return prefix && !/^firebase(error)?$/i.test(prefix) && !hinglishFor(prefix) ? `${prefix}: ${hit}` : hit;
}
export function friendlyError(error, fallback = 'Something went wrong. Please try again.') {
  const raw = error?.code && !/^[a-z_]+$/.test(error.code) ? `${error.code} ${error.message || ''}` : error?.message;
  return hinglishify(raw || fallback) || fallback;
}
