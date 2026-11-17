// More skills: flat vector powers drawn like the first four (see skills.js). Every function draws around the middle of a square picture (0,0 after the translate), R = the base radius
// (the picture is about 3.2 R wide), T = seconds since the skill started (times Speed), c = [r,g,b], p = Level 0.1..1, wd = Width / spread. "Forward" is UP (-y): the Turn slider and a flying
// skill rotate the picture, so a beam, an arc or speed lines point where it is turned or where it flies. Plain canvas 2D only: it runs in the export worker too.
export const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
export const css = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
export const seeded = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const W = [255, 255, 255];
const glow = (ctx, x, y, r, col, a) => { const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, css(col, a)); g.addColorStop(1, css(col, 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); };
const flame = (ctx, x, y, w, h, sway) => { ctx.beginPath(); ctx.moveTo(x - w / 2, y); ctx.quadraticCurveTo(x - w * 0.7, y - h * 0.45, x + sway, y - h); ctx.quadraticCurveTo(x + w * 0.7, y - h * 0.45, x + w / 2, y); ctx.quadraticCurveTo(x, y + w * 0.25, x - w / 2, y); ctx.fill(); };
const star = (ctx, x, y, r, th = 0) => { ctx.beginPath(); for (let i = 0; i < 8; i++) { const a = th + (i * Math.PI) / 4, rr = i % 2 ? r * 0.22 : r; i ? ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); };
/** a jagged line from (0,0) forward (up) as far as `len`, with `seg` kinks of size `jag`; returns the points */
const jagged = (rnd, len, seg, jag, ang = 0) => { const pts = [[0, 0]]; for (let i = 1; i <= seg; i++) { const d = (i / seg) * len, j = (rnd() - 0.5) * jag * (i < seg ? 1 : 0.4); pts.push([Math.cos(ang) * j + Math.sin(ang) * d, -Math.cos(ang) * d + Math.sin(ang) * j]); } return pts; };
const stroke = (ctx, pts, w, col) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); };
const bolt = (ctx, pts, R, c, k = 1) => { const g = mix(c, W, 0.2), wh = mix(c, W, 0.85); stroke(ctx, pts, R * 0.16 * k, css(g, 0.28)); stroke(ctx, pts, R * 0.07 * k, css(c, 0.95)); stroke(ctx, pts, R * 0.03 * k, css(wh, 1)); };

