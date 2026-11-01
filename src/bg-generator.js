// Background Generator: a blank canvas (4K by default) where the user composes a background from pictures, props, shapes and text,
// saves it to the account's local database, and picks it again from the Background tab of the Animator Studio.
import { h } from './dom.js';
import { listBgLibrary, putBgLibrary, deleteBgLibrary } from './store.js';
import { listStudioAssets, downloadStudioAsset } from './studio-assets.js';
import { BACKGROUNDS } from './db/stage.js';
import { projectDialog } from './project-dialog.js';
import { friendlyError } from '../shared/hinglish-errors.js';
import './bg-generator.css';

export const SIZES = [
  { id: '4k', label: '4K landscape · 3840 × 2160', w: 3840, h: 2160 },
  { id: '2k', label: '2K landscape · 2560 × 1440', w: 2560, h: 1440 },
  { id: 'hd', label: 'Full HD · 1920 × 1080', w: 1920, h: 1080 },
  { id: '4kp', label: '4K portrait · 2160 × 3840', w: 2160, h: 3840 },
  { id: 'sq', label: '4K square · 2160 × 2160', w: 2160, h: 2160 },
];
const PREVIEW_MAX = 1600;                                   // the editing canvas is drawn at most this wide; saving and downloading use the full size
const uid8 = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const newDoc = (size = SIZES[0]) => ({ size: { w: size.w, h: size.h }, base: { kind: 'blank' }, items: [] });

