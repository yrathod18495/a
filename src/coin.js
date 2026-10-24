// The 12toons Gold Coin: a royal coin drawn in code (no image file), used wherever the site shows what used to be "credits".
// One hidden <defs> block holds the gradients; every coin just references it, so a page full of coins stays light.
import { h } from './dom.js';

export const COIN_NAME = 'Gold Coins';
const NS = 'http://www.w3.org/2000/svg';
let defsReady = false;

const DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
  <linearGradient id="gc-rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3b0"/><stop offset=".28" stop-color="#e8b93c"/><stop offset=".55" stop-color="#9a6a12"/><stop offset=".8" stop-color="#f2cf63"/><stop offset="1" stop-color="#7a4f08"/></linearGradient>
  <linearGradient id="gc-edge" x1="1" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#fff0a6"/><stop offset=".5" stop-color="#b9831d"/><stop offset="1" stop-color="#5e3a05"/></linearGradient>
  <radialGradient id="gc-face" cx=".38" cy=".3" r=".9"><stop offset="0" stop-color="#ffe98a"/><stop offset=".45" stop-color="#f0bd3a"/><stop offset=".8" stop-color="#c58a1c"/><stop offset="1" stop-color="#9a6410"/></radialGradient>
  <linearGradient id="gc-emboss" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff7c4"/><stop offset=".5" stop-color="#d9a22b"/><stop offset="1" stop-color="#8a5a0b"/></linearGradient>
  <linearGradient id="gc-shine" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <path id="gc-arc" d="M 17 50 A 33 33 0 0 1 83 50"/>
</defs></svg>`;

/** the coin as an SVG string: reeded edge, raised rim, small "12TOON" lettering round the top, a crown in the middle and stars below */
const coinSvg = (size) => `<svg xmlns="${NS}" viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="12toons Gold Coin">
  <circle cx="50" cy="50" r="48.5" fill="url(#gc-edge)"/>
  <circle cx="50" cy="50" r="47" fill="none" stroke="#6b4408" stroke-width="2.4" stroke-dasharray="1.6 1.9" opacity=".75"/>
  <circle cx="50" cy="50" r="44" fill="url(#gc-rim)"/>
  <circle cx="50" cy="50" r="38.5" fill="url(#gc-face)" stroke="#8a5a0b" stroke-width="1"/>
  <circle cx="50" cy="50" r="35.5" fill="none" stroke="#fff1a8" stroke-width=".7" opacity=".8"/>
  <text font-family="Georgia,'Times New Roman',serif" font-weight="700" font-size="10" letter-spacing="2" fill="#7a4d08" stroke="#fff0a0" stroke-width=".25" text-anchor="middle"><textPath href="#gc-arc" startOffset="50%">12TOON</textPath></text>
  <g transform="translate(50 47)" fill="url(#gc-emboss)" stroke="#7a4d08" stroke-width=".9" stroke-linejoin="round">
    <path d="M-15 8 L-17 -9 L-8 -1 L0 -13 L8 -1 L17 -9 L15 8 Z"/>
    <rect x="-15" y="8.5" width="30" height="4.2" rx="1.2"/>
    <circle cx="-17" cy="-10.5" r="2.2"/><circle cx="0" cy="-15" r="2.4"/><circle cx="17" cy="-10.5" r="2.2"/>
  </g>
  <circle cx="50" cy="53.4" r="1.7" fill="#c8342f" stroke="#7a4d08" stroke-width=".5"/>
  <g fill="#7a4d08" stroke="#fff0a0" stroke-width=".25" opacity=".92"><path d="M0-4.2 1.2-1.3 4.2-1.1 1.9 .9 2.6 3.9 0 2.3-2.6 3.9-1.9 .9-4.2-1.1-1.2-1.3z" transform="translate(35 76.5)"/><path d="M0-4.2 1.2-1.3 4.2-1.1 1.9 .9 2.6 3.9 0 2.3-2.6 3.9-1.9 .9-4.2-1.1-1.2-1.3z" transform="translate(50 76.5)"/><path d="M0-4.2 1.2-1.3 4.2-1.1 1.9 .9 2.6 3.9 0 2.3-2.6 3.9-1.9 .9-4.2-1.1-1.2-1.3z" transform="translate(65 76.5)"/></g>
  <path d="M 18 40 A 34 34 0 0 1 52 14 A 40 40 0 0 0 22 52 Z" fill="url(#gc-shine)"/>
</svg>`;

/** a Gold Coin element; `size` is in px */
export function goldCoin(size = 20) {
  if (!defsReady && typeof document !== 'undefined') { document.body.insertAdjacentHTML('beforeend', DEFS); defsReady = true; }
  const el = h('span', { class: 'gcoin', style: `width:${size}px;height:${size}px` });
  el.innerHTML = coinSvg(size);
  return el;
}

/** "1,500 [coin] Gold Coins" as one inline element (number first, the coin, then the name unless `short`) */
export function coinAmount(n, { short = false, size = 18 } = {}) {
  return h('span', { class: 'gcoin-amount' }, Number(n || 0).toLocaleString('en-IN'), goldCoin(size), short ? null : ` ${COIN_NAME}`);
}

/** plain-text wording for toasts, payment descriptions and messages */
export const coinText = (n) => `${Number(n || 0).toLocaleString('en-IN')} ${COIN_NAME}`;
