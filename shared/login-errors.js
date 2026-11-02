// Plain English for an email + password sign-in that did not work (Firebase error codes in, a sentence out).
const MESSAGES = {
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/missing-password': 'Please enter your password.',
  'auth/invalid-credential': 'The email or password is not correct. Please try again.',
  'auth/wrong-password': 'The email or password is not correct. Please try again.',
  'auth/user-not-found': 'The email or password is not correct. Please try again.',
  'auth/user-disabled': 'This account has been turned off. Please contact support.',
  'auth/too-many-requests': 'Too many attempts. Please wait a few minutes and try again.',
  'auth/network-request-failed': 'The request did not reach the server. Please check your internet and try again.',
  'auth/operation-not-allowed': 'Email sign-in is not switched on yet. Please turn on Email/Password in the Firebase sign-in settings.',
};
export function emailLoginMessage(error) {
  const code = String(error?.code || '');
  if (MESSAGES[code]) return MESSAGES[code];
  if (/verify your email/i.test(String(error?.message || ''))) return 'This email is not verified yet. Please verify it and try again.';
  return 'Could not sign in. Please try again.';
}
