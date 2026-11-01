import { h } from './dom.js';
import { apiCall } from './session.js';

const ICONS = {
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z',
  close: 'M6 6l12 12M18 6 6 18',
  send: 'M12 19V5m0 0-6 6m6-6 6 6',
  expand: 'M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7',
  shrink: 'M20 10h-6V4M4 14h6v6M14 10l7-7M3 21l7-7',
  min: 'M5 12h14',
  bolt: 'M13 3 5 14h6l-1 7 8-11h-6l1-7Z',
};
const QUICK = ['How do coins work?', 'I need help with my video', 'Report a problem', 'Ask about a feature'];
const icon = (name) => { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', ICONS[name]); svg.append(path); return svg; };

export function chatWidget(user, onLogin = () => {}) {
  const root = h('div', { class: 'support-widget' });
  let open = false, loading = false, sending = false, timer = 0, latest = '', cachedMessages = [], pendingMessages = [], revision = 0;
  const list = h('div', { class: 'support-messages', 'aria-live': 'polite' });
  const input = h('textarea', { class: 'support-compose', rows: '2', maxlength: '2000', placeholder: 'Write a message…', 'aria-label': 'Message support' });
  const state = h('p', { class: 'support-state', role: 'status' });
  const guest = h('div', { class: 'support-guest', hidden: !!user }, h('span', { class: 'support-guest-icon', 'aria-hidden': 'true' }, icon('chat')), h('b', {}, 'Talk to our team'), h('p', {}, 'Sign in to send a message and keep your conversation available when you return.'), h('button', { class: 'btn pri', type: 'button', onclick: () => { close(); onLogin(); } }, 'Sign in to chat'));
  list.hidden = !user; input.disabled = !user;
  if (user) render([]);
  let big = false;
  const expandBtn = h('button', { class: 'support-close support-expand', 'aria-label': 'Expand chat', title: 'Expand', onclick: () => { big = !big; panel.classList.toggle('big', big); expandBtn.replaceChildren(icon(big ? 'shrink' : 'expand')); expandBtn.title = big ? 'Shrink' : 'Expand'; expandBtn.setAttribute('aria-label', big ? 'Shrink chat' : 'Expand chat'); list.scrollTop = list.scrollHeight; } }, icon('expand'));
  const chips = h('div', { class: 'support-chips', hidden: !user }, ...QUICK.map(q => h('button', { type: 'button', onclick: () => { input.value = q; grow(); input.focus(); } }, icon('bolt'), q)));
  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; };
  input.rows = 1; input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(e); } });
  const panel = h('section', { class: 'support-panel', 'aria-label': 'Support chat', hidden: true },
    h('header', { class: 'support-head' }, h('span', { class: 'support-mark' }, '12', h('i', { class: 'support-online', 'aria-hidden': 'true' })), h('div', { class: 'support-who' }, h('b', {}, 'Live support'), h('small', {}, 'Typically replies within a few hours')),
      expandBtn, h('button', { class: 'support-close', 'aria-label': 'Minimise chat', title: 'Minimise', onclick: close }, icon('min')), h('button', { class: 'support-close', 'aria-label': 'Close chat', title: 'Close', onclick: close }, icon('close'))),
    guest, list, chips, state, h('form', { class: 'support-form', hidden: !user, onsubmit: send }, input, h('button', { class: 'support-send', type: 'submit', 'aria-label': 'Send message' }, icon('send'))));
  const sendButton = panel.querySelector('.support-send');
  const toggle = h('button', { class: 'support-launch', 'aria-label': 'Open live chat', 'aria-expanded': 'false', onclick: async () => { open = !open; panel.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); if (open) { if (user) { await load(); clearInterval(timer); quietSince = Date.now(); schedule(); input.focus(); } else panel.querySelector('.support-guest button')?.focus(); } else { clearTimeout(timer); timer = 0; } } }, icon('chat'), h('i', { class: 'support-dot', 'aria-hidden': 'true' }));
  root.append(panel, toggle);
  // a chat nobody writes in is asked about less and less often (5 s, then 15 s, then 30 s): every question costs a few database reads
  let quietSince = Date.now();
  const delay = () => { const quiet = Date.now() - quietSince; return quiet < 60000 ? 5000 : quiet < 300000 ? 15000 : 30000; };
  function schedule() { clearTimeout(timer); timer = setTimeout(async () => { await load(); if (open) schedule(); }, delay()); }
  async function load() {
    if (!user || loading || !open || !root.isConnected || document.hidden) return;
    loading = true;
    try {
      const since = cachedMessages.reduce((n, m) => Math.max(n, Number(m.createdAt) || 0), 0);
      const data = await apiCall('/api/chat', { action: 'messages', ...(since ? { since, revision } : {}) }, user.uid);      // an edited or deleted reply changes the revision, and the whole chat comes again
      revision = data.revision || 0;
      toggle.classList.toggle('unread', !!data.unreadUser); toggle.setAttribute('aria-label', data.unreadUser ? 'Open live chat, you have a new reply' : 'Open live chat');
      const fresh = data.messages || [], msgs = data.incremental ? [...cachedMessages, ...fresh.filter(m => !cachedMessages.some(c => c.id === m.id))] : fresh, key = msgs.map(m => `${m.id || m.createdAt}:${m.editedAt || 0}`).join('|');
      if (key !== latest) quietSince = Date.now();
      cachedMessages = msgs;
      const pendingBefore = pendingMessages.length;
      pendingMessages = pendingMessages.filter(p => !msgs.some(m => m.sender === p.sender && m.message === p.message && Math.abs(Number(m.createdAt) - p.createdAt) < 120000));
      if (key !== latest || pendingBefore !== pendingMessages.length) { latest = key; render([...msgs, ...pendingMessages]); }
      state.textContent = '';
    } catch (e) { state.textContent = e.message; }
    finally { loading = false; }
  }
  function render(messages) {
    if (!messages.length) { list.replaceChildren(h('div', { class: 'support-empty' }, h('span', { class: 'support-empty-icon' }, icon('chat')), h('b', {}, 'How can we help?'), h('p', {}, 'Send us a message and the team will reply here.'))); return; }
    chips.hidden = !user || messages.length > 0;
    let lastDay = '';
    list.replaceChildren(...messages.flatMap(m => { const day = new Date(m.createdAt).toDateString(), sep = day !== lastDay ? [h('div', { class: 'support-day' }, h('span', {}, day === new Date().toDateString() ? 'Today' : new Date(m.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short' })))] : []; lastDay = day; return [...sep, bubble(m)]; }));
    list.scrollTop = list.scrollHeight;
  }
  function bubble(m) {
    return (h('div', { class: `support-bubble ${m.sender === 'admin' ? 'received' : 'sent'} ${m.pending ? 'pending' : ''} ${m.failed ? 'failed' : ''}` }, m.image ? h('img', { class: 'support-image', src: m.image, alt: 'Picture from support' }) : null, m.message ? h('p', {}, m.message) : null, h('time', {}, m.failed ? 'Not sent' : m.pending ? 'Sending…' : m.sent ? 'Sent' : `${m.editedAt ? 'edited · ' : ''}${new Date(m.createdAt).toLocaleTimeString([], { timeStyle: 'short' })}`)));
  }
  async function send(e) {
    quietSince = Date.now(); schedule();
    e.preventDefault(); const message = input.value.trim(); if (!user || !message || sending) return;
    sending = true; sendButton.disabled = true; state.textContent = '';
    const optimistic = { id: `pending-${Date.now()}`, sender: 'user', message, createdAt: Date.now(), pending: true };
    pendingMessages.push(optimistic); input.value = ''; grow(); render([...cachedMessages, ...pendingMessages]);
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
