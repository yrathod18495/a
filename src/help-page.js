// The "Help and support" page: every way to reach the team, the reply time and the office hours.
import { h, logo } from './dom.js';
import { goldCoin } from './coin.js';
import { contactChannels } from '../shared/contact-links.js';
import { SUPPORT, supportStatus, statusText, hoursRows } from '../shared/support-info.js';

const ICON = {
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z',
  telegram: 'M21.4 4.3 2.9 11.5c-.9.4-.9 1.5 0 1.8l4.6 1.6 1.8 5.5c.2.7 1.1.9 1.6.4l2.5-2.4 4.6 3.4c.6.4 1.4.1 1.6-.6l3.1-14.3c.2-.9-.7-1.6-1.3-1.1ZM8.8 14l9.1-5.7-7.2 6.9-.3 3.2L8.8 14Z',
  whatsapp: 'M12 3a9 9 0 0 0-7.8 13.4L3 21l4.7-1.2A9 9 0 1 0 12 3Zm4.4 12.3c-.2.6-1.2 1.1-1.7 1.1-.5.1-1 .2-3.3-.7-2.8-1.1-4.5-3.9-4.7-4.1-.1-.2-1.1-1.5-1.1-2.8s.7-2 .9-2.3c.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.5.2.5.8 1.8.8 1.9.1.1.1.3 0 .4-.1.2-.2.3-.3.4l-.4.5c-.1.1-.3.3-.1.5.2.3.7 1.2 1.5 1.9 1 .9 1.8 1.2 2.1 1.3.3.1.4.1.6-.1l.8-1c.2-.2.4-.2.6-.1l1.8.9c.2.1.4.2.4.3.1.1.1.6-.1 1.2Z',
};
const icon = (name) => { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', ICON[name]); svg.append(path); return svg; };

/** the page; `openChat` opens the live chat, `isAdmin` shows a hint when no Telegram / WhatsApp link has been added yet */
export function helpView({ home, openChat, isAdmin = false, links, support = SUPPORT, now = Date.now }) {
  const root = h('div', { class: 'sh help-page' });
  const channels = contactChannels(links);
  const status = h('p', { class: 'help-status', role: 'status' });
  const paint = () => { const s = supportStatus(now(), support); status.className = `help-status ${s.open ? 'open' : 'closed'}`; status.replaceChildren(h('i', { 'aria-hidden': 'true' }), statusText(s)); };
  paint(); const timer = setInterval(() => { if (!root.isConnected) clearInterval(timer); else paint(); }, 60000);

  const card = (key, title, text, ...actions) => h('article', { class: `help-card ${key}` }, h('span', { class: 'help-badge', 'aria-hidden': 'true' }, icon(key)), h('div', { class: 'help-card-text' }, h('h3', {}, title), h('p', {}, text)), h('div', { class: 'help-actions' }, ...actions));
  const link = (option) => h('a', { class: 'btn', href: option.url, target: '_blank', rel: 'noopener noreferrer' }, option.label);
  const cards = [
    card('chat', 'Live chat', 'Write to our team here on 12toons. Your messages and our replies stay in the chat.', h('button', { type: 'button', class: 'btn pri', onclick: openChat }, 'Start live chat')),
    ...channels.map((c) => card(c.key, c.label, c.options.length > 1 ? `Join our ${c.label} group, or message us directly.` : `Reach us on ${c.label}.`, ...c.options.map(link))),
  ];
  root.append(
    h('header', { class: 'sh-bar' }, logo(home), h('span', { class: 'sh-crumb' }, 'Help and support'), h('span', { class: 'sp' }), h('button', { class: 'btn', type: 'button', onclick: home }, 'Home')),
    h('main', { class: 'help-main' },
      h('section', { class: 'help-hero' }, h('h1', {}, 'Help and support'), h('p', { class: 'sub' }, 'Have a question or a problem? Write to us and we will help you.'), status),
      h('section', { class: 'help-reply' }, h('b', {}, `You will get a reply within ${support.replyWindow}.`), h('p', {}, 'This is during our office hours. If you write after office hours, we reply when the office opens.')),
      h('section', { 'aria-labelledby': 'help-contact' }, h('h2', { id: 'help-contact' }, 'Contact us'), h('div', { class: 'help-grid' }, ...cards),
        isAdmin && !channels.length ? h('p', { class: 'help-admin-note' }, 'Admin note: Telegram and WhatsApp are not shown yet. Add the four links in shared/contact-links.js to show them here and in the chat button.') : null),
      h('section', { class: 'help-hours', 'aria-labelledby': 'help-hours-title' }, h('h2', { id: 'help-hours-title' }, 'Office hours'),
        h('table', {}, h('tbody', {}, ...hoursRows(support).map((row) => h('tr', {}, h('th', { scope: 'row' }, row.days), h('td', {}, row.time))))),
        h('p', { class: 'help-zone' }, `All times are in ${support.zoneLabel}.`)),
      h('section', { class: 'help-tips' }, h('h2', {}, 'To help us help you faster'), h('ul', {},
        h('li', {}, 'Tell us what you were doing when the problem happened.'),
        h('li', {}, 'Send a screenshot of the problem if you can.'),
        h('li', {}, 'Include your Project ID. You can see it at the top of the studio.'))),
      h('section', { class: 'help-coins' }, goldCoin(26), h('p', {}, 'Questions about Coins or a payment? Open the Coins page from the menu and use the payment history, then send us the order ID in your message.'))));
  root.dispose = () => clearInterval(timer);
  return root;
}
