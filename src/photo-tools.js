/* Pixel tools for the layer picture editor (src/photo-editor.js). Pure functions on RGBA byte arrays, no DOM, so they can be tested in Node.
   data = Uint8ClampedArray of w * h * 4 (straight alpha); a mask = Uint8Array of w * h (0 = not selected, 255 = selected, in between = feathered). */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** how far two pixels are apart (0 .. 255), alpha counts too */
function dist(d, i, r, g, b, a) {
  const da = d[i + 3] - a;
  if (d[i + 3] < 8 && a < 8) return 0;                          // two see-through pixels are the same, whatever hides in their colour
  const dr = d[i] - r, dg = d[i + 1] - g, db = d[i + 2] - b;
  return Math.sqrt((dr * dr + dg * dg + db * db + da * da * 2) / 5);
}
/** magic wand: every pixel like the one at (sx, sy). contiguous = only the connected area, otherwise the whole picture. tol 0 .. 100 */
export function floodMask(data, w, h, sx, sy, tol = 24, contiguous = true) {
  const mask = new Uint8Array(w * h);
  sx = Math.floor(sx); sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return mask;
  const at = (sy * w + sx) * 4, r = data[at], g = data[at + 1], b = data[at + 2], a = data[at + 3], lim = (clamp(tol, 0, 100) / 100) * 255;
  const like = (p) => dist(data, p * 4, r, g, b, a) <= lim;
  if (!contiguous) { for (let p = 0; p < w * h; p++) if (like(p)) mask[p] = 255; return mask; }
  const stack = [sy * w + sx];
  while (stack.length) {
    let p = stack.pop(); const y = (p / w) | 0; let x = p - y * w;
    if (mask[p] || !like(p)) continue;
    let x0 = x; while (x0 > 0 && !mask[y * w + x0 - 1] && like(y * w + x0 - 1)) x0--;
    let x1 = x; while (x1 < w - 1 && !mask[y * w + x1 + 1] && like(y * w + x1 + 1)) x1++;
    for (x = x0; x <= x1; x++) mask[y * w + x] = 255;
    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= h) continue;
      let inRun = false;
      for (x = x0; x <= x1; x++) { const q = ny * w + x, ok = !mask[q] && like(q); if (ok && !inRun) { stack.push(q); inRun = true; } else if (!ok) inRun = false; }
    }
  }
  return mask;
}
/** how a new selection joins the old one: replace | add | subtract | intersect */
export function combineMask(old, next, mode = 'replace') {
  if (!old || mode === 'replace') return next;
  const out = new Uint8Array(next.length);
  for (let i = 0; i < out.length; i++) {
    const a = old[i], b = next[i];
    out[i] = mode === 'add' ? Math.max(a, b) : mode === 'subtract' ? Math.round(a * (255 - b) / 255) : Math.round(a * b / 255);
  }
  return out;
}
export const invertMask = (mask) => { const o = new Uint8Array(mask.length); for (let i = 0; i < o.length; i++) o[i] = 255 - mask[i]; return o; };
export const maskCount = (mask) => { let n = 0; for (let i = 0; i < mask.length; i++) if (mask[i] > 127) n++; return n; };
export function maskBounds(mask, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** a box blur (three passes look like a gaussian) of one channel; returns a new array */
function blurPlaneSimple(src, w, h, r) {
  r = Math.round(r); if (r < 1) return Float32Array.from(src);
  let cur = Float32Array.from(src), tmp = new Float32Array(src.length);
  const k = 1 / (2 * r + 1);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      let sum = 0; const row = y * w;
      for (let x = -r; x <= r; x++) sum += cur[row + clamp(x, 0, w - 1)];
      for (let x = 0; x < w; x++) { tmp[row + x] = sum * k; sum += cur[row + Math.min(w - 1, x + r + 1)] - cur[row + Math.max(0, x - r)]; }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += tmp[clamp(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) { cur[y * w + x] = sum * k; sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; }
    }
  }
  return cur;
}
/** blur a picture (premultiplied, so a see-through edge does not turn dark or grey) */
export function blurRGBA(data, w, h, radius) {
  const out = new Uint8ClampedArray(data.length), n = w * h, R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), A = new Float32Array(n);
  for (let p = 0; p < n; p++) { const a = data[p * 4 + 3] / 255; R[p] = data[p * 4] * a; G[p] = data[p * 4 + 1] * a; B[p] = data[p * 4 + 2] * a; A[p] = a; }
  const r2 = blurPlaneSimple(R, w, h, radius), g2 = blurPlaneSimple(G, w, h, radius), b2 = blurPlaneSimple(B, w, h, radius), a2 = blurPlaneSimple(A, w, h, radius);
  for (let p = 0; p < n; p++) { const a = a2[p]; out[p * 4 + 3] = Math.round(a * 255); if (a > 0.0005) { out[p * 4] = r2[p] / a; out[p * 4 + 1] = g2[p] / a; out[p * 4 + 2] = b2[p] / a; } }
  return out;
}
/** soften the edge of a selection */
export function blurMask(mask, w, h, radius) {
  if (radius < 1) return mask;
  const f = blurPlaneSimple(mask, w, h, radius), o = new Uint8Array(mask.length);
  for (let i = 0; i < o.length; i++) o[i] = Math.round(clamp(f[i], 0, 255));
  return o;
}
/** make a selection bigger (px > 0) or smaller (px < 0) */
export function growMask(mask, w, h, px) {
  if (!px) return mask;
  const n = Math.abs(Math.round(px)), src = px > 0 ? mask : invertMask(mask);
  const f = blurPlaneSimple(src, w, h, Math.max(1, n)), o = new Uint8Array(mask.length), cut = 128 * (n > 1 ? 0.35 : 1);
  for (let i = 0; i < o.length; i++) o[i] = f[i] > cut ? 255 : 0;
  return px > 0 ? o : invertMask(o);
}

