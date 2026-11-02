// The loading screen: the real 12toons logo, drawn piece by piece (pure SVG + CSS), and a line under it that changes every few seconds.
// The logo is the original picture cut into layers (scripts/make_logo_layers.py), so its colours and shapes are exactly the real logo.
import { h } from './dom.js';
import { LOADING_LINES, nextLine } from '../shared/loading-lines.js';
import { LOGO_VIEW, LOGO_PLATE, LOGO_LAYERS } from './logo-anim-data.js';

const SVG = 'http://www.w3.org/2000/svg', XLINK = 'http://www.w3.org/1999/xlink';
const layerUrl = (name) => `/images/logo-anim/${name}.webp`;
const node = (tag, attrs = {}) => { const el = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };

/** the animated logo; the animation starts when its pictures have loaded (or after a short wait), so nothing pops in half drawn */
export function animatedLogo() {
  const svg = node('svg', { viewBox: `0 0 ${LOGO_VIEW} ${LOGO_VIEW}`, class: 'ls-logo', role: 'img', 'aria-label': '12toons' });
  const clip = node('clipPath', { id: 'ls-swoosh-clip' }); clip.append(node('rect', { class: 'ls-wipe', x: 0, y: 300, width: LOGO_VIEW, height: 300 }));
  const clipUnder = node('clipPath', { id: 'ls-under-clip' }); clipUnder.append(node('rect', { class: 'ls-wipe ls-wipe-under', x: 0, y: 660, width: LOGO_VIEW, height: 80 }));
  svg.append(node('defs'), clip, clipUnder);
  const stage = node('g', { class: 'ls-stage' });
  stage.append(node('path', { class: 'ls-plate', d: LOGO_PLATE.path, fill: LOGO_PLATE.fill }));
  for (const name of LOGO_LAYERS) {
    const image = node('image', { href: layerUrl(name), width: LOGO_VIEW, height: LOGO_VIEW, class: `ls-img ls-${name}`, preserveAspectRatio: 'none' });
    image.setAttributeNS(XLINK, 'xlink:href', layerUrl(name));
    if (name === 'swoosh') image.setAttribute('clip-path', 'url(#ls-swoosh-clip)');
    if (name === 'under') image.setAttribute('clip-path', 'url(#ls-under-clip)');
    stage.append(image);
  }
  svg.append(stage);
  let started = false;
  const go = () => { if (!started) { started = true; svg.classList.add('go'); } };
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
