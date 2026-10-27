import { hinglishify } from '../shared/hinglish-errors.js';
/** tiny element builder shared by the shell and the Character Studio */
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
const BRAND_MARK_SVG = `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="12toons">
  <defs><linearGradient id="bm-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3d58a"/><stop offset=".55" stop-color="#d4a443"/><stop offset="1" stop-color="#a97a22"/></linearGradient></defs>
  <rect x="1" y="1" width="46" height="46" rx="12" fill="url(#bm-g)"/>
  <rect x="1.5" y="1.5" width="45" height="45" rx="11.5" fill="none" stroke="#8a5a0b" stroke-width="1" opacity=".4"/>
  <text x="24" y="33" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="22" letter-spacing="-1" fill="#1b1308">12</text>
</svg>`;
/** the 12toons brand mark: a rounded badge with "12", drawn as SVG so it stays sharp at any size.
 *  with no `size` it scales with the surrounding font-size (1.3em), matching every header it sits in. */
export const brandMark = (size) => { const el = h('span', { class: 'brand-mark', style: size ? `width:${size}px;height:${size}px` : '' }); el.innerHTML = BRAND_MARK_SVG; return el; };
export const brandWordmark = () => [
  brandMark(),
  h('span', { class: 'brand-name' }, 'toons'),
];
export const logo = () => h('a', { class: 'logo logo-btn', href: '/#/', style: 'text-decoration:none', title: '12toons home', 'aria-label': '12toons home' }, ...brandWordmark());
