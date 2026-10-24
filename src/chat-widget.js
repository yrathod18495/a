import { h } from './dom.js';
import { apiCall } from './session.js';

export function chatWidget(user, onLogin = () => {}) {
  const root = h('div', { class: 'support-widget' });
  let open = false, loading = false, sending = false, timer = 0, latest = '', cachedMessages = [], pendingMessages = [];
  const list = h('div', { class: 'support-messages', 'aria-live': 'polite' });
  const input = h('textarea', { class: 'support-compose', rows: '2', maxlength: '2000', placeholder: 'Write a message…', 'aria-label': 'Message support' });
  const state = h('p', { class: 'support-state', role: 'status' });
  const guest = h('div', { class: 'support-guest', hidden: !!user }, h('span', { class: 'support-guest-icon', 'aria-hidden': 'true' }, '✉'), h('b', {}, 'Talk to our team'), h('p', {}, 'Sign in to send a message and keep your conversation available when you return.'), h('button', { class: 'btn pri', type: 'button', onclick: () => { close(); onLogin(); } }, 'Sign in to chat'));
  list.hidden = !user; input.disabled = !user;
  const panel = h('section', { class: 'support-panel', 'aria-label': 'Support chat', hidden: true },
    h('header', { class: 'support-head' }, h('span', { class: 'support-mark' }, '12'), h('div', {}, h('b', {}, 'Live support'), h('small', {}, 'Message the 12toons team')), h('button', { class: 'support-close', 'aria-label': 'Close chat', onclick: close }, '×')),
    guest, list, state, h('form', { class: 'support-form', hidden: !user, onsubmit: send }, input, h('button', { class: 'btn pri support-send', type: 'submit' }, 'Send')));
  const sendButton = panel.querySelector('.support-send');
  const toggle = h('button', { class: 'support-launch', 'aria-label': 'Open live chat', 'aria-expanded': 'false', onclick: async () => { open = !open; panel.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); if (open) { if (user) { await load(); clearInterval(timer); timer = setInterval(load, 3000); input.focus(); } else panel.querySelector('.support-guest button')?.focus(); } else clearInterval(timer); } }, 'Chat');
  root.append(panel, toggle);
  async function load() {
    if (!user || loading || !open || !root.isConnected || document.hidden) return;
    loading = true;
    try {
      const data = await apiCall('/api/chat', { action: 'messages' }, user.uid);
      toggle.textContent = data.unreadUser ? 'New reply · Chat' : 'Chat';
      const msgs = data.messages || [], key = msgs.map(m => m.id || m.createdAt).join('|');
      cachedMessages = msgs;
      const pendingBefore = pendingMessages.length;
      pendingMessages = pendingMessages.filter(p => !msgs.some(m => m.sender === p.sender && m.message === p.message && Math.abs(Number(m.createdAt) - p.createdAt) < 120000));
      if (key !== latest || pendingBefore !== pendingMessages.length) { latest = key; render([...msgs, ...pendingMessages]); }
      state.textContent = '';
    } catch (e) { state.textContent = e.message; }
    finally { loading = false; }
  }
  function render(messages) {
    list.replaceChildren(...messages.map(m => h('div', { class: `support-bubble ${m.sender === 'admin' ? 'received' : 'sent'} ${m.pending ? 'pending' : ''} ${m.failed ? 'failed' : ''}` }, h('p', {}, m.message), h('time', {}, m.failed ? 'Not sent' : m.pending ? 'Sending…' : m.sent ? 'Sent' : new Date(m.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })))));
    list.scrollTop = list.scrollHeight;
  }
  async function send(e) {
    e.preventDefault(); const message = input.value.trim(); if (!user || !message || sending) return;
    sending = true; sendButton.disabled = true; state.textContent = '';
    const optimistic = { id: `pending-${Date.now()}`, sender: 'user', message, createdAt: Date.now(), pending: true };
    pendingMessages.push(optimistic); input.value = ''; render([...cachedMessages, ...pendingMessages]);
    try {
      await apiCall('/api/chat', { action: 'send', message }, user.uid);
      optimistic.pending = false; optimistic.sent = true; latest = ''; render([...cachedMessages, ...pendingMessages]); await load();
    } catch (err) {
      optimistic.failed = true; state.textContent = `Message not sent: ${err.message}`; render([...cachedMessages, ...pendingMessages]);
    } finally { sending = false; sendButton.disabled = false; input.focus(); }
  }
  function close() { open = false; panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); clearInterval(timer); }
  const onVisibility = () => { if (!document.hidden && open) load(); };
  document.addEventListener('visibilitychange', onVisibility);
  root.dispose = () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility); };
  return root;
}
