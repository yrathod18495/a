// Bitmap/PNG brush-tip engine. Tips are built as RGBA pixel textures (no SVG),
// cached per colour/hardness, and stamped on the document's raster canvas.
// The same bitmap engine is used for previews, mouse, touch, and stylus.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const T = 128, HALF = T / 2;
const makeCanvas = () => { const c = document.createElement('canvas'); c.width = c.height = T; return c; };
const hash = (x, y, seed = 0) => {
  let h = Math.imul((x + seed) | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
function textureAlpha(kind, x, y, hard, seed) {
  const nx = (x + .5 - HALF) / HALF, ny = (y + .5 - HALF) / HALF;
  const radius = Math.hypot(nx, ny);
  const noise = hash(x, y, seed), coarse = hash(x >> 2, y >> 2, seed);
  const falloff = (radius, inner = hard) => radius >= 1 ? 0 :
    radius <= inner ? 1 : Math.pow((1 - radius) / Math.max(.0001, 1 - inner), .85);
  if (kind === 'hard') return radius <= .985 ? 1 : 0;
  if (kind === 'soft' || kind === 'eraser') return falloff(radius, hard);
  if (kind === 'air' || kind === 'shadow' || kind === 'light' || kind === 'burn' || kind === 'dodge')
    return Math.pow(Math.max(0, 1 - radius), 2.4);
  if (kind === 'ink') return radius < .975 ? (noise < .05 ? .88 : 1) : 0;
  if (kind === 'pencil') return falloff(radius, .83) * (.27 + .73 * noise) * (coarse > .08 ? 1 : .1);
  if (kind === 'marker') {
    const u = (nx - ny) * .7071, v = (nx + ny) * .7071;
    return Math.abs(u) < .95 && Math.abs(v) < .32 ? (.86 + noise * .14) : 0;
  }
  if (kind === 'water') {
    const wobble = radius + (coarse - .5) * .13;
    const edge = Math.exp(-Math.pow((wobble - .82) / .105, 2));
    return falloff(wobble, .12) * (.18 + .13 * coarse + .33 * edge);
  }
  if (kind === 'chalk') {
    return falloff(radius, .77) * (noise < .37 ? 0 : noise < .66 ? .22 : .85)
      * (coarse < .13 ? .08 : 1);
  }
  if (kind === 'spray') {
    const probability = .12 * Math.pow(Math.max(0, 1 - radius), .6);
    return radius < 1 && noise < probability ? (.3 + .7 * coarse) : 0;
  }
  if (kind === 'hatch') {
    const line = ((x + y) % 17 + 17) % 17;
    return falloff(radius, .78) * (line < 3 ? .9 : 0);
  }
  return falloff(radius, hard);
}
export function createRasterBrushes() {
  const cache = new Map();
  function tip(kind, colour, hardness = .25, variant = 0) {
    const h = Math.round(clamp(hardness, 0, 1) * 20) / 20;
    const key = [kind, colour.join(','), h, variant].join(':');
    if (cache.has(key)) return cache.get(key);
    const c = makeCanvas(), g = c.getContext('2d'), im = g.createImageData(T, T);
    const seed = variant * 173 + kind.length * 41;
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const a = Math.round(255 * clamp(textureAlpha(kind, x, y, h, seed), 0, 1));
      const i = (y * T + x) * 4;
      im.data[i] = colour[0]; im.data[i + 1] = colour[1]; im.data[i + 2] = colour[2]; im.data[i + 3] = a;
    }
    g.putImageData(im, 0, 0);
    if (cache.size > 160) cache.clear();
    cache.set(key, c);
    return c;
  }
  function draw(g, { kind, tool = 'brush', colour, x, y, size, pressure = 1, speed = 0, hardness = .25, flow = 1, sequence = 0 }) {
    const k = tool === 'eraser' ? 'eraser' : kind;
    let scale = 1;
    if (k === 'ink') scale = clamp((1 - speed * .62) * (.45 + pressure * .55), .2, 1);
    if (k === 'pencil') scale = .6;
    const d = Math.max(.8, size * scale);
    const variant = (k === 'chalk' || k === 'water' || k === 'spray' || k === 'pencil') ? sequence % 6 : 0;
    const h = k === 'hard' ? 1 : k === 'soft' || k === 'eraser' ? hardness : .2;
    const opacity = tool === 'eraser' ? 1 : flow;
    g.save(); g.globalAlpha *= clamp(opacity, 0, 1);
    // These are cached RGBA PNG-compatible bitmap stamps, not geometric vector paths.
    if (k === 'marker') {
      g.translate(x, y); g.rotate(-Math.PI / 4);
      g.drawImage(tip(k, colour, h, variant), -d * .5, -d * .5, d, d);
    } else {
      g.drawImage(tip(k, colour, h, variant), x - d * .5, y - d * .5, d, d);
    }
    g.restore();
  }
  return { draw, tip, exportTipPNG: (kind, colour, hardness) => tip(kind, colour, hardness).toDataURL('image/png') };
}
