import { h } from './dom.js';
/** Shows that something is being done to one card or row: it is dimmed, cannot be pressed, and a moving bar with a short text sits on it. `done()` puts it back. */
export function working(el, label = 'Working…') {
  if (!el) return { done() {}, text() {} };
  el.classList.add('is-working');
  const text = h('span', {}, label), overlay = h('div', { class: 'work-overlay', role: 'status', 'aria-live': 'polite' }, text, h('i', { class: 'work-bar', 'aria-hidden': 'true' }));
  el.append(overlay);
  return { text: (t) => { text.textContent = t; }, done() { overlay.remove(); el.classList.remove('is-working'); } };
}
