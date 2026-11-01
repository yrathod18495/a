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
    if (it.type === 'image') { const bmp = bitmaps.get(it.id); if (bmp) ctx.drawImage(bmp, -iw / 2, -ih / 2, iw, ih); }
    else if (it.type === 'rect') { ctx.fillStyle = it.fill || '#8b7bff'; const r = Math.min((it.radius || 0) * scale, iw / 2, ih / 2); ctx.beginPath(); ctx.roundRect(-iw / 2, -ih / 2, iw, ih, r); ctx.fill(); }
    else if (it.type === 'ellipse') { ctx.fillStyle = it.fill || '#8b7bff'; ctx.beginPath(); ctx.ellipse(0, 0, iw / 2, ih / 2, 0, 0, Math.PI * 2); ctx.fill(); }
    else if (it.type === 'text') { ctx.fillStyle = it.fill || '#ffffff'; ctx.font = `800 ${Math.round(ih * 0.8)}px system-ui, "Noto Sans Devanagari", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(it.text || 'Text', 0, 0, iw); }
    ctx.restore();
  }
  ctx.restore();
}
const toBlob = (canvas, type = 'image/png', q) => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be created. Please try a smaller size.'))), type, q));

export async function view({ user, home, toast }) {
  let doc = newDoc(), id = uid8(), name = 'My background', sel = null, saved = false, busy = false;
  const bitmaps = new Map();                                // item id -> ImageBitmap
  const history = [], future = [];
  const snapshot = () => JSON.stringify({ ...doc, items: doc.items.map(({ blob, ...rest }) => rest) });
  let lastSnap = snapshot();
  const commit = () => { const s = snapshot(); if (s !== lastSnap) { history.push(lastSnap); if (history.length > 60) history.shift(); future.length = 0; lastSnap = s; } saved = false; redraw(); };
  const applySnap = (s) => { const parsed = JSON.parse(s), blobs = new Map(doc.items.map((i) => [i.id, i.blob])); doc = { ...parsed, items: parsed.items.map((i) => ({ ...i, blob: blobs.get(i.id) })) }; lastSnap = s; if (!doc.items.some((i) => i.id === sel)) sel = null; redraw(); };
  const undo = () => { if (!history.length) return; future.push(lastSnap); applySnap(history.pop()); };
  const redo = () => { if (!future.length) return; history.push(lastSnap); applySnap(future.pop()); };

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
    if (!it || it.hidden) { selBox.hidden = true; return; }
    const k = stage.clientWidth / doc.size.w;
    selBox.hidden = false;
    Object.assign(selBox.style, { left: `${(it.x - it.w / 2) * k}px`, top: `${(it.y - it.h / 2) * k}px`, width: `${it.w * k}px`, height: `${it.h * k}px`, transform: `rotate(${it.rot || 0}deg)` });
  };
  function redraw() { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { fit(); drawCanvas(); place(); drawSide(); }); }

  // ---------- items ----------
  const load = async (item) => { if (item.type === 'image' && item.blob && !bitmaps.has(item.id)) bitmaps.set(item.id, await createImageBitmap(item.blob)); };
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
  const duplicate = (item) => { const copy = { ...item, id: uid8(), x: item.x + doc.size.w * 0.03, y: item.y + doc.size.w * 0.03 }; if (bitmaps.has(item.id)) bitmaps.set(copy.id, bitmaps.get(item.id)); doc.items.push(copy); sel = copy.id; commit(); };

  // ---------- pointer: select, move, resize (corner / pinch / wheel), rotate ----------
  const pointers = new Map();
  let drag = null;
  const toCanvas = (e) => { const r = canvas.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * doc.size.w, y: ((e.clientY - r.top) / r.height) * doc.size.h }; };
  const hit = (p) => {
    for (let i = doc.items.length - 1; i >= 0; i--) {
      const it = doc.items[i]; if (it.hidden) continue;
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
    if (!drag) return;
    const it = drag.it;
    if (drag.kind === 'pinch') resizeTo(it, dist() / drag.d0);
    else if (drag.kind === 'scale') resizeTo(it, Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy) / drag.r0);
    else if (drag.kind === 'rotate') it.rot = Math.round(((Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx) * 180) / Math.PI + 90) * 10) / 10;
    else { const p = toCanvas(e); it.x = Math.round(drag.x0 + p.x - drag.p0.x); it.y = Math.round(drag.y0 + p.y - drag.p0.y); }
    drag.changed = true; drawCanvas(); place();
  });
  const up = (e) => { pointers.delete(e.pointerId); if (drag && (!pointers.size || drag.kind === 'pinch')) { const changed = drag.changed; drag = null; if (changed) commit(); else drawSide(); } };
  stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
  stage.addEventListener('wheel', (e) => { const it = selected(); if (!it) return; e.preventDefault(); drag = { it, w0: it.w, h0: it.h }; resizeTo(it, Math.exp(-e.deltaY * 0.0015)); drag = null; clearTimeout(stage._t); drawCanvas(); place(); stage._t = setTimeout(commit, 250); }, { passive: false });
  const onKey = (e) => {
    if (!document.body.contains(root) || e.target.closest?.('input,textarea,select,[contenteditable]')) return;
    const it = selected(), step = e.shiftKey ? 50 : 5;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
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
  async function save() {
    if (busy) return;
    if (!doc.items.length && doc.base.kind === 'blank') { toast('Add something to the canvas first, then save.'); return; }
    setBusy(true, 'Rendering the full-size picture…');
    try {
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
  function newBackground() { doc = newDoc(); bitmaps.clear(); id = uid8(); name = 'My background'; nameInput.value = name; sel = null; history.length = future.length = 0; lastSnap = snapshot(); sizeSel.value = '4k'; saved = false; redraw(); }

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
  const left = h('aside', { class: 'bgg-left' },
    h('div', { class: 'bgg-card' }, h('h2', {}, 'Add'),
      h('button', { type: 'button', class: 'btn pri', onclick: () => file.click() }, '＋ Picture or prop'), file,
      h('button', { type: 'button', class: 'btn', onclick: toggleShared }, 'Shared props library'), sharedBox,
      h('div', { class: 'bgg-row' }, h('button', { type: 'button', class: 'btn', onclick: () => addShape('rect') }, '▭ Rectangle'), h('button', { type: 'button', class: 'btn', onclick: () => addShape('ellipse') }, '◯ Circle'), h('button', { type: 'button', class: 'btn', onclick: addText }, 'T Text'))),
    h('div', { class: 'bgg-card' }, h('h2', {}, 'Canvas'), sizeSel, h('p', { class: 'bgg-sub' }, 'Colour or gradient'), swatches, h('label', { class: 'bgg-inline' }, 'Own colour', colourA)),
    h('div', { class: 'bgg-card' }, h('h2', {}, 'My backgrounds'), h('p', { class: 'bgg-sub' }, 'Saved in your account on this device. Open one to keep editing it.'), (libBox = h('div', { class: 'bgg-lib' }))));
  const props = h('div', { class: 'bgg-props' }), layers = h('div', { class: 'bgg-layers' });
  const right = h('aside', { class: 'bgg-right' }, h('div', { class: 'bgg-card' }, h('h2', {}, 'Selected'), props), h('div', { class: 'bgg-card' }, h('h2', {}, 'Layers'), layers));
  function drawSide() {
    emptyHint.hidden = doc.items.length > 0;
    const it = selected(), row = (label, ...c) => h('label', { class: 'bgg-field' }, h('span', {}, label), ...c);
    props.replaceChildren(...(it ? [
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
      h('button', { type: 'button', class: 'bgg-layer-main', onclick: () => { sel = l.id; place(); drawSide(); } }, `${{ image: '🖼', rect: '▭', ellipse: '◯', text: 'T' }[l.type] || '•'} ${l.name || l.type}`),
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
