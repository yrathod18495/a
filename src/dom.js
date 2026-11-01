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
// a notice leaves by itself after a few seconds, and can be swiped (or flicked) away sideways or down at once
export function swipeAway(t, ms = 4500) {
  const timer = setTimeout(() => t.remove(), ms);
  let x0 = 0, y0 = 0, dx = 0, dy = 0, down = false;
  t.style.touchAction = 'none'; t.style.cursor = 'grab';
  const paint = () => { t.style.transform = `translate(calc(-50% + ${dx}px), ${Math.max(0, dy)}px)`; t.style.opacity = String(Math.max(.15, 1 - Math.max(Math.abs(dx), dy) / 220)); };
  t.addEventListener('pointerdown', (e) => { down = true; x0 = e.clientX; y0 = e.clientY; dx = dy = 0; t.style.transition = 'none'; t.setPointerCapture?.(e.pointerId); });
  t.addEventListener('pointermove', (e) => { if (!down) return; dx = e.clientX - x0; dy = e.clientY - y0; paint(); });
  const end = () => {
    if (!down) return; down = false;
    if (Math.abs(dx) > 50 || dy > 40) { clearTimeout(timer); t.style.transition = 'transform .18s,opacity .18s'; dx = Math.sign(dx || 1) * (Math.abs(dy) > Math.abs(dx) ? 0 : 400); dy = Math.abs(dy) > Math.abs(dx) ? 200 : 0; t.style.opacity = '0'; t.style.transform = `translate(calc(-50% + ${dx}px), ${dy}px)`; setTimeout(() => t.remove(), 180); }
    else { t.style.transition = 'transform .15s,opacity .15s'; dx = dy = 0; t.style.transform = 'translateX(-50%)'; t.style.opacity = '1'; }
  };
  t.addEventListener('pointerup', end); t.addEventListener('pointercancel', end);
}
export const toast = (msg) => { const t = h('div', { class: 'toast' }, typeof msg === 'string' ? hinglishify(msg) : msg); document.body.append(t); swipeAway(t); };
/** the 12toons header mark: a small "12" badge in text, the same in every header (the full logo picture is only on the landing page) */
export const brandMark = () => h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, '12');
export const brandWordmark = () => [
  brandMark(),
  h('span', { class: 'brand-name' }, 'toons'),
];
export const logo = () => h('a', { class: 'logo logo-btn', href: '/#/', style: 'text-decoration:none', title: '12toons home', 'aria-label': '12toons home' }, ...brandWordmark());
