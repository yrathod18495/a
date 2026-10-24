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
export const toast = (msg) => { const t = h('div', { class: 'toast' }, msg); document.body.append(t); setTimeout(() => t.remove(), 4500); };
/** The crown belongs to the number, so every header uses the same wordmark. */
export const brandWordmark = () => [
  h('span', { class: 'brand-number' },
    h('img', { class: 'brand-crown', src: '/images/royal-crown-emblem.png', alt: '', width: 320, height: 247 }),
    h('b', {}, '12')),
  h('span', { class: 'brand-name' }, 'toons'),
];
export const logo = () => h('a', { class: 'logo logo-btn', href: '/#/', style: 'text-decoration:none', title: '12toons home', 'aria-label': '12toons home' }, ...brandWordmark());
