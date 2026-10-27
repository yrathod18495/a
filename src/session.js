import { auth, idToken } from './firebase.js';
import { friendlyError } from '../shared/hinglish-errors.js';
import { h } from './dom.js';
let heartbeat;
function persistent(key) {
  let value = localStorage.getItem(key);
  if (!value) { value = crypto.randomUUID(); localStorage.setItem(key, value); }
  return value;
}
function confirmTakeover() {
  return new Promise(resolve => {
    const close = v => { window.removeEventListener('keydown', onKey); overlay.remove(); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') close(false); };
    const overlay = h('div', { class: 'project-dialog-backdrop', onclick: e => { if (e.target === overlay) close(false); } },
      h('section', { class: 'project-dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'session-dialog-title' },
        h('span', { class: 'project-dialog-icon', 'aria-hidden': 'true' }, '!'),
        h('h2', { id: 'session-dialog-title' }, 'Another login found'),
        h('p', { class: 'project-dialog-description' }, 'Your account is already signed in on another device. Do you want to continue here?'),
        h('div', { class: 'project-dialog-actions' },
          h('button', { class: 'btn project-dialog-cancel', onclick: () => close(false) }, 'Cancel'),
          h('button', { class: 'btn pri project-dialog-confirm', onclick: () => close(true) }, 'Continue here')),
        h('p', { class: 'project-dialog-description', style: 'margin:14px 0 0' }, 'Continuing will sign out the other device.')));
    window.addEventListener('keydown', onKey);
    document.body.append(overlay);
  });
}
export async function apiCall(url, body, owner = auth.currentUser?.uid) {
  const offline = import.meta.env.DEV && location.search.includes('debug');   // dev test mode: no sign-in, the browser tests answer the API themselves
  if (!offline && (!owner || auth.currentUser?.uid !== owner)) throw Error('The account has changed. Please reopen the project.');
  const token = offline ? 'debug' : await idToken();
  if (!offline && auth.currentUser?.uid !== owner) throw Error('The account has changed. Please try again.');
  let r;
  try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) }); }
  catch (cause) { const e = Error(friendlyError(cause, 'The request did not reach the server. Please check your internet and try again.')); e.code = 'network'; throw e; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = Error(j.error || 'The cloud request failed. Please try again.'); e.code = j.code; e.status = r.status; throw e; }
  if (!offline && auth.currentUser?.uid !== owner) throw Error('The account has changed. Please try again.');
  return j;
}
export async function acquireSession(scope) {
  const body = { action: 'acquire', ...(scope === 'tester' ? { scope } : {}), deviceId: persistent('12toons-device'), secret: persistent('12toons-session-secret') };
  try { return await apiCall('/api/security', body); }
  catch (e) {
    if (e.code !== 'session_active' || !(await confirmTakeover())) throw e;
    return apiCall('/api/security', { ...body, force: true });
  }
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
  }, 5 * 60 * 1000);     // sessions never expire; this check only notices quickly when the account was signed in on another device (every API call re-checks it too)
  return result;
}
export const stopSession = () => { clearInterval(heartbeat); heartbeat = null; };
export async function releaseSession() {
  stopSession();
  if(auth.currentUser)localStorage.removeItem('12toons-validated-'+auth.currentUser.uid);
  await apiCall('/api/security', { action: 'logout' });
}
