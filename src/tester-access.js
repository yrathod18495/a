import { friendlyError } from '../shared/hinglish-errors.js';
import { h } from './dom.js';
import { apiCall } from './session.js';

export function testerAccessView({ user, status = 'none', error = '', accessOnly = false, home, toast, login, continueApproved, signOut, onApproved }) {
  let state = status, disposed = false, timer = 0, busy = false;
  const root = h('main', { class: 'sh sh-center tester-access-page' });
  const card = h('section', { class: 'sh-login tester-access-card', 'aria-live': 'polite' });
  root.append(card);

  function render() {
    const heading = state === 'pending' ? 'Approval pending'
      : state === 'rejected' ? 'Request not approved'
        : state === 'revoked' ? 'Tester access was removed'
          : state === 'approved' ? 'Access approved'
            : 'Request tester access';
    const detail = state === 'pending'
      ? 'You are signed in with Google. Admin approval is pending. This page will update when an admin approves your account.'
      : state === 'rejected' ? 'An admin did not approve this request. You can send a new request if you still need tester access.'
        : state === 'revoked' ? 'Your account does not currently have tester access. You can submit a new request for review.'
          : state === 'approved' && accessOnly ? 'Your request is approved. Continue with Google to start a secure session and open the tester page.'
            : state === 'approved' ? 'Opening the tester page…'
              : user ? 'Send an access request for this Google account. An admin must approve it before the tester page opens.'
                : 'Sign in with Google to request access. An admin must approve your account before the tester page opens.';
    const actions = [];
    if (!user) actions.push(h('button', { class: 'btn pri big gbtn', disabled: busy, onclick: login }, h('span', { class: 'g' }, 'G'), 'Continue with Google'));
    else if (state === 'none' || state === 'rejected' || state === 'revoked') actions.push(h('button', { class: 'btn pri big', disabled: busy, onclick: requestAccess }, busy ? 'Sending request…' : state === 'none' ? 'Request tester access' : 'Request again'));
    else if (state === 'approved' && accessOnly) actions.push(h('button', { class: 'btn pri big gbtn', disabled: busy, onclick: continueApproved }, h('span', { class: 'g' }, 'G'), 'Continue with Google'));
    if (user && error && state !== 'approved') actions.push(h('button', { class: 'btn', onclick: login }, 'Continue with Google again'));
    if (state === 'pending') actions.push(h('span', { class: 'tester-pending-indicator' }, 'Checking for an update…'));
    card.replaceChildren(
      h('div', { class: 'tester-access-icon', 'aria-hidden': 'true' }, state === 'approved' ? '✓' : state === 'rejected' || state === 'revoked' ? '!' : '◷'),
      h('span', { class: 'staff-tag' }, 'TESTER ACCESS'),
      h('h1', {}, heading), h('p', { class: 'sub' }, detail),
      ...(error ? [h('p', { class: 'sub', role: 'alert' }, error)] : []),
      ...(user ? [h('p', { class: 'tester-account' }, user.email || user.displayName || 'Google account')] : []),
      h('div', { class: 'tester-access-actions' }, ...actions),
      user ? h('button', { class: 'btn-link', onclick: signOut }, 'Sign out') : h('button', { class: 'btn-link', onclick: home }, '← Back to home')
    );
  }

  async function requestAccess() {
    if (busy || !user) return;
    busy = true; render();
    try { const result = await apiCall('/api/security', { action: 'testerApply' }, user.uid); state = result.status; }
    catch (error) { toast(friendlyError(error, 'Could not send the tester request. Please try again.')); }
    finally { busy = false; render(); }
  }

  async function refresh() {
    if (disposed || !user || busy) return;
    try {
      const result = await apiCall('/api/security', { action: 'testerStatus' }, user.uid);
      if (result.status === state) return;
      state = result.status;
      if (state === 'approved') {
        render();
        window.setTimeout(() => { if (!disposed) onApproved?.(); }, 0);
        return;
      }
      render();
    } catch { /* keep the last confirmed state while offline */ }
  }

  render();
  if (user) { refresh(); timer = window.setInterval(() => { if (!document.hidden) refresh(); }, 15000); }
  root.dispose = () => { disposed = true; window.clearInterval(timer); };
  return root;
}
