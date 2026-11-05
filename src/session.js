import { auth, idToken, firestore } from './firebase.js';
import { watchSessionSignal, REPLACED_MESSAGE } from '../shared/session-signal.js';
import { friendlyError } from '../shared/hinglish-errors.js';
let heartbeat;
function persistent(key) {
  let value = localStorage.getItem(key);
  if (!value) { value = crypto.randomUUID(); localStorage.setItem(key, value); }
  return value;
}
let cloudRender = null;
/** the cloud export render page has no sign-in: its read-only library calls are sent through /api/export with the job's secret instead */
export const setCloudRenderAuth = (a) => { cloudRender = a; };
export const cloudRenderOwner = () => cloudRender?.uid || null;
async function cloudProxyCall(url, body) {
  const r = await fetch('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cloudStudio', uid: cloudRender.uid, jobId: cloudRender.jobId, secret: cloudRender.secret, route: url.replace(/^\/api\//, ''), body }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = Error(j.error || 'The cloud request failed. Please try again.'); e.code = j.code; e.status = r.status; throw e; }
  return j;
}
export async function apiCall(url, body, owner = auth.currentUser?.uid) {
  if (cloudRender && url === '/api/studio-assets') return cloudProxyCall(url, body);
  const offline = import.meta.env.DEV && location.search.includes('debug');   // dev test mode: no sign-in, the browser tests answer the API themselves
  if (!offline && (!owner || auth.currentUser?.uid !== owner)) throw Error('The account has changed. Please reopen the project.');
  const token = offline ? 'debug' : await Promise.race([idToken(), new Promise((_, no) => setTimeout(() => { const e = Error('Signing in took too long. Please check your internet and try again.'); e.code = 'network'; no(e); }, 15000))]);
  if (!offline && auth.currentUser?.uid !== owner) throw Error('The account has changed. Please try again.');
  let r;
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 25000);          // a request that never answers must not hold a page open forever
  try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body), signal: ctl.signal }); }
  catch (cause) { const e = Error(cause?.name === 'AbortError' ? 'The server took too long to answer. Please try again.' : friendlyError(cause, 'The request did not reach the server. Please check your internet and try again.')); e.code = 'network'; throw e; }
  finally { clearTimeout(timer); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = Error(j.error || 'The cloud request failed. Please try again.'); e.code = j.code; e.status = r.status; throw e; }
  if (!offline && auth.currentUser?.uid !== owner) throw Error('The account has changed. Please try again.');
  return j;
}
export async function acquireSession() {
  // A new login always works: if the account is signed in somewhere else, that older login is ended (and told at once, see watchSignal)
  return apiCall('/api/security', { action: 'acquire', deviceId: persistent('12toons-device'), secret: persistent('12toons-session-secret') });
}
let stopSignal = () => {};
/** listen for the account being signed in somewhere else, so this device signs out the moment it happens */
async function watchSignal() {
  stopSignal(); stopSignal = () => {};
  const offline = import.meta.env.DEV && location.search.includes('debug');
  const user = auth.currentUser;
  if (offline || !user || !navigator.onLine) return;
  try {
    const sid = (await user.getIdTokenResult()).claims.sid;
    stopSignal = watchSessionSignal({
      uid: user.uid, sid,
      subscribe: (uid, callback) => {
        let stop = () => {}, cancelled = false;
        firestore().then(({ db, doc, onSnapshot }) => { if (!cancelled) stop = onSnapshot(doc(db, 'sessionSignals', uid), (snap) => callback(snap.data() || null), () => {}); }).catch(() => {});   // no access to the signal (rules not updated yet): the regular check still works
        return () => { cancelled = true; stop(); };
      },
      onReplaced: () => {
        if (auth.currentUser?.uid === user.uid) localStorage.removeItem('12toons-validated-' + user.uid);
        stopSession(); window.dispatchEvent(new CustomEvent('session-revoked', { detail: REPLACED_MESSAGE }));
      },
    });
  } catch { /* the regular check still finds out */ }
}
export async function validateSession() {
  const result = navigator.onLine ? await apiCall('/api/security', { action: 'heartbeat' }) : {offline:true};
  if(!result.offline&&auth.currentUser)localStorage.setItem('12toons-validated-'+auth.currentUser.uid,'true');
  clearInterval(heartbeat);
  watchSignal();
  heartbeat = setInterval(() => {
    if(!navigator.onLine)return;
    apiCall('/api/security', { action: 'heartbeat' }).catch(e => {
      if (e.status === 401 || e.status === 403) {
        if(auth.currentUser)localStorage.removeItem('12toons-validated-'+auth.currentUser.uid);
        stopSession(); window.dispatchEvent(new CustomEvent('session-revoked', { detail: e.message }));
      }
    });
  }, 5 * 60 * 1000);     // sessions never expire; this check only notices quickly when the account was signed in on another device (every API call re-checks it too)
  return result;
}
export const stopSession = () => { clearInterval(heartbeat); heartbeat = null; stopSignal(); stopSignal = () => {}; };
export async function releaseSession() {
  stopSession();
  if(auth.currentUser)localStorage.removeItem('12toons-validated-'+auth.currentUser.uid);
  await apiCall('/api/security', { action: 'logout' });
}
