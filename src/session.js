import { auth, idToken } from './firebase.js';
import { friendlyError } from '../shared/hinglish-errors.js';
let heartbeat;
function persistent(key) {
  let value = localStorage.getItem(key);
  if (!value) { value = crypto.randomUUID(); localStorage.setItem(key, value); }
  return value;
}
export async function apiCall(url, body, owner = auth.currentUser?.uid) {
  const offline = import.meta.env.DEV && location.search.includes('debug');   // dev test mode: no sign-in, the browser tests answer the API themselves
  if (!offline && (!owner || auth.currentUser?.uid !== owner)) throw Error('Account badal gaya hai. Project dobara kholein.');
  const token = offline ? 'debug' : await idToken();
  if (!offline && auth.currentUser?.uid !== owner) throw Error('Account badal gaya. Dobara try karein.');
  let r;
  try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) }); }
  catch (cause) { const e = Error(friendlyError(cause, 'Server tak request nahi pahunchi. Internet check karke dobara try karein.')); e.code = 'network'; throw e; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = Error(j.error || 'Cloud request fail ho gayi. Dobara try karein.'); e.code = j.code; e.status = r.status; throw e; }
  if (!offline && auth.currentUser?.uid !== owner) throw Error('Account badal gaya. Dobara try karein.');
  return j;
}
export async function acquireSession(scope) {
  return apiCall('/api/security', { action: 'acquire', ...(scope === 'tester' ? { scope } : {}), deviceId: persistent('12toons-device'), secret: persistent('12toons-session-secret') });
}
export async function validateSession() {
  const result = navigator.onLine ? await apiCall('/api/security', { action: 'heartbeat' }) : {offline:true};
  if(!result.offline&&auth.currentUser)localStorage.setItem('12toons-validated-'+auth.currentUser.uid,'true');
  clearInterval(heartbeat);
  heartbeat = setInterval(() => {
    if(!navigator.onLine)return;
    apiCall('/api/security', { action: 'heartbeat' }).catch(e => {
      if (e.status === 401 || e.status === 403) {
        if(auth.currentUser)localStorage.removeItem('12toons-validated-'+auth.currentUser.uid);
        stopSession(); window.dispatchEvent(new CustomEvent('session-revoked', { detail: e.message }));
      }
    });
  }, 5 * 60 * 1000);     // the lease lasts 15 minutes; checking every 5 keeps it alive and a revoked session is noticed within minutes (every API call re-checks it too)
  return result;
}
export const stopSession = () => { clearInterval(heartbeat); heartbeat = null; };
export async function releaseSession() {
  stopSession();
  if(auth.currentUser)localStorage.removeItem('12toons-validated-'+auth.currentUser.uid);
  await apiCall('/api/security', { action: 'logout' });
}
