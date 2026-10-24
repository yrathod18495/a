// Errors are shown to users in simple Hinglish (Roman Hindi + common English words). See docs/ERROR-MESSAGES.md.
// This file turns the raw English errors that come from Firebase, the browser, the network and payment gateways into
// Hinglish. Our own messages are already written in Hinglish at the place where they are thrown; this is the safety net.
const RULES = [
  [/missing or insufficient permissions|permission-denied|permission_denied/i,
    'Aapko is kaam ki permission nahi hai, ya Firebase (Firestore) rules is kaam ko rok rahe hain. Dobara sign in karke dekhein; phir bhi na chale to admin se Firestore rules check karwayein.'],
  [/unauthenticated|auth\/(user-token-expired|id-token-expired|requires-recent-login|user-disabled|invalid-user-token)/i,
    'Aapka login khatam ho gaya hai. Dobara sign in karein.'],
  [/auth\/unauthorized-domain/i,
    'Is website ke address se login abhi allowed nahi hai. Firebase Authentication me is domain ko authorized domains me jodna hoga.'],
  [/auth\/popup-blocked/i, 'Browser ne login ki popup rok di. Popup allow karke dobara try karein.'],
  [/auth\/network-request-failed|failed to fetch|networkerror|network request failed|load failed|err_internet_disconnected|err_network/i,
    'Internet connection me dikkat hai ya server abhi nahi mil raha. Connection check karke dobara try karein.'],
  [/auth\/too-many-requests|too many requests|(?:status|http|error)\s*429|^429 https?:/i, 'Bahut zyada koshish ho gayi. Thodi der ruk kar dobara try karein.'],
  [/resource-exhausted|quota exceeded|quota-exceeded/i, 'Server ya Firebase ki limit abhi poori ho gayi hai. Thodi der baad dobara try karein.'],
  [/deadline-exceeded|timed out|timeout/i, 'Kaam me bahut der lag gayi. Internet check karke dobara try karein.'],
  [/failed-precondition.*index|requires an index/i, 'Firestore me ek zaroori index nahi bana hai. Admin ko Firebase Console me index banana hoga.'],
  [/failed-precondition/i, 'Abhi ye kaam is halat me nahi ho sakta. Page reload karke dobara try karein.'],
  [/not-found/i, 'Jo cheez aap dhundh rahe the wo nahi mili.'],
  [/already-exists/i, 'Ye cheez pehle se maujood hai.'],
  [/aborted|cancelled by the user/i, 'Kaam beech me ruk gaya. Dobara try karein.'],
  [/unavailable|service unavailable|(?:status|http|error)\s*50[234]|^50[234] https?:/i, 'Server abhi busy ya band hai. Thodi der baad dobara try karein.'],
  [/quotaexceedederror|storage.*full|no space left/i, 'Is device par jagah kam hai. Kuch purani files hatakar dobara try karein.'],
  [/webgl|graphics memory|out of memory|context lost/i, 'Graphics memory kam pad gayi. Preview quality kam karke dobara try karein.'],
  [/server error|internal error|(?:status|http|error)\s*500|^500 https?:/i, 'Server par kuch gadbad ho gayi. Thodi der baad dobara try karein.'],
];
export const hinglishFor = (text) => RULES.find(([pattern]) => pattern.test(String(text || '')))?.[1] || '';

/** a message safe to show: raw technical English becomes Hinglish, our own Hinglish passes through unchanged */
export function hinglishify(message) {
  const text = String(message ?? '');
  const hit = hinglishFor(text);
  if (!hit) return text;
  const cut = text.lastIndexOf(': '), prefix = cut > 0 ? text.slice(0, cut) : '';
  return prefix && !/^firebase(error)?$/i.test(prefix) && !hinglishFor(prefix) ? `${prefix}: ${hit}` : hit;
}
export function friendlyError(error, fallback = 'Kuch gadbad ho gayi. Dobara try karein.') {
  const raw = error?.code && !/^[a-z_]+$/.test(error.code) ? `${error.code} ${error.message || ''}` : error?.message;
  return hinglishify(raw || fallback) || fallback;
}
