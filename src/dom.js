import { hinglishify } from '../shared/hinglish-errors.js';
/** tiny element builder shared by the shell and the Character Editor */
export const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') el.style.cssText = v;
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
};
export const toast = (msg) => { const t = h('div', { class: 'toast' }, typeof msg === 'string' ? hinglishify(msg) : msg); document.body.append(t); setTimeout(() => t.remove(), 4500); };
/** the 12toons header mark: a small "12" badge in text, the same in every header (the full logo picture is only on the landing page) */
export const brandMark = () => h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, '12');
export const brandWordmark = () => [
  brandMark(),
  h('span', { class: 'brand-name' }, 'toons'),
];
export const logo = () => h('a', { class: 'logo logo-btn', href: '/#/', style: 'text-decoration:none', title: '12toons home', 'aria-label': '12toons home' }, ...brandWordmark());
