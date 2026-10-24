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
export const logo = () => h('a', { class: 'logo logo-btn', href: '/#/', style: 'text-decoration:none', title: '12toons home', 'aria-label': '12toons home' }, h('img', { class: 'royal-brand-emblem', src: '/images/royal-crown-emblem.png', alt: '', width: 38, height: 38 }), h('b', {}, '12'), 'toons');
