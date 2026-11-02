// The loading screen: a scratch card. A coin scratches the silver foil in a zig-zag and the real 12toons logo shows up under it as it goes
// (pure SVG + CSS), with a line below that changes every few seconds. The logo is the original picture cut into layers
// (scripts/make_logo_layers.py), so its colours and shapes are exactly the real logo.
import { h } from './dom.js';
import { LOADING_LINES, nextLine } from '../shared/loading-lines.js';
import { LOGO_VIEW, LOGO_PLATE, LOGO_LAYERS } from './logo-anim-data.js';

const SVG = 'http://www.w3.org/2000/svg', XLINK = 'http://www.w3.org/1999/xlink';
const layerUrl = (name) => `/images/logo-anim/${name}.webp`;
const node = (tag, attrs = {}, ...kids) => { const el = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); el.append(...kids); return el; };

export const SCRATCH_SECONDS = 2.7;
/** the zig-zag the coin follows: nine rows from edge to edge, so the whole card is scratched */
export const SCRATCH_PATH = (() => {
  const left = 40, right = LOGO_VIEW - 40, top = 60, bottom = LOGO_VIEW - 60, rows = 9, gap = (bottom - top) / (rows - 1);
  let d = `M${left} ${top}`;
  for (let i = 0; i < rows; i++) {
    const y = top + i * gap, toRight = i % 2 === 0;
    d += ` L${toRight ? right : left} ${y}`;
    if (i < rows - 1) d += ` L${toRight ? right : left} ${y + gap}`;
  }
  return d;
})();
const sparkle = (x, y, r) => node('path', { class: 'ls-spark', d: `M${x} ${y - r} L${x + r * 0.22} ${y - r * 0.22} L${x + r} ${y} L${x + r * 0.22} ${y + r * 0.22} L${x} ${y + r} L${x - r * 0.22} ${y + r * 0.22} L${x - r} ${y} L${x - r * 0.22} ${y - r * 0.22}Z` });

/** the scratch-card logo; the scratching starts when the logo's pictures have loaded (or after a short wait), so nothing shows half drawn */
export function animatedLogo() {
  const svg = node('svg', { viewBox: `0 0 ${LOGO_VIEW} ${LOGO_VIEW}`, class: 'ls-logo', role: 'img', 'aria-label': '12toons' });
  const foil = node('linearGradient', { id: 'ls-foil', x1: 0, y1: 0, x2: 1, y2: 1 },
    node('stop', { offset: 0, 'stop-color': '#d9dce2' }), node('stop', { offset: 0.35, 'stop-color': '#a9aeb8' }), node('stop', { offset: 0.55, 'stop-color': '#e6e8ec' }), node('stop', { offset: 1, 'stop-color': '#9298a3' }));
  const coin = node('radialGradient', { id: 'ls-coin', cx: 0.35, cy: 0.3, r: 0.8 }, node('stop', { offset: 0, 'stop-color': '#fff1b0' }), node('stop', { offset: 0.6, 'stop-color': '#f2b632' }), node('stop', { offset: 1, 'stop-color': '#b9791a' }));
  // everything white shows the foil; the zig-zag is drawn in black as the coin moves, which wipes the foil away there
  const mask = node('mask', { id: 'ls-scratch', maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: LOGO_VIEW, height: LOGO_VIEW },
    node('rect', { width: LOGO_VIEW, height: LOGO_VIEW, fill: '#fff' }),
    node('path', { class: 'ls-scratched', d: SCRATCH_PATH, pathLength: 1, fill: 'none', stroke: '#000', 'stroke-width': 116, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  svg.append(node('defs', {}, foil, coin, mask));

  const stage = node('g', { class: 'ls-stage' });
  stage.append(node('path', { class: 'ls-plate', d: LOGO_PLATE.path, fill: LOGO_PLATE.fill }));
  for (const name of LOGO_LAYERS) {
    const image = node('image', { href: layerUrl(name), width: LOGO_VIEW, height: LOGO_VIEW, class: `ls-img ls-${name}`, preserveAspectRatio: 'none' });
    image.setAttributeNS(XLINK, 'xlink:href', layerUrl(name));
    stage.append(image);
  }
  const cover = node('g', { class: 'ls-cover', mask: 'url(#ls-scratch)' },
    node('path', { d: LOGO_PLATE.path, fill: 'url(#ls-foil)' }),
    node('text', { x: LOGO_VIEW / 2, y: 410, 'text-anchor': 'middle', class: 'ls-foil-text' }, 'SCRATCH'),
    sparkle(150, 170, 34), sparkle(610, 130, 26), sparkle(630, 520, 38), sparkle(120, 610, 28), sparkle(380, 640, 22));
  const motion = node('animateMotion', { class: 'ls-motion', path: SCRATCH_PATH, dur: `${SCRATCH_SECONDS}s`, begin: 'indefinite', fill: 'freeze', calcMode: 'spline', keyTimes: '0;1', keyPoints: '0;1', keySplines: '.4 0 .6 1' });
  const coinShape = node('g', { class: 'ls-coin' }, node('g', { class: 'ls-coin-tilt' },
    node('circle', { r: 54, cx: 0, cy: 0, fill: 'url(#ls-coin)', stroke: '#8a5a12', 'stroke-width': 5 }), node('circle', { r: 37, fill: 'none', stroke: '#b9791a', 'stroke-width': 4, opacity: 0.7 }),
    node('path', { d: 'M-12 -10 L-12 12 M-4 -10 L-4 12', stroke: '#b9791a', 'stroke-width': 4, 'stroke-linecap': 'round', opacity: 0.8, transform: 'translate(8 0)' })), motion);
  stage.append(cover, coinShape);
  svg.append(stage);

  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let started = false;
  const go = () => {
    if (started) return; started = true;
    svg.classList.add('go');
    if (reduced) { svg.classList.add('done'); return; }            // reduced motion: the logo is simply shown, nothing is scratched
    try { motion.beginElement(); } catch { svg.classList.add('done'); }
    setTimeout(() => svg.classList.add('done'), SCRATCH_SECONDS * 1000 + 100);
  };
  Promise.race([Promise.all(LOGO_LAYERS.map((name) => new Promise((resolve) => { const img = new Image(); img.onload = img.onerror = resolve; img.src = layerUrl(name); }))), new Promise((resolve) => setTimeout(resolve, 1500))]).then(go);
  return svg;
}

/** a loading screen element; the changing line stops by itself when the screen is removed */
export function loadingSplash(message = 'Getting things ready…', { every = 3200, lines = LOADING_LINES } = {}) {
  let index = 0;
  const line = h('p', { class: 'ls-line' }, lines[0]);
  const el = h('div', { class: 'sh sh-center boot-splash loading-splash', role: 'status', 'aria-live': 'polite' }, animatedLogo(), h('p', { class: 'sub ls-message' }, message), line);
  const timer = setInterval(() => {
    if (!el.isConnected) { clearInterval(timer); return; }
    line.classList.add('out');
    setTimeout(() => { index = nextLine(index, lines); line.textContent = lines[index]; line.classList.remove('out'); }, 350);
  }, every);
  return el;
}