/** paint the whole background at `scale` (1 = full resolution). `bitmaps` maps item id -> decoded picture. */
export function paint(ctx, doc, bitmaps, scale = 1, { checker = false } = {}) {
  const { w, h: hh } = doc.size, W = w * scale, H = hh * scale;
  ctx.save(); ctx.clearRect(0, 0, W, H);
  if (doc.base.kind === 'blank') {
    if (checker) { const s = Math.max(8, Math.round(W / 96)); for (let y = 0; y < H; y += s) for (let x = 0; x < W; x += s) { ctx.fillStyle = ((x / s + y / s) % 2) ? '#2b2d33' : '#34363d'; ctx.fillRect(x, y, s, s); } }
  } else if (doc.base.kind === 'solid') { ctx.fillStyle = doc.base.a; ctx.fillRect(0, 0, W, H); }
  else { const g = ctx.createLinearGradient(0, 0, W * 0.3, H); g.addColorStop(0, doc.base.a); g.addColorStop(1, doc.base.b); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
  for (const it of doc.items) {
    if (it.hidden) continue;
    ctx.save(); ctx.globalAlpha = clamp(it.opacity ?? 1, 0, 1);
    ctx.translate(it.x * scale, it.y * scale); ctx.rotate(((it.rot || 0) * Math.PI) / 180); ctx.scale(it.flip ? -1 : 1, 1);
    const iw = it.w * scale, ih = it.h * scale;
    if (it.type === 'image' || it.type === 'paint') { const bmp = bitmaps.get(it.id); if (bmp) ctx.drawImage(bmp, -iw / 2, -ih / 2, iw, ih); }
    else if (it.type === 'rect') { ctx.fillStyle = it.fill || '#8b7bff'; const r = Math.min((it.radius || 0) * scale, iw / 2, ih / 2); ctx.beginPath(); ctx.roundRect(-iw / 2, -ih / 2, iw, ih, r); ctx.fill(); }
    else if (it.type === 'ellipse') { ctx.fillStyle = it.fill || '#8b7bff'; ctx.beginPath(); ctx.ellipse(0, 0, iw / 2, ih / 2, 0, 0, Math.PI * 2); ctx.fill(); }
    else if (it.type === 'text') { ctx.fillStyle = it.fill || '#ffffff'; ctx.font = `800 ${Math.round(ih * 0.8)}px system-ui, "Noto Sans Devanagari", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(it.text || 'Text', 0, 0, iw); }
    ctx.restore();
  }
  ctx.restore();
}
const toBlob = (canvas, type = 'image/png', q) => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be created. Please try a smaller size.'))), type, q));


/** ready-made seamless textures (drawn in code, so there is nothing to download): each is a 256 px tile that repeats without a visible edge */
const TILE = 256;
export const SAMPLE_TEXTURES = [
  ['mud', 'Mud'], ['grass', 'Grass'], ['gravel', 'Gravel'], ['cobble', 'Cobblestone'], ['wood', 'Wood planks'], ['water', 'Water'], ['snow', 'Snow'], ['brick', 'Brick'], ['sand', 'Sand'],
];
export function makeSampleTexture(kind) {
  const c = document.createElement('canvas'); c.width = c.height = TILE; const g = c.getContext('2d');
  const r = (a, b) => a + Math.random() * (b - a), pick = (l) => l[Math.floor(Math.random() * l.length)];
  const wrap = (fn) => { for (const dx of [-TILE, 0, TILE]) for (const dy of [-TILE, 0, TILE]) { g.save(); g.translate(dx, dy); fn(); g.restore(); } };   // everything is drawn 9 times, so it continues on the opposite edge
  const dots = (n, cols, rmin, rmax) => { for (let i = 0; i < n; i++) { const x = r(0, TILE), y = r(0, TILE), rad = r(rmin, rmax), col = pick(cols); wrap(() => { g.fillStyle = col; g.beginPath(); g.arc(x, y, rad, 0, 6.283); g.fill(); }); } };
  if (kind === 'mud') { g.fillStyle = '#8a5a30'; g.fillRect(0, 0, TILE, TILE); dots(26, ['#7a4c26aa', '#a06c3caa', '#6e4422aa'], 14, 34); dots(500, ['#9c6b3c', '#c99a62', '#6b4020', '#b98a55', '#d8b283'], 1, 4); }
  else if (kind === 'grass') { g.fillStyle = '#4c8a2c'; g.fillRect(0, 0, TILE, TILE); dots(18, ['#3f7d2a99', '#5aa13a99'], 16, 36); for (let i = 0; i < 900; i++) { const x = r(0, TILE), y = r(0, TILE), a = -Math.PI / 2 + r(-0.5, 0.5), l = r(6, 16), col = pick(['#3f7d2a', '#5aa13a', '#7bbf4a', '#2f5f22', '#8fcf58']); wrap(() => { g.strokeStyle = col; g.lineWidth = r(1, 2.2); g.lineCap = 'round'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }); } }
  else if (kind === 'gravel') { g.fillStyle = '#7d7b78'; g.fillRect(0, 0, TILE, TILE); for (let i = 0; i < 260; i++) { const x = r(0, TILE), y = r(0, TILE), rx = r(3, 9), col = pick(['#8d8f93', '#a6a8ac', '#6f7175', '#b4a79a', '#9a9288']), rot = r(0, 3); wrap(() => { g.fillStyle = col; g.strokeStyle = '#3d3e41'; g.lineWidth = 1; g.beginPath(); g.ellipse(x, y, rx, rx * r(0.6, 0.9), rot, 0, 6.283); g.fill(); g.stroke(); }); } }
  else if (kind === 'cobble') { g.fillStyle = '#4a4742'; g.fillRect(0, 0, TILE, TILE); const n = 4, sz = TILE / n; for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) { const x = col * sz + (row % 2 ? sz / 2 : 0) + 3, y = row * sz + 3, shade = pick(['#8b8780', '#9b968d', '#7a766f', '#a39d92']); wrap(() => { g.fillStyle = shade; g.beginPath(); g.roundRect(x, y, sz - 6, sz - 6, 10); g.fill(); g.fillStyle = '#ffffff18'; g.fillRect(x + 6, y + 5, sz - 22, 4); }); } }
  else if (kind === 'wood') { const n = 4, sz = TILE / n; for (let i = 0; i < n; i++) { g.fillStyle = pick(['#9a6a3a', '#a8763f', '#8c5f33', '#b0804a']); g.fillRect(0, i * sz, TILE, sz); g.strokeStyle = '#4a2e14'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, i * sz); g.lineTo(TILE, i * sz); g.stroke(); for (let k = 0; k < 9; k++) { const y = i * sz + r(6, sz - 6); g.strokeStyle = '#5a3a1a55'; g.lineWidth = r(0.6, 1.6); g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(TILE * 0.3, y + r(-3, 3), TILE * 0.7, y + r(-3, 3), TILE, y); g.stroke(); } } }
  else if (kind === 'water') { const gr = g.createLinearGradient(0, 0, 0, TILE); gr.addColorStop(0, '#2f7fc4'); gr.addColorStop(1, '#2468a8'); g.fillStyle = gr; g.fillRect(0, 0, TILE, TILE); for (let i = 0; i < 26; i++) { const x = r(0, TILE), y = r(0, TILE), w = r(24, 60); wrap(() => { g.strokeStyle = pick(['#ffffff55', '#bfe3ff66', '#1d5a9a66']); g.lineWidth = r(1.5, 3); g.lineCap = 'round'; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + w / 2, y - r(3, 7), x + w, y); g.stroke(); }); } }
  else if (kind === 'snow') { g.fillStyle = '#eef3f8'; g.fillRect(0, 0, TILE, TILE); dots(30, ['#ffffffcc', '#d5e2ee99'], 10, 30); dots(260, ['#ffffff', '#cfdce8', '#e4edf5'], 1, 3); }
  else if (kind === 'brick') { g.fillStyle = '#7b5d50'; g.fillRect(0, 0, TILE, TILE); const rows = 8, bh = TILE / rows, bw = TILE / 4; for (let row = 0; row < rows; row++) for (let col = 0; col < 4; col++) { const x = col * bw + (row % 2 ? bw / 2 : 0) + 2, y = row * bh + 2; wrap(() => { g.fillStyle = pick(['#a4513a', '#b35c42', '#94472f', '#a95b44']); g.fillRect(x, y, bw - 4, bh - 4); g.fillStyle = '#ffffff14'; g.fillRect(x, y, bw - 4, 3); }); } }
  else { g.fillStyle = '#d9bf86'; g.fillRect(0, 0, TILE, TILE); dots(20, ['#e6d29faa', '#c9ad73aa'], 14, 30); dots(600, ['#e9d6a4', '#d2b97f', '#f1e2b8', '#c9ad73', '#b99a5f'], 0.8, 2.2); }
  return c;
}

export async function view({ user, home, toast }) {
  let doc = newDoc(), id = uid8(), name = 'My background', sel = null, saved = false, busy = false;
  const bitmaps = new Map();                                // item id -> ImageBitmap
  const history = [], future = [], paintDirty = new Set();
  const snapshot = () => JSON.stringify({ ...doc, items: doc.items.map(({ blob, ...rest }) => rest) });
  let lastSnap = snapshot();
  const commit = () => { const s = snapshot(); if (s !== lastSnap) { history.push({ s: lastSnap }); if (history.length > 60) history.shift(); future.length = 0; lastSnap = s; } saved = false; redraw(); };
  const applySnap = (s) => { const parsed = JSON.parse(s), blobs = new Map(doc.items.map((i) => [i.id, i.blob])); doc = { ...parsed, items: parsed.items.map((i) => ({ ...i, blob: blobs.get(i.id) })) }; lastSnap = s; if (!doc.items.some((i) => i.id === sel)) sel = null; redraw(); };
  // an undo step is the item list before the change, plus (for a brush stroke) a copy of the painting before the stroke
  const cloneCanvas = (c) => { const n = document.createElement('canvas'); n.width = c.width; n.height = c.height; n.getContext('2d').drawImage(c, 0, 0); return n; };
  const inverse = (e) => ({ s: lastSnap, p: e.p && bitmaps.get(e.p.id) ? { id: e.p.id, canvas: cloneCanvas(bitmaps.get(e.p.id)) } : undefined });
  const restore = (e) => { applySnap(e.s); const c = e.p && bitmaps.get(e.p.id); if (c) { const g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height); g.drawImage(e.p.canvas, 0, 0); paintDirty.add(e.p.id); redraw(); } };
  const undo = () => { if (!history.length) return; const e = history.pop(); future.push(inverse(e)); restore(e); };
  const redo = () => { if (!future.length) return; const e = future.pop(); history.push(inverse(e)); restore(e); };

  // ---------- canvas ----------
  const canvas = h('canvas', { class: 'bgg-canvas', 'aria-label': 'Background canvas' });
  const selBox = h('div', { class: 'bgg-sel', hidden: true }, ...['tl', 'tr', 'bl', 'br'].map((c) => h('i', { class: `bgg-hd bgg-${c}`, 'data-hd': c })), h('i', { class: 'bgg-rot', 'data-hd': 'rot', title: 'Rotate' }));
  const stage = h('div', { class: 'bgg-stage' }, canvas, selBox);
  const emptyHint = h('div', { class: 'bgg-empty' }, h('b', {}, 'Blank 4K canvas'), h('span', {}, 'Add pictures, props, shapes or text from the left.'));
  stage.append(emptyHint);
  const sizeInfo = h('span', { class: 'bgg-size-info' });
  const fit = () => {
    const box = stage.parentElement; if (!box) return;
    const k = Math.min((box.clientWidth - 24) / doc.size.w, (box.clientHeight - 24) / doc.size.h);
    stage.style.width = `${Math.max(120, doc.size.w * k)}px`; stage.style.height = `${Math.max(80, doc.size.h * k)}px`;
  };
  const previewScale = () => Math.min(1, PREVIEW_MAX / Math.max(doc.size.w, doc.size.h));
  let raf = 0;
  const drawCanvas = () => {
    const s = previewScale(); canvas.width = Math.round(doc.size.w * s); canvas.height = Math.round(doc.size.h * s);
    paint(canvas.getContext('2d'), doc, bitmaps, s, { checker: true });
  };
  const place = () => {                                       // the selection frame, in CSS pixels of the stage
    const it = doc.items.find((i) => i.id === sel);
    if (!it || it.hidden || it.type === 'paint' || tool !== 'select') { selBox.hidden = true; return; }
    const k = stage.clientWidth / doc.size.w;
    selBox.hidden = false;
    Object.assign(selBox.style, { left: `${(it.x - it.w / 2) * k}px`, top: `${(it.y - it.h / 2) * k}px`, width: `${it.w * k}px`, height: `${it.h * k}px`, transform: `rotate(${it.rot || 0}deg)` });
  };
  function redraw() { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { fit(); drawCanvas(); place(); drawSide(); }); }

  // ---------- items ----------
  const load = async (item) => {
    if (item.type === 'paint') { const c = document.createElement('canvas'); c.width = doc.size.w; c.height = doc.size.h; if (item.blob) { const b = await createImageBitmap(item.blob); c.getContext('2d').drawImage(b, 0, 0, c.width, c.height); b.close?.(); } bitmaps.set(item.id, c); return; }
    if (item.type === 'image' && item.blob && !bitmaps.has(item.id)) bitmaps.set(item.id, await createImageBitmap(item.blob)); };
  const addItem = async (item) => { await load(item); doc.items.push(item); sel = item.id; commit(); };
  const addImage = async (blob, label, { asBackground = false } = {}) => {
    const bmp = await createImageBitmap(blob), { w: cw, h: ch } = doc.size, k = asBackground ? Math.max(cw / bmp.width, ch / bmp.height) : Math.min(1, (cw * 0.6) / bmp.width, (ch * 0.6) / bmp.height);
    const item = { id: uid8(), type: 'image', name: label, blob, x: cw / 2, y: ch / 2, w: Math.round(bmp.width * k), h: Math.round(bmp.height * k), rot: 0, opacity: 1 };
    bmp.close?.(); await addItem(item);
  };
  const addShape = (type) => addItem({ id: uid8(), type, name: type === 'rect' ? 'Rectangle' : 'Circle', x: doc.size.w / 2, y: doc.size.h / 2, w: Math.round(doc.size.w * 0.25), h: Math.round(doc.size.w * 0.25 * (type === 'rect' ? 0.6 : 1)), rot: 0, opacity: 1, fill: '#8b7bff', radius: 0 });
  const addText = () => addItem({ id: uid8(), type: 'text', name: 'Text', text: 'Your text', x: doc.size.w / 2, y: doc.size.h / 2, w: Math.round(doc.size.w * 0.4), h: Math.round(doc.size.h * 0.12), rot: 0, opacity: 1, fill: '#ffffff' });
  const selected = () => doc.items.find((i) => i.id === sel);
  const removeItem = (item) => { doc.items = doc.items.filter((i) => i !== item); bitmaps.delete(item.id); if (sel === item.id) sel = null; commit(); };
  const move = (item, by) => { const i = doc.items.indexOf(item), j = clamp(i + by, 0, doc.items.length - 1); if (i === j) return; doc.items.splice(i, 1); doc.items.splice(j, 0, item); commit(); };
  const duplicate = (item) => { const copy = { ...item, id: uid8(), x: item.x + doc.size.w * 0.03, y: item.y + doc.size.w * 0.03 }; if (item.type === 'paint') { copy.blob = null; bitmaps.set(copy.id, cloneCanvas(bitmaps.get(item.id))); paintDirty.add(copy.id); } else if (bitmaps.has(item.id)) bitmaps.set(copy.id, bitmaps.get(item.id)); doc.items.push(copy); sel = copy.id; commit(); };


  // ---------- brush ----------
  let tool = 'select';                                        // 'select' | 'brush' | 'eraser'
  const brush = { type: 'dirt', size: Math.round(doc.size.w * 0.03), flow: 80, hardness: 60, colour: '#8b5a2b', texture: null, scale: 2, _pat: null };
  const rnd = (a, b) => a + Math.random() * (b - a), pick = (list) => list[Math.floor(Math.random() * list.length)];
  const BRUSHES = [['colour', 'Colour'], ['dirt', 'Dirt road'], ['grass', 'Grass'], ['stones', 'Stones'], ['sand', 'Sand'], ['texture', 'Texture']];
  const blob = (g, x, y, r, rgb, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(1, `rgba(${rgb},0)`); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  const hexRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `${n >> 16},${(n >> 8) & 255},${n & 255}`; };
  /** one dab of the brush at (x, y); strokes are many dabs in a row, so a texture brush looks like real grass / mud / gravel */
  function stamp(g, x, y) {
    const S = brush.size, r = S / 2, a = brush.flow / 100;
    g.save();
    if (tool === 'eraser') { g.globalCompositeOperation = 'destination-out'; blob(g, x, y, r, '0,0,0', Math.min(1, a + 0.1)); g.restore(); return; }
    if (brush.type === 'colour') { const gr = g.createRadialGradient(x, y, r * (brush.hardness / 100) * 0.95, x, y, r), rgb = hexRgb(brush.colour); gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(1, `rgba(${rgb},0)`); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
    else if (brush.type === 'dirt') {
      blob(g, x, y, r, '176,128,78', a * 0.55);
      g.globalAlpha = a; for (let i = 0; i < Math.max(8, S / 5); i++) { const t = rnd(0, 6.283), d = Math.sqrt(Math.random()) * r * 0.95; g.fillStyle = pick(['#9a6a3c', '#c99a62', '#8a5a30', '#b98a55', '#d8b283']); g.beginPath(); g.arc(x + Math.cos(t) * d, y + Math.sin(t) * d, rnd(1, S / 38 + 1.5), 0, 6.283); g.fill(); }
    } else if (brush.type === 'sand') {
      blob(g, x, y, r, '224,200,146', a * 0.6);
      g.globalAlpha = a; for (let i = 0; i < Math.max(8, S / 5); i++) { const t = rnd(0, 6.283), d = Math.sqrt(Math.random()) * r * 0.95; g.fillStyle = pick(['#e9d6a4', '#d2b97f', '#f1e2b8', '#c9ad73']); g.beginPath(); g.arc(x + Math.cos(t) * d, y + Math.sin(t) * d, rnd(0.8, S / 50 + 1.2), 0, 6.283); g.fill(); }
    } else if (brush.type === 'grass') {
      blob(g, x, y, r, '63,125,42', a * 0.28);
      g.globalAlpha = a; g.lineCap = 'round';
      for (let i = 0; i < Math.max(6, S / 5); i++) {
        const t = rnd(0, 6.283), d = Math.sqrt(Math.random()) * r * 0.9, ox = x + Math.cos(t) * d, oy = y + Math.sin(t) * d, ang = -Math.PI / 2 + rnd(-0.45, 0.45), len = S * rnd(0.12, 0.3);
        g.strokeStyle = pick(['#3f7d2a', '#5aa13a', '#7bbf4a', '#2f5f22', '#8fcf58']); g.lineWidth = Math.max(1.5, S / 40);
        g.beginPath(); g.moveTo(ox, oy); g.quadraticCurveTo(ox + Math.cos(ang) * len * 0.4 + rnd(-3, 3), oy + Math.sin(ang) * len * 0.5, ox + Math.cos(ang) * len, oy + Math.sin(ang) * len); g.stroke();
      }
    } else if (brush.type === 'stones') {
      g.globalAlpha = a;
      for (let i = 0; i < Math.max(2, S / 40); i++) {
        const t = rnd(0, 6.283), d = Math.sqrt(Math.random()) * r * 0.9, rx = S * rnd(0.025, 0.07);
        g.fillStyle = pick(['#8d8f93', '#a6a8ac', '#76787c', '#b4a79a']); g.strokeStyle = '#4a4b4e'; g.lineWidth = Math.max(1, S / 200);
        g.beginPath(); g.ellipse(x + Math.cos(t) * d, y + Math.sin(t) * d, rx, rx * rnd(0.6, 0.9), rnd(0, 3), 0, 6.283); g.fill(); g.stroke();
      }
    } else if (brush.type === 'texture' && brush.texture) {
      g.globalAlpha = a; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.clip();
      if (!brush._pat || brush._pat.g !== g || brush._pat.tex !== brush.texture || brush._pat.k !== brush.scale) { const pat = g.createPattern(brush.texture, 'repeat'); pat.setTransform?.(new DOMMatrix().scale(brush.scale)); brush._pat = { g, tex: brush.texture, k: brush.scale, pat }; }
      g.fillStyle = brush._pat.pat; g.fillRect(x - r, y - r, S, S);
    }
    g.restore();
  }
  const spacing = () => Math.max(1.5, brush.size * ({ stones: 0.45, grass: 0.16, texture: 0.08, colour: 0.07 }[brush.type] ?? 0.12));
  let stroke = null;
  const paintLayer = () => {
    let it = selected(); if (it?.type !== 'paint') it = [...doc.items].reverse().find((i) => i.type === 'paint');
    if (!it) { it = { id: uid8(), type: 'paint', name: 'Painting', x: doc.size.w / 2, y: doc.size.h / 2, w: doc.size.w, h: doc.size.h, rot: 0, opacity: 1 }; const c = document.createElement('canvas'); c.width = doc.size.w; c.height = doc.size.h; bitmaps.set(it.id, c); doc.items.push(it); }
    return it;
  };
  const startStroke = (e) => {
    const it = paintLayer(), c = bitmaps.get(it.id), p = toCanvas(e);
    sel = it.id; stroke = { it, c, g: c.getContext('2d'), last: p, undo: { s: lastSnap, p: { id: it.id, canvas: cloneCanvas(c) } }, carry: 0, shift: e.shiftKey, from: p };
    stamp(stroke.g, p.x, p.y); drawCanvas();
  };
  const moveStroke = (e) => {
    const p = toCanvas(e), st = stroke, gap = spacing();
    let a = st.last, dx = p.x - a.x, dy = p.y - a.y, len = Math.hypot(dx, dy), t = gap - st.carry;
    while (t <= len) { stamp(st.g, a.x + (dx / len) * t, a.y + (dy / len) * t); t += gap; }
    st.carry = len - (t - gap); st.last = p; drawCanvas();
  };
  const endStroke = () => {
    const st = stroke; stroke = null; if (!st) return;
    history.push(st.undo); future.length = 0; if (history.filter((x) => x.p).length > 8) history.splice(0, history.findIndex((x) => x.p) + 1);
    lastSnap = snapshot(); paintDirty.add(st.it.id); saved = false; redraw();
  };
  const ring = h('div', { class: 'bgg-ring', hidden: true });
  stage.append(ring);
  const moveRing = (e) => {
    if (tool === 'select') { ring.hidden = true; return; }
    const r = stage.getBoundingClientRect(), k = r.width / doc.size.w, d = brush.size * k;
    ring.hidden = false; Object.assign(ring.style, { width: `${d}px`, height: `${d}px`, left: `${e.clientX - r.left - d / 2}px`, top: `${e.clientY - r.top - d / 2}px` });
  };
  stage.addEventListener('pointermove', moveRing); stage.addEventListener('pointerleave', () => { ring.hidden = true; });
  const setTool = (t) => { tool = t; stage.classList.toggle('bgg-painting', t !== 'select'); place(); drawSide(); };

  // ---------- pointer: select, move, resize (corner / pinch / wheel), rotate ----------
  const pointers = new Map();
  let drag = null;
  const toCanvas = (e) => { const r = canvas.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * doc.size.w, y: ((e.clientY - r.top) / r.height) * doc.size.h }; };
  const hit = (p) => {
    for (let i = doc.items.length - 1; i >= 0; i--) {
      const it = doc.items[i]; if (it.hidden || it.type === 'paint') continue;          // a painting covers the whole canvas: it is chosen from the layer list
      const a = (-(it.rot || 0) * Math.PI) / 180, dx = p.x - it.x, dy = p.y - it.y, lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(lx) <= it.w / 2 && Math.abs(ly) <= it.h / 2) return it;
    }
    return null;
  };
  const dist = () => { const [a, b] = [...pointers.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; };
  const resizeTo = (it, k) => { const w = clamp(drag.w0 * k, 20, doc.size.w * 6), s = w / drag.w0; it.w = Math.round(w); it.h = Math.round(drag.h0 * s); };
  stage.addEventListener('pointerdown', (e) => {
    if (busy) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (tool !== 'select') { if (pointers.size > 1) return; stage.setPointerCapture(e.pointerId); startStroke(e); return; }
    const it = selected();
    if (it && drag?.kind === 'move' && pointers.size === 2) { drag = { kind: 'pinch', it, d0: dist() || 1, w0: it.w, h0: it.h }; return; }
    stage.setPointerCapture(e.pointerId);
    const handle = e.target.dataset?.hd;
    if (it && handle === 'rot') { const r = stage.getBoundingClientRect(), k = r.width / doc.size.w; drag = { kind: 'rotate', it, cx: r.left + it.x * k, cy: r.top + it.y * k }; return; }
    if (it && handle) { const r = stage.getBoundingClientRect(), k = r.width / doc.size.w, cx = r.left + it.x * k, cy = r.top + it.y * k; drag = { kind: 'scale', it, cx, cy, r0: Math.hypot(e.clientX - cx, e.clientY - cy) || 1, w0: it.w, h0: it.h }; return; }
    const target = hit(toCanvas(e));
    sel = target?.id ?? null;
    if (target) { const p = toCanvas(e); drag = { kind: 'move', it: target, p0: p, x0: target.x, y0: target.y }; }
    place(); drawSide();
  });
  stage.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (stroke) { moveStroke(e); return; }
    if (!drag) return;
    const it = drag.it;
    if (drag.kind === 'pinch') resizeTo(it, dist() / drag.d0);
    else if (drag.kind === 'scale') resizeTo(it, Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy) / drag.r0);
    else if (drag.kind === 'rotate') it.rot = Math.round(((Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx) * 180) / Math.PI + 90) * 10) / 10;
    else { const p = toCanvas(e); it.x = Math.round(drag.x0 + p.x - drag.p0.x); it.y = Math.round(drag.y0 + p.y - drag.p0.y); }
    drag.changed = true; drawCanvas(); place();
  });
  const up = (e) => { pointers.delete(e.pointerId); if (stroke) { endStroke(); return; } if (drag && (!pointers.size || drag.kind === 'pinch')) { const changed = drag.changed; drag = null; if (changed) commit(); else drawSide(); } };
  stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
  stage.addEventListener('wheel', (e) => { if (tool !== 'select') { e.preventDefault(); brush.size = clamp(Math.round(brush.size * Math.exp(-e.deltaY * 0.001)), 4, 1200); moveRing(e); drawSide(); return; } const it = selected(); if (!it || it.type === 'paint') return; e.preventDefault(); drag = { it, w0: it.w, h0: it.h }; resizeTo(it, Math.exp(-e.deltaY * 0.0015)); drag = null; clearTimeout(stage._t); drawCanvas(); place(); stage._t = setTimeout(commit, 250); }, { passive: false });
  const onKey = (e) => {
    if (!document.body.contains(root) || e.target.closest?.('input,textarea,select,[contenteditable]')) return;
    const it = selected(), step = e.shiftKey ? 50 : 5;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (e.key.toLowerCase() === 'b' && !e.ctrlKey && !e.metaKey) { setTool('brush'); return; }
    if (e.key.toLowerCase() === 'e' && !e.ctrlKey && !e.metaKey) { setTool('eraser'); return; }
    if (!it) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeItem(it); }
    else if (e.key.startsWith('Arrow')) { e.preventDefault(); it.x += e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0; it.y += e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0; commit(); }
  };
  document.addEventListener('keydown', onKey);

  // ---------- saving ----------
  const render = async (type = 'image/png') => {
    const full = document.createElement('canvas'); full.width = doc.size.w; full.height = doc.size.h;
    paint(full.getContext('2d'), doc, bitmaps, 1); return toBlob(full, type);
  };
  const makeThumb = async () => { const t = document.createElement('canvas'), k = 360 / Math.max(doc.size.w, doc.size.h); t.width = Math.round(doc.size.w * k); t.height = Math.round(doc.size.h * k); paint(t.getContext('2d'), doc, bitmaps, k); return toBlob(t, 'image/jpeg', 0.82); };
  const setBusy = (on, text = '') => { busy = on; root.classList.toggle('bgg-busy', on); status.textContent = text; };
  async function syncPaintBlobs() {          // the painting is kept as a PNG inside the saved background, so it can be opened and painted on again
    for (const it of doc.items) if (it.type === 'paint' && (paintDirty.has(it.id) || !it.blob)) { it.blob = await toBlob(bitmaps.get(it.id)); paintDirty.delete(it.id); }
  }
  async function save() {
    if (busy) return;
    if (!doc.items.length && doc.base.kind === 'blank') { toast('Add something to the canvas first, then save.'); return; }
    setBusy(true, 'Rendering the full-size picture…');
    try {
      await syncPaintBlobs();
      const blob = await render(), thumb = await makeThumb();
      await putBgLibrary(user.uid, { id, name, w: doc.size.w, h: doc.size.h, blob, thumb, doc: { size: doc.size, base: doc.base, items: doc.items } });
      saved = true; toast('Saved. You can pick it from the Background tab in the Animator Studio.'); await drawLibrary();
    } catch (e) { toast(friendlyError(e)); } finally { setBusy(false); drawSide(); }
  }
  async function download() {
    if (busy) return; setBusy(true, 'Rendering the full-size picture…');
    try { const blob = await render(), a = h('a', { href: URL.createObjectURL(blob), download: `${name.replace(/[^\w-]+/g, '_') || 'background'}.png` }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
    catch (e) { toast(friendlyError(e)); } finally { setBusy(false); }
  }
  async function openSaved(rec) {
    if (rec.doc) { doc = { size: rec.doc.size, base: rec.doc.base, items: rec.doc.items.map((i) => ({ ...i })) }; }
    else { doc = newDoc(SIZES.find((s) => s.w === rec.w && s.h === rec.h) || SIZES[0]); doc.items = [{ id: uid8(), type: 'image', name: rec.name, blob: rec.blob, x: rec.w / 2, y: rec.h / 2, w: rec.w, h: rec.h, rot: 0, opacity: 1 }]; }
    bitmaps.clear(); await Promise.all(doc.items.map(load));
    id = rec.id; name = rec.name; nameInput.value = name; sel = null; history.length = future.length = 0; lastSnap = snapshot(); saved = true; sizeSel.value = SIZES.find((s) => s.w === doc.size.w && s.h === doc.size.h)?.id || 'custom'; redraw();
  }
  function newBackground() { paintDirty.clear(); setTool('select'); doc = newDoc(); bitmaps.clear(); id = uid8(); name = 'My background'; nameInput.value = name; sel = null; history.length = future.length = 0; lastSnap = snapshot(); sizeSel.value = '4k'; saved = false; redraw(); }

  // ---------- side panels ----------
  const status = h('span', { class: 'bgg-status', role: 'status' });
  const nameInput = h('input', { class: 'bgg-name', value: name, maxlength: 80, 'aria-label': 'Background name', oninput: (e) => { name = e.target.value; saved = false; } });
  const file = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: async (e) => { for (const f of e.target.files) { try { await addImage(f, f.name.replace(/\.[^.]+$/, '')); } catch { toast('This picture could not be opened. Please choose a PNG, JPG or WebP file.'); } } e.target.value = ''; } });
  const sizeSel = h('select', { 'aria-label': 'Canvas size', onchange: (e) => { const s = SIZES.find((x) => x.id === e.target.value); if (!s) return; const kx = s.w / doc.size.w, ky = s.h / doc.size.h; for (const it of doc.items) { it.x *= kx; it.y *= ky; it.w *= Math.min(kx, ky); it.h *= Math.min(kx, ky); } doc.size = { w: s.w, h: s.h }; commit(); } },
    SIZES.map((s) => h('option', { value: s.id }, s.label)), h('option', { value: 'custom', hidden: true }, 'Custom'));
  const sharedBox = h('div', { class: 'bgg-shared', hidden: true });
  let sharedLoaded = false;
  async function toggleShared() {
    sharedBox.hidden = !sharedBox.hidden; if (sharedBox.hidden || sharedLoaded) return;
    sharedBox.replaceChildren(h('p', { class: 'bgg-sub' }, 'Loading the shared library…'));
    try {
      const assets = (await listStudioAssets()).filter((a) => ['prop', 'background', 'effect'].includes(a.type)); sharedLoaded = true;
      sharedBox.replaceChildren(assets.length ? h('div', { class: 'bgg-grid' }, assets.map((a) => h('button', { type: 'button', class: 'bgg-tile', title: a.name, onclick: async () => { setBusy(true, 'Adding…'); try { await addImage(await downloadStudioAsset(a), a.name, { asBackground: a.type === 'background' }); } catch (e) { toast(friendlyError(e)); } finally { setBusy(false); } } }, a.thumb ? h('img', { src: a.thumb, alt: a.name, loading: 'lazy' }) : h('span', {}, '🖼'), h('small', {}, a.name)))) : h('p', { class: 'bgg-sub' }, 'The shared library is empty for now.'));
    } catch (e) { sharedLoaded = false; sharedBox.replaceChildren(h('p', { class: 'bgg-sub' }, friendlyError(e))); }
  }
  let libBox;
  const swatches = h('div', { class: 'bgg-sw' }, BACKGROUNDS.map((b, i) => h('button', { type: 'button', title: b.name, style: `background:linear-gradient(135deg,${b.a},${b.b})`, onclick: () => { doc.base = { kind: 'gradient', a: b.a, b: b.b }; commit(); } })),
    h('button', { type: 'button', class: 'bgg-blank', title: 'Blank (transparent)', onclick: () => { doc.base = { kind: 'blank' }; commit(); } }, '▦'));
  const colourA = h('input', { type: 'color', value: '#2a2c3a', 'aria-label': 'Colour', oninput: (e) => { doc.base = { kind: 'solid', a: e.target.value }; saved = false; drawCanvas(); }, onchange: commit });
  const toolBtns = {};
  const toolBtn = (t, label, tip) => (toolBtns[t] = h('button', { type: 'button', class: 'btn', title: tip, 'aria-pressed': 'false', onclick: () => setTool(t) }, label));
  const brushType = h('select', { 'aria-label': 'Brush', onchange: (e) => { brush.type = e.target.value; drawSide(); } }, BRUSHES.map(([k, l]) => h('option', { value: k }, l)));
  brushType.value = brush.type;
  const texFile = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { brush.texture = await createImageBitmap(f); brush.type = 'texture'; brushType.value = 'texture'; setTool('brush'); toast('Texture ready. Paint with it on the canvas.'); } catch { toast('This picture could not be opened. Please choose a PNG, JPG or WebP file.'); } } });
  const slider = (label, min, max, get, set) => { const out = h('output', {}, String(get())), input = h('input', { type: 'range', min, max, value: get(), oninput: (e) => { set(+e.target.value); out.textContent = e.target.value; moveRingCentre(); } }); return { box: h('label', { class: 'bgg-field' }, h('span', {}, label), input, out), input, out }; };
  const sizeSlider = slider('Size', 4, 1200, () => brush.size, (v) => { brush.size = v; });
  const flowSlider = slider('Flow', 5, 100, () => brush.flow, (v) => { brush.flow = v; });
  const hardSlider = slider('Soft edge', 0, 100, () => brush.hardness, (v) => { brush.hardness = v; });
  const scaleSlider = slider('Texture size', 1, 12, () => brush.scale, (v) => { brush.scale = v; });
  const pickTexture = (canvas, label) => { brush.texture = canvas; brush.type = 'texture'; brushType.value = 'texture'; setTool('brush'); toast(`${label} texture ready. Paint with it on the canvas.`); };
  const sampleGrid = h('div', { class: 'bgg-samples' }, SAMPLE_TEXTURES.map(([k, label]) => { const tex = makeSampleTexture(k); return h('button', { type: 'button', class: 'bgg-sample', title: `${label} — paint with it`, onclick: () => pickTexture(tex, label) }, h('img', { src: tex.toDataURL('image/png'), alt: '' }), h('small', {}, label)); }));
  const brushColour = h('input', { type: 'color', value: brush.colour, 'aria-label': 'Brush colour', oninput: (e) => { brush.colour = e.target.value; } });
  const colourRow = h('label', { class: 'bgg-inline' }, 'Colour', brushColour);
  const moveRingCentre = () => {};
  const paintCard = h('div', { class: 'bgg-card' }, h('h2', {}, 'Paint'),
    h('p', { class: 'bgg-sub' }, 'Paint a road, grass, gravel or sand right on the canvas.'),
    h('div', { class: 'bgg-row' }, toolBtn('select', '↖ Select', 'Move and resize items'), toolBtn('brush', '🖌 Brush', 'Paint (B)'), toolBtn('eraser', '⌫ Eraser', 'Rub out the painting (E)')),
    brushType, sizeSlider.box, flowSlider.box, hardSlider.box, colourRow,
    h('p', { class: 'bgg-sub' }, 'Sample textures'), sampleGrid, scaleSlider.box,
    h('button', { type: 'button', class: 'btn', onclick: () => texFile.click() }, '＋ Paint with my own texture'), texFile,
    h('p', { class: 'bgg-sub' }, 'Your own texture: choose any picture (best: a square, seamless PNG or JPG of mud, grass, stone, water…). It repeats as you paint.'),
    h('p', { class: 'bgg-sub' }, 'Tip: the mouse wheel on the canvas changes the brush size. Painting sits on its own layer, so you can move it Back or Forward behind or in front of props.'));
  function syncPaintUi() {
    for (const [t, b] of Object.entries(toolBtns)) b.setAttribute('aria-pressed', String(tool === t));
    sizeSlider.input.value = brush.size; sizeSlider.out.textContent = String(brush.size);
    scaleSlider.box.style.display = tool !== 'select' && brush.type === 'texture' ? '' : 'none'; scaleSlider.input.value = brush.scale; scaleSlider.out.textContent = String(brush.scale);
    colourRow.hidden = brush.type !== 'colour'; hardSlider.box.hidden = brush.type !== 'colour';
    for (const el of [brushType, sizeSlider.box, flowSlider.box, hardSlider.box, colourRow]) el.style.display = tool === 'select' ? 'none' : '';
    if (tool !== 'select') { colourRow.style.display = brush.type === 'colour' ? '' : 'none'; hardSlider.box.style.display = brush.type === 'colour' ? '' : 'none'; }
  }
  const left = h('aside', { class: 'bgg-left' },
    h('div', { class: 'bgg-card' }, h('h2', {}, 'Add'),
      h('button', { type: 'button', class: 'btn pri', onclick: () => file.click() }, '＋ Picture or prop'), file,
      h('button', { type: 'button', class: 'btn', onclick: toggleShared }, 'Shared props library'), sharedBox,
      h('div', { class: 'bgg-row' }, h('button', { type: 'button', class: 'btn', onclick: () => addShape('rect') }, '▭ Rectangle'), h('button', { type: 'button', class: 'btn', onclick: () => addShape('ellipse') }, '◯ Circle'), h('button', { type: 'button', class: 'btn', onclick: addText }, 'T Text'))),
    paintCard,
    h('div', { class: 'bgg-card' }, h('h2', {}, 'Canvas'), sizeSel, h('p', { class: 'bgg-sub' }, 'Colour or gradient'), swatches, h('label', { class: 'bgg-inline' }, 'Own colour', colourA)),
    h('div', { class: 'bgg-card' }, h('h2', {}, 'My backgrounds'), h('p', { class: 'bgg-sub' }, 'Saved in your account on this device. Open one to keep editing it.'), (libBox = h('div', { class: 'bgg-lib' }))));
  const props = h('div', { class: 'bgg-props' }), layers = h('div', { class: 'bgg-layers' });
  const right = h('aside', { class: 'bgg-right' }, h('div', { class: 'bgg-card' }, h('h2', {}, 'Selected'), props), h('div', { class: 'bgg-card' }, h('h2', {}, 'Layers'), layers));
  function drawSide() {
    syncPaintUi();
    emptyHint.hidden = doc.items.length > 0;
    const it = selected(), row = (label, ...c) => h('label', { class: 'bgg-field' }, h('span', {}, label), ...c);
    props.replaceChildren(...(it?.type === 'paint' ? [
      row('Opacity', h('input', { type: 'range', min: 5, max: 100, value: Math.round((it.opacity ?? 1) * 100), oninput: (e) => { it.opacity = +e.target.value / 100; drawCanvas(); }, onchange: commit })),
      h('div', { class: 'bgg-row' }, h('button', { type: 'button', class: 'btn sm', onclick: () => { setTool('brush'); } }, '🖌 Paint more'), h('button', { type: 'button', class: 'btn sm', onclick: () => move(it, 1) }, 'Forward'), h('button', { type: 'button', class: 'btn sm', onclick: () => move(it, -1) }, 'Back'),
        h('button', { type: 'button', class: 'btn sm danger', onclick: () => removeItem(it) }, 'Delete painting')),
    ] : it ? [
      row('Opacity', h('input', { type: 'range', min: 5, max: 100, value: Math.round((it.opacity ?? 1) * 100), oninput: (e) => { it.opacity = +e.target.value / 100; drawCanvas(); }, onchange: commit })),
      row('Size', h('input', { type: 'range', min: 5, max: 400, value: Math.round((it.w / doc.size.w) * 100), oninput: (e) => { const w = (+e.target.value / 100) * doc.size.w, s = w / it.w; it.w = Math.round(w); it.h = Math.round(it.h * s); drawCanvas(); place(); }, onchange: commit })),
      row('Rotate', h('input', { type: 'range', min: -180, max: 180, value: Math.round(it.rot || 0), oninput: (e) => { it.rot = +e.target.value; drawCanvas(); place(); }, onchange: commit })),
      ...(it.type === 'text' ? [row('Text', h('input', { type: 'text', value: it.text, maxlength: 80, oninput: (e) => { it.text = e.target.value; drawCanvas(); }, onchange: commit }))] : []),
      ...(['rect', 'ellipse', 'text'].includes(it.type) ? [row('Colour', h('input', { type: 'color', value: it.fill || '#8b7bff', oninput: (e) => { it.fill = e.target.value; drawCanvas(); }, onchange: commit }))] : []),
      h('div', { class: 'bgg-row' },
        h('button', { type: 'button', class: 'btn sm', onclick: () => { it.flip = !it.flip; commit(); } }, '⇋ Flip'), h('button', { type: 'button', class: 'btn sm', onclick: () => duplicate(it) }, 'Duplicate'),
        h('button', { type: 'button', class: 'btn sm', onclick: () => move(it, 1) }, 'Forward'), h('button', { type: 'button', class: 'btn sm', onclick: () => move(it, -1) }, 'Back'),
        h('button', { type: 'button', class: 'btn sm danger', onclick: () => removeItem(it) }, 'Delete')),
    ] : [h('p', { class: 'bgg-sub' }, 'Click an item on the canvas to move it. Drag a corner, pinch with two fingers or use the mouse wheel to resize.')]));
    layers.replaceChildren(...(doc.items.length ? [...doc.items].reverse().map((l) => h('div', { class: `bgg-layer ${l.id === sel ? 'on' : ''}` },
      h('button', { type: 'button', class: 'bgg-layer-main', onclick: () => { sel = l.id; place(); drawSide(); } }, `${{ image: '🖼', paint: '🖌', rect: '▭', ellipse: '◯', text: 'T' }[l.type] || '•'} ${l.name || l.type}`),
      h('button', { type: 'button', class: 'bgg-eye', title: l.hidden ? 'Show' : 'Hide', onclick: () => { l.hidden = !l.hidden; commit(); } }, l.hidden ? '🚫' : '👁')))
      : [h('p', { class: 'bgg-sub' }, 'No layers yet.')]));
    sizeInfo.textContent = `${doc.size.w} × ${doc.size.h}`;
  }
  async function drawLibrary() {
    const all = await listBgLibrary(user.uid).catch(() => []);
    libBox.replaceChildren(...(all.length ? all.map((rec) => {
      const url = rec.thumb ? URL.createObjectURL(rec.thumb) : '';
      return h('div', { class: `bgg-lib-item ${rec.id === id ? 'on' : ''}` },
        h('button', { type: 'button', class: 'bgg-lib-open', title: `Open ${rec.name}`, onclick: () => openSaved(rec) }, url ? h('img', { src: url, alt: '', onload: () => setTimeout(() => URL.revokeObjectURL(url), 2000) }) : null, h('span', {}, rec.name), h('small', {}, `${rec.w} × ${rec.h}`)),
        h('button', { type: 'button', class: 'bgg-lib-del', 'aria-label': `Delete ${rec.name}`, title: 'Delete', onclick: async () => {
          if (!await projectDialog({ title: 'Delete this background?', description: `“${rec.name}” will be removed from your library. Animation projects that already use it keep their copy.`, confirmLabel: 'Delete background', danger: true, confirmOnly: true })) return;
          await deleteBgLibrary(user.uid, rec.id); if (rec.id === id) saved = false; await drawLibrary();
        } }, '✕'));
    }) : [h('p', { class: 'bgg-sub' }, 'Nothing saved yet.')]));
  }

  // ---------- page ----------
  const root = h('div', { class: 'bgg' },
    h('header', { class: 'bgg-bar' },
      h('button', { type: 'button', class: 'btn', onclick: () => { if (!saved && doc.items.length && !confirm('You have unsaved changes. Leave without saving?')) return; home(); } }, '← Hub'),
      h('b', { class: 'bgg-title' }, 'Background Generator'), nameInput, h('span', { class: 'sp' }), status, sizeInfo,
      h('button', { type: 'button', class: 'btn', title: 'Undo (Ctrl+Z)', onclick: undo }, '↶'), h('button', { type: 'button', class: 'btn', title: 'Redo (Ctrl+Y)', onclick: redo }, '↷'),
      h('button', { type: 'button', class: 'btn', onclick: newBackground }, 'New'), h('button', { type: 'button', class: 'btn', onclick: download }, 'Download PNG'), h('button', { type: 'button', class: 'btn pri', onclick: save }, 'Save to my backgrounds')),
    h('div', { class: 'bgg-body' }, left, h('main', { class: 'bgg-center' }, stage), right));
  const observer = new ResizeObserver(() => { if (document.body.contains(root)) redraw(); else { observer.disconnect(); document.removeEventListener('keydown', onKey); } });
  queueMicrotask(() => { observer.observe(stage.parentElement); drawLibrary(); redraw(); });
  return root;
}
