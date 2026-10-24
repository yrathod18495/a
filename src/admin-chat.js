import { h, logo } from './dom.js';
import { apiCall } from './session.js';

export async function chatView({ user, back, toast }) {
  const root = h('div', { class: 'sh admin-chat-page' });
  const chats = h('div', { class: 'admin-chat-list' }), title = h('h2', {}, 'Choose a conversation'),
    detail = h('p', { class: 'admin-chat-muted' }, 'User conversations will appear here.'),
    messages = h('div', { class: 'admin-chat-messages' }), input = h('textarea', { class: 'admin-chat-compose', rows: '2', maxlength: '2000', placeholder: 'Reply to this user…', 'aria-label': 'Admin reply' }),
    send = h('button', { class: 'btn pri', type: 'submit' }, 'Send reply'), form = h('form', { class: 'admin-chat-form', onsubmit: reply }, input, send);
  const convo = h('section', { class: 'admin-chat-conversation' }, h('div', { class: 'admin-chat-convo-head' }, title, detail), messages, form);
  let selected = '', polling = 0, listBusy = false, messageBusy = false, replyBusy = false, lastMessageKey = '';
  root.append(h('header', { class: 'sh-bar' }, logo(back), h('span', { class: 'sh-crumb' }, 'Admin · Live Chat'), h('span', { class: 'sp' }), h('button', { class: 'btn', onclick: back }, 'Back to Admin')),
    h('main', { class: 'admin-chat-main' }, h('div', { class: 'admin-chat-title' }, h('div', {}, h('span', { class: 'projects-eyebrow' }, 'CUSTOMER SUPPORT'), h('h1', {}, 'Live Chat'), h('p', {}, 'Reply to users from your admin panel.')), h('button', { class: 'btn', onclick: loadChats }, 'Refresh inbox')), h('div', { class: 'admin-chat-layout' }, h('aside', { class: 'admin-chat-sidebar' }, h('h2', {}, 'Inbox'), chats), convo)));
  async function loadChats() {
    if (listBusy || !root.isConnected) return;
    listBusy = true;
    try {
      const result = await apiCall('/api/chat', { action: 'adminList' }, user.uid);
      const rows = result.chats || [];
      chats.replaceChildren(...rows.map(c => h('button', { class: `admin-chat-item ${selected === c.id ? 'active' : ''} ${c.unreadAdmin ? 'unread' : ''}`, onclick: () => select(c) }, h('span', { class: 'admin-chat-avatar' }, (c.displayName || c.email || c.id).trim()[0]?.toUpperCase() || '?'), h('span', { class: 'admin-chat-item-copy' }, h('b', {}, c.displayName || c.email || 'User'), h('small', {}, c.lastMessage || 'No messages yet')), c.unreadAdmin ? h('i', { class: 'admin-chat-unread', title: 'Unread message' }) : null)));
      if (!rows.length) chats.replaceChildren(h('p', { class: 'admin-chat-muted admin-chat-empty' }, 'No conversations yet.'));
      if (selected && !rows.some(c => c.id === selected)) { selected = ''; title.textContent = 'Choose a conversation'; detail.textContent = 'User conversations will appear here.'; messages.replaceChildren(); }
    } catch (e) { toast(`Could not load chat inbox: ${e.message}`); }
    finally { listBusy = false; }
  }
  async function select(chat) {
    selected = chat.id; lastMessageKey = '';
    title.textContent = chat.displayName || chat.email || 'User'; detail.textContent = chat.email || chat.id;
    input.disabled = false; send.disabled = false;
    await loadChats(); await loadMessages();
  }
  async function loadMessages() {
    if (!selected || messageBusy || !root.isConnected || document.hidden) return;
    messageBusy = true;
    const active = selected;
    try {
      const result = await apiCall('/api/chat', { action: 'adminMessages', uid: active }, user.uid);
      if (active !== selected) return;
      const rows = result.messages || [], key = rows.map(m => m.id || m.createdAt).join('|');
      if (key === lastMessageKey) return;
      lastMessageKey = key;
      const rendered = rows.map(m => h('article', { class: `admin-chat-message ${m.sender === 'admin' ? 'outgoing' : 'incoming'}` },
        h('b', {}, m.sender === 'admin' ? 'You' : 'User'), h('p', {}, m.message),
        h('time', {}, new Date(m.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }))));
      messages.replaceChildren(...rendered);
      messages.scrollTop = messages.scrollHeight;
    } catch (e) { if (active === selected) toast(`Could not load conversation: ${e.message}`); }
    finally { messageBusy = false; }
  }
  async function reply(e) {
    e.preventDefault(); const message = input.value.trim(); if (!selected || !message || replyBusy) return;
    replyBusy = true; input.disabled = true; send.disabled = true;
    try { await apiCall('/api/chat', { action: 'adminReply', uid: selected, message }, user.uid); input.value = ''; lastMessageKey = ''; await loadMessages(); await loadChats(); }
    catch (err) { toast(`Reply failed: ${err.message}`); }
    finally { replyBusy = false; input.disabled = !selected; send.disabled = !selected; }
  }
  input.disabled = true; send.disabled = true;
  await loadChats();
  polling = window.setInterval(() => { if (!document.hidden) { loadChats(); loadMessages(); } }, 3000);
  const onVisibility = () => { if (!document.hidden) { loadChats(); loadMessages(); } };
  document.addEventListener('visibilitychange', onVisibility);
  root.dispose = () => { clearInterval(polling); document.removeEventListener('visibilitychange', onVisibility); };
  return root;
}