/** brightness / contrast, both -100 .. 100; only inside the mask if there is one */
export function adjustBrightnessContrast(data, brightness = 0, contrast = 0, mask = null) {
  const c = contrast / 100, k = c >= 0 ? 1 / (1 - Math.min(0.99, c)) : 1 + c, add = brightness * 2.55;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    if (data[i + 3] === 0) continue;
    const m = mask ? mask[p] / 255 : 1; if (!m) continue;
    for (let j = 0; j < 3; j++) { const v = clamp((data[i + j] - 128) * k + 128 + add, 0, 255); data[i + j] = data[i + j] + (v - data[i + j]) * m; }
  }
  return data;
}
export function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let hh = 0, s = 0;
  if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hh /= 6; }
  return [hh, s, l];
}
export function hsl2rgb(hh, s, l) {
  const f = (p, q, t) => { t = ((t % 1) + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [f(p, q, hh + 1 / 3) * 255, f(p, q, hh) * 255, f(p, q, hh - 1 / 3) * 255];
}
/** hue -180 .. 180 degrees, saturation -100 .. 100, lightness -100 .. 100 */
export function adjustHSL(data, hue = 0, sat = 0, light = 0, mask = null) {
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    if (data[i + 3] === 0) continue;
    const m = mask ? mask[p] / 255 : 1; if (!m) continue;
    const [hh, s, l] = rgb2hsl(data[i], data[i + 1], data[i + 2]);
    const [R, G, B] = hsl2rgb(hh + hue / 360, clamp(s * (1 + sat / 100), 0, 1), clamp(l + light / 200, 0, 1));
    data[i] += (R - data[i]) * m; data[i + 1] += (G - data[i + 1]) * m; data[i + 2] += (B - data[i + 2]) * m;
  }
  return data;
}
export function invertColours(data, mask = null) {
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    if (data[i + 3] === 0) continue;
    const m = mask ? mask[p] / 255 : 1; if (!m) continue;
    for (let j = 0; j < 3; j++) data[i + j] += (255 - 2 * data[i + j]) * m;
  }
  return data;
}
export function grayscale(data, mask = null) {
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    if (data[i + 3] === 0) continue;
    const m = mask ? mask[p] / 255 : 1; if (!m) continue;
    const y = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    for (let j = 0; j < 3; j++) data[i + j] += (y - data[i + j]) * m;
  }
  return data;
}
/** sharpen: the picture plus some of (picture - blurred picture) */
export function sharpen(data, w, h, amount = 60, radius = 1.5, mask = null) {
  const bl = blurRGBA(data, w, h, radius), k = amount / 100;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    if (data[i + 3] === 0) continue;
    const m = mask ? mask[p] / 255 : 1; if (!m) continue;
    for (let j = 0; j < 3; j++) data[i + j] = clamp(data[i + j] + (data[i + j] - bl[i + j]) * k * m, 0, 255);
  }
  return data;
}
/** blur of the picture itself, only where the mask is (the whole picture without a mask) */
export function blurFilter(data, w, h, radius, mask = null) {
  const bl = blurRGBA(data, w, h, radius);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const m = mask ? mask[p] / 255 : 1; if (!m) continue;
    for (let j = 0; j < 4; j++) data[i + j] += (bl[i + j] - data[i + j]) * m;
  }
  return data;
}
/** an inner shadow: the picture gets darker (or tinted) near its own edge, as if the part were round. size = how far it reaches (px), strength 0 .. 100, colour [r, g, b] */
export function edgeShadow(data, w, h, size = 14, strength = 55, colour = [30, 10, 20], mask = null) {
  const pad = Math.ceil(size) + 2, W = w + pad * 2, H = h + pad * 2, A = new Float32Array(W * H);          // outside the picture counts as empty, so a part that fills its box is shaded at the box edge too
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) A[(y + pad) * W + x + pad] = data[(y * w + x) * 4 + 3] / 255 > 0.5 ? 1 : 0;
  const bl = blurPlaneSimple(A, W, H, Math.max(1, size / 2)), k = strength / 100;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x, i = p * 4; if (data[i + 3] === 0) continue;
    const m = mask ? mask[p] / 255 : 1; if (!m) continue;
    const t = clamp((1 - bl[(y + pad) * W + x + pad]) * 1.9, 0, 1) * k * m;        // 1 right at the edge, 0 deep inside
    for (let j = 0; j < 3; j++) data[i + j] += (data[i + j] * (colour[j] / 255) - data[i + j]) * t;
  }
  return data;
}
/** the pixels of a mask's border, for drawing the "marching ants": 1 on a border pixel */
export function maskEdge(mask, w, h) {
  const e = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = y * w + x; if (mask[p] < 128) continue;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || mask[p - 1] < 128 || mask[p + 1] < 128 || mask[p - w] < 128 || mask[p + w] < 128) e[p] = 1;
  }
  return e;
}
/** paint a flat colour into a mask. colour [r, g, b], opacity 0 .. 1; keepAlpha = only where the picture already has pixels */
export function fillMask(data, mask, colour, opacity = 1, keepAlpha = false) {
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const m = (mask ? mask[p] / 255 : 1) * opacity; if (!m) continue;
    if (keepAlpha) { const a = data[i + 3] / 255; if (!a) continue; for (let j = 0; j < 3; j++) data[i + j] += (colour[j] - data[i + j]) * m; continue; }
    const a0 = data[i + 3] / 255, a = m + a0 * (1 - m);
    for (let j = 0; j < 3; j++) data[i + j] = a ? (colour[j] * m + data[i + j] * a0 * (1 - m)) / a : colour[j];
    data[i + 3] = Math.round(a * 255);
  }
  return data;
}
/** erase the picture inside a mask */
export function clearMask(data, mask) {
  for (let i = 0, p = 0; i < data.length; i += 4, p++) { const m = mask ? mask[p] / 255 : 1; if (m) data[i + 3] = Math.round(data[i + 3] * (1 - m)); }
  return data;
}
export const hexToRgb = (hex) => { const v = parseInt(String(hex).replace('#', '').padEnd(6, '0').slice(0, 6), 16) || 0; return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
export const rgbToHex = ([r, g, b]) => `#${[r, g, b].map((x) => Math.round(clamp(x, 0, 255)).toString(16).padStart(2, '0')).join('')}`;
