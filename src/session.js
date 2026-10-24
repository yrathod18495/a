import { auth, idToken } from './firebase.js';
let heartbeat;
function persistent(key) {
  let value = localStorage.getItem(key);
  if (!value) { value = crypto.randomUUID(); localStorage.setItem(key, value); }
  return value;
}
export async function apiCall(url, body, owner = auth.currentUser?.uid) {
  if (!owner || auth.currentUser?.uid !== owner) throw Error('Account changed. Reopen the project.');
  const token = await idToken();
  if (auth.currentUser?.uid !== owner) throw Error('Account changed.');
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = Error(j.error || 'Cloud request failed'); e.code = j.code; e.status = r.status; throw e; }
  if (auth.currentUser?.uid !== owner) throw Error('Account changed.');
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
  }, 60000);
  return result;
}
export const stopSession = () => { clearInterval(heartbeat); heartbeat = null; };
export async function releaseSession() {
  stopSession();
  if(auth.currentUser)localStorage.removeItem('12toons-validated-'+auth.currentUser.uid);
  await apiCall('/api/security', { action: 'logout' });
}
