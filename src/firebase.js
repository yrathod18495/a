// Firebase (login + database). The web config below is public by design (it only names the project);
// what protects the data are the Firestore rules (firebase/firestore.rules) and the server check in api/r2.js.
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { initializeFirestore, doc, getDoc, setDoc, collection, getDocs, deleteDoc } from 'firebase/firestore';

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
export const db = initializeFirestore(app, { experimentalForceLongPolling: true }, DATABASE_ID);
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
  async function handleUser(user) {
    if (!user) { (await import('./session.js')).stopSession(); cb(null); return; }
    try {
      const session = await import('./session.js');
      if (!navigator.onLine && localStorage.getItem('12toons-validated-'+user.uid)) {
        await session.validateSession();cb(user);return;
      }
      const token = await user.getIdTokenResult();
      if (!token.claims.sid) {
        const acquired = await session.acquireSession();
        if (auth.currentUser?.uid !== user.uid) return;
        const credential=await signInWithCustomToken(auth, acquired.token);
        await session.validateSession();
        if(auth.currentUser?.uid===credential.user.uid)cb(credential.user);
        return;
      }
      await session.validateSession();
      if (auth.currentUser?.uid === user.uid) cb(user);
    } catch (e) {
      window.dispatchEvent(new CustomEvent('session-error', { detail: e.message }));
      await signOut(auth);
    }
  }
  return onAuthStateChanged(auth, refresh);
};
window.addEventListener('session-revoked', () => { signOut(auth); });
export const idToken = () => auth.currentUser?.getIdToken();

/** every user's own space: workspaces/{uid}  (+ sub-collections) */
export const wsDoc = (uid, ...path) => doc(db, 'workspaces', uid, ...path);
export { doc, getDoc, setDoc, collection, getDocs, deleteDoc };

