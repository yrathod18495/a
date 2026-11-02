// The loading screen: a small bouncing mascot (pure CSS / SVG, so nothing extra to download) and a line that changes every few seconds.
import { h } from './dom.js';
import { LOADING_LINES, nextLine } from '../shared/loading-lines.js';

const SVG = 'http://www.w3.org/2000/svg';
function mascot() {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120'); svg.setAttribute('class', 'ls-mascot'); svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `
    <ellipse class="ls-shadow" cx="60" cy="108" rx="26" ry="5"/>
    <g class="ls-body">
      <rect x="26" y="26" width="68" height="68" rx="24" class="ls-face"/>
      <g class="ls-eyes"><ellipse cx="46" cy="58" rx="6" ry="8"/><ellipse cx="74" cy="58" rx="6" ry="8"/></g>
      <path d="M48 76 Q60 86 72 76" class="ls-smile"/>
      <path d="M60 26 Q58 14 66 10" class="ls-sprout"/>
    </g>`;
  return svg;
}

/** a loading screen element; the changing line stops by itself when the screen is removed */
export function loadingSplash(message = 'Getting things ready…', { every = 3200, lines = LOADING_LINES } = {}) {
  let index = 0;
  const line = h('p', { class: 'ls-line' }, lines[0]);
  const el = h('div', { class: 'sh sh-center boot-splash loading-splash', role: 'status', 'aria-live': 'polite' }, mascot(), h('p', { class: 'sub ls-message' }, message), line);
  const timer = setInterval(() => {
    if (!el.isConnected) { clearInterval(timer); return; }
    line.classList.add('out');
    setTimeout(() => { index = nextLine(index, lines); line.textContent = lines[index]; line.classList.remove('out'); }, 350);
  }, every);
  return el;
}
