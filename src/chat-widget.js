import { h } from './dom.js';
import { apiCall, watchChatSignal } from './session.js';
import { contactChannels } from '../shared/contact-links.js';
import { SUPPORT, supportStatus, statusText, hoursRows } from '../shared/support-info.js';

const ICONS = {
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z',
  close: 'M6 6l12 12M18 6 6 18',
  send: 'M12 19V5m0 0-6 6m6-6 6 6',
  expand: 'M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7',
  shrink: 'M20 10h-6V4M4 14h6v6M14 10l7-7M3 21l7-7',
  min: 'M5 12h14',
  bolt: 'M13 3 5 14h6l-1 7 8-11h-6l1-7Z',
  telegram: 'M21.4 4.3 2.9 11.5c-.9.4-.9 1.5 0 1.8l4.6 1.6 1.8 5.5c.2.7 1.1.9 1.6.4l2.5-2.4 4.6 3.4c.6.4 1.4.1 1.6-.6l3.1-14.3c.2-.9-.7-1.6-1.3-1.1ZM8.8 14l9.1-5.7-7.2 6.9-.3 3.2L8.8 14Z',
  whatsapp: 'M12 3a9 9 0 0 0-7.8 13.4L3 21l4.7-1.2A9 9 0 1 0 12 3Zm4.4 12.3c-.2.6-1.2 1.1-1.7 1.1-.5.1-1 .2-3.3-.7-2.8-1.1-4.5-3.9-4.7-4.1-.1-.2-1.1-1.5-1.1-2.8s.7-2 .9-2.3c.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.5.2.5.8 1.8.8 1.9.1.1.1.3 0 .4-.1.2-.2.3-.3.4l-.4.5c-.1.1-.3.3-.1.5.2.3.7 1.2 1.5 1.9 1 .9 1.8 1.2 2.1 1.3.3.1.4.1.6-.1l.8-1c.2-.2.4-.2.6-.1l1.8.9c.2.1.4.2.4.3.1.1.1.6-.1 1.2Z',
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
    h('header', { class: 'support-head' }, h('span', { class: 'support-mark' }, '12', h('i', { class: 'support-online', 'aria-hidden': 'true' })), h('div', { class: 'support-who' }, h('b', {}, 'Live support'), h('small', {}, `Replies within ${SUPPORT.replyWindow}`)),
      expandBtn, h('button', { class: 'support-close', 'aria-label': 'Minimise chat', title: 'Minimise', onclick: close }, icon('min')), h('button', { class: 'support-close', 'aria-label': 'Close chat', title: 'Close', onclick: close }, icon('close'))),
    guest, list, chips, state, h('form', { class: 'support-form', hidden: !user, onsubmit: send }, input, h('button', { class: 'support-send', type: 'submit', 'aria-label': 'Send message' }, icon('send'))));
  const sendButton = panel.querySelector('.support-send');
  const flip = async () => { open = !open; panel.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); if (open) { if (user) { await load(); clearInterval(timer); quietSince = Date.now(); schedule(); input.focus(); } else panel.querySelector('.support-guest button')?.focus(); } else { clearTimeout(timer); timer = 0; } };
  // keyboard (Enter / Space) still opens it; a pointer press is handled below so the bubble can be dragged without opening
  const toggle = h('button', { class: 'support-launch', 'aria-label': 'Open live chat', 'aria-expanded': 'false', onclick: (e) => { if (e.detail === 0) press(); } }, icon('chat'), h('i', { class: 'support-dot', 'aria-hidden': 'true' }));
  const hideX = h('button', { class: 'support-hide', type: 'button', 'aria-label': 'Hide the chat button', hidden: true, onclick: (e) => { e.stopPropagation(); try { sessionStorage.setItem('toons-chat-hidden', '1'); } catch { /* this visit only */ } root.hidden = true; } }, icon('close'));
  hideX.addEventListener('pointerdown', (e) => e.stopPropagation());
  const fab = h('div', { class: 'support-fab' }, hideX, toggle);
  // the button first asks how to reach us (Telegram, WhatsApp, live chat) when Telegram / WhatsApp links are set; with none set it opens the live chat directly
  const channels = contactChannels();
  const menu = h('div', { class: 'support-menu', role: 'menu', 'aria-label': 'How would you like to reach us?', hidden: true });
  const closeMenu = () => { menu.hidden = true; toggle.setAttribute('aria-expanded', String(open)); };
  const chooseLive = () => { closeMenu(); flip(); };
  const drawMenu = () => {
    const row = (key, label, hint, onclick, ...extra) => h('div', { class: 'support-menu-row' },
      h('button', { type: 'button', class: 'support-menu-item', role: 'menuitem', 'aria-expanded': extra.length ? 'false' : undefined, onclick }, h('span', { class: `support-menu-badge ${key}`, 'aria-hidden': 'true' }, icon(key === 'live' ? 'chat' : key)), h('span', { class: 'support-menu-text' }, h('b', {}, label), h('small', {}, hint))), ...extra);
    const link = (option) => h('a', { class: 'support-menu-sub', role: 'menuitem', href: option.url, target: '_blank', rel: 'noopener noreferrer', onclick: () => closeMenu() }, option.label);
    const rows = channels.map((channel) => {
      if (channel.options.length === 1) { const only = channel.options[0]; return row(channel.key, channel.label, only.label, () => { window.open(only.url, '_blank', 'noopener,noreferrer'); closeMenu(); }); }
      const subs = h('div', { class: 'support-menu-subs', hidden: true }, ...channel.options.map(link));
      const item = row(channel.key, channel.label, 'Group or personal chat', (e) => { const row_ = e.currentTarget.closest('.support-menu-row'), opening = subs.hidden; menu.querySelectorAll('.support-menu-subs').forEach((x) => { x.hidden = true; }); menu.querySelectorAll('.support-menu-item[aria-expanded]').forEach((b) => b.setAttribute('aria-expanded', 'false')); subs.hidden = !opening; e.currentTarget.setAttribute('aria-expanded', String(opening)); row_.classList.toggle('open', opening); }, subs);
      return item;
    });
    menu.replaceChildren(h('p', { class: 'support-menu-title' }, 'How would you like to reach us?'), ...rows, row('live', 'Live chat', 'Talk to our team here', chooseLive),
      h('p', { class: 'support-menu-note' }, `Reply within ${SUPPORT.replyWindow} in office hours. `, h('a', { href: '#/help', onclick: () => closeMenu() }, 'See office hours')));
  };
  const placeMenu = () => {
    const rect = fab.getBoundingClientRect(), below = rect.top < 280;
    Object.assign(menu.style, { right: `${Math.max(8, innerWidth - rect.right)}px`, left: 'auto', top: below ? `${rect.bottom + 10}px` : 'auto', bottom: below ? 'auto' : `${innerHeight - rect.top + 10}px` });
  };
  function press() {
    if (!channels.length) { flip(); return; }
    if (!menu.hidden) { closeMenu(); return; }
    drawMenu(); placeMenu(); menu.hidden = false; toggle.setAttribute('aria-expanded', 'true'); menu.querySelector('.support-menu-item')?.focus();
  }
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target) && !fab.contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { closeMenu(); toggle.focus(); } });
  root.append(panel, menu, fab);
  try { if (sessionStorage.getItem('toons-chat-hidden')) root.hidden = true; } catch { /* shown */ }
  // drag the bubble anywhere (the place is remembered); hold it still for half a second to show a cross that hides it for this visit
  const POS = 'toons-chat-pos';
  let pos = (() => { try { return JSON.parse(localStorage.getItem(POS) || 'null') || { x: 0, y: 0 }; } catch { return { x: 0, y: 0 }; } })(), drag = null, hold = 0, moved = false, heldOpen = false;
  const clamp = () => { pos = { x: Math.min(Math.max(pos.x, -16), innerWidth - 80), y: Math.min(Math.max(pos.y, -10), innerHeight - 140) }; };
  const paint = (animate) => { fab.style.transition = animate ? 'transform .35s cubic-bezier(.32,.72,0,1)' : 'none'; fab.style.transform = `translate3d(${-pos.x}px, ${-pos.y}px, 0)`; };
  clamp(); paint(false);
  addEventListener('resize', () => { clamp(); paint(false); });
  fab.addEventListener('pointerdown', (e) => {
    if (open || e.button > 0) return;
    fab.setPointerCapture?.(e.pointerId); moved = false; heldOpen = false;
    drag = { x: e.clientX, y: e.clientY, ox: pos.x, oy: pos.y };
    clearTimeout(hold); hold = setTimeout(() => { if (!moved) { heldOpen = true; hideX.hidden = false; } }, 500);
  });
  fab.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!moved && Math.abs(dx) <= 5 && Math.abs(dy) <= 5) return;
    if (!moved) { moved = true; clearTimeout(hold); fab.classList.add('dragging'); }
    pos = { x: drag.ox - dx, y: drag.oy - dy }; clamp(); paint(false);
  });
  const release = () => {
    if (!drag) return;
    drag = null; clearTimeout(hold); fab.classList.remove('dragging');
    if (moved) { paint(true); try { localStorage.setItem(POS, JSON.stringify(pos)); } catch { /* not remembered */ } return; }
    if (heldOpen) { heldOpen = false; return; }          // the press that showed the cross does not also open the chat
    if (!hideX.hidden) { hideX.hidden = true; return; }
    press();
  };
  fab.addEventListener('pointerup', release); fab.addEventListener('pointercancel', () => { drag = null; clearTimeout(hold); fab.classList.remove('dragging'); });
  // phone: pull the chat sheet down by its header to close it
  const head = panel.querySelector('.support-head');
  let sheet = null;
  head.addEventListener('pointerdown', (e) => { if (innerWidth > 700 || e.target.closest('button')) return; head.setPointerCapture?.(e.pointerId); sheet = { y: e.clientY, t: performance.now(), dy: 0 }; panel.style.transition = 'none'; });
  head.addEventListener('pointermove', (e) => { if (!sheet) return; const raw = e.clientY - sheet.y; sheet.dy = raw > 0 ? raw : raw / 6; panel.style.transform = `translate3d(0, ${sheet.dy}px, 0)`; });
  const sheetEnd = () => {
    if (!sheet) return; const { dy, t } = sheet; sheet = null; const v = dy / Math.max(1, performance.now() - t);
    if (dy > 120 || (dy > 30 && v > 0.5)) { panel.style.transition = 'transform .22s cubic-bezier(.32,.72,0,1)'; panel.style.transform = 'translate3d(0, 100%, 0)'; setTimeout(() => { close(); panel.style.transition = ''; panel.style.transform = ''; }, 200); }
    else { panel.style.transition = 'transform .28s cubic-bezier(.32,.72,0,1)'; panel.style.transform = ''; }
  };
  head.addEventListener('pointerup', sheetEnd); head.addEventListener('pointercancel', sheetEnd);
  // a chat nobody writes in is asked about less and less often (5 s, then 15 s, then 30 s): every question costs a few database reads
  let quietSince = Date.now();
  // live: when the signal channel works, a message shows up at once and the slow check below is only a safety net
  let live = false, stopSignal = () => {};
  if (user) stopSignal = watchChatSignal(user.uid, (data, first) => {
    if (first || !data || data.by !== 'admin') return;          // what this browser wrote itself is already on screen: no request needed
    if (open) { quietSince = Date.now(); load(); }
    else { toggle.classList.add('unread'); toggle.setAttribute('aria-label', 'Open live chat, you have a new reply'); }
  }, (ok) => { live = ok; });
  const delay = () => { if (live) return 60000; const quiet = Date.now() - quietSince; return quiet < 60000 ? 5000 : quiet < 300000 ? 15000 : 30000; };
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
    if (!messages.length) { list.replaceChildren(h('div', { class: 'support-empty' }, h('span', { class: 'support-empty-icon' }, icon('chat')), h('b', {}, 'How can we help?'), h('p', {}, 'Send us a message and the team will reply here.'), h('p', { class: 'support-hours-note' }, `You will get a reply within ${SUPPORT.replyWindow} during office hours (${hoursRows().filter((r) => r.time !== 'Closed').map((r) => `${r.days}, ${r.time}`).join('; ')} ${SUPPORT.zoneLabel.split(' ')[0]}). ${statusText(supportStatus())}`))); return; }
    chips.hidden = !user || messages.length > 0;
    let lastDay = '';
    list.replaceChildren(...messages.flatMap(m => { const day = new Date(m.createdAt).toDateString(), sep = day !== lastDay ? [h('div', { class: 'support-day' }, h('span', {}, day === new Date().toDateString() ? 'Today' : new Date(m.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short' })))] : []; lastDay = day; return [...sep, bubble(m)]; }));
    list.scrollTop = list.scrollHeight;
  }
  function bubble(m) {
    return (h('div', { class: `support-bubble ${m.sender === 'admin' ? 'received' : 'sent'} ${m.pending ? 'pending' : ''} ${m.failed ? 'failed' : ''}` }, m.image ? h('img', { class: 'support-image', src: m.image, alt: 'Picture from support' }) : null, m.message ? h('p', {}, m.message) : null, h('time', {}, m.failed ? 'Not sent' : m.pending && Date.now() - m.createdAt > 3000 ? 'Sending…' : (m.pending || m.sent) ? new Date(m.createdAt).toLocaleTimeString([], { timeStyle: 'short' }) : `${m.editedAt ? 'edited · ' : ''}${new Date(m.createdAt).toLocaleTimeString([], { timeStyle: 'short' })}`)));
  }
  async function send(e) {
    quietSince = Date.now(); schedule();
    e.preventDefault(); const message = input.value.trim(); if (!user || !message || sending) return;
    sending = true; sendButton.disabled = true; state.textContent = '';
    const optimistic = { id: `pending-${Date.now()}`, sender: 'user', message, createdAt: Date.now(), pending: true };
    pendingMessages.push(optimistic); input.value = ''; grow(); render([...cachedMessages, ...pendingMessages]);
    setTimeout(() => { if (optimistic.pending && open) render([...cachedMessages, ...pendingMessages]); }, 3100);          // only a slow send says "Sending…"
    try {
      await apiCall('/api/chat', { action: 'send', message }, user.uid);
      optimistic.pending = false; optimistic.sent = true; latest = ''; render([...cachedMessages, ...pendingMessages]);        // nothing to download: the message is on screen, and an answer arrives through the live signal
    } catch (err) {
      optimistic.failed = true; state.textContent = `Message not sent: ${err.message}`; render([...cachedMessages, ...pendingMessages]);
    } finally { sending = false; sendButton.disabled = false; input.focus(); }
  }
  function close() { open = false; panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); clearInterval(timer); }
  const onVisibility = () => { if (!document.hidden && open) load(); };
  document.addEventListener('visibilitychange', onVisibility);
  // the Help and support page's "Start live chat" button
  const onOpenRequest = () => { closeMenu(); if (!open) flip(); };
  document.addEventListener('open-live-chat', onOpenRequest);
  root.dispose = () => { stopSignal(); clearTimeout(timer); clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility); document.removeEventListener('open-live-chat', onOpenRequest); };
  return root;
}
