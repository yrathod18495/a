import { friendlyError } from '../shared/hinglish-errors.js';
import { h, logo } from './dom.js';
import { apiCall } from './session.js';
import { projectDialog } from './project-dialog.js';

// Admin · Live Chat: conversations on the left (unread / premium / all, select, delete, new chat), the thread on the right
// (read ticks, edit / delete your replies, pictures).
const SVG = 'http://www.w3.org/2000/svg';
const ICONS = {
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  image: 'M4 5h16v14H4zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM4 17l5-5 4 4 3-3 4 4',
  send: 'M5 12 20 4l-4 16-4-6-7-2Zm7 2 8-10',
  plus: 'M12 5v14M5 12h14',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  edit: 'M4 20h4L19 9l-4-4L4 16v4ZM13 7l4 4',
  close: 'M6 6l12 12M18 6 6 18',
};
const icon = (name, size = 16) => { const svg = document.createElementNS(SVG, 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', size); svg.setAttribute('height', size); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); const path = document.createElementNS(SVG, 'path'); path.setAttribute('d', ICONS[name]); svg.append(path); return svg; };
/** the premium (paid account) badge: a blue diamond */
const diamond = () => { const svg = document.createElementNS(SVG, 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', 15); svg.setAttribute('height', 15); svg.setAttribute('class', 'ac-diamond'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Premium member'); const title = document.createElementNS(SVG, 'title'); title.textContent = 'Premium member (paid account)'; const path = document.createElementNS(SVG, 'path'); path.setAttribute('d', 'M6 3h12l4 6-10 12L2 9l4-6Zm0 0 6 6 6-6M2 9h20M12 9v12'); path.setAttribute('fill', '#5aa9ff'); path.setAttribute('stroke', '#2f6fd6'); path.setAttribute('stroke-width', '1.4'); path.setAttribute('stroke-linejoin', 'round'); svg.append(title, path); return svg; };
const PALETTE = ['#fde68a', '#c7d2fe', '#fbcfe8', '#bbf7d0', '#fed7aa', '#bae6fd'];
const colourOf = (text) => PALETTE[[...String(text)].reduce((n, c) => n + c.charCodeAt(0), 0) % PALETTE.length];
const nameOf = (c) => c.displayName || c.email || 'User';
const timeOf = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dayOf = (ms) => { const d = new Date(ms), today = new Date(); return d.toDateString() === today.toDateString() ? 'Today' : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' }); };
const MAX_IMAGE_CHARS = 140000;
/** a picture is shrunk in the browser (longest side 1024 px, JPEG) so it fits inside a chat message */
async function shrinkImage(file) {
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) throw new Error('Please choose a JPG, PNG or WebP picture.');
  const bitmap = await createImageBitmap(file);
  let scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height)), quality = 0.82;
  for (let attempt = 0; attempt < 6; attempt++, scale *= 0.75, quality = Math.max(0.5, quality - 0.08)) {
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const g = canvas.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height); g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.length <= MAX_IMAGE_CHARS) return url;
  }
  throw new Error('This picture is too large. Please choose a smaller one.');
}

