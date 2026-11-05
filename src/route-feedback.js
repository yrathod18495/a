// Page-change feedback, so a tap never looks like it did nothing: a thin progress bar at the top the moment a page starts loading, a
// placeholder page if it takes longer than a blink, and a "tap to reload" pill if it is really stuck. Each caller uses its own key.
import { h } from './dom.js';

const SLOW_AFTER_MS = 140;
// "stuck" (tap-to-reload) should mean the page really has stopped making progress — not just that the user's own connection is slow
// enough that 12 s was never realistic. On a confirmed slow connection (the Network Information API, where the browser supports it)
// the same page can legitimately take much longer, so the threshold grows with how slow the connection says it is.
export function stuckAfterMs() {
  const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!c) return 12000;
  if (c.effectiveType === 'slow-2g') return 45000;
  if (c.effectiveType === '2g') return 30000;
  if (c.effectiveType === '3g') return 20000;
  if (Number.isFinite(c.downlink) && c.downlink > 0 && c.downlink < 1) return 30000;   // under ~1 Mbps, whatever the label says
  return 12000;
}
const pending = new Map();           // key -> { studio }
let bar, fill, overlay, pill, progress = 0, tick = 0, slowTimer = 0, stuckTimer = 0, hideTimer = 0;

function ensure() {
  if (bar) return;
  fill = h('div', { class: 'rf-fill' });
  bar = h('div', { class: 'rf-bar', 'aria-hidden': 'true' }, fill);
  document.body.append(bar);
}
const paint = () => { fill.style.width = `${progress}%`; };
const skeleton = (studio) => studio
  ? h('div', { class: 'rf-overlay rf-studio', role: 'status', 'aria-live': 'polite' }, h('div', { class: 'rf-spin' }), h('b', {}, 'Opening your studio…'), h('small', {}, 'Getting your characters and project ready'))
  : h('div', { class: 'rf-overlay', 'aria-hidden': 'true' },
    h('div', { class: 'rf-head' }, h('i', { class: 'rf-sk rf-ico' }), h('i', { class: 'rf-sk rf-line w60' }), h('i', { class: 'rf-sk rf-line w40' })),
    h('div', { class: 'rf-card' }, h('i', { class: 'rf-sk rf-block' })), h('div', { class: 'rf-card' }, h('i', { class: 'rf-sk rf-block' })), h('div', { class: 'rf-card short' }, h('i', { class: 'rf-sk rf-line w80' }), h('i', { class: 'rf-sk rf-line w50' })));

function clearTimers() { clearInterval(tick); clearTimeout(slowTimer); clearTimeout(stuckTimer); clearTimeout(hideTimer); tick = slowTimer = stuckTimer = hideTimer = 0; }
function showOverlay() {
  if (!pending.size || overlay || [...pending.values()].every((p) => p.quiet)) return;
  overlay = skeleton([...pending.values()].some((p) => p.studio));
  document.body.append(overlay);
}
function dropOverlay() { overlay?.remove(); overlay = null; pill?.remove(); pill = null; }

export function startRoute(key, { studio = false, quiet = false } = {}) {
  ensure();
  const first = !pending.size;
  pending.set(key, { studio, quiet });
  if (!first) return;
  clearTimers(); dropOverlay();
  progress = 8; bar.classList.add('on'); paint();
  tick = setInterval(() => { progress = Math.min(90, progress + (90 - progress) * 0.08); paint(); }, 200);
  slowTimer = setTimeout(showOverlay, SLOW_AFTER_MS);   // a quiet start (the first page load) only gets the bar, the splash is already on screen
  stuckTimer = setTimeout(() => {
    if (!pending.size || pill) return;
    pill = h('button', { type: 'button', class: 'rf-pill', onclick: () => location.reload() }, 'This page is slow to open — tap to reload');
    document.body.append(pill);
  }, stuckAfterMs());
}
export function doneRoute(key) {
  if (!pending.delete(key) || pending.size) return;
  clearTimers(); dropOverlay();
  progress = 100; paint();
  hideTimer = setTimeout(() => { bar.classList.remove('on'); progress = 0; paint(); }, 320);
}
