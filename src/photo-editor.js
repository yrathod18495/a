/* A small picture editor for one layer of a character: brushes (13 looks), eraser, smudge, blur, clone, bucket fill, gradient, eyedropper,
   selections (rectangle, ellipse, freehand, magic wand with add / subtract), move, shadows and colour adjustments, undo / redo, zoom and pan.
   Works with mouse, pen and touch (one finger paints, two fingers zoom and move the picture).
   openPhotoEditor({ canvas, title, onApply }) opens it over the page; onApply(canvas) gets the finished picture. The pure pixel maths is in photo-tools.js. */
import './photo-editor.css';
import { h } from './dom.js';
import { icon } from './icons.js';
import { floodMask, combineMask, invertMask, growMask, blurMask, maskEdge, maskCount, adjustBrightnessContrast, adjustHSL, invertColours, grayscale, sharpen, blurFilter, edgeShadow, fillMask, clearMask, blurRGBA, hexToRgb, rgbToHex, rgb2hsv, hsv2rgb, parseHex } from './photo-tools.js';

const mk = (w, hh) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(hh)); return c; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rgba = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const svg = (body) => { const s = document.createElement('span'); s.className = 'pe-ic'; s.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`; return s; };
const ICONS = {
  brush: '<path d="M18 3l3 3-9 9-3-3z"/><path d="M9 12c-3 0-5 2-5 5 0 2-1 3-1 3 3 1 7 0 8-3 .5-1.500-.5-3-2-5z"/>',
  bucket: '<path d="M4 12l8-8 8 8-7 7a2 2 0 0 1-3 0z"/><path d="M20 15c1 1.500 2 2.500 2 3.500a2 2 0 0 1-4 0c0-1 1-2 2-3.500z"/>',
  gradient: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 12h18M3 8h18M3 16h18" opacity=".5"/>',
  dropper: '<path d="M14 5l5 5"/><path d="M17 3l4 4-3 3-4-4z"/><path d="M14 8L5 17v3h3l9-9"/>',
  eraser: '<path d="M7 20h13"/><path d="M5 15l9-9 5 5-6 6H8z"/><path d="M9 11l5 5"/>',
  smudge: '<path d="M4 18c3-6 6-10 10-10 2 0 3 1 3 3s-2 4-5 4c-1 0-2 .5-2 2"/><path d="M17 17c1.500 0 3-.5 3-2"/>',
  blur: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7" stroke-dasharray="2 3"/>',
  clone: '<rect x="3" y="3" width="10" height="10" rx="2"/><rect x="11" y="11" width="10" height="10" rx="2"/>',
  rect: '<rect x="4" y="5" width="16" height="14" rx="1" stroke-dasharray="3 2"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="9" ry="7" stroke-dasharray="3 2"/>',
  lasso: '<path d="M12 4c5 0 9 2 9 5s-4 5-9 5-9-2-9-5 4-5 9-5z" stroke-dasharray="3 2"/><path d="M8 14c-1 2 0 4 2 5"/>',
  wand: '<path d="M4 20L16 8"/><path d="M15 4v3M19 8h-3M17 5.500l-1.500 1.500M5 6v2M4 7h2"/>',
  move: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  hand: '<path d="M8 12V6a1.500 1.500 0 0 1 3 0v5M11 11V4.500a1.500 1.500 0 0 1 3 0V11M14 11V6a1.500 1.500 0 0 1 3 0v8c0 4-2 6-6 6-3 0-4-1-6-4l-1-2a1.500 1.500 0 0 1 2.500-1.500L8 14"/>',
  shade: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>',
};
const ic = (name) => (ICONS[name] ? svg(ICONS[name]) : icon(name));

/** the looks of the brush. round = a soft or hard dot; the rest draw their own marks. blend = how the stroke joins the picture. */
const STYLES = [
  { id: 'soft', name: 'Soft round', round: true, hard: 0.15, space: 0.1, flow: 1, hint: 'Smooth, blurry edge. Good for blending.' },
  { id: 'hard', name: 'Hard round', round: true, hard: 1, space: 0.08, flow: 1, hint: 'Clean, sharp edge.' },
  { id: 'pencil', name: 'Pencil', space: 0.12, flow: 0.85, hint: 'Thin, slightly rough line.' },
  { id: 'ink', name: 'Ink pen', space: 0.06, flow: 1, hint: 'Line gets thinner when you move fast.' },
  { id: 'marker', name: 'Marker (flat)', space: 0.1, flow: 1, hint: 'Flat slanted tip, like a chisel marker.' },
  { id: 'air', name: 'Airbrush', round: true, hard: 0, space: 0.05, flow: 0.12, hint: 'Soft spray that builds up slowly.' },
  { id: 'water', name: 'Watercolour', space: 0.07, flow: 0.18, hint: 'Light, see-through washes that overlap.' },
  { id: 'chalk', name: 'Chalk', space: 0.1, flow: 1, hint: 'Grainy, rough texture.' },
  { id: 'spray', name: 'Spray dots', space: 0.15, flow: 1, hint: 'Scattered dots, like a splatter.' },
  { id: 'hatch', name: 'Hatching', space: 0.5, flow: 1, hint: 'Little diagonal lines, for shading.' },
  { id: 'shadow', name: 'Shadow (darken)', round: true, hard: 0, space: 0.08, flow: 0.25, blend: 'multiply', lock: true, hint: 'Darkens what is below. Use a dark version of the skin colour.' },
  { id: 'light', name: 'Light (highlight)', round: true, hard: 0, space: 0.08, flow: 0.25, blend: 'screen', lock: true, hint: 'Brightens what is below. Use a light colour.' },
  { id: 'burn', name: 'Burn (deepen)', round: true, hard: 0, space: 0.08, flow: 0.3, blend: 'soft-light', force: [0, 0, 0], lock: true, hint: 'Deepens shadows with no colour change.' },
  { id: 'dodge', name: 'Dodge (lighten)', round: true, hard: 0, space: 0.08, flow: 0.3, blend: 'soft-light', force: [255, 255, 255], lock: true, hint: 'Lightens areas with no colour change.' },
];
const TOOLS = [
  ['brush', 'Brush', 'brush'], ['eraser', 'Eraser', 'eraser'], ['smudge', 'Smudge', 'smudge'], ['blur', 'Blur', 'blur'], ['clone', 'Clone', 'clone'],
  ['bucket', 'Fill', 'bucket'], ['gradient', 'Gradient', 'gradient'], ['dropper', 'Pick colour', 'dropper'],
  ['rect', 'Rectangle select', 'rect'], ['ellipse', 'Ellipse select', 'ellipse'], ['lasso', 'Freehand select', 'lasso'], ['wand', 'Magic select', 'wand'],
  ['move', 'Move pixels', 'move'], ['hand', 'Move view', 'hand'],
];
const SWATCHES = ['#000000', '#ffffff', '#6b6b6b', '#c0c0c0', '#8b1e2d', '#e03a3a', '#f08a24', '#f4d03f', '#7ab648', '#2e8b57', '#2aa6c9', '#2f5fd0', '#6a3fc4', '#d65db1', '#d9b38c', '#8a5a3c'];

export function openPhotoEditor({ canvas, title = 'Edit picture', onApply, onCancel } = {}) {
  const W = canvas.width, H = canvas.height;
  const D = mk(W, H), dg = D.getContext('2d', { willReadFrequently: true });
  dg.drawImage(canvas, 0, 0);
  const original = dg.getImageData(0, 0, W, H);
  const S = mk(W, H), sg = S.getContext('2d');                      // the stroke being drawn (flat colour with its own softness; the opacity is put on when the stroke ends)
  const state = { tool: 'brush', style: 'soft', size: 28, opacity: 100, hard: 15, fg: [217, 179, 140], bg: [255, 255, 255], tol: 24, contiguous: true, lock: true, mode: 'replace', feather: 0, smoothWand: true,
    gradKind: 'linear', gradEnd: 'fade', bucketLock: true, space: false, scale: 1, ox: 0, oy: 0, sel: null, selViz: null, undo: [], redo: [], recent: [], cloneSrc: null, cloneOff: null, armClone: false, panel: 'brush' };
  let rafId = 0, stroke = null, pinch = null, preview = null, ghostSel = null, closed = false;
  const pointers = new Map();

  /* ---------- history ---------- */
  const budget = Math.max(6, Math.min(40, Math.floor(90e6 / (W * H * 4))));
  const snap = () => ({ img: dg.getImageData(0, 0, W, H), sel: state.sel ? state.sel.slice() : null });
  const restore = (s) => { dg.putImageData(s.img, 0, 0); setSel(s.sel ? s.sel.slice() : null, false); };
  function pushUndo() { state.undo.push(snap()); if (state.undo.length > budget) state.undo.shift(); state.redo.length = 0; syncButtons(); }
  function undo() { if (!state.undo.length) return; state.redo.push(snap()); restore(state.undo.pop()); syncButtons(); draw(); }
  function redo() { if (!state.redo.length) return; state.undo.push(snap()); restore(state.redo.pop()); syncButtons(); draw(); }

  /* ---------- selection ---------- */
  function setSel(mask, record = true) {
    if (mask && !maskCount(mask)) mask = null;
    state.sel = mask; state.selViz = null;
    if (mask) {
      const e = maskEdge(mask, W, H), c = mk(W, H), g = c.getContext('2d'), im = g.createImageData(W, H), d = im.data;
      for (let p = 0; p < W * H; p++) {
        const i = p * 4;
        if (e[p]) { const on = ((p % W) + ((p / W) | 0)) % 8 < 4; d[i] = d[i + 1] = d[i + 2] = on ? 0 : 255; d[i + 3] = 255; }
        else if (mask[p] > 127) { d[i] = 70; d[i + 1] = 120; d[i + 2] = 255; d[i + 3] = 46; }
      }
      g.putImageData(im, 0, 0); state.selViz = c;
    }
    if (record) syncButtons();
    draw();
  }
  const withSel = (m, mode = state.mode) => { const f = state.feather > 0 ? blurMask(m, W, H, state.feather) : m; setSel(combineMask(state.sel, f, mode)); };
  const pathMask = (fn) => { const c = mk(W, H), g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'; g.beginPath(); fn(g); g.fill(); const d = g.getImageData(0, 0, W, H).data, m = new Uint8Array(W * H); for (let p = 0; p < m.length; p++) m[p] = d[p * 4 + 3]; return m; };

  /* ---------- coordinates ---------- */
  const rectOfView = () => vp.getBoundingClientRect();
  const toDoc = (e) => { const r = rectOfView(); return { x: (e.clientX - r.left - state.ox) / state.scale, y: (e.clientY - r.top - state.oy) / state.scale }; };
  function fit() {
    const r = rectOfView(), s = Math.min((r.width - 24) / W, (r.height - 24) / H);
    state.scale = clamp(s > 0 ? s : 1, 0.05, 32); state.ox = (r.width - W * state.scale) / 2; state.oy = (r.height - H * state.scale) / 2; draw();
  }
  function zoomAt(cx, cy, k) {
    const ns = clamp(state.scale * k, 0.05, 32), wx = (cx - state.ox) / state.scale, wy = (cy - state.oy) / state.scale;
    state.scale = ns; state.ox = cx - wx * ns; state.oy = cy - wy * ns; draw();
  }

  /* ---------- drawing the view ---------- */
  function draw() { if (closed || rafId) return; rafId = requestAnimationFrame(() => { rafId = 0; paintView(); }); }
  let checkerPat = null;
  const checker = (g) => { if (!checkerPat) { const c = mk(20, 20), cg = c.getContext('2d'); cg.fillStyle = '#e9ecf2'; cg.fillRect(0, 0, 20, 20); cg.fillStyle = '#bfc3cc'; cg.fillRect(0, 0, 10, 10); cg.fillRect(10, 10, 10, 10); checkerPat = g.createPattern(c, 'repeat'); } return checkerPat; };
  function paintView() {
    if (closed) return;
    const r = rectOfView(), dpr = Math.min(2, window.devicePixelRatio || 1), cw = Math.max(1, Math.round(r.width * dpr)), chh = Math.max(1, Math.round(r.height * dpr));
    if (stageCv.width !== cw || stageCv.height !== chh) { stageCv.width = cw; stageCv.height = chh; }
    const vg = stageCv.getContext('2d'); vg.setTransform(1, 0, 0, 1, 0, 0); vg.clearRect(0, 0, cw, chh);
    vg.setTransform(dpr, 0, 0, dpr, 0, 0);
    const x = state.ox, y = state.oy, w = W * state.scale, hh = H * state.scale;
    vg.save(); vg.beginPath(); vg.rect(x, y, w, hh); vg.clip();           // transparent squares
    vg.fillStyle = checker(vg); vg.save(); vg.translate(x, y); vg.fillRect(0, 0, w, hh); vg.restore();
    vg.imageSmoothingEnabled = state.scale < 6; vg.imageSmoothingQuality = stroke || pinch ? 'low' : 'high';          // quick while you paint, crisp when you stop
    vg.drawImage(preview || D, x, y, w, hh);
    if (state.selViz) { vg.imageSmoothingEnabled = false; vg.drawImage(state.selViz, x, y, w, hh); }
    if (ghostSel) { vg.strokeStyle = '#fff'; vg.lineWidth = 1.5; vg.setLineDash([5, 4]); vg.beginPath(); ghostSel(vg, state.scale, x, y); vg.stroke(); vg.strokeStyle = '#000'; vg.lineDashOffset = 5; vg.beginPath(); ghostSel(vg, state.scale, x, y); vg.stroke(); vg.setLineDash([]); vg.lineDashOffset = 0; }
    if (state.cloneSrc && state.tool === 'clone') { const sx = x + state.cloneSrc.x * state.scale, sy = y + state.cloneSrc.y * state.scale; vg.strokeStyle = '#ff3b3b'; vg.lineWidth = 2; vg.beginPath(); vg.arc(sx, sy, 7, 0, Math.PI * 2); vg.moveTo(sx - 11, sy); vg.lineTo(sx + 11, sy); vg.moveTo(sx, sy - 11); vg.lineTo(sx, sy + 11); vg.stroke(); }
    vg.restore();
    vg.strokeStyle = 'rgba(0,0,0,.35)'; vg.lineWidth = 1; vg.strokeRect(x - 0.5, y - 0.5, w + 1, hh + 1);
    zoomLabel.textContent = `${Math.round(state.scale * 100)}%`;
  }

  /* ---------- brush engine ---------- */
  const style = () => STYLES.find((s) => s.id === state.style) || STYLES[0];
  const grain = (() => { const c = mk(96, 96), g = c.getContext('2d'), im = g.createImageData(96, 96); for (let i = 0; i < im.data.length; i += 4) { const v = Math.random(); im.data[i] = im.data[i + 1] = im.data[i + 2] = 255; im.data[i + 3] = v > 0.42 ? 255 : v > 0.3 ? 120 : 0; } g.putImageData(im, 0, 0); return c; })();
  const colourOf = () => (state.tool === 'brush' && style().force ? style().force : state.fg);
  /** one stamp of the brush at (x, y); size in picture pixels, p = pressure 0..1, speed 0..1 */
  function dab(g, x, y, size, p, speed) {
    const st = style(), col = colourOf(), flow = st.flow * (st.id === 'ink' ? 1 : 1), r = Math.max(0.5, size / 2);
    g.save();
    if (st.round || state.tool === 'eraser') {
      const hard = clamp(state.hard / 100, 0, 1), eff = state.tool === 'eraser' ? hard : (st.id === 'air' ? Math.min(hard, 0.15) : st.id === 'hard' ? 1 : st.id === 'soft' ? hard : Math.min(0.5, hard));
      const gr = g.createRadialGradient(x, y, r * eff * 0.98, x, y, r);
      const a = (state.tool === 'eraser' ? 1 : flow) * (st.id === 'air' || st.hard === 0 ? 1 : 1);
      gr.addColorStop(0, rgba(col, a)); gr.addColorStop(1, rgba(col, 0)); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    } else if (st.id === 'pencil') {
      g.fillStyle = rgba(col, 0.55 + Math.random() * 0.4); g.beginPath(); g.arc(x + (Math.random() - 0.5) * 0.7, y + (Math.random() - 0.5) * 0.7, Math.max(0.6, r * 0.45), 0, Math.PI * 2); g.fill();
    } else if (st.id === 'ink') {
      const k = clamp(0.3 + 0.7 * (1 - speed) * (0.4 + 0.6 * p), 0.18, 1); g.fillStyle = rgba(col, 1); g.beginPath(); g.arc(x, y, Math.max(0.5, r * k), 0, Math.PI * 2); g.fill();
    } else if (st.id === 'marker') {
      g.translate(x, y); g.rotate(-Math.PI / 4); g.fillStyle = rgba(col, 1); g.fillRect(-r, -r * 0.3, r * 2, r * 0.6);
    } else if (st.id === 'water') {
      const rr = r * (0.85 + Math.random() * 0.3), gr = g.createRadialGradient(x, y, rr * 0.35, x, y, rr);
      gr.addColorStop(0, rgba(col, flow)); gr.addColorStop(0.85, rgba(col, flow * 0.85)); gr.addColorStop(1, rgba(col, 0)); g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill();
    } else if (st.id === 'chalk') {
      const t = mk(Math.ceil(r * 2), Math.ceil(r * 2)), tg = t.getContext('2d'), ox = Math.floor(Math.random() * 40), oy = Math.floor(Math.random() * 40);
      tg.fillStyle = rgba(col, 1); tg.fillRect(0, 0, t.width, t.height); tg.globalCompositeOperation = 'destination-in'; tg.drawImage(grain, ox, oy, 56, 56, 0, 0, t.width, t.height);
      tg.globalCompositeOperation = 'destination-in'; const gr = tg.createRadialGradient(r, r, r * 0.6, r, r, r); gr.addColorStop(0, '#fff'); gr.addColorStop(1, 'rgba(255,255,255,0)'); tg.fillStyle = gr; tg.fillRect(0, 0, t.width, t.height);
      g.drawImage(t, x - r, y - r);
    } else if (st.id === 'spray') {
      g.fillStyle = rgba(col, 1); const n = Math.max(6, Math.round(r * 0.9));
      for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r, s = Math.max(0.6, Math.random() * Math.max(1, r * 0.09)); g.beginPath(); g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, s, 0, Math.PI * 2); g.fill(); }
    } else if (st.id === 'hatch') {
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.clip(); g.strokeStyle = rgba(col, 0.9); g.lineWidth = Math.max(1, r * 0.06); g.lineCap = 'round';
      const gap = Math.max(3, r * 0.22); g.beginPath(); for (let k = -r * 2; k < r * 2; k += gap) { g.moveTo(x + k - r, y + r); g.lineTo(x + k + r, y - r); } g.stroke();
    }
    g.restore();
  }
  /** join the finished stroke (stroke canvas S) to the picture, through the selection, with the opacity and the "keep transparent" rule */
  const scratch = mk(W, H), scratchG = scratch.getContext('2d'), previewCv = mk(W, H), previewG = previewCv.getContext('2d');          // reused for every move of a stroke
  /** only the part of the picture the stroke touched (box) is worked on, so a long stroke stays quick on a big picture */
  function compose(target, strokeCv, opacity, tool, box = { x: 0, y: 0, w: W, h: H }) {
    const st = style(), g = target.getContext('2d'), tmp = scratch, tg = scratchG, { x, y, w, h: bh } = box;
    if (w < 1 || bh < 1) return;
    tg.globalCompositeOperation = 'source-over'; tg.clearRect(x, y, w, bh); tg.drawImage(strokeCv, x, y, w, bh, x, y, w, bh);
    if (state.sel) { const m = maskToCanvas(); tg.globalCompositeOperation = 'destination-in'; tg.drawImage(m, x, y, w, bh, x, y, w, bh); tg.globalCompositeOperation = 'source-over'; }
    g.save(); g.globalAlpha = opacity;
    if (tool === 'eraser') g.globalCompositeOperation = 'destination-out';
    else if (st.blend && tool === 'brush') { tg.globalCompositeOperation = 'destination-in'; tg.drawImage(D, x, y, w, bh, x, y, w, bh); g.globalCompositeOperation = st.blend; }
    else if (state.lock) g.globalCompositeOperation = 'source-atop';
    g.drawImage(tmp, x, y, w, bh, x, y, w, bh); g.restore();
  }
  let maskCache = null;
  function maskToCanvas() {
    if (maskCache?.mask === state.sel) return maskCache.cv;
    const c = mk(W, H), g = c.getContext('2d'), im = g.createImageData(W, H);
    for (let p = 0; p < W * H; p++) { im.data[p * 4 + 3] = state.sel[p]; im.data[p * 4] = im.data[p * 4 + 1] = im.data[p * 4 + 2] = 255; }
    g.putImageData(im, 0, 0); maskCache = { mask: state.sel, cv: c }; return c;
  }
  function refreshPreview() {
    if (!stroke) return;
    if (stroke.direct) { preview = null; draw(); return; }
    const pv = previewCv, pg = previewG, box = stroke.box || { x: 0, y: 0, w: W, h: H };
    if (!stroke.pvInit) { pg.globalCompositeOperation = 'source-over'; pg.clearRect(0, 0, W, H); pg.drawImage(D, 0, 0); stroke.pvInit = true; }
    pg.globalCompositeOperation = 'source-over'; pg.clearRect(box.x, box.y, box.w, box.h); pg.drawImage(D, box.x, box.y, box.w, box.h, box.x, box.y, box.w, box.h);
    compose(pv, S, state.tool === 'eraser' ? 1 : state.opacity / 100, state.tool === 'gradient' ? 'gradient' : state.tool, box);
    preview = pv; draw();
  }
  const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function stamp(pos, p, speed) {
    const st = style(), size = state.size * (state.tool === 'brush' && st.id === 'pencil' ? 0.6 : 1) * (0.55 + 0.45 * p * 1);
    if (state.tool === 'smudge' || state.tool === 'blur' || state.tool === 'clone') { directDab(pos, size); return; }
    dab(sg, pos.x, pos.y, size, p, speed); growBox(pos, size);
  }
  function growBox(pos, size) {
    const r = Math.ceil(size / 2 + 3), x0 = clamp(Math.floor(pos.x - r), 0, W), y0 = clamp(Math.floor(pos.y - r), 0, H), x1 = clamp(Math.ceil(pos.x + r), 0, W), y1 = clamp(Math.ceil(pos.y + r), 0, H), b = stroke.box;
    stroke.box = b ? { x: Math.min(b.x, x0), y: Math.min(b.y, y0), w: Math.max(b.x + b.w, x1) - Math.min(b.x, x0), h: Math.max(b.y + b.h, y1) - Math.min(b.y, y0) } : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  const radialMask = (d, soft = 0.2) => { const c = mk(d, d), g = c.getContext('2d'), r = d / 2, gr = g.createRadialGradient(r, r, r * soft, r, r, r); gr.addColorStop(0, '#fff'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, d, d); return c; };
  /** smudge / blur / clone change the picture directly, dab by dab (the selection still limits them) */
  function directDab(pos, size) {
    const d = Math.max(4, Math.round(size)), x0 = Math.round(pos.x - d / 2), y0 = Math.round(pos.y - d / 2), strength = clamp(state.opacity / 100, 0.05, 1);
    const bx = clamp(x0, 0, W), by = clamp(y0, 0, H), bw = Math.min(W, x0 + d) - bx, bh = Math.min(H, y0 + d) - by; if (bw < 1 || bh < 1) return;
    const before = state.sel ? dg.getImageData(bx, by, bw, bh) : null, mask = radialMask(d, clamp(state.hard / 100, 0, 0.9) * 0.8), t = mk(d, d), tg = t.getContext('2d');
    if (state.tool === 'smudge') {
      if (!stroke.carry) { stroke.carry = mk(d, d); stroke.carry.getContext('2d').drawImage(D, x0, y0, d, d, 0, 0, d, d); return; }
      tg.drawImage(stroke.carry, 0, 0, stroke.carry.width, stroke.carry.height, 0, 0, d, d); tg.globalCompositeOperation = 'destination-in'; tg.drawImage(mask, 0, 0);
      dg.save(); dg.globalAlpha = strength * 0.85; dg.drawImage(t, x0, y0); dg.restore();
      const c2 = stroke.carry.getContext('2d'); c2.save(); c2.globalAlpha = 0.45; c2.drawImage(D, x0, y0, d, d, 0, 0, stroke.carry.width, stroke.carry.height); c2.restore();
    } else if (state.tool === 'blur') {
      const im = dg.getImageData(bx, by, bw, bh), out = blurRGBA(im.data, bw, bh, Math.max(1, Math.round(d / 9))), t2 = mk(bw, bh), t2g = t2.getContext('2d'); t2g.putImageData(new ImageData(out, bw, bh), 0, 0);
      tg.drawImage(t2, bx - x0, by - y0); tg.globalCompositeOperation = 'destination-in'; tg.drawImage(mask, 0, 0);
      dg.save(); dg.globalAlpha = strength; dg.drawImage(t, x0, y0); dg.restore();
    } else if (state.tool === 'clone') {
      if (!state.cloneOff) return;
      const sx = Math.round(pos.x - state.cloneOff.x - d / 2), sy = Math.round(pos.y - state.cloneOff.y - d / 2);
      tg.drawImage(stroke.base, sx, sy, d, d, 0, 0, d, d); tg.globalCompositeOperation = 'destination-in'; tg.drawImage(mask, 0, 0);
      dg.save(); dg.globalAlpha = strength; dg.drawImage(t, x0, y0); dg.restore();
    }
    if (before && state.sel) {                          // outside the selection the picture stays as it was
      const after = dg.getImageData(bx, by, bw, bh);
      for (let yy = 0; yy < bh; yy++) for (let xx = 0; xx < bw; xx++) {
        const m = state.sel[(by + yy) * W + bx + xx] / 255, i = (yy * bw + xx) * 4;
        if (m < 1) for (let j = 0; j < 4; j++) after.data[i + j] = before.data[i + j] + (after.data[i + j] - before.data[i + j]) * m;
      }
      dg.putImageData(after, bx, by);
    }
  }
  function lineTo(pos, p) {
    const st = style(), last = stroke.last, size = Math.max(1, state.size), step = Math.max(0.7, size * (state.tool === 'brush' ? st.space : 0.12));
    const d = dist2(last, pos), speed = clamp(d / (size * 1.6), 0, 1);
    if (d >= step) { const n = Math.floor(d / step); for (let i = 1; i <= n; i++) { const t = (i * step) / d; stamp({ x: last.x + (pos.x - last.x) * t, y: last.y + (pos.y - last.y) * t }, p, speed); } const t = (n * step) / d; stroke.last = { x: last.x + (pos.x - last.x) * t, y: last.y + (pos.y - last.y) * t }; }
    refreshPreview();
  }

  /* ---------- fills ---------- */
  function bucketAt(pos) {
    const x = Math.floor(pos.x), y = Math.floor(pos.y); if (x < 0 || y < 0 || x >= W || y >= H) return;
    pushUndo();
    const im = dg.getImageData(0, 0, W, H);
    let m = floodMask(im.data, W, H, x, y, state.tol, state.contiguous);
    if (state.smoothWand) m = growMask(m, W, H, 1);
    if (state.sel) m = combineMask(state.sel, m, 'intersect');
    fillMask(im.data, m, state.fg, state.opacity / 100, state.bucketLock);
    dg.putImageData(im, 0, 0); addRecent(); draw();
  }
  function fillSelection() { pushUndo(); const im = dg.getImageData(0, 0, W, H); fillMask(im.data, state.sel, state.fg, state.opacity / 100, state.lock); dg.putImageData(im, 0, 0); addRecent(); draw(); }
  function clearSelection() { pushUndo(); const im = dg.getImageData(0, 0, W, H); clearMask(im.data, state.sel); dg.putImageData(im, 0, 0); draw(); }
  function addRecent() { const hex = rgbToHex(state.fg); state.recent = [hex, ...state.recent.filter((c) => c !== hex)].slice(0, 12); renderColours(); }
  function gradientPaint(a, b) {
    sg.clearRect(0, 0, W, H);
    const g = state.gradKind === 'radial' ? sg.createRadialGradient(a.x, a.y, 0, a.x, a.y, Math.max(1, dist2(a, b))) : sg.createLinearGradient(a.x, a.y, b.x, b.y);
    g.addColorStop(0, rgba(state.fg, 1)); g.addColorStop(1, state.gradEnd === 'bg' ? rgba(state.bg, 1) : rgba(state.fg, 0));
    sg.fillStyle = g; sg.fillRect(0, 0, W, H); refreshPreview();
  }

  /* ---------- adjustments (on the selection, or the whole picture) ---------- */
  function applyFilter(fn, label) {
    pushUndo(); const im = dg.getImageData(0, 0, W, H); fn(im.data, state.sel); dg.putImageData(im, 0, 0); draw(); flash(label);
  }
  const adj = { bright: 0, contrast: 0, hue: 0, sat: 0, light: 0, blur: 3, sharp: 60, shSize: 16, shStr: 55 };

  /* ---------- pointer handling ---------- */
  function onDown(e) {
    if (e.target !== stageCv) return;
    try { stageCv.setPointerCapture?.(e.pointerId); } catch { /* a pointer that is already gone */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    if (pointers.size === 2) { cancelStroke(); const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, scale: state.scale, ox: state.ox, oy: state.oy }; return; }
    if (pointers.size > 2) return;
    e.preventDefault();
    const pos = toDoc(e), tool = e.button === 1 || state.space ? 'hand' : state.tool;
    if (tool === 'hand') { stroke = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: state.ox, oy: state.oy }; return; }
    if (tool === 'dropper' || (e.altKey && (tool === 'brush' || tool === 'bucket') )) { pick(pos); return; }
    if (tool === 'bucket') { bucketAt(pos); return; }
    if (tool === 'wand') { wandAt(pos, e); return; }
    if (tool === 'rect' || tool === 'ellipse' || tool === 'lasso') { stroke = { kind: 'select', tool, a: pos, pts: [pos], mode: e.shiftKey ? 'add' : e.altKey ? 'subtract' : state.mode }; return; }
    if (tool === 'move') { startMove(pos); return; }
    if (tool === 'clone' && (e.altKey || state.armClone)) { state.cloneSrc = pos; state.armClone = false; state.cloneOff = null; syncOptions(); draw(); return; }
    if (tool === 'clone' && !state.cloneSrc) { flash('Tap "Set source" first (or Alt + click), then paint.'); return; }
    if (tool === 'gradient') { pushUndo(); stroke = { kind: 'gradient', a: pos }; gradientPaint(pos, pos); return; }
    // brush, eraser, smudge, blur, clone
    pushUndo();
    if (tool === 'clone') state.cloneOff = { x: pos.x - state.cloneSrc.x, y: pos.y - state.cloneSrc.y };
    const direct = tool === 'smudge' || tool === 'blur' || tool === 'clone';
    sg.clearRect(0, 0, W, H);
    stroke = { kind: 'paint', direct, last: pos, base: direct && tool === 'clone' ? copyD() : null, carry: null };
    const p = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 1;
    stamp(pos, p, 0); refreshPreview();
  }
  const copyD = () => { const c = mk(W, H); c.getContext('2d').drawImage(D, 0, 0); return c; };
  function onMove(e) {
    updateCursor(e);
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, r = rectOfView();
      const ns = clamp(pinch.scale * d / Math.max(1, pinch.d), 0.05, 32), cx = pinch.mx - r.left, cy = pinch.my - r.top, wx = (cx - pinch.ox) / pinch.scale, wy = (cy - pinch.oy) / pinch.scale;
      state.scale = ns; state.ox = (mx - r.left) - wx * ns; state.oy = (my - r.top) - wy * ns; draw(); return;
    }
    if (!stroke) return;
    e.preventDefault();
    const pos = toDoc(e);
    if (stroke.kind === 'pan') { state.ox = stroke.ox + e.clientX - stroke.sx; state.oy = stroke.oy + e.clientY - stroke.sy; draw(); }
    else if (stroke.kind === 'paint') { const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]; for (const ce of (evs.length ? evs : [e])) lineTo(toDoc(ce), ce.pointerType === 'pen' && ce.pressure > 0 ? ce.pressure : 1); }
    else if (stroke.kind === 'gradient') gradientPaint(stroke.a, pos);
    else if (stroke.kind === 'select') { stroke.b = pos; if (stroke.tool === 'lasso') stroke.pts.push(pos); selectGhost(); }
    else if (stroke.kind === 'move') moveTo(pos);
  }
  function onUp(e) {
    pointers.delete(e.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; return; }
    if (!stroke) return;
    const s = stroke; stroke = null;
    if (s.kind === 'paint') { if (!s.direct) { compose(D, S, state.tool === 'eraser' ? 1 : state.opacity / 100, state.tool, s.box); if (state.tool === 'brush') addRecent(); } preview = null; if (s.box) sg.clearRect(s.box.x, s.box.y, s.box.w, s.box.h); else sg.clearRect(0, 0, W, H); draw(); }
    else if (s.kind === 'gradient') { compose(D, S, state.opacity / 100, 'gradient'); preview = null; sg.clearRect(0, 0, W, H); addRecent(); draw(); }
    else if (s.kind === 'select') finishSelect(s);
    else if (s.kind === 'move') finishMove(s);
  }
  function cancelStroke() { if (stroke?.kind === 'paint' || stroke?.kind === 'gradient') { preview = null; sg.clearRect(0, 0, W, H); if (state.undo.length) restore(state.undo.pop()); } if (stroke?.kind === 'move') { restore(stroke.snapshot); } stroke = null; ghostSel = null; draw(); }
  function selectGhost() {
    const s = stroke; if (!s?.b) return;
    ghostSel = (g, sc, ox, oy) => {
      const X = (v) => ox + v.x * sc, Y = (v) => oy + v.y * sc;
      if (s.tool === 'rect') g.rect(Math.min(X(s.a), X(s.b)), Math.min(Y(s.a), Y(s.b)), Math.abs(X(s.b) - X(s.a)), Math.abs(Y(s.b) - Y(s.a)));
      else if (s.tool === 'ellipse') g.ellipse((X(s.a) + X(s.b)) / 2, (Y(s.a) + Y(s.b)) / 2, Math.abs(X(s.b) - X(s.a)) / 2, Math.abs(Y(s.b) - Y(s.a)) / 2, 0, 0, Math.PI * 2);
      else { s.pts.forEach((q, i) => (i ? g.lineTo(X(q), Y(q)) : g.moveTo(X(q), Y(q)))); g.closePath(); }
    };
    draw();
  }
  function finishSelect(s) {
    ghostSel = null;
    if (!s.b) { if (s.mode === 'replace') setSel(null); else draw(); return; }
    let m;
    if (s.tool === 'rect') { const x = Math.min(s.a.x, s.b.x), y = Math.min(s.a.y, s.b.y); m = pathMask((g) => g.rect(x, y, Math.abs(s.b.x - s.a.x), Math.abs(s.b.y - s.a.y))); }
    else if (s.tool === 'ellipse') m = pathMask((g) => g.ellipse((s.a.x + s.b.x) / 2, (s.a.y + s.b.y) / 2, Math.max(0.5, Math.abs(s.b.x - s.a.x) / 2), Math.max(0.5, Math.abs(s.b.y - s.a.y) / 2), 0, 0, Math.PI * 2));
    else { if (s.pts.length < 3) { draw(); return; } m = pathMask((g) => { s.pts.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.closePath(); }); }
    withSel(m, s.mode);
  }
  function wandAt(pos, e) {
    const im = dg.getImageData(0, 0, W, H), m = floodMask(im.data, W, H, pos.x, pos.y, state.tol, state.contiguous);
    withSel(state.smoothWand ? blurMask(m, W, H, 1) : m, e.shiftKey ? 'add' : e.altKey ? 'subtract' : state.mode);
  }
  function pick(pos) {
    const x = Math.floor(pos.x), y = Math.floor(pos.y); if (x < 0 || y < 0 || x >= W || y >= H) return;
    const d = dg.getImageData(x, y, 1, 1).data; if (d[3] < 10) { flash('That spot is empty.'); return; }
    setColour('fg', [d[0], d[1], d[2]]); renderColours(); flash(`Colour ${rgbToHex(state.fg)}`);
  }
  function startMove(pos) {
    pushUndo(); const snapshot = state.undo[state.undo.length - 1];
    const im = dg.getImageData(0, 0, W, H), lift = new Uint8ClampedArray(im.data.length);
    for (let p = 0; p < W * H; p++) { const m = state.sel ? state.sel[p] / 255 : 1; if (!m) continue; const i = p * 4; lift[i] = im.data[i]; lift[i + 1] = im.data[i + 1]; lift[i + 2] = im.data[i + 2]; lift[i + 3] = im.data[i + 3] * m; im.data[i + 3] = Math.round(im.data[i + 3] * (1 - m)); }
    const hole = mk(W, H), fl = mk(W, H); hole.getContext('2d').putImageData(im, 0, 0); fl.getContext('2d').putImageData(new ImageData(lift, W, H), 0, 0);
    stroke = { kind: 'move', a: pos, hole, fl, dx: 0, dy: 0, snapshot: { img: snapshot.img, sel: snapshot.sel } };
  }
  function moveTo(pos) {
    const s = stroke; s.dx = Math.round(pos.x - s.a.x); s.dy = Math.round(pos.y - s.a.y);
    const pv = mk(W, H), g = pv.getContext('2d'); g.drawImage(s.hole, 0, 0); g.drawImage(s.fl, s.dx, s.dy); preview = pv; draw();
  }
  function finishMove(s) {
    dg.clearRect(0, 0, W, H); dg.drawImage(s.hole, 0, 0); dg.drawImage(s.fl, s.dx, s.dy); preview = null;
    if (state.sel && (s.dx || s.dy)) { const m = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const nx = x + s.dx, ny = y + s.dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H) m[ny * W + nx] = state.sel[y * W + x]; } setSel(m); }
    draw();
  }

  /* ---------- interface ---------- */
  const flashEl = h('div', { class: 'pe-flash', role: 'status', 'aria-live': 'polite' });
  let flashT = 0;
  function flash(text) { flashEl.textContent = text; flashEl.classList.add('on'); clearTimeout(flashT); flashT = setTimeout(() => flashEl.classList.remove('on'), 2200); }
  const stageCv = h('canvas', { class: 'pe-canvas', 'aria-label': 'Picture' });
  const cursor = h('div', { class: 'pe-cursor' });
  const vp = h('div', { class: 'pe-view' }, stageCv, cursor);
  const zoomLabel = h('span', { class: 'pe-zoom' }, '100%');
  const btn = (label, onclick, { title, cls = '', ico } = {}) => h('button', { type: 'button', class: `pe-btn ${cls}`, title: title || label, onclick }, ico ? (typeof ico === 'string' ? ic(ico) : ico) : null, label ? h('span', {}, label) : null);
  const undoBtn = btn('', undo, { title: 'Undo (Ctrl+Z)', ico: 'undo', cls: 'ib' }), redoBtn = btn('', redo, { title: 'Redo (Ctrl+Shift+Z)', ico: 'redo', cls: 'ib' });
  function syncButtons() { undoBtn.disabled = !state.undo.length; redoBtn.disabled = !state.redo.length; selButtons?.forEach((b) => { b.disabled = !state.sel; }); }
  const toolBar = h('div', { class: 'pe-tools', role: 'toolbar', 'aria-label': 'Tools' });
  function renderTools() {
    toolBar.replaceChildren(...TOOLS.map(([id, label, ico]) => h('button', { type: 'button', class: `pe-tool${state.tool === id ? ' on' : ''}`, 'data-tool': id, title: label, 'aria-label': label, 'aria-pressed': String(state.tool === id), onclick: () => setTool(id) }, ic(ico), h('small', {}, label.replace(' select', '').replace('Rectangle', 'Rect.').replace('Freehand', 'Free').replace('Pick colour', 'Pick').replace('Move pixels', 'Move').replace('Move view', 'Pan')))));
  }
  function setTool(id) { state.tool = id; if (id === 'eraser' || id === 'smudge' || id === 'blur' || id === 'clone') state.panel = 'brush'; renderTools(); syncOptions(); updateCursor(); }
  const optBar = h('div', { class: 'pe-opts' });
  const slider = (label, key, min, max, step = 1, fmt = (v) => v, on) => { const out = h('b', {}, fmt(state[key] ?? adj[key])); return h('label', { class: 'pe-s' }, h('span', {}, label), h('input', { type: 'range', min, max, step, value: state[key] ?? adj[key], 'data-k': key, oninput: (ev) => { const v = +ev.target.value; if (key in state) state[key] = v; else adj[key] = v; out.textContent = fmt(v); on?.(v); updateCursor(); } }), out); };
  const check = (label, key, on, title) => h('label', { class: 'pe-ck', title: title || label }, h('input', { type: 'checkbox', checked: !!state[key], onchange: (ev) => { state[key] = ev.target.checked; on?.(); } }), h('span', {}, label));
  const seg = (items, key, on) => h('div', { class: 'pe-seg', role: 'group' }, items.map(([v, label, title]) => h('button', { type: 'button', class: state[key] === v ? 'on' : '', title: title || label, onclick: (ev) => { state[key] = v; on?.(); ev.currentTarget.parentNode.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === ev.currentTarget)); } }, label)));
  const sizeSlider = () => slider('Size', 'size', 1, 240, 1, (v) => `${v}px`), opacitySlider = () => slider('Opacity', 'opacity', 1, 100, 1, (v) => `${v}%`), hardSlider = () => slider('Softness', 'hard', 0, 100, 1, (v) => (v >= 85 ? 'Hard' : v <= 15 ? 'Soft' : `${100 - v}%`));
  function syncOptions() {
    const t = state.tool, st = style(), items = [];
    if (t === 'brush') { items.push(h('span', { class: 'pe-name' }, st.name)); if (!st.force) items.push(colourButton('fg')); items.push(sizeSlider(), opacitySlider()); if (st.round && !st.force) items.push(hardSlider()); if (st.lock !== true) items.push(check('Keep transparent areas', 'lock', null, 'Paint only where the picture already has pixels, so nothing spills outside the part')); items.push(h('small', { class: 'pe-hint' }, st.hint)); }
    else if (t === 'eraser') items.push(h('span', { class: 'pe-name' }, 'Eraser'), sizeSlider(), hardSlider());
    else if (t === 'smudge') items.push(h('span', { class: 'pe-name' }, 'Smudge'), sizeSlider(), slider('Strength', 'opacity', 5, 100, 1, (v) => `${v}%`), hardSlider(), h('small', { class: 'pe-hint' }, 'Drag to push the colours around.'));
    else if (t === 'blur') items.push(h('span', { class: 'pe-name' }, 'Blur'), sizeSlider(), slider('Strength', 'opacity', 5, 100, 1, (v) => `${v}%`), hardSlider(), h('small', { class: 'pe-hint' }, 'Paint over rough spots to soften them.'));
    else if (t === 'clone') items.push(h('span', { class: 'pe-name' }, 'Clone'), sizeSlider(), opacitySlider(), hardSlider(), btn('Set source', () => { state.armClone = true; flash('Now tap the spot to copy from.'); }, { title: 'Then tap the part of the picture to copy from (on a computer: Alt + click)' }), h('small', { class: 'pe-hint' }, state.cloneSrc ? 'Source set (red cross). Paint to copy from it.' : 'Choose a source first, then paint to copy it somewhere else.'));
    else if (t === 'bucket') items.push(h('span', { class: 'pe-name' }, 'Fill'), colourButton('fg'), slider('Tolerance', 'tol', 0, 100, 1, (v) => `${v}`), opacitySlider(), check('Only joined area', 'contiguous'), check('Keep transparent areas', 'bucketLock', null, 'Fill only where the picture has pixels'), check('Smooth edge', 'smoothWand'), h('small', { class: 'pe-hint' }, 'Tap an area to fill it with the front colour.'));
    else if (t === 'gradient') items.push(h('span', { class: 'pe-name' }, 'Gradient'), colourButton('fg'), colourButton('bg'), seg([['linear', 'Line'], ['radial', 'Round']], 'gradKind'), seg([['fade', 'Colour to clear'], ['bg', 'Colour to back colour']], 'gradEnd'), opacitySlider(), check('Keep transparent areas', 'lock'), h('small', { class: 'pe-hint' }, 'Drag across the picture. Use it with a selection for soft shading.'));
    else if (t === 'dropper') items.push(h('span', { class: 'pe-name' }, 'Pick colour'), h('small', { class: 'pe-hint' }, 'Tap the picture to take its colour. With any brush: Alt + click.'));
    else if (t === 'rect' || t === 'ellipse' || t === 'lasso') items.push(h('span', { class: 'pe-name' }, t === 'rect' ? 'Rectangle select' : t === 'ellipse' ? 'Ellipse select' : 'Freehand select'), selectModes(), slider('Soft edge', 'feather', 0, 40, 1, (v) => `${v}px`));
    else if (t === 'wand') items.push(h('span', { class: 'pe-name' }, 'Magic select'), selectModes(), slider('Tolerance', 'tol', 0, 100, 1, (v) => `${v}`), check('Only joined area', 'contiguous'), check('Smooth edge', 'smoothWand'), h('small', { class: 'pe-hint' }, 'Tap a colour to select all of it.'));
    else if (t === 'move') items.push(h('span', { class: 'pe-name' }, 'Move pixels'), h('small', { class: 'pe-hint' }, state.sel ? 'Drag to move the selected part.' : 'No selection: drag to move the whole picture.'));
    else items.push(h('span', { class: 'pe-name' }, 'Move view'), h('small', { class: 'pe-hint' }, 'Drag to move the picture around. Two fingers or the wheel zoom.'));
    optBar.replaceChildren(...items.filter(Boolean)); refreshSwatches();
  }
  const selectModes = () => seg([['replace', 'New'], ['add', 'Add'], ['subtract', 'Take away'], ['intersect', 'Overlap']], 'mode');

  /* right side: colours, brush list, selection, adjust */
  const colourBox = h('div', { class: 'pe-colours' });
  /* ---------- colours: swatches, "my colours" (kept on this device) and a full colour picker (square, hue, R G B, hex, eyedropper) ---------- */
  let mine = []; try { mine = JSON.parse(localStorage.getItem('12toons-pe-colours') || '[]').filter((c) => parseHex(c)).slice(0, 30); } catch { mine = []; }
  const saveMine = () => { try { localStorage.setItem('12toons-pe-colours', JSON.stringify(mine)); } catch { /* storage may be blocked: the colours just stay for this session */ } };
  function refreshSwatches() { for (const el of root.querySelectorAll('.pe-fgsw')) el.style.background = rgbToHex(state.fg); for (const el of root.querySelectorAll('.pe-bgsw')) el.style.background = rgbToHex(state.bg); }
  function setColour(which, rgb) { state[which] = rgb; refreshSwatches(); }
  /** the button that opens the colour picker; it shows the current front colour. Put it wherever a tool uses a colour. */
  const colourButton = (which = 'fg') => h('button', { type: 'button', class: 'pe-cbtn', title: 'Open the colour picker: mix any colour you like', 'aria-label': 'Custom colour', onclick: (ev) => openPicker(ev.currentTarget, which) }, h('i', { class: which === 'fg' ? 'pe-fgsw' : 'pe-bgsw', style: `background:${rgbToHex(state[which])}` }), h('span', {}, 'Custom colour'));
  let picker = null;
  function closePicker() { if (!picker) return; picker.el.remove(); document.removeEventListener('pointerdown', picker.out, true); picker = null; }
  function openPicker(anchor, startWhich = 'fg') {
    closePicker();
    let which = startWhich; const old = { fg: state.fg.slice(), bg: state.bg.slice() };
    let [hh, sat, val] = rgb2hsv(...state[which]);
    const SW = 232, SH = 150, sv = mk(SW, SH), svg2 = sv.getContext('2d'), svBox = h('div', { class: 'pe-sv' }, sv), knob = h('i', { class: 'pe-svk' });
    svBox.append(knob);
    const hueIn = h('input', { type: 'range', min: 0, max: 360, step: 1, class: 'pe-hue', 'aria-label': 'Hue' });
    const chan = {}, num = {};
    const mkChan = (k, label) => { const r = h('input', { type: 'range', min: 0, max: 255, step: 1, 'aria-label': label }), n = h('input', { type: 'number', min: 0, max: 255, step: 1, 'aria-label': `${label} number` }); chan[k] = r; num[k] = n; return h('label', { class: 'pe-ch' }, h('b', {}, k.toUpperCase()), r, n); };
    const chRows = [mkChan('r', 'Red'), mkChan('g', 'Green'), mkChan('b', 'Blue')];
    const hex = h('input', { type: 'text', class: 'pe-hex', maxlength: 7, spellcheck: 'false', 'aria-label': 'Colour code' });
    const now = h('i', { class: 'pe-now' }), was = h('i', { class: 'pe-was', title: 'The colour you had. Tap to go back to it.' });
    const whichBar = h('div', { class: 'pe-seg' }, [['fg', 'Front colour'], ['bg', 'Back colour']].map(([k, label]) => h('button', { type: 'button', 'data-w': k, class: which === k ? 'on' : '', onclick: () => { which = k; [hh, sat, val] = rgb2hsv(...state[k]); was.style.background = rgbToHex(old[k]); whichBar.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.w === k)); paint(true); } }, label)));
    const mineRow = h('div', { class: 'pe-swatches' });
    function paintSV() {
      const g1 = svg2.createLinearGradient(0, 0, SW, 0); g1.addColorStop(0, '#fff'); g1.addColorStop(1, rgbToHex(hsv2rgb(hh, 1, 1))); svg2.fillStyle = g1; svg2.fillRect(0, 0, SW, SH);
      const g2 = svg2.createLinearGradient(0, 0, 0, SH); g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(1, '#000'); svg2.fillStyle = g2; svg2.fillRect(0, 0, SW, SH);
    }
    function paint(redrawSV = false) {
      const rgb = hsv2rgb(hh, sat, val); setColour(which, rgb);
      if (redrawSV) paintSV();
      knob.style.left = `${sat * SW}px`; knob.style.top = `${(1 - val) * SH}px`; hueIn.value = hh; hueIn.style.setProperty('--hue', rgbToHex(hsv2rgb(hh, 1, 1)));
      ['r', 'g', 'b'].forEach((k, i) => { chan[k].value = rgb[i]; num[k].value = rgb[i]; chan[k].style.background = `linear-gradient(90deg, ${rgbToHex(rgb.map((v, j) => (j === i ? 0 : v)))}, ${rgbToHex(rgb.map((v, j) => (j === i ? 255 : v)))})`; });
      if (document.activeElement !== hex) hex.value = rgbToHex(rgb); now.style.background = rgbToHex(rgb);
    }
    function fromRgb(rgb) { [hh, sat, val] = rgb2hsv(...rgb); if (sat === 0 || val === 0) hh = hueIn.value ? +hueIn.value : hh; paint(true); }
    const pickSV = (e) => { const r = sv.getBoundingClientRect(); sat = clamp((e.clientX - r.left) / r.width, 0, 1); val = 1 - clamp((e.clientY - r.top) / r.height, 0, 1); paint(); };
    let dragging = false;
    svBox.addEventListener('pointerdown', (e) => { dragging = true; svBox.setPointerCapture?.(e.pointerId); pickSV(e); e.preventDefault(); });
    svBox.addEventListener('pointermove', (e) => { if (dragging) pickSV(e); }); svBox.addEventListener('pointerup', () => { dragging = false; }); svBox.addEventListener('pointercancel', () => { dragging = false; });
    hueIn.addEventListener('input', () => { hh = +hueIn.value; paint(true); });
    ['r', 'g', 'b'].forEach((k, i) => {
      const upd = (v) => { const rgb = hsv2rgb(hh, sat, val); rgb[i] = clamp(Math.round(+v || 0), 0, 255); fromRgb(rgb); };
      chan[k].addEventListener('input', () => upd(chan[k].value)); num[k].addEventListener('input', () => upd(num[k].value));
    });
    hex.addEventListener('input', () => { const c = parseHex(hex.value); if (c) fromRgb(c); });
    hex.addEventListener('blur', () => { hex.value = rgbToHex(state[which]); });
    was.addEventListener('click', () => fromRgb(old[which]));
    const eyedrop = window.EyeDropper ? btn('Pick from screen', async () => { try { const r = await new window.EyeDropper().open(); const c = parseHex(r.sRGBHex); if (c) fromRgb(c); } catch { /* cancelled */ } }, { title: 'Take a colour from anywhere on your screen', cls: 'sm' }) : null;
    function renderMine() {
      mineRow.replaceChildren(...[h('small', {}, 'My colours'), ...mine.map((c) => h('button', { type: 'button', class: 'pe-sw', style: `background:${c}`, title: `${c} · tap to use, press and hold or right-click to remove`, 'aria-label': `My colour ${c}`, onclick: () => fromRgb(hexToRgb(c)), oncontextmenu: (ev) => { ev.preventDefault(); mine = mine.filter((x) => x !== c); saveMine(); renderMine(); renderColours(); } })), mine.length ? null : h('small', { class: 'pe-note' }, 'Nothing saved yet')].filter(Boolean));
    }
    const saveBtn = btn('Save to my colours', () => { const c = rgbToHex(state[which]); mine = [c, ...mine.filter((x) => x !== c)].slice(0, 30); saveMine(); renderMine(); renderColours(); flash('Colour saved.'); }, { title: 'Keep this colour in your list on this device', cls: 'sm' });
    const el = h('div', { class: 'pe-pick', role: 'dialog', 'aria-label': 'Colour picker' },
      h('div', { class: 'pe-pick-head' }, h('b', {}, 'Colour picker'), btn('Done', () => { addRecent(); closePicker(); }, { cls: 'sm pri', title: 'Close the colour picker' })),
      whichBar, svBox, h('label', { class: 'pe-huel' }, h('b', {}, 'HUE'), hueIn), ...chRows,
      h('div', { class: 'pe-hexrow' }, h('label', {}, h('b', {}, 'CODE'), hex), was, now), h('div', { class: 'pe-row' }, saveBtn, eyedrop), mineRow);
    root.append(el);
    const a = anchor.getBoundingClientRect(), pw = 270, ph = el.offsetHeight || 460, narrow = window.innerWidth < 820;
    el.style.left = `${narrow ? Math.max(8, (window.innerWidth - pw) / 2) : a.left > pw + 20 ? a.left - pw - 10 : clamp(a.right + 10, 8, window.innerWidth - pw - 8)}px`;          // beside the button, not over the tool options
    el.style.top = `${narrow ? Math.max(8, (window.innerHeight - ph) / 2) : clamp(a.top - 4, 8, Math.max(8, window.innerHeight - ph - 8))}px`;
    was.style.background = rgbToHex(old[which]); renderMine(); paint(true);
    const out = (ev) => { if (!el.contains(ev.target) && !anchor.contains(ev.target)) { addRecent(); closePicker(); } };
    document.addEventListener('pointerdown', out, true); picker = { el, out };
  }
  function renderColours() {
    refreshSwatches();
    const sw = (hex) => h('button', { type: 'button', class: 'pe-sw', style: `background:${hex}`, title: hex, 'aria-label': `Colour ${hex}`, onclick: () => { setColour('fg', hexToRgb(hex)); } });
    colourBox.replaceChildren(...[h('div', { class: 'pe-pair' }, h('button', { type: 'button', class: 'pe-col fg', title: 'Front colour: tap to mix a colour', 'aria-label': 'Front colour', onclick: (ev) => openPicker(ev.currentTarget, 'fg') }, h('i', { class: 'pe-fgsw' })), h('button', { type: 'button', class: 'pe-col bg', title: 'Back colour: tap to mix a colour', 'aria-label': 'Back colour', onclick: (ev) => openPicker(ev.currentTarget, 'bg') }, h('i', { class: 'pe-bgsw' })),
      btn('', () => { [state.fg, state.bg] = [state.bg, state.fg]; refreshSwatches(); }, { title: 'Swap colours (X)', ico: 'swap', cls: 'ib' })),
      colourButton('fg'), h('div', { class: 'pe-swatches' }, SWATCHES.map(sw)),
      mine.length ? h('div', { class: 'pe-swatches' }, h('small', {}, 'My colours'), mine.map(sw)) : null,
      state.recent.length ? h('div', { class: 'pe-swatches recent' }, h('small', {}, 'Recent'), state.recent.map(sw)) : null].filter(Boolean));
    refreshSwatches();
  }
  const brushList = h('div', { class: 'pe-brushes' });
  function renderBrushes() {
    brushList.replaceChildren(...STYLES.map((s) => { const prev = mk(120, 30), g = prev.getContext('2d'); drawPreview(g, s); return h('button', { type: 'button', class: `pe-brush${state.style === s.id ? ' on' : ''}`, title: s.hint, 'data-style': s.id, onclick: () => { state.style = s.id; state.tool = 'brush'; state.hard = s.round ? Math.round((s.hard ?? 0.5) * 100) : state.hard; if (s.flow < 0.5) state.opacity = Math.max(state.opacity, 70); renderTools(); renderBrushes(); syncOptions(); updateCursor(); } }, prev, h('span', {}, s.name)); }));
  }
  function drawPreview(g, s) {
    const keepStyle = state.style, keepTool = state.tool; state.style = s.id; state.tool = 'brush';
    g.fillStyle = '#d9dde6'; g.fillRect(0, 0, 120, 30);
    const oldW = W; void oldW;
    for (let i = 0; i <= 20; i++) { const x = 12 + i * 5, y = 15 + Math.sin(i / 3) * 6; dab(g, x, y, s.id === 'hatch' ? 18 : 10, 1, 0.2); }
    state.style = keepStyle; state.tool = keepTool;
  }
  let selButtons = [];
  const selPanel = () => {
    selButtons = [];
    const sb = (label, fn, ico, title) => { const b = btn(label, fn, { title: title || label, ico }); selButtons.push(b); return b; };
    return h('div', { class: 'pe-group' }, h('h4', {}, 'Selection'),
      h('div', { class: 'pe-row' }, btn('All', () => setSel(new Uint8Array(W * H).fill(255)), { title: 'Select everything (Ctrl+A)' }), (() => { const b = btn('None', () => setSel(null), { title: 'Remove the selection (Ctrl+D)' }); selButtons.push(b); return b; })(), sb('Invert', () => setSel(invertMask(state.sel)), null, 'Select what is not selected')),
      h('div', { class: 'pe-row' }, sb('Grow', () => setSel(growMask(state.sel, W, H, 3)), null, 'Make the selection a little bigger'), sb('Shrink', () => setSel(growMask(state.sel, W, H, -3)), null, 'Make the selection a little smaller'), sb('Soften', () => setSel(blurMask(state.sel, W, H, 4)), null, 'Soften the edge of the selection')),
      h('div', { class: 'pe-row' }, colourButton('fg'), sb('Fill colour', fillSelection, 'bucket', 'Fill the selection with the front colour'), sb('Delete', clearSelection, 'trash', 'Erase the picture inside the selection (Delete)')));
  };
  const range = (label, key, min, max, fmt) => slider(label, key, min, max, 1, fmt || ((v) => v));
  const adjustPanel = () => h('div', { class: 'pe-group' }, h('h4', {}, 'Colour and effects'), h('p', { class: 'pe-note' }, 'Works on the selection, or on the whole picture if nothing is selected.'),
    range('Brightness', 'bright', -100, 100), range('Contrast', 'contrast', -100, 100), h('div', { class: 'pe-row' }, btn('Apply brightness / contrast', () => { applyFilter((d, m) => adjustBrightnessContrast(d, adj.bright, adj.contrast, m), 'Brightness and contrast applied.'); resetAdj(['bright', 'contrast']); }, { cls: 'wide' })),
    range('Hue', 'hue', -180, 180, (v) => `${v}°`), range('Colourfulness', 'sat', -100, 100), range('Lightness', 'light', -100, 100), h('div', { class: 'pe-row' }, btn('Apply colour change', () => { applyFilter((d, m) => adjustHSL(d, adj.hue, adj.sat, adj.light, m), 'Colour change applied.'); resetAdj(['hue', 'sat', 'light']); }, { cls: 'wide' })),
    range('Blur', 'blur', 1, 30, (v) => `${v}px`), range('Sharpen', 'sharp', 10, 200, (v) => `${v}%`), h('div', { class: 'pe-row' }, btn('Blur', () => applyFilter((d, m) => blurFilter(d, W, H, adj.blur, m), 'Blurred.')), btn('Sharpen', () => applyFilter((d, m) => sharpen(d, W, H, adj.sharp, 1.5, m), 'Sharpened.'))),
    h('div', { class: 'pe-row' }, btn('Invert colours', () => applyFilter((d, m) => invertColours(d, m), 'Colours inverted.')), btn('Black & white', () => applyFilter((d, m) => grayscale(d, m), 'Black and white.'))),
    h('h4', {}, 'Shadow'), h('p', { class: 'pe-note' }, 'Darkens the edge so the part looks round. Uses the front colour darkened.'), range('Reach', 'shSize', 4, 80, (v) => `${v}px`), range('Strength', 'shStr', 5, 100, (v) => `${v}%`),
    h('div', { class: 'pe-row' }, btn('Add edge shadow', () => applyFilter((d, m) => edgeShadow(d, W, H, adj.shSize, adj.shStr, state.fg.map((c) => Math.round(c * 0.35)), m), 'Edge shadow added.'), { ico: 'shade', cls: 'wide' })),
    h('h4', {}, 'Flip'), h('div', { class: 'pe-row' }, btn('Left ↔ right', () => flip(true)), btn('Up ↕ down', () => flip(false))));
  function resetAdj(keys) { for (const k of keys) { adj[k] = 0; const i = panelBox.querySelector(`input[data-k="${k}"]`); if (i) { i.value = 0; i.nextSibling.textContent = k === 'hue' ? '0°' : '0'; } } }
  function flip(horizontal) { pushUndo(); const c = copyD(); dg.save(); dg.clearRect(0, 0, W, H); dg.translate(horizontal ? W : 0, horizontal ? 0 : H); dg.scale(horizontal ? -1 : 1, horizontal ? 1 : -1); dg.drawImage(c, 0, 0); dg.restore(); if (state.sel) setSel(null); draw(); flash('Flipped.'); }
  const panelBox = h('div', { class: 'pe-panel' });
  const tabs = h('div', { class: 'pe-ptabs', role: 'tablist' });
  function renderPanel() {
    tabs.replaceChildren(...[['brush', 'Brushes'], ['select', 'Selection'], ['adjust', 'Adjust']].map(([id, label]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(state.panel === id), class: state.panel === id ? 'on' : '', onclick: () => { state.panel = id; renderPanel(); } }, label)));
    panelBox.replaceChildren(h('div', { class: 'pe-group' }, h('h4', {}, 'Colour'), colourBox), state.panel === 'brush' ? h('div', { class: 'pe-group' }, h('h4', {}, 'Brush looks'), brushList) : state.panel === 'select' ? selPanel() : adjustPanel());
    syncButtons();
  }
  function updateCursor(e) {
    const show = e && e.pointerType === 'mouse' && ['brush', 'eraser', 'smudge', 'blur', 'clone'].includes(state.tool) && e.target === stageCv && !state.space;
    if (!show) { cursor.style.display = 'none'; return; }
    const r = rectOfView(), d = Math.max(4, state.size * state.scale);
    cursor.style.cssText = `display:block;width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
  }
  const titleEl = h('b', { class: 'pe-title' }, title);
  function close(apply) {
    if (closed) return; closed = true; closePicker(); cancelAnimationFrame(rafId); document.removeEventListener('keydown', onKey, true); document.removeEventListener('keyup', onKeyUp, true); window.removeEventListener('resize', fit); wide.removeEventListener?.('change', placeOptions); ro.disconnect();
    let out = null; if (apply) { out = mk(W, H); out.getContext('2d').drawImage(D, 0, 0); }
    root.remove(); document.body.classList.remove('pe-open');
    if (apply) onApply?.(out); else onCancel?.();
  }
  const changed = () => state.undo.length > 0;
  const askClose = () => { if (changed() && !confirm('Close without applying? Your changes to this picture will be lost.')) return; close(false); };
  const optWrap = h('div', { class: 'pe-optwrap' }, optBar), sideBox = h('aside', { class: 'pe-side' }, tabs, panelBox);
  const wide = window.matchMedia('(min-width: 821px)');
  /** on a computer the options of the chosen tool are at the top of the side panel; on a phone they are in a bar above the picture */
  const placeOptions = () => { if (wide.matches) sideBox.prepend(optWrap); else root.insertBefore(optWrap, root.querySelector('.pe-main')); };
  const root = h('div', { class: 'pe', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Edit picture: ${title}` },
    h('header', { class: 'pe-head' }, titleEl, h('span', { class: 'pe-sp' }), undoBtn, redoBtn,
      btn('', () => zoomAt(rectOfView().width / 2, rectOfView().height / 2, 1 / 1.25), { title: 'Zoom out', ico: 'minus', cls: 'ib' }), zoomLabel, btn('', () => zoomAt(rectOfView().width / 2, rectOfView().height / 2, 1.25), { title: 'Zoom in', ico: 'plus', cls: 'ib' }),
      btn('Fit', fit, { title: 'Fit the picture in the window', cls: 'sm' }), btn('100%', () => { const r = rectOfView(); state.scale = 1; state.ox = (r.width - W) / 2; state.oy = (r.height - H) / 2; draw(); }, { title: 'Actual size', cls: 'sm' }),
      btn('Start again', () => { if (!changed() || confirm('Go back to the picture you started with?')) { pushUndo(); dg.putImageData(original, 0, 0); setSel(null); draw(); } }, { title: 'Go back to the picture you opened', cls: 'sm' }),
      btn('Cancel', askClose, { cls: 'sm', title: 'Close without changes' }), btn('Apply', () => close(true), { cls: 'sm pri', ico: 'check', title: 'Put this picture on the layer' })),
    optWrap,
    h('div', { class: 'pe-main' }, toolBar, h('div', { class: 'pe-center' }, vp, flashEl), sideBox));
  const onKey = (e) => {
    if (e.target.matches?.('input[type=text],input[type=number],textarea')) return;
    const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'z') { e.preventDefault(); e.stopPropagation(); e.shiftKey ? redo() : undo(); }
    else if (mod && k === 'y') { e.preventDefault(); e.stopPropagation(); redo(); }
    else if (mod && k === 'a') { e.preventDefault(); e.stopPropagation(); setSel(new Uint8Array(W * H).fill(255)); }
    else if (mod && k === 'd') { e.preventDefault(); e.stopPropagation(); setSel(null); }
    else if (k === ' ') { e.preventDefault(); state.space = true; stageCv.style.cursor = 'grab'; }
    else if (k === 'escape' && picker) { e.stopPropagation(); closePicker(); }
    else if (k === 'escape') { e.stopPropagation(); stroke ? cancelStroke() : state.sel ? setSel(null) : askClose(); }
    else if ((k === 'delete' || k === 'backspace') && state.sel) { e.preventDefault(); clearSelection(); }
    else if (k === '[') { state.size = clamp(state.size - 4, 1, 240); syncOptions(); }
    else if (k === ']') { state.size = clamp(state.size + 4, 1, 240); syncOptions(); }
    else if (k === 'x') { [state.fg, state.bg] = [state.bg, state.fg]; renderColours(); }
    else if (!mod) { const hot = { b: 'brush', e: 'eraser', g: 'bucket', i: 'dropper', m: 'rect', l: 'lasso', w: 'wand', v: 'move', s: 'smudge', h: 'hand' }[k]; if (hot) setTool(hot); }
  };
  const onKeyUp = (e) => { if (e.key === ' ') { state.space = false; stageCv.style.cursor = ''; } };
  document.addEventListener('keydown', onKey, true); document.addEventListener('keyup', onKeyUp, true);
  stageCv.addEventListener('pointerdown', onDown); stageCv.addEventListener('pointermove', onMove); stageCv.addEventListener('pointerup', onUp); stageCv.addEventListener('pointercancel', onUp);
  stageCv.addEventListener('pointerleave', () => { cursor.style.display = 'none'; });
  stageCv.addEventListener('wheel', (e) => { e.preventDefault(); const r = rectOfView(); zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016))); }, { passive: false });
  stageCv.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('resize', fit);
  const ro = new ResizeObserver(() => { fit(); }); ro.observe(vp);
  document.body.append(root); document.body.classList.add('pe-open');
  wide.addEventListener?.('change', placeOptions); placeOptions();
  renderTools(); renderBrushes(); renderColours(); renderPanel(); syncOptions(); syncButtons();
  requestAnimationFrame(() => { fit(); root.querySelector('.pe-tool.on')?.focus?.({ preventScroll: true }); });
  // for tests and for other tools: a handle on the running editor
  const api = { state, D, undo, redo, setTool, setSel, close, fit, draw, paint: paintView, toDoc, get root() { return root; } };
  root._pe = api; return api;
}