export async function chatView({ user, back, toast }) {
  const call = (body) => apiCall('/api/chat', body, user.uid);
  let rows = [], selected = '', tab = 'all', checked = new Set(), listBusy = false, messageBusy = false, sendBusy = false, editing = '', attached = '', lastKey = '';
  const threads = new Map();      // per conversation: the messages already downloaded, the revision they belong to, and when the user last read the chat
  let polling = 0;
  const root = h('div', { class: 'sh admin-chat-page ac-page' });
  const tabsEl = h('div', { class: 'ac-tabs', role: 'tablist' }), listEl = h('div', { class: 'ac-list' }), tools = h('div', { class: 'ac-tools' });
  const head = h('div', { class: 'ac-thread-head', hidden: true }), messagesEl = h('div', { class: 'ac-messages' }, h('div', { class: 'ac-empty' }, h('b', {}, 'Select a conversation'), h('p', {}, 'Choose a user on the left, or start a new chat.')));
  const input = h('textarea', { class: 'ac-input', rows: '1', maxlength: '2000', placeholder: 'Type a reply…', 'aria-label': 'Reply to this user', disabled: true });
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
  const previewEl = h('div', { class: 'ac-attached', hidden: true });
  const attachBtn = h('button', { class: 'ac-icon-btn', type: 'button', title: 'Attach a picture', 'aria-label': 'Attach a picture', disabled: true, onclick: () => file.click() }, icon('image', 18));
  const sendBtn = h('button', { class: 'ac-send', type: 'submit', title: 'Send', 'aria-label': 'Send reply', disabled: true }, icon('send', 18));
  const form = h('form', { class: 'ac-composer', onsubmit: reply }, previewEl, h('div', { class: 'ac-composer-row' }, attachBtn, file, input, sendBtn));
  root.append(h('header', { class: 'sh-bar' }, logo(back), h('span', { class: 'sh-crumb' }, 'Admin · Live Chat'), h('span', { class: 'sp' }), h('button', { class: 'btn', onclick: back }, 'Back to Admin')),
    h('main', { class: 'ac-main' }, h('div', { class: 'ac-layout' },
      h('aside', { class: 'ac-side' }, h('div', { class: 'ac-side-head' }, h('h2', {}, 'Conversations'), h('button', { class: 'ac-new', type: 'button', onclick: newChat }, icon('plus', 14), 'New chat')), tools, tabsEl, listEl),
      h('section', { class: 'ac-thread' }, head, messagesEl, form))));

  /* ---------- list ---------- */
  const unreadCount = () => rows.filter((c) => c.unreadAdmin).length;
  const visible = () => rows.filter((c) => tab === 'unread' ? c.unreadAdmin : tab === 'premium' ? c.premium : true);
  function renderTabs() {
    const tabButton = (key, label, count) => h('button', { class: `ac-tab ${tab === key ? 'on' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(tab === key), onclick: () => { tab = key; renderTabs(); renderList(); } }, label, count ? h('span', { class: 'ac-count' }, String(count)) : null);
    tabsEl.replaceChildren(tabButton('unread', 'Unread', unreadCount()), tabButton('premium', 'Premium', rows.filter((c) => c.premium).length), tabButton('all', 'All', 0));
  }
  function renderTools() {
    const list = visible(), all = list.length > 0 && list.every((c) => checked.has(c.id));
    tools.replaceChildren(h('button', { class: 'ac-select-all', type: 'button', disabled: !list.length, onclick: () => { if (all) list.forEach((c) => checked.delete(c.id)); else list.forEach((c) => checked.add(c.id)); renderList(); } }, h('i', { class: `ac-box ${all ? 'on' : ''}` }), all ? 'Deselect' : 'Select all'),
      ...(checked.size ? [h('button', { class: 'ac-delete-selected', type: 'button', onclick: () => removeChats([...checked]) }, icon('trash', 14), `Delete (${checked.size})`)] : []));
  }
  function renderList() {
    renderTools();
    const list = visible();
    if (!list.length) { listEl.replaceChildren(h('p', { class: 'ac-muted', role: 'status' }, tab === 'unread' ? 'No unread conversations.' : tab === 'premium' ? 'No premium conversations.' : 'No conversations yet.')); return; }
    listEl.replaceChildren(...list.map((c) => {
      const preview = c.lastMessage ? `${c.lastSender === 'admin' ? 'Admin: ' : ''}${c.lastMessage}` : 'No messages yet';
      return h('div', { class: `ac-item ${selected === c.id ? 'active' : ''} ${c.unreadAdmin ? 'unread' : ''}`, role: 'button', tabindex: '0', onclick: () => select(c.id), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(c.id); } } },
        h('input', { type: 'checkbox', class: 'ac-check', checked: checked.has(c.id), 'aria-label': `Select ${nameOf(c)}`, onclick: (e) => e.stopPropagation(), onchange: (e) => { if (e.target.checked) checked.add(c.id); else checked.delete(c.id); renderTools(); } }),
        h('span', { class: 'ac-avatar', style: `background:${colourOf(c.id)}` }, nameOf(c).trim()[0]?.toUpperCase() || '?'),
        h('span', { class: 'ac-item-copy' }, h('span', { class: 'ac-item-name' }, h('b', {}, nameOf(c)), c.premium ? diamond() : null), h('small', {}, preview)),
        c.unreadAdmin ? h('i', { class: 'ac-unread', title: 'Unread message' }) : null);
    }));
  }
  async function loadChats() {
    if (listBusy || !root.isConnected) return;
    listBusy = true;
    try {
      rows = (await call({ action: 'adminList' })).chats || [];
      for (const id of [...checked]) if (!rows.some((c) => c.id === id)) checked.delete(id);
      if (selected && !rows.some((c) => c.id === selected)) clearSelection();
      renderTabs(); renderList(); renderHead();
    } catch (e) { toast(`Could not load the conversations: ${friendlyError(e)}`); }
    finally { listBusy = false; }
  }
  function clearSelection() { selected = ''; editing = ''; lastKey = ''; head.hidden = true; input.disabled = true; attachBtn.disabled = true; sendBtn.disabled = true; messagesEl.replaceChildren(h('div', { class: 'ac-empty' }, h('b', {}, 'Select a conversation'), h('p', {}, 'Choose a user on the left, or start a new chat.'))); }

  /* ---------- conversation ---------- */
  const current = () => rows.find((c) => c.id === selected);
  function renderHead() {
    const c = current(); if (!c) return;
    head.hidden = false;
    head.replaceChildren(h('span', { class: 'ac-avatar big', style: `background:${colourOf(c.id)}` }, nameOf(c).trim()[0]?.toUpperCase() || '?'),
      h('div', { class: 'ac-thread-who' }, h('span', { class: 'ac-item-name' }, h('b', {}, nameOf(c)), c.premium ? diamond() : null), h('small', {}, c.email || c.id)),
      h('button', { class: 'ac-trash', type: 'button', title: 'Delete this conversation', 'aria-label': 'Delete this conversation', onclick: () => removeChats([c.id]) }, icon('trash', 18)));
  }
  async function select(id) {
    selected = id; editing = ''; lastKey = ''; attached = ''; renderAttached(); input.value = ''; autoGrow();
    input.disabled = false; attachBtn.disabled = false; syncSend();
    renderList(); renderHead(); messagesEl.replaceChildren(h('p', { class: 'ac-muted' }, 'Loading messages…'));
    await loadMessages(true); await loadChats();
    input.focus();
  }
  async function loadMessages(force = false) {
    if (!selected || messageBusy || !root.isConnected || (document.hidden && !force)) return;
    messageBusy = true;
    const active = selected;
    try {
      const known = threads.get(active) || { rows: [], revision: 0, seenAt: 0 }, since = known.rows.reduce((n, m) => Math.max(n, Number(m.createdAt) || 0), 0);
      const result = await call({ action: 'adminMessages', uid: active, ...(since ? { since, revision: known.revision } : {}) });
      if (active !== selected) return;
      const next = { rows: result.incremental ? [...known.rows, ...(result.messages || []).filter((m) => !known.rows.some((k) => k.id === m.id))] : (result.messages || []), revision: result.revision || 0, seenAt: Number(result.userSeenAt || 0) };
      threads.set(active, next);
      renderMessages();
    } catch (e) { if (active === selected) toast(`Could not load the conversation: ${friendlyError(e)}`); }
    finally { messageBusy = false; }
  }
  function renderMessages() {
    const thread = threads.get(selected); if (!thread || editing) return;
    const key = thread.rows.map((m) => `${m.id}:${m.editedAt || 0}`).join('|') + `#${thread.seenAt >= (thread.rows.at(-1)?.createdAt || 0)}`;
    if (key === lastKey) return;
    lastKey = key;
    if (!thread.rows.length) { messagesEl.replaceChildren(h('div', { class: 'ac-empty' }, h('b', {}, 'No messages yet'), h('p', {}, 'Write the first message below.'))); return; }
    let day = '';
    messagesEl.replaceChildren(...thread.rows.flatMap((m) => { const label = dayOf(m.createdAt), sep = label !== day ? [h('div', { class: 'ac-day' }, h('span', {}, label))] : []; day = label; return [...sep, bubble(m, thread)]; }));
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  function bubble(m, thread) {
    const mine = m.sender === 'admin', read = mine && thread.seenAt >= m.createdAt;
    const body = h('div', { class: 'ac-bubble' }, m.image ? h('img', { class: 'ac-image', src: m.image, alt: 'Picture in the conversation', onclick: () => window.open(m.image, '_blank', 'noopener') }) : null, m.message ? h('p', {}, m.message) : null,
      h('span', { class: 'ac-meta' }, m.editedAt ? h('em', {}, 'edited') : null, h('time', {}, timeOf(m.createdAt)), mine ? h('span', { class: `ac-ticks ${read ? 'read' : ''}`, title: read ? 'Read by the user' : 'Delivered' }, read ? '✓✓' : '✓') : null));
    if (!mine) return h('div', { class: 'ac-row incoming' }, h('span', { class: 'ac-avatar tiny', style: `background:${colourOf(selected)}` }, nameOf(current() || { id: '?' }).trim()[0]?.toUpperCase() || '?'), body);
    const menu = h('div', { class: 'ac-menu', hidden: true, role: 'menu' },
      h('button', { type: 'button', role: 'menuitem', onclick: () => startEdit(m) }, icon('edit', 14), 'Edit'),
      h('button', { type: 'button', role: 'menuitem', class: 'danger', onclick: () => removeMessage(m) }, icon('trash', 14), 'Delete'));
    const toggle = h('button', { class: 'ac-more', type: 'button', title: 'Message options', 'aria-label': 'Message options', 'aria-haspopup': 'menu', onclick: (e) => { e.stopPropagation(); const open = menu.hidden; document.querySelectorAll('.ac-menu').forEach((x) => { x.hidden = true; }); menu.hidden = !open; } }, icon('more', 16));
    return h('div', { class: 'ac-row outgoing', 'data-id': m.id }, h('div', { class: 'ac-actions' }, toggle, menu), body);
  }
  const closeMenus = () => document.querySelectorAll('.ac-menu').forEach((x) => { x.hidden = true; });
  document.addEventListener('click', closeMenus);

  /* ---------- edit and delete a reply ---------- */
  function startEdit(m) {
    closeMenus(); editing = m.id;
    const field = h('textarea', { class: 'ac-edit', rows: '3', maxlength: '2000', 'aria-label': 'Edit your reply' }, m.message || '');
    field.value = m.message || '';
    const save = h('button', { class: 'btn sm pri', type: 'button' }, 'Save'), cancel = h('button', { class: 'btn sm', type: 'button', onclick: () => { editing = ''; lastKey = ''; renderMessages(); } }, 'Cancel');
    save.addEventListener('click', async () => {
      const text = field.value.trim();
      if (!text && !m.image) { toast('The message cannot be empty.'); field.focus(); return; }
      save.disabled = true;
      try { await call({ action: 'adminEditMessage', uid: selected, messageId: m.id, message: text }); editing = ''; lastKey = ''; await loadMessages(true); await loadChats(); toast('Message updated.'); }
      catch (e) { toast(`Could not edit the message: ${friendlyError(e)}`); save.disabled = false; }
    });
    const holder = h('div', { class: 'ac-row outgoing editing' }, h('div', { class: 'ac-edit-box' }, field, h('div', { class: 'ac-edit-actions' }, cancel, save)));
    // only the bubble being edited is replaced; the rest of the thread stays as it is
    [...messagesEl.querySelectorAll('.ac-row.outgoing')].find((el) => el.dataset.id === m.id)?.replaceWith(holder); field.focus();
  }
  async function removeMessage(m) {
    closeMenus();
    if (!window.confirm('Delete this message? The user will no longer see it.')) return;
    try { await call({ action: 'adminDeleteMessage', uid: selected, messageId: m.id }); lastKey = ''; await loadMessages(true); await loadChats(); toast('Message deleted.'); }
    catch (e) { toast(`Could not delete the message: ${friendlyError(e)}`); }
  }
  async function removeChats(ids) {
    if (!ids.length) return;
    if (!window.confirm(`Permanently delete ${ids.length === 1 ? 'this conversation' : `${ids.length} conversations`} and all messages in ${ids.length === 1 ? 'it' : 'them'}?\n\nThis cannot be undone.`)) return;
    try { const r = await call({ action: 'adminDeleteChats', uids: ids }); ids.forEach((id) => { checked.delete(id); threads.delete(id); }); if (ids.includes(selected)) clearSelection(); toast(`${r.deleted} conversation${r.deleted === 1 ? '' : 's'} deleted.`); await loadChats(); }
    catch (e) { toast(`Could not delete: ${friendlyError(e)}`); }
  }
  async function newChat() {
    const email = await projectDialog({ title: 'New chat', description: 'Enter the email address of the 12toons account you want to message.', placeholder: 'name@example.com', confirmLabel: 'Start chat', maxLength: 254 }, root);
    if (!email) return;
    try { const r = await call({ action: 'adminNewChat', email }); tab = 'all'; await loadChats(); renderTabs(); await select(r.chat.id); if (r.existing) toast('You already have a conversation with this user.'); }
    catch (e) { toast(`Could not start the chat: ${friendlyError(e)}`); }
  }

  /* ---------- composer ---------- */
  const autoGrow = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 130)}px`; };
  const syncSend = () => { sendBtn.disabled = !selected || sendBusy || (!input.value.trim() && !attached); };
  function renderAttached() { previewEl.hidden = !attached; previewEl.replaceChildren(...(attached ? [h('img', { src: attached, alt: 'Picture to send' }), h('button', { type: 'button', class: 'ac-remove-image', 'aria-label': 'Remove the picture', onclick: () => { attached = ''; renderAttached(); syncSend(); } }, icon('close', 14))] : [])); }
  input.addEventListener('input', () => { autoGrow(); syncSend(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  file.addEventListener('change', async () => {
    const picked = file.files[0]; file.value = ''; if (!picked) return;
    try { attached = await shrinkImage(picked); renderAttached(); syncSend(); } catch (e) { toast(friendlyError(e)); }
  });
  async function reply(e) {
    e.preventDefault(); const message = input.value.trim();
    if (!selected || sendBusy || (!message && !attached)) return;
    sendBusy = true; input.disabled = true; syncSend();
    try { await call({ action: 'adminReply', uid: selected, ...(message ? { message } : {}), ...(attached ? { image: attached } : {}) }); input.value = ''; attached = ''; renderAttached(); autoGrow(); lastKey = ''; await loadMessages(true); await loadChats(); }
    catch (err) { toast(`Could not send the reply: ${friendlyError(err)}`); }
    finally { sendBusy = false; input.disabled = !selected; syncSend(); input.focus(); }
  }

  await loadChats();
  const tick = () => { if (!document.hidden) { loadChats(); loadMessages(); } };
  polling = window.setInterval(tick, 10000);
  document.addEventListener('visibilitychange', tick);
  root.dispose = () => { clearInterval(polling); document.removeEventListener('visibilitychange', tick); document.removeEventListener('click', closeMenus); };
  return root;
}
