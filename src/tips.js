// Hold-to-explain tooltips for icon buttons: press and hold (touch) or hover (mouse) an element that has a `title` / `data-tip`, and a small label
// shows what it does. It goes away by itself after a moment, when the finger lifts, or when the pointer leaves — it never stays stuck on screen.
let bubble = null, hideTimer = 0, holdTimer = 0, current = null;
const textOf = (el) => el?.dataset?.tip || '';
/** copy `title` text into `data-tip` and keep an accessible name; the title attribute itself stays (tests, screen readers) except while the pointer is on it */
function adopt(el) {
  const t = el.getAttribute?.('title');
  if (!t) return;
  el.dataset.tip = t;
  if (!el.getAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', t);
}
let lifted = null;
/** take the native tooltip away while our own is in charge (it is slow and sticks) */
function lift(el) { if (lifted === el) return; drop(); const t = el.getAttribute('title'); if (t) { el.dataset.tip = t; el.removeAttribute('title'); lifted = el; } }
function drop() { if (lifted) { if (lifted.dataset.tip && !lifted.hasAttribute('title')) lifted.setAttribute('title', lifted.dataset.tip); lifted = null; } }
function adoptAll(root) { if (root.nodeType !== 1) return; adopt(root); root.querySelectorAll('[title]').forEach(adopt); }
function hide() { clearTimeout(hideTimer); clearTimeout(holdTimer); bubble?.remove(); bubble = null; current = null; drop(); }
function show(el, autoHide = 1800) {
  const t = textOf(el);
  if (!t) return;
  hide(); current = el;
  bubble = document.createElement('div'); bubble.className = 'tip-bubble'; bubble.setAttribute('role', 'tooltip'); bubble.textContent = t;
  document.body.append(bubble);
  const r = el.getBoundingClientRect(), b = bubble.getBoundingClientRect(), pad = 8;
  let x = r.left + r.width / 2 - b.width / 2, y = r.bottom + 8;
  if (y + b.height > innerHeight - pad) y = r.top - b.height - 8;           // no room below: show above
  x = Math.max(pad, Math.min(x, innerWidth - b.width - pad));
  bubble.style.left = `${x}px`; bubble.style.top = `${Math.max(pad, y)}px`;
  hideTimer = setTimeout(hide, autoHide);
}
export function installTips(root = document.body) {
  if (installTips.done) return; installTips.done = true;
  adoptAll(root);
  new MutationObserver((list) => { for (const m of list) { if (m.type === 'attributes') adopt(m.target); else m.addedNodes.forEach(adoptAll); } })
    .observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['title'] });
  const target = (e) => e.target.closest?.('[data-tip]');
  let touchHeld = false;
  document.addEventListener('pointerdown', (e) => {
    const el = target(e);
    if (!el) { hide(); return; }
    if (e.pointerType === 'mouse') { hide(); lift(el); return; }
    touchHeld = false; lift(el); clearTimeout(holdTimer);
    holdTimer = setTimeout(() => { touchHeld = true; show(el, 2200); }, 380);        // press and hold
  }, true);
  const release = () => { clearTimeout(holdTimer); if (touchHeld) { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 900); } };
  document.addEventListener('pointerup', release, true);
  document.addEventListener('pointercancel', () => { clearTimeout(holdTimer); hide(); }, true);
  document.addEventListener('pointermove', (e) => { if (e.pointerType !== 'mouse' && !touchHeld && Math.abs(e.movementX) + Math.abs(e.movementY) > 6) clearTimeout(holdTimer); }, true);
  // a long press must not also open the browser's context menu or fire the button
  document.addEventListener('contextmenu', (e) => { if (touchHeld && target(e)) e.preventDefault(); }, true);
  document.addEventListener('click', (e) => { if (touchHeld) { touchHeld = false; if (target(e)) { e.stopPropagation(); e.preventDefault(); } } }, true);
  // mouse: hover shows it after a short pause
  let hover = 0;
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = target(e); clearTimeout(hover);
    if (el) lift(el);
    if (el && el !== current) hover = setTimeout(() => show(el, 2500), 450);
  }, true);
  document.addEventListener('pointerout', (e) => { if (e.pointerType === 'mouse') { clearTimeout(hover); if (!e.relatedTarget || !e.target.closest?.('[data-tip]')?.contains(e.relatedTarget)) hide(); } }, true);
  window.addEventListener('scroll', hide, true); window.addEventListener('blur', hide);
}
