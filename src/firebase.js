// Firebase (login + database). The web config below is public by design (it only names the project);
// what protects the data are the Firestore rules (firebase/firestore.rules) and the server check in api/r2.js.
import { initializeApp } from 'firebase/app';
import { needsNewSession } from '../shared/session-signal.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';

const env = import.meta.env;
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'AIzaSyAA1mz9xQsdvca0DCaKhEtqr6_tdrgJ6-0',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'twelvelabs-studio-209137-11a91.firebaseapp.com',
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'twelvelabs-studio-209137-11a91',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || 'twelvelabs-studio-209137-11a91.firebasestorage.app',
  messagingSenderId: env.VITE_FIREBASE_SENDER_ID || '156902229475',
  appId: env.VITE_FIREBASE_APP_ID || '1:156902229475:web:b743629fbcb0fffbcd0cd6',
};
const DATABASE_ID = env.VITE_FIRESTORE_DATABASE_ID || '(default)';

const app = initializeApp(config);
export const auth = getAuth(app);
// Firestore is a large library and only a few settings reads use it, so it is loaded the first time one of them runs, not at start-up
let firestoreReady;
export const firestore = () => firestoreReady ||= import('firebase/firestore').then((m) => ({ ...m, db: m.initializeFirestore(app, { experimentalForceLongPolling: true }, DATABASE_ID) }));
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

export async function signInGoogle() {
  try { return (await signInWithPopup(auth, provider)).user; } catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') { await signInWithRedirect(auth, provider); return null; }
    throw e;
  }
}
export const finishRedirect = () => getRedirectResult(auth).catch(() => null);
export async function signOutUser() {
  const session = await import('./session.js');
  try { await session.releaseSession(); } finally { await signOut(auth); }
}
export const onUser = (cb) => {
  let inFlight;
  const refresh = user => {
    if (inFlight && inFlight.uid === user?.uid) return inFlight.promise;
    const promise = handleUser(user);
    const task = inFlight = { uid: user?.uid, promise };
    promise.finally(() => { if (inFlight === task) inFlight = null; });
    return promise;
  };
  /** `cb(user, info)`. info.check = a promise of the server's answer { admin, maintenance, features } (never rejects); info.wait = the page should wait for it (a sign-in that just happened). */
  async function handleUser(user) {
    if (!user) { (await import('./session.js')).stopSession(); cb(null); return; }
    try {
      const session = await import('./session.js');
      if (!navigator.onLine && localStorage.getItem('12toons-validated-'+user.uid)) {
        await session.validateSession();cb(user);return;
      }
      const token = await user.getIdTokenResult();
      if (needsNewSession(token)) {          // a fresh Google sign-in always starts a session (its token may still carry the last, ended, session id)
        const acquired = await session.acquireSession();
        if (auth.currentUser?.uid !== user.uid) return;
        const credential=await signInWithCustomToken(auth, acquired.token);
        if(auth.currentUser?.uid===credential.user.uid)cb(credential.user, { check: bootCheck(session, credential.user), wait: true });
        return;
      }
      // a returning user: the page opens at once from what it already knows; the session is checked in the background (one request)
      if (auth.currentUser?.uid === user.uid) cb(user, { check: bootCheck(session, user), wait: false });
    } catch (e) {
      window.dispatchEvent(new CustomEvent('session-error', { detail: e.message }));
      await signOut(auth);
    }
  }
  /** the one server request of a page load. Only a definite "no" (the session ended or the account is blocked: 401 / 403) signs the user out;
   *  a slow or failed connection never does — the page just keeps what it has and asks again later. */
  function bootCheck(session, user) {
    let tries = 0;
    const ask = async () => {
      try { return await session.validateSession('boot'); }
      catch (e) {
        if (e?.status === 401 || e?.status === 403) {
          if (auth.currentUser?.uid === user.uid) { window.dispatchEvent(new CustomEvent('session-error', { detail: e.message })); await signOut(auth); }
          return null;
        }
        if (++tries < 3) { await new Promise((r) => setTimeout(r, 4000 * tries)); return ask(); }
        return null;
      }
    };
    return ask();
  }
  return onAuthStateChanged(auth, refresh);
};
window.addEventListener('session-revoked', () => { signOut(auth); });
export const idToken = () => auth.currentUser?.getIdToken();

/** every user's own space: workspaces/{uid}  (+ sub-collections) */