export const MORE = {
  /** flames all round the body */
  burnaura(ctx, R, T, c, p, wd = 1) {
    const rx = R * 0.85 * wd, ry = R * 1.15, n = 12 + Math.round(p * 8), hot = mix(c, [255, 235, 140], 0.65), core = mix(c, [255, 255, 235], 0.9);
    glow(ctx, 0, 0, R * 1.5, c, 0.18 + 0.2 * p);
    for (const [col, sc] of [[css(c), 1], [css(hot), 0.7], [css(core), 0.4]]) {
      ctx.fillStyle = col;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, ph = i * 1.9 + sc * 2, x = Math.cos(a) * rx, y = Math.sin(a) * ry, h = R * (0.5 + 0.55 * p) * sc * (0.75 + 0.25 * Math.sin(T * 7 + ph));
        flame(ctx, x, y, R * 0.3 * sc, h * (Math.sin(a) < 0 ? 1.25 : 0.8), Math.sin(T * 5 + ph) * R * 0.05);
      }
    }
  },
  /** sparks that float up and fade */
  embers(ctx, R, T, c, p, wd = 1) {
    const n = 14 + Math.round(p * 22), hot = mix(c, [255, 235, 140], 0.6);
    for (let i = 0; i < n; i++) {
      const ph = (T * (0.35 + (i % 5) * 0.07) + i * 0.173) % 1, x = Math.sin(i * 12.9 + T * 0.6) * R * 0.9 * wd + Math.sin(T * 3 + i) * R * 0.08, y = R * 1.1 - ph * R * 2.5, r = R * (0.03 + 0.045 * ((i * 7) % 4) / 3) * (1 - ph * 0.5) + 1;
      ctx.fillStyle = css(i % 3 ? c : hot, Math.min(1, (1 - ph) * 1.6)); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    }
  },
  /** wavy see-through lines that rise (hot air) */
  haze(ctx, R, T, c, p, wd = 1) {
    const col = mix(c, W, 0.6); glow(ctx, 0, R * 0.2, R * 1.2, c, 0.1 + 0.1 * p);
    ctx.lineWidth = Math.max(2, R * 0.07);
    for (let i = 0; i < 6; i++) {
      const x0 = (i - 2.5) * R * 0.38 * wd, ph = (T * 0.45 + i * 0.37) % 1; ctx.strokeStyle = css(col, 0.3 * Math.sin(Math.PI * ph) * (0.5 + p * 0.5)); ctx.beginPath();
      for (let s = 0; s <= 14; s++) { const u = s / 14, y = R * 1.1 - u * R * 2.2, x = x0 + Math.sin(u * 7 + T * 3 + i) * R * 0.09 * (0.4 + u); s ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
    }
  },
  /** grey puffs that rise, grow and fade */
  smoke(ctx, R, T, c, p, wd = 1) {
    const n = 7 + Math.round(p * 6), col = mix(c, [80, 80, 90], 0.55);
    for (let i = 0; i < n; i++) {
      const ph = (T * 0.32 + i / n) % 1, x = Math.sin(i * 5.3 + T * 0.8) * R * 0.45 * wd * (0.4 + ph), y = R * 1.0 - ph * R * 2.3, r = R * (0.22 + ph * 0.5);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, css(col, 0.55 * Math.sin(Math.PI * Math.min(1, ph * 1.2)))); g.addColorStop(1, css(col, 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    }
  },
  /** one long bolt that jumps between two places (turn it to aim) */
  arc(ctx, R, T, c, p, wd = 1) {
    const rnd = seeded(Math.floor(T * 16) * 4001 + 5), len = R * 1.35 * Math.min(1.1, wd), main = jagged(rnd, len, 9, R * 0.3); glow(ctx, 0, 0, R * 0.5, c, 0.5); glow(ctx, main[9][0], main[9][1], R * 0.4, c, 0.5);
    bolt(ctx, main, R, c, 0.6 + p * 0.6);
    for (let b = 0; b < 1 + Math.round(p * 2); b++) { const at = main[2 + Math.floor(rnd() * 5)], br = jagged(rnd, R * (0.4 + rnd() * 0.4), 4, R * 0.2, (rnd() - 0.5) * 1.6).map(([x, y]) => [x + at[0], y + at[1]]); bolt(ctx, br, R, c, 0.5); }
  },
  /** short bolts that crawl over the body */
  voltaura(ctx, R, T, c, p, wd = 1) {
    const rnd = seeded(Math.floor(T * 12) * 6131 + 9), n = 7 + Math.round(p * 7); glow(ctx, 0, 0, R * 1.4, c, 0.14 + 0.12 * p);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, rx = R * 0.7 * wd * (0.6 + rnd() * 0.5), ry = R * 1.1 * (0.6 + rnd() * 0.5), x = Math.cos(a) * rx, y = Math.sin(a) * ry, ang = a + Math.PI / 2 + (rnd() - 0.5) * 1.4;
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang); bolt(ctx, jagged(rnd, R * (0.35 + rnd() * 0.45), 4, R * 0.18, 0), R, c, 0.45); ctx.restore();
    }
  },
  /** a straight ray of energy (turn it to aim) */
  beam(ctx, R, T, c, p, wd = 1) {
    const len = R * 1.55, w = R * (0.22 + 0.2 * p) * wd * (1 + 0.1 * Math.sin(T * 24)), hot = mix(c, W, 0.6);
    const g = ctx.createLinearGradient(0, 0, 0, -len); g.addColorStop(0, css(c, 0.95)); g.addColorStop(0.75, css(c, 0.7)); g.addColorStop(1, css(c, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-w * 0.8, 0); ctx.lineTo(-w * 1.1, -len); ctx.lineTo(w * 1.1, -len); ctx.lineTo(w * 0.8, 0); ctx.closePath(); ctx.fill();
    const g2 = ctx.createLinearGradient(0, 0, 0, -len); g2.addColorStop(0, css(hot, 1)); g2.addColorStop(1, css(hot, 0)); ctx.fillStyle = g2; ctx.beginPath(); ctx.moveTo(-w * 0.35, 0); ctx.lineTo(-w * 0.45, -len); ctx.lineTo(w * 0.45, -len); ctx.lineTo(w * 0.35, 0); ctx.closePath(); ctx.fill();
    glow(ctx, 0, 0, R * 0.55, c, 0.8); ctx.fillStyle = css(W, 0.95); ctx.beginPath(); ctx.arc(0, 0, R * 0.16, 0, 7); ctx.fill();
    for (let i = 0; i < 8; i++) { const ph = (T * 1.6 + i / 8) % 1, x = Math.sin(i * 3.7) * w, y = -ph * len; ctx.fillStyle = css(hot, 1 - ph); ctx.beginPath(); ctx.arc(x, y, R * 0.035 + 1, 0, 7); ctx.fill(); }
  },
  /** rings that spread over the ground */
  shockwave(ctx, R, T, c, p, wd = 1) {
    ctx.save(); ctx.translate(0, R * 0.2); ctx.scale(1, 0.36);
    for (let i = 0; i < 3; i++) {
      const ph = (T * 0.7 + i / 3) % 1, r = R * (0.15 + ph * 1.45) * wd, a = (1 - ph) * (0.5 + p * 0.5);
      ctx.strokeStyle = css(mix(c, W, ph * 0.3), a); ctx.lineWidth = R * (0.14 - ph * 0.08) + 1; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke();
      ctx.fillStyle = css(c, a * 0.18); ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
    }
    ctx.restore();
    const n = 6 + Math.round(p * 6); for (let i = 0; i < n; i++) { const ph = (T * 0.7 + i / n) % 1, a = i * 2.399, r = R * (0.2 + ph * 1.3), x = Math.cos(a) * r * wd, y = R * 0.2 + Math.sin(a) * r * 0.36 - ph * R * 0.5; ctx.fillStyle = css(mix(c, W, 0.5), 1 - ph); ctx.beginPath(); ctx.arc(x, y, R * 0.04 + 1, 0, 7); ctx.fill(); }
  },
  /** marks that glow in the air and float round */
  runes(ctx, R, T, c, p, wd = 1) {
    const hot = mix(c, W, 0.6), n = 5 + Math.round(p * 3);
    const glyph = [(r) => { ctx.moveTo(0, -r); ctx.lineTo(r * 0.7, r * 0.8); ctx.lineTo(-r * 0.7, r * 0.8); ctx.closePath(); ctx.moveTo(0, -r * 0.1); ctx.lineTo(0, r * 0.8); },
      (r) => { ctx.arc(0, 0, r * 0.8, 0, 7); ctx.moveTo(-r * 0.8, 0); ctx.lineTo(r * 0.8, 0); }, (r) => { ctx.moveTo(-r * 0.7, -r); ctx.lineTo(r * 0.7, r); ctx.moveTo(r * 0.7, -r); ctx.lineTo(-r * 0.7, r); ctx.moveTo(0, -r); ctx.lineTo(0, r); },
      (r) => { ctx.moveTo(-r * 0.7, r); ctx.lineTo(-r * 0.7, -r); ctx.lineTo(r * 0.7, -r * 0.2); ctx.lineTo(-r * 0.7, r * 0.3); }, (r) => { ctx.rect(-r * 0.7, -r * 0.7, r * 1.4, r * 1.4); ctx.moveTo(0, -r * 0.7); ctx.lineTo(0, r * 0.7); },
      (r) => { ctx.moveTo(-r, r * 0.6); ctx.lineTo(0, -r); ctx.lineTo(r, r * 0.6); ctx.moveTo(-r * 0.5, r * 0.1); ctx.lineTo(r * 0.5, r * 0.1); }];
    glow(ctx, 0, 0, R * 1.4, c, 0.1);
    for (let i = 0; i < n; i++) {
      const a = T * 0.5 + (i / n) * Math.PI * 2, x = Math.cos(a) * R * 0.95 * wd, y = Math.sin(a) * R * 0.6 + Math.sin(T * 1.7 + i * 2) * R * 0.12, tw = 0.65 + 0.35 * Math.sin(T * 3 + i * 1.3);
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(T + i) * 0.25); ctx.lineWidth = Math.max(2, R * 0.06); ctx.lineCap = 'round';
      ctx.strokeStyle = css(c, 0.35 * tw); ctx.lineWidth = R * 0.16; ctx.beginPath(); glyph[i % glyph.length](R * 0.2); ctx.stroke(); ctx.strokeStyle = css(hot, tw); ctx.lineWidth = Math.max(2, R * 0.05); ctx.beginPath(); glyph[i % glyph.length](R * 0.2); ctx.stroke(); ctx.restore();
    }
  },
  /** two glowing eyes with a flare */
  eyes(ctx, R, T, c, p, wd = 1) {
    const hot = mix(c, W, 0.7), pulse = 0.85 + 0.15 * Math.sin(T * 4), gap = R * 0.26 * wd;
    for (const sx of [-1, 1]) {
      const x = sx * gap; glow(ctx, x, 0, R * (0.55 + 0.3 * p) * pulse, c, 0.55);
      ctx.fillStyle = css(c, 1); ctx.beginPath(); ctx.ellipse(x, 0, R * 0.17, R * 0.075, sx * 0.25, 0, 7); ctx.fill(); ctx.fillStyle = css(hot, 1); ctx.beginPath(); ctx.ellipse(x, 0, R * 0.11, R * 0.04, sx * 0.25, 0, 7); ctx.fill();
      ctx.strokeStyle = css(c, 0.8 * pulse); ctx.lineWidth = Math.max(1.5, R * 0.025); for (const a of [-0.35, 0, 0.35]) { ctx.beginPath(); ctx.moveTo(x + sx * R * 0.16, 0); ctx.lineTo(x + sx * R * (0.45 + 0.4 * p) * Math.cos(a), Math.sin(a) * R * 0.3); ctx.stroke(); }
    }
  },
  /** sparkles that follow behind a moving thing (the head is up, the trail goes down) */
  trail(ctx, R, T, c, p, wd = 1) {
    const hot = mix(c, W, 0.65), n = 22 + Math.round(p * 14); glow(ctx, 0, -R * 0.5, R * 0.55, c, 0.65);
    ctx.fillStyle = css(W, 1); star(ctx, 0, -R * 0.5, R * 0.2, T * 2);
    for (let i = 0; i < n; i++) {
      const u = i / n, ph = (T * 0.6 + u) % 1, y = -R * 0.5 + ph * R * 2.1, x = Math.sin(ph * 9 + i * 1.7 + T * 2) * R * 0.28 * wd * (0.3 + ph), r = R * (0.1 - ph * 0.07) + 1;
      ctx.fillStyle = css(i % 2 ? hot : c, 1 - ph); star(ctx, x, y, r, i + T * 3);
    }
  },
  /** twinkling stars */
  sparkles(ctx, R, T, c, p, wd = 1) {
    const rnd = seeded(77), n = 8 + Math.round(p * 8), hot = mix(c, W, 0.7);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * R * 1.3 * wd, x = Math.cos(a) * d, y = Math.sin(a) * d * 0.9, tw = Math.max(0, Math.sin(T * (1.5 + rnd() * 2.5) + rnd() * 6)), r = R * (0.1 + rnd() * 0.16) * tw;
      if (r < 1) continue; glow(ctx, x, y, r * 2.4, c, 0.3 * tw); ctx.fillStyle = css(i % 3 ? hot : c, 1); star(ctx, x, y, r, 0);
    }
  },
  /** cold mist that sinks and spreads, with snow */
  frost(ctx, R, T, c, p, wd = 1) {
    const col = mix(c, W, 0.55);
    for (let i = 0; i < 8; i++) { const ph = (T * 0.25 + i / 8) % 1, x = Math.sin(i * 4.1) * R * 0.8 * wd * (0.4 + ph), y = R * 0.1 + ph * R * 0.9, r = R * (0.3 + ph * 0.55), g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, css(col, 0.4 * Math.sin(Math.PI * ph))); g.addColorStop(1, css(col, 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
    const n = 12 + Math.round(p * 14); ctx.fillStyle = css(W, 1);
    for (let i = 0; i < n; i++) { const ph = (T * (0.18 + (i % 4) * 0.05) + i * 0.137) % 1, x = Math.sin(i * 9.7 + T * 0.9) * R * 1.2 * wd, y = -R * 1.2 + ph * R * 2.6; ctx.globalAlpha = Math.sin(Math.PI * ph) * 0.9; ctx.beginPath(); ctx.arc(x, y, R * 0.035 + 1, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1;
  },
  /** ice crystals that grow up from one point */
  crystal(ctx, R, T, c, p, wd = 1) {
    const grow = Math.min(1, T * 2.2), dark = mix(c, [20, 50, 110], 0.45), light = mix(c, W, 0.7), n = 4 + Math.round(p * 2);
    glow(ctx, 0, -R * 0.3, R * 1.2, c, 0.15);
    const items = []; for (let i = 0; i < n; i++) { const u = n === 1 ? 0 : i / (n - 1) - 0.5, h = R * (1.0 + 0.9 * (1 - Math.abs(u) * 1.2)) * (0.8 + 0.2 * ((i * 5) % 3) / 2), w = R * 0.26 * wd; items.push({ x: u * R * 1.5 * wd, a: u * 0.5, h, w }); }
    items.sort((a, b) => Math.abs(b.x) - Math.abs(a.x));
    for (const it of items) {
      ctx.save(); ctx.translate(it.x, R * 0.15); ctx.rotate(it.a); const h = it.h * grow, w = it.w;
      ctx.fillStyle = css(dark, 0.95); ctx.beginPath(); ctx.moveTo(-w, 0); ctx.lineTo(-w * 0.85, -h * 0.75); ctx.lineTo(0, -h); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = css(c, 0.95); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -h); ctx.lineTo(w * 0.85, -h * 0.75); ctx.lineTo(w, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = css(light, 0.8); ctx.beginPath(); ctx.moveTo(w * 0.15, -h * 0.12); ctx.lineTo(w * 0.15, -h * 0.7); ctx.lineTo(w * 0.42, -h * 0.62); ctx.lineTo(w * 0.42, -h * 0.12); ctx.closePath(); ctx.fill(); ctx.restore();
    }
    const tw = Math.max(0, Math.sin(T * 3)); ctx.fillStyle = css(W, 1); star(ctx, R * 0.1, -R * 0.55, R * 0.16 * tw, 0); star(ctx, -R * 0.6, -R * 0.1, R * 0.1 * Math.max(0, Math.sin(T * 3 + 2)), 0);
  },
  /** a ball of water with drops circling it */
  water(ctx, R, T, c, p, wd = 1) {
    const r = R * wd * (0.55 + 0.2 * p) * (1 + 0.05 * Math.sin(T * 5)), dark = mix(c, [10, 40, 120], 0.5), light = mix(c, W, 0.65);
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r); g.addColorStop(0, css(light, 0.95)); g.addColorStop(0.55, css(c, 0.9)); g.addColorStop(1, css(dark, 0.95)); ctx.fillStyle = g;
    ctx.beginPath(); for (let a = 0; a <= 48; a++) { const t = (a / 48) * Math.PI * 2, rr = r * (1 + 0.05 * Math.sin(t * 5 + T * 4)); const x = Math.cos(t) * rr, y = Math.sin(t) * rr; a ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath(); ctx.fill();
    ctx.strokeStyle = css(light, 0.7); ctx.lineWidth = Math.max(1.5, R * 0.03); ctx.beginPath(); ctx.arc(0, r * 0.1, r * 0.62, 0.25, 1.9); ctx.stroke();
    ctx.fillStyle = css(W, 0.85); ctx.beginPath(); ctx.ellipse(-r * 0.38, -r * 0.4, r * 0.2, r * 0.11, -0.7, 0, 7); ctx.fill();
    for (let i = 0; i < 5; i++) { const a = T * 2.4 + i * 1.256, rr = r * 1.5, x = Math.cos(a) * rr, y = Math.sin(a) * rr * 0.7; ctx.fillStyle = css(c, 0.95); ctx.beginPath(); ctx.ellipse(x, y, R * 0.06, R * 0.09, a, 0, 7); ctx.fill(); ctx.fillStyle = css(W, 0.8); ctx.beginPath(); ctx.arc(x - 1, y - 2, R * 0.02 + 0.5, 0, 7); ctx.fill(); }
  },
  /** a turning column of wind with specks */
  wind(ctx, R, T, c, p, wd = 1) {
    const col = mix(c, W, 0.5);
    for (let i = 0; i < 6; i++) {
      const u = i / 5, y = -R * 1.1 + u * R * 2.3, rx = R * (0.3 + 0.8 * (1 - u)) * wd * 0.8 + R * 0.1, ph = T * (2.4 + i * 0.25) + i * 1.3;
      ctx.strokeStyle = css(i % 2 ? col : c, 0.35 + 0.5 * p); ctx.lineWidth = Math.max(2, R * (0.09 - u * 0.04)); ctx.beginPath(); ctx.ellipse(0, y, rx, rx * 0.28, 0, ph, ph + 2.7); ctx.stroke();
    }
    for (let i = 0; i < 6; i++) { const a = T * 3 + i * 1.05, u = (i * 0.173 + T * 0.2) % 1, y = R * 1.1 - u * R * 2.2, rx = R * (0.4 + 0.7 * (1 - u)) * wd * 0.9; ctx.fillStyle = css(col, 0.8); ctx.beginPath(); ctx.ellipse(Math.cos(a) * rx, y + Math.sin(a) * rx * 0.28, R * 0.05 + 1, R * 0.03 + 1, a, 0, 7); ctx.fill(); }
  },
  /** dark smoke / a shadow that rises off the body */
  shadow(ctx, R, T, c, p, wd = 1) {
    const col = mix(c, [10, 5, 25], 0.55), n = 9 + Math.round(p * 6);
    for (let i = 0; i < n; i++) {
      const ph = (T * 0.3 + i / n) % 1, x = Math.sin(i * 3.3 + T * 0.7) * R * 0.6 * wd * (0.5 + ph), y = R * 1.1 - ph * R * 2.4, r = R * (0.28 + ph * 0.4), a = 0.95 * Math.sin(Math.PI * Math.min(1, ph * 1.15)) * (0.65 + p * 0.35);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, css(col, a)); g.addColorStop(0.7, css(mix(col, c, 0.4), a * 0.5)); g.addColorStop(1, css(col, 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    }
  },
  /** a red haze with two red eyes that pulse */
  redeye(ctx, R, T, c, p, wd = 1) {
    const pulse = 0.6 + 0.4 * Math.sin(T * 2.2), gap = R * 0.26 * wd; glow(ctx, 0, 0, R * (1.3 + 0.2 * pulse), c, 0.3 + 0.3 * pulse * p);
    for (const sx of [-1, 1]) { const x = sx * gap; glow(ctx, x, 0, R * 0.4, c, 0.8); ctx.fillStyle = css(c, 1); ctx.beginPath(); ctx.ellipse(x, 0, R * 0.14, R * 0.065, sx * 0.3, 0, 7); ctx.fill(); ctx.fillStyle = css(mix(c, W, 0.75), 1); ctx.beginPath(); ctx.ellipse(x, 0, R * 0.07, R * 0.025, sx * 0.3, 0, 7); ctx.fill(); }
    for (let i = 0; i < 6; i++) { const ph = (T * 0.4 + i / 6) % 1, a = i * 1.1; ctx.fillStyle = css(c, 0.5 * (1 - ph)); ctx.beginPath(); ctx.arc(Math.cos(a) * R * 0.7 * ph * wd, -ph * R * 0.9, R * 0.06, 0, 7); ctx.fill(); }
  },
  /** a pale veil that waves round the body */
  ghost(ctx, R, T, c, p, wd = 1) {
    const col = mix(c, W, 0.5), w = R * 0.95 * wd, top = -R * 1.2, bot = R * 1.15;
    const g = ctx.createLinearGradient(0, top, 0, bot); g.addColorStop(0, css(col, 0.8 * (0.6 + p * 0.4))); g.addColorStop(1, css(col, 0.18)); ctx.fillStyle = g; glow(ctx, 0, 0, R * 1.5, col, 0.25);
    ctx.beginPath(); ctx.moveTo(-w, bot); ctx.bezierCurveTo(-w * 1.15, top * 0.2, -w * 0.6, top, 0, top); ctx.bezierCurveTo(w * 0.6, top, w * 1.15, top * 0.2, w, bot);
    for (let i = 8; i >= 0; i--) { const x = -w + (i / 8) * 2 * w, y = bot + Math.sin(i * 1.6 + T * 3) * R * 0.14; ctx.lineTo(x, y); } ctx.closePath(); ctx.fill();
    ctx.strokeStyle = css(W, 0.85); ctx.lineWidth = Math.max(2, R * 0.045); ctx.stroke(); ctx.fillStyle = css([20, 25, 45], 0.8); for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(sx * w * 0.28, top * 0.45, R * 0.09, R * 0.15, 0, 0, 7); ctx.fill(); } ctx.beginPath(); ctx.ellipse(0, top * 0.1, R * 0.09, R * 0.2, 0, 0, 7); ctx.fill();
    for (let i = 0; i < 3; i++) { const ph = (T * 0.3 + i / 3) % 1; ctx.strokeStyle = css(W, 0.25 * (1 - ph)); ctx.lineWidth = Math.max(2, R * 0.06); ctx.beginPath(); ctx.moveTo(-w * 0.7, bot - ph * R * 2.2); ctx.quadraticCurveTo(0, bot - ph * R * 2.2 - R * 0.25, w * 0.7, bot - ph * R * 2.2); ctx.stroke(); }
  },
  /** a round shield of light that shimmers */
  shield(ctx, R, T, c, p, wd = 1) {
    const r = R * wd * (1 + 0.025 * Math.sin(T * 5)), hot = mix(c, W, 0.65);
    const g = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r); g.addColorStop(0, css(c, 0.08)); g.addColorStop(0.8, css(c, 0.28 * (0.5 + p))); g.addColorStop(1, css(c, 0.6)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
    ctx.strokeStyle = css(hot, 0.95); ctx.lineWidth = Math.max(2, R * 0.07); ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r * 0.97, 0, 7); ctx.clip(); ctx.strokeStyle = css(hot, 0.35); ctx.lineWidth = Math.max(1, R * 0.025);
    const hx = R * 0.36; for (let row = -4; row <= 4; row++) for (let col = -4; col <= 4; col++) { const x = col * hx * 1.5, y = row * hx * 1.732 + (col % 2 ? hx * 0.866 : 0); ctx.beginPath(); for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 3; k ? ctx.lineTo(x + Math.cos(a) * hx, y + Math.sin(a) * hx) : ctx.moveTo(x + Math.cos(a) * hx, y + Math.sin(a) * hx); } ctx.closePath(); ctx.stroke(); }
    const s = ((T * 0.5) % 1) * 3 - 1.5; const sg = ctx.createLinearGradient(s * r - r * 0.3, -r, s * r + r * 0.3, r); sg.addColorStop(0, css(W, 0)); sg.addColorStop(0.5, css(W, 0.45)); sg.addColorStop(1, css(W, 0)); ctx.fillStyle = sg; ctx.fillRect(-r, -r, r * 2, r * 2); ctx.restore();
    ctx.strokeStyle = css(W, 0.8); ctx.lineWidth = Math.max(2, R * 0.045); ctx.beginPath(); ctx.arc(0, 0, r * 0.86, -2.4, -1.5); ctx.stroke();
  },
  /** a standing doorway of swirling light */
  portal(ctx, R, T, c, p, wd = 1) {
    const rx = R * 0.62 * wd, ry = R * 1.2, hot = mix(c, W, 0.6), dark = mix(c, [10, 5, 40], 0.7);
    glow(ctx, 0, 0, R * 1.5, c, 0.22 + 0.2 * p);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, ry); g.addColorStop(0, css(mix(c, W, 0.5), 0.95)); g.addColorStop(0.55, css(c, 0.9)); g.addColorStop(1, css(dark, 0.95));
    ctx.save(); ctx.scale(rx / ry, 1); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, ry * 0.9, 0, 7); ctx.fill();
    ctx.lineCap = 'round'; for (let i = 0; i < 4; i++) { const a = T * (2 + i * 0.3) * (i % 2 ? -1 : 1) + i * 1.57, rr = ry * (0.25 + i * 0.18); ctx.strokeStyle = css(hot, 0.6 + 0.3 * (i % 2)); ctx.lineWidth = Math.max(2, R * 0.07); ctx.beginPath(); ctx.arc(0, 0, rr, a, a + 2.2); ctx.stroke(); }
    ctx.restore();
    ctx.strokeStyle = css(c, 1); ctx.lineWidth = Math.max(3, R * 0.11); ctx.beginPath(); ctx.ellipse(0, 0, rx, ry * 0.9, 0, 0, 7); ctx.stroke(); ctx.strokeStyle = css(hot, 0.9); ctx.lineWidth = Math.max(1.5, R * 0.04); ctx.beginPath(); ctx.ellipse(0, 0, rx, ry * 0.9, 0, 0, 7); ctx.stroke();
    for (let i = 0; i < 8; i++) { const a = T * 2 + i * 0.785, ph = (T * 0.8 + i / 8) % 1; ctx.fillStyle = css(hot, 1 - ph); ctx.beginPath(); ctx.arc(Math.cos(a) * rx * (1 + ph * 0.5), Math.sin(a) * ry * 0.9 * (1 + ph * 0.25), R * 0.04 + 1, 0, 7); ctx.fill(); }
  },
  /** streaks that rush past (turn it: the streaks run behind the direction it points) */
  speed(ctx, R, T, c, p, wd = 1) {
    const col = mix(c, W, 0.7), n = 10 + Math.round(p * 8);
    for (let i = 0; i < n; i++) {
      const x = ((i * 0.618) % 1 - 0.5) * R * 2.2 * wd, ph = (T * (1.1 + (i % 4) * 0.25) + i * 0.29) % 1, len = R * (0.5 + 0.9 * ((i * 7) % 5) / 5), y0 = -R * 1.2 + ph * R * 2.6, w = Math.max(1.5, R * 0.035 * (1 + (i % 3) * 0.6));
      const g = ctx.createLinearGradient(0, y0, 0, y0 + len); g.addColorStop(0, css(col, 0)); g.addColorStop(0.25, css(col, 0.85)); g.addColorStop(1, css(c, 0)); ctx.strokeStyle = g; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y0 + len); ctx.stroke();
    }
  },
};
