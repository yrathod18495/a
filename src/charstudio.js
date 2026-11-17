import { friendlyError } from '../shared/hinglish-errors.js';
// 12toons Character Editor.
// Start from a template (or any rig ZIP), then change it layer by layer: upload / download / remove / lock every layer, colour it,
// nudge it, fit the face (eyes, brows, nose, lips, ears), pick the outfit — all live on the canvas. Save = baked character
// (rig + atlas + images + edit profile) in this device's database and, when logged in, in your cloud account.
import JSZip from 'jszip';
import { h, logo } from './dom.js';
import { icon } from './icons.js';
import { Stage } from './db/stage.js';
import { characterPicker } from './charpick.js';
import { refreshLayerRules, layerName, groupName, layerHidden } from './layerrules.js';
import { ingest } from './ingest.js';
import { readPsdLayers, planPsd, kindOf } from './psd.js';
import { listStudioAssets, downloadStudioAsset } from './studio-assets.js';
import { lockedFor, PAID_MESSAGE } from '../shared/asset-access.js';
import { currentPlan, refreshPlan } from './export-plan.js';
import { openPhotoEditor } from './photo-editor.js';
import { patchRig, faceEdits, faceDefaults, bakeSke, stickerAtlasJson, STICKER_PAGE } from './rigedit.js';
import { LIMITS, mb } from './limits.js';
import { saveCharacter, deleteCharacter, loadCharacters, get as getDraft, put as putDraft } from './store.js';
import { onSyncStatus } from './project-sync.js';
import { loadCatalog, hydrateAll, hydrateCharacter, libraryCharacters, fetchLibraryCharacter, categoriesFor, fetchAnimation, url as assetUrl } from './catalog.js';
import { getFit, setFit, FIT_LIMITS } from './universal.js';
import { rigInfo } from './db/info.js';
import { cloudReady, saveCharacterCloud, deleteCharacterCloud, listCharactersCloud, loadCharacterCloud } from './cloud.js';

/* ---- colour helpers ---- */
const rgb2hsl = (r, g, b) => {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hh * 60, s, l];
};
const hsl2rgb = (hh, s, l) => {
  hh = (((hh % 360) + 360) % 360) / 360;
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return 255 * (t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p); };
  return [f(hh + 1 / 3), f(hh), f(hh - 1 / 3)];
};
const makeCanvas = (w, hgt) => { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, hgt); return c; };
const toBlob = (c, type = 'image/webp', q = 0.95) => new Promise((res) => c.toBlob(res, type, q));
const safe = (s) => String(s).replace(/[\\/]+/g, '_');
const isImage = (n) => /\.(png|webp|jpe?g|svg)$/i.test(n);
/** bitmap / canvas from any image file (SVG included: browsers cannot createImageBitmap an SVG) */
/** the box that holds the visible (not transparent) pixels of a picture */
function trimBox(img) {
  const c = makeCanvas(img.width, img.height), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data; let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 >= x0 ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : { x: 0, y: 0, w: c.width, h: c.height };
}
async function readImage(blob, name = '') {
  if (/svg/i.test(blob.type) || /\.svg$/i.test(name)) {
    const url = URL.createObjectURL(blob), im = new Image();
    im.src = url; await im.decode();
    const w = im.naturalWidth || 1024, hh = im.naturalHeight || 1024, k = Math.min(1, 2048 / Math.max(w, hh)), c = makeCanvas(Math.round(w * k), Math.round(hh * k));
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
    return c;
  }
  return createImageBitmap(blob);
}

const GROUP_ICON = { Top: 'shirt', Bottom: 'layers', Shoes: 'walk', Eyes: 'eye', Eyebrows: 'pencil', Face: 'smile', Nose: 'shapes', Ears: 'shapes', Hair: 'scissors', Lips: 'smile', Palms: 'hand', Earrings: 'star', Other: 'shapes' };

export async function view({ user, home, toast, localPreview = false }) {
  localPreview = import.meta.env.DEV && localPreview;
  // The page opens from what this device knows. The shared library (network) gets a few seconds at most; if the connection is slow or dead it keeps loading in the
  // background and the character list fills in when it arrives. Nothing here may wait on the network for long.
  const within = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);
  let pageReady = false, redrawLibrary = () => {}, savedRaw = [];
  const catalogLoading = loadCatalog().catch((e) => console.warn('Character library unavailable:', e?.message));
  catalogLoading.then(() => { if (pageReady) redrawLibrary(); });
  const groupsLoading = (async () => { const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 2500); try { return await fetch(assetUrl('12toons/groups.json'), { signal: ctl.signal }).then((r) => r.json()); } catch { return []; } finally { clearTimeout(timer); } })();          // optional: part groups
  const [rawList, groupsData] = await Promise.all([loadCharacters().then((l) => l.filter((c) => c.ske || c.base)), groupsLoading, within(catalogLoading, 3000), refreshLayerRules()]);
  savedRaw = rawList;
  const mine = await hydrateAll(rawList);            // saved characters are small (template + settings + own pictures): put them together again (the ones built on a library template need the library: they come when it has loaded)
  const groupOf = new Map();
  for (const g of groupsData) for (const a of g.attachments) groupOf.set(a, g.name);

  const stage = new Stage({ maxTex: 4096 });
  stage.setSize('4:5', 720);
  const st = {
    outline: false, stickers: [], stkSel: null, autoLen: true, guideFocus: null, createMode: false, def: null, tpl: null, skins: null, hide: new Set(), edit: new Map(), xf: {}, order: {}, place: true, attach: {}, face: faceDefaults(), locked: new Set(),
    regions: new Map(), pages: [], orig: {}, work: {}, artworkPages: {}, dirty: new Set(), cbox: new Map(), anim: null, tab: 'start', open: null, openGroup: null, filter: '',
    busy: false, mouth: false, zoom: 'wide', name: '', cloud: [],
  };
  let gen = 0, pending = new Set(), applyTimer = 0, rigTimer = 0, t0 = performance.now(), raf = 0, lastFrame = 0;
  const panel = h('div', { class: 'cs-panel' }), tabs = h('div', { class: 'cs-tabs' }), stageBox = h('div', { class: 'cs-stage' }, stage.out);
  const animBar = h('div', { class: 'cs-anim' });
  const saveButton = h('button', { class: 'btn ok', onclick: () => { if (st.def) { st.tab = 'save'; draw(); } else toast('Please choose a character first.'); } }, icon('download'), h('span', {}, 'Save'));
  const root = h('div', { class: 'sh cs' },
    h('header', { class: 'sh-bar' }, logo(home), h('span', { class: 'sp' }),
      saveButton, h('button', { class: 'btn', 'aria-label': 'Home', onclick: home }, icon('home'), h('span', {}, 'Home'))),
    h('div', { class: 'cs-body' }, h('div', { class: 'cs-left' }, stageBox, animBar), h('div', { class: 'cs-right' }, tabs, panel)));

  /* ---------- live preview ---------- */
  const visemes = Uint8Array.from({ length: 400 }, (_, i) => [0, 1, 3, 4, 5, 6, 7, 2][Math.floor(i / 5) % 8]);
  const previewTime = now => Math.max(0, (now - t0) / 1000);
  const mouthClips = t => { const start = Math.floor(t / 6) * 6; return st.mouth ? [{ speaker: 'c', start, end: start + 6, visemes }] : []; };
  const loop = (now) => {
    if (!root.isConnected) { cancelAnimationFrame(raf); return; }
    raf = requestAnimationFrame(loop);
    if (!st.def || document.hidden || now - lastFrame < 33) return;
    const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 1 / 30;
    lastFrame = now;
    const t = previewTime(now);
    try {
      const cameraPlan = [{ start: 0, end: 1e9, speaker: 'c', type: st.zoom, focus: 'auto' }];
      stage.render(t, dt, mouthClips(t), cameraPlan);
      overlayFrame();
    } catch (e) { console.warn(e); }
  };

  /* ---------- free zoom / pan on the preview: wheel = zoom at the cursor, drag = move, double click = back ---------- */
  {
    { let mark = 0; const redraw = () => { cancelAnimationFrame(mark); mark = requestAnimationFrame(() => { try { stage.render(performance.now() / 1000, 0, [], [{ start: 0, end: 1e9, speaker: 'c', type: st.zoom, focus: 'auto' }]); } catch { /* the loop draws it again */ } }); };          // a browser zoom or a window resize changes the canvas size on screen: draw it again at once
      window.addEventListener('resize', redraw); new ResizeObserver(redraw).observe(stageBox); }
    const cv = stage.out, hint = h('div', { class: 'cs-zoomhint' }, 'Wheel: zoom · drag: move · double-click: reset');
    stageBox.append(hint);
    const at = (e) => { const r = cv.getBoundingClientRect(); return { px: ((e.clientX - r.left) / r.width) * stage.W, py: ((e.clientY - r.top) / r.height) * stage.H }; };
    const cam = () => stage.userCam || (stage.userCam = { zoom: 1, cx: stage.W / 2, cy: stage.H / 2 });
    const reset = () => { stage.userCam = null; hint.classList.remove('on'); };
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const c = cam(), { px, py } = at(e), z = Math.min(16, Math.max(0.15, c.zoom * Math.exp(-e.deltaY * 0.0015)));
      const wx = c.cx + (px - stage.W / 2) / c.zoom, wy = c.cy + (py - stage.H / 2) / c.zoom;     // the point under the cursor stays under it
      c.zoom = z; c.cx = wx - (px - stage.W / 2) / z; c.cy = wy - (py - stage.H / 2) / z;
      hint.classList.add('on');
    }, { passive: false });
    let drag = null;
    cv.addEventListener('pointerdown', (e) => { if (!stage.userCam) return; drag = { x: e.clientX, y: e.clientY, cx: stage.userCam.cx, cy: stage.userCam.cy }; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing'; });
    cv.addEventListener('pointermove', (e) => {
      if (!drag || !stage.userCam) return;
      const r = cv.getBoundingClientRect(), k = stage.W / r.width / stage.userCam.zoom;
      stage.userCam.cx = drag.cx - (e.clientX - drag.x) * k; stage.userCam.cy = drag.cy - (e.clientY - drag.y) * k;
    });
    const up = () => { drag = null; cv.style.cursor = ''; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('dblclick', reset);
    cv.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
    cv.addEventListener('drop', (e) => { const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/') || /\.svg$/i.test(x.name)); if (!f) return; e.preventDefault(); addSticker(f); });
    st.resetView = reset;
  }

  /* ---------- model: layers of the current character ---------- */
  const skinList = () => st.def.ske.armature[0].skin;
  /** every picture the character can show: {slot, key, region, group} for the worn skins */
  function layers() {
    // The stage merges the worn skins in rig order (a later skin replaces an earlier one with the same slot + picture name),
    // so a character can carry several regions behind one name (SL/ARM_R, PS/ARM_R, ARM_R). Only the one that is drawn is a layer,
    // otherwise an upload would land on a hidden region and nothing would change on the canvas.
    const win = new Map();
    for (const sk of skinList()) {
      if (st.skins && sk.name !== 'default' && !st.skins.includes(sk.name)) continue;
      for (const sl of sk.slot) {
        for (const a of sl.display) {
          if (a.type !== 'image' && a.type !== 'mesh') continue;
          win.set(`${sl.name}|${a.name}`, { slot: sl.name, key: a.name, region: a.path || a.name });
        }
      }
    }
    const out = [];
    for (const { slot, key, region } of win.values()) {
      if (!st.regions.has(region)) continue;
      const group = groupOf.get(key) || groupOf.get(key.replace(/\//g, '_')) || groupOf.get(slot) || (groupsData.length ? 'Other' : 'Parts');
      out.push({ slot, key, region, group, id: `${slot}|${key}|${region}` });
    }
    return out;
  }
  /** the picture a slot shows when nothing is animated */
  const defaultAtt = (slot) => {
    const sl = st.def.ske.armature[0].slot.find((x) => x.name === slot);
    if (!sl) return null;
    if ('_defaultAtt' in sl) return sl._defaultAtt;
    const merged = []; for (const sk of skinList()) for (const x of sk.slot) if (x.name === slot) for (const d of x.display) if (!merged.includes(d.name)) merged.push(d.name);
    return merged[sl.displayIndex ?? 0] ?? null;
  };
  st.slot_attach = (slot) => (slot in st.attach ? st.attach[slot] || null : defaultAtt(slot));

  /* ---------- pixels: every region = original (or uploaded) picture + colour ---------- */
  const rectOf = (reg) => ({ rw: reg.deg ? reg.h : reg.w, rh: reg.deg ? reg.w : reg.h });   // size of the rectangle inside the page
  const imageOf = (name) => (st.def.tex.find((t) => t.json.imagePath === name) || st.def.tex[0]).image;
  async function pageCanvas(name) {
    if (st.work[name]) return st.work[name];
    const bmp = await createImageBitmap(imageOf(name));
    const o = makeCanvas(bmp.width, bmp.height), w = makeCanvas(bmp.width, bmp.height);
    o.getContext('2d').drawImage(bmp, 0, 0); w.getContext('2d').drawImage(bmp, 0, 0);
    st.orig[name] = o; st.work[name] = w; bmp.close();
    return w;
  }
  /** where the original picture of a layer sits inside its region box (upright pixels); an empty / full region = the whole box */
  function contentBox(r) {
    if (st.cbox.has(r)) return st.cbox.get(r);
    const reg = st.regions.get(r), src = st.orig[reg.page], full = { x: 0, y: 0, w: reg.w, h: reg.h };
    let out = full;
    if (src) {
      const k = Math.min(1, 160 / Math.max(reg.w, reg.h)), cw = Math.max(1, Math.round(reg.w * k)), ch = Math.max(1, Math.round(reg.h * k)), c = makeCanvas(cw, ch), g = c.getContext('2d', { willReadFrequently: true }), { rw, rh } = rectOf(reg);
      g.scale(cw / reg.w, ch / reg.h);
      if (reg.deg) { g.translate(0, reg.h); g.rotate(-Math.PI / 2); g.drawImage(src, reg.x, reg.y, rw, rh, 0, 0, rw, rh); } else g.drawImage(src, reg.x, reg.y, rw, rh, 0, 0, rw, rh);
      const d = g.getImageData(0, 0, cw, ch).data; let x0 = cw, y0 = ch, x1 = -1, y1 = -1;
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (d[(y * cw + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 >= x0 && y1 >= y0) { const sx = reg.w / cw, sy = reg.h / ch; out = { x: x0 * sx, y: y0 * sy, w: (x1 - x0 + 1) * sx, h: (y1 - y0 + 1) * sy }; }
    }
    st.cbox.set(r, out); return out;
  }
  async function paintRegion(r) {
    const reg = st.regions.get(r), e = st.edit.get(r), { rw, rh } = rectOf(reg);
    const work = await pageCanvas(reg.page), ctx = work.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(reg.x, reg.y, rw, rh);
    if (e?.removed) { /* stays transparent */ }
    else if (e?.img) {
      const iw = e.img.width, ih = e.img.height, uw = reg.w, uh = reg.h;                    // upright size of the layer
      // A picture with the proportions of the whole region (e.g. a layer downloaded from here, margins included) fills the region 1:1.
      // Tightly cropped art (just the sleeve, just the trouser) goes where the original art was, not into the empty margin around it.
      const wholeBox = Math.abs(iw / ih / (uw / uh) - 1) < 0.07, bb = wholeBox ? { x: 0, y: 0, w: uw, h: uh } : contentBox(r), bx = bb.x, by = bb.y, bw = bb.w, bh = bb.h;
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      // "outline": the opaque part of the art is cut out and stretched over the original picture's outline, so its edges meet the neighbours (joints, seams) the way the template's did
      const mode = e.mode || (e.fill ? 'fill' : 'fit'), tb = mode === 'outline' && !wholeBox ? (e.trim ||= trimBox(e.img)) : null;
      const sx = tb ? tb.x : 0, sy = tb ? tb.y : 0, sw = tb ? tb.w : iw, sh = tb ? tb.h : ih;
      const k = tb ? 0 : mode === 'fill' ? Math.max(bw / iw, bh / ih) : Math.min(bw / iw, bh / ih), dw = tb ? bw : iw * k, dh = tb ? bh : ih * k;
      ctx.save(); ctx.beginPath(); ctx.rect(reg.x, reg.y, rw, rh); ctx.clip();
      if (reg.deg) { ctx.translate(reg.x + rw, reg.y); ctx.rotate(Math.PI / 2); ctx.drawImage(e.img, sx, sy, sw, sh, bx + (bw - dw) / 2, by + (bh - dh) / 2, dw, dh); }
      else ctx.drawImage(e.img, sx, sy, sw, sh, reg.x + bx + (bw - dw) / 2, reg.y + by + (bh - dh) / 2, dw, dh);
      ctx.restore();
    } else ctx.drawImage(st.orig[reg.page], reg.x, reg.y, rw, rh, reg.x, reg.y, rw, rh);
    if (e && !e.removed && (e.hue || e.sat !== 1 || e.light)) {
      const im = ctx.getImageData(reg.x, reg.y, rw, rh), d = im.data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 8) continue;
        const [hh, s, l] = rgb2hsl(d[i], d[i + 1], d[i + 2]);
        const [R, G, B] = hsl2rgb(hh + e.hue, Math.min(1, s * e.sat), Math.min(1, Math.max(0, l + e.light / 100)));
        d[i] = R; d[i + 1] = G; d[i + 2] = B;
      }
      ctx.putImageData(im, reg.x, reg.y);
    }
  }
  const editOf = (r) => { let e = st.edit.get(r); if (!e) st.edit.set(r, (e = { hue: 0, sat: 1, light: 0, img: null, removed: false, fill: false })); return e; };
  const queue = (regs) => { regs.forEach((r) => pending.add(r)); clearTimeout(applyTimer); applyTimer = setTimeout(flush, 50); };
  async function flush() {
    if (st.busy) { applyTimer = setTimeout(flush, 100); return; }
    st.busy = true;
    const g = gen;
    try {
      const regs = [...pending], olds = []; pending = new Set();
      for (const r of regs) { await paintRegion(r); if (g !== gen) return; }
      for (const pg of new Set(regs.map((r) => st.regions.get(r).page))) {
        const key = { page: pg };
        await stage.loadArtworkCanvas(key, st.work[pg]);
        if (g !== gen) { stage.dropArtworkCanvas(key); return; }
        olds.push(st.artworkPages[pg]); st.artworkPages[pg] = key; st.dirty.add(pg);
      }
      rebuild(); refreshThumbs(regs); olds.forEach((k) => k && stage.dropArtworkCanvas(k));
    } catch (e) { console.warn('edit failed', e); } finally { st.busy = false; }
  }
  /** crop of a layer, upright */
  function cropOf(r, maxSide) {
    const reg = st.regions.get(r), src = st.work[reg.page] || st.orig[reg.page];
    if (!src) return null;
    const { rw, rh } = rectOf(reg), k = maxSide ? Math.min(1, maxSide / Math.max(reg.w, reg.h)) : 1, c = makeCanvas(Math.round(reg.w * k), Math.round(reg.h * k)), ctx = c.getContext('2d');
    ctx.scale(k, k);
    if (reg.deg) { ctx.translate(0, reg.h); ctx.rotate(-Math.PI / 2); ctx.drawImage(src, reg.x, reg.y, rw, rh, 0, 0, rw, rh); }
    else ctx.drawImage(src, reg.x, reg.y, rw, rh, 0, 0, rw, rh);
    return c;
  }
  const thumbs = new Map();   // region -> canvas elements showing it
  function thumb(r) {
    const c = makeCanvas(48, 48); c.className = 'cs-lth'; (thumbs.get(r) || thumbs.set(r, new Set()).get(r)).add(c);
    paintThumb(r, c); return c;
  }
  function paintThumb(r, c) {
    const crop = cropOf(r, 96), g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height);
    if (!crop) return;
    const k = Math.min(c.width / crop.width, c.height / crop.height);
    g.drawImage(crop, (c.width - crop.width * k) / 2, (c.height - crop.height * k) / 2, crop.width * k, crop.height * k);
  }
  const refreshThumbs = (regs) => regs.forEach((r) => thumbs.get(r)?.forEach((c) => c.isConnected && paintThumb(r, c)));

  /* ---------- stickers: a scar, a blood mark, a patch ... placed on a layer; it moves with that body part and is saved with the character ---------- */
  const STK_MAX = 512;
  let stkEntry = null;
  const stickerEntry = () => (st.stickers.length ? stkEntry : null);
  /** all sticker pictures packed into one picture page (stickers.png) */
  /** the picture of a body part as it stands in the set-up pose, drawn in the local space of the bone it hangs on (bone pixels); works for flat pictures and for bent meshes.
      Returns { canvas, ox, oy, f } (the canvas starts at bone point ox, oy and is f times the size of the bone space) or null. */
  function layerShape(l) {
    let built = null;
    try { built = stage.armatureFor(st.def.id, st.skins); } catch { return null; }
    try {
      const sd = st.def.ske.armature[0].slot.find((x) => x.name === l.slot), slot = built.arm.getSlot(l.slot), idx = built.prep.disp.get(l.slot)?.get(l.key), bone = sd && built.arm.getBone(sd.parent);
      if (!slot || idx == null || !bone) return null;
      slot.displayIndex = idx; built.arm.advanceTime(0);
      const list = []; slot.collect(list); if (!list.length) return null;
      const m = bone.globalTransformMatrix, det = m.a * m.d - m.b * m.c; if (Math.abs(det) < 1e-9) return null;
      const toLocal = (x, y) => { const dx = x - m.tx, dy = y - m.ty; return [(m.d * dx - m.c * dy) / det, (-m.b * dx + m.a * dy) / det]; };
      const tris = []; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const it of list) {
        const page = st.work[it.atlas.imagePath] || st.orig[it.atlas.imagePath]; if (!page) continue;
        const pts = []; for (let i = 0; i < it.verts.length; i += 2) { const [lx, ly] = toLocal(it.verts[i], it.verts[i + 1]); pts.push([lx, ly]); if (lx < x0) x0 = lx; if (lx > x1) x1 = lx; if (ly < y0) y0 = ly; if (ly > y1) y1 = ly; }
        for (let i = 0; i < it.idx.length; i += 3) tris.push({ page, p: [it.idx[i], it.idx[i + 1], it.idx[i + 2]].map((k) => pts[k]), u: [it.idx[i], it.idx[i + 1], it.idx[i + 2]].map((k) => [it.uvs[k * 2] * page.width, it.uvs[k * 2 + 1] * page.height]) });
      }
      if (!tris.length || !(x1 > x0) || !(y1 > y0)) return null;
      const f = Math.min(1, 2048 / Math.max(x1 - x0, y1 - y0)), c = makeCanvas(Math.max(1, Math.ceil((x1 - x0) * f)), Math.max(1, Math.ceil((y1 - y0) * f))), g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      for (const t of tris) {
        const [[ax, ay], [bx, by], [cx, cy]] = t.p.map(([x, y]) => [(x - x0) * f, (y - y0) * f]), [[au, av], [bu, bv], [cu, cv]] = t.u;
        const d = (au * (bv - cv) + bu * (cv - av) + cu * (av - bv)); if (Math.abs(d) < 1e-9) continue;
        const A = (ax * (bv - cv) + bx * (cv - av) + cx * (av - bv)) / d, C = (ax * (cu - bu) + bx * (au - cu) + cx * (bu - au)) / d, E = (ax * (bu * cv - cu * bv) + bx * (cu * av - au * cv) + cx * (au * bv - bu * av)) / d;
        const B = (ay * (bv - cv) + by * (cv - av) + cy * (av - bv)) / d, D = (ay * (cu - bu) + by * (au - cu) + cy * (bu - au)) / d, F = (ay * (bu * cv - cu * bv) + by * (cu * av - au * cv) + cy * (au * bv - bu * av)) / d;
        g.save(); g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.lineTo(cx, cy); g.closePath(); g.clip(); g.setTransform(A, B, C, D, E, F); g.drawImage(t.page, 0, 0); g.restore();
      }
      return { canvas: c, ox: x0, oy: y0, f };
    } catch (e) { console.warn('shape of the layer failed', e); return null; } finally { stage.disposeTemp(built); }
  }
  /** the sticker cut to the shape of its body part: placed on the part's picture (in bone space), then everything outside the part's opaque pixels is removed */
  function clipSticker(k) {
    const l = layers().find((x) => x.region === k.layer), sh = l && layerShape(l); if (!sh) return null;
    const { canvas: base, ox, oy, f } = sh, c = makeCanvas(base.width, base.height), g = c.getContext('2d');
    g.save(); g.translate((k.x - ox) * f, (k.y - oy) * f); g.rotate((k.rot || 0) * Math.PI / 180);
    const w = k.img.width * (k.s ?? 1) * f, h = k.img.height * (k.s ?? 1) * f; g.drawImage(k.img, -w / 2, -h / 2, w, h); g.restore();
    g.globalCompositeOperation = 'destination-in'; g.drawImage(base, 0, 0);
    return { canvas: c, tf: { x: ox + base.width / (2 * f), y: oy + base.height / (2 * f), skX: 0, skY: 0, scX: 1 / f, scY: 1 / f } };
  }
  /** all sticker pictures packed into one picture page (stickers.png); a cut sticker is stored as its cut picture (shown) plus its original (`_src`, kept so it can be edited again) */
  async function packStickers() {
    if (!st.stickers.length) { stkEntry = null; st.stkAtlas = null; st.stkBlob = null; return; }
    const parts = [];          // [regionName, canvas]
    for (const k of st.stickers) {
      const cut = k.clip ? clipSticker(k) : null;
      k.tf = cut ? cut.tf : null;
      parts.push([k.name, cut ? cut.canvas : k.img]); if (cut) parts.push([`${k.name}_src`, k.img]);
    }
    const W = Math.max(...parts.map(([, c]) => c.width)); let y = 0; const regs = {};
    for (const [name, c] of parts) { regs[name] = { x: 0, y, w: c.width, h: c.height }; y += c.height + 2; }
    const cv = makeCanvas(W, y), g = cv.getContext('2d');
    for (const [name, c] of parts) g.drawImage(c, 0, regs[name].y);
    st.stkAtlas = { w: W, h: y, regs }; st.stkBlob = await toBlob(cv, 'image/png');
    stkEntry = { json: stickerAtlasJson(st.stkAtlas), image: st.stkBlob };
    const old = st.artworkPages[STICKER_PAGE], key = { page: STICKER_PAGE };
    await stage.loadArtworkCanvas(key, cv); st.artworkPages[STICKER_PAGE] = key; if (old) stage.dropArtworkCanvas(old);
  }
  async function syncStickers() { await packStickers(); rebuild(); }
  let stkTimer = 0;
  /** a slider moved: a cut sticker is cut again (a moment after the last move); a free one only moves */
  function queueSticker(k) { if (!k.clip) { queueRig(); return; } clearTimeout(stkTimer); stkTimer = setTimeout(() => { syncStickers().catch((e) => console.warn('sticker update failed', e)); }, 140); }
  function displayOf(l) {
    const sk = st.def.ske.armature[0].skin;
    let found = null;
    for (const k of sk) { if (k.name !== 'default' && st.skins && !st.skins.includes(k.name)) continue; const sl = k.slot.find((x) => x.name === l.slot), d = sl?.display?.find((x) => x.name === l.key); if (d) found = d.transform || {}; }          // the worn outfit's picture replaces the default one, like on the stage
    return found || {};
  }
  async function addSticker(file) {
    if (!st.def) { toast('Pick a template first.'); return; }
    const l = layers().find((x) => x.region === st.guideFocus);
    if (!l) { toast('Tap a layer in the list first (for example the upper arm), then add the sticker. It will move with that body part.'); return; }
    if (st.stickers.length >= 12) { toast('You can add up to 12 stickers. Please remove one first.'); return; }
    let src; try { src = await readImage(file, file.name); } catch { toast('This picture could not be read. Please use a PNG or SVG.'); return; }
    const k = Math.min(1, STK_MAX / Math.max(src.width, src.height)), img = makeCanvas(Math.max(1, Math.round(src.width * k)), Math.max(1, Math.round(src.height * k)));
    img.getContext('2d').drawImage(src, 0, 0, img.width, img.height);
    const reg = st.regions.get(l.region), sh = layerShape(l), t = sh ? { x: sh.ox + sh.canvas.width / (2 * sh.f), y: sh.oy + sh.canvas.height / (2 * sh.f) } : displayOf(l), size = Math.min(2, Math.max(0.05, (Math.min(reg.w, reg.h) * 0.6) / img.width));
    const id = `k${Math.random().toString(36).slice(2, 7)}`;
    const sticker = { id, name: `stk_${id}`, slot: l.slot, layer: l.region, img, x: t.x || 0, y: t.y || 0, s: +size.toFixed(3), rot: 0, a: 1, clip: true };
    st.stickers.push(sticker); st.stkSel = id; await syncStickers(); draw();
    toast('Sticker added. Use the sliders to move, resize and turn it.');
  }
  async function removeSticker(id) { st.stickers = st.stickers.filter((k) => k.id !== id); if (st.stkSel === id) st.stkSel = st.stickers.at(-1)?.id || null; await syncStickers(); draw(); }
  /** a saved character brings its stickers back: each picture is cut out of the sticker page again */
  async function restoreStickers(pr, pages) {
    st.stickers = []; st.stkSel = null; stkEntry = null;
    if (!pr?.stickers?.length || !pr.stickerAtlas || !pages?.[STICKER_PAGE]) return;
    const bmp = await createImageBitmap(pages[STICKER_PAGE]);
    for (const k of pr.stickers) { const r = pr.stickerAtlas.regs[`${k.name}_src`] || pr.stickerAtlas.regs[k.name]; if (!r) continue; const img = makeCanvas(r.w, r.h); img.getContext('2d').drawImage(bmp, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h); st.stickers.push({ ...k, img }); }
    st.stkSel = st.stickers.at(-1)?.id || null; bmp.close?.();
    await packStickers();
  }
  const stickerProfile = () => (st.stickers.length ? { stickers: st.stickers.map(({ id, name, slot, layer, x, y, s: sz, rot, a, clip, tf }) => ({ id, name, slot, layer, x, y, s: sz, rot, a, clip: !!clip, tf: tf || null })), stickerAtlas: st.stkAtlas } : {});
  /** the admin's sticker library (R2 files, one small record each in the database, a tiny thumbnail inside it): the list is read once and kept for a few minutes */
  function loadStickerLibrary() {
    if (st.libState) return; st.libState = 'loading';
    Promise.all([listStudioAssets(), refreshPlan().catch(() => null)])
      .then(([list]) => { st.lib = list.filter((a) => a.type === 'sticker'); st.libState = 'ready'; if (st.tab === 'create') draw(); })
      .catch((e) => { st.libState = 'failed'; st.libError = friendlyError(e); if (st.tab === 'create') draw(); });
  }
  async function useLibrarySticker(asset) {
    if (lockedFor(asset, currentPlan().tier)) { toast(PAID_MESSAGE); return; }
    try { const blob = await downloadStudioAsset(asset); await addSticker(new File([blob], `${asset.name}.png`, { type: blob.type || 'image/png' })); }
    catch (e) { toast(`Could not add the sticker: ${friendlyError(e)}`); }
  }
  function libraryGrid() {
    loadStickerLibrary();
    if (st.libState === 'loading') return h('p', { class: 'hint', style: 'text-align:left;margin:6px 0' }, 'Loading the sticker library…');
    if (st.libState === 'failed') return h('p', { class: 'hint', style: 'text-align:left;margin:6px 0' }, `The sticker library could not be loaded (${st.libError}). You can still add your own picture.`);
    const list = st.lib || []; if (!list.length) return null;
    const cats = new Map(); for (const a of list) (cats.get(a.category || 'Stickers') || cats.set(a.category || 'Stickers', []).get(a.category || 'Stickers')).push(a);
    const tier = currentPlan().tier;
    return h('div', { class: 'cs-stk-lib' }, ...[...cats].map(([cat, items]) => h('div', {}, h('small', { class: 'cs-stk-cat' }, cat),
      h('div', { class: 'cs-stk-grid' }, items.map((a) => { const locked = lockedFor(a, tier);
        return h('button', { type: 'button', class: `cs-stk-tile${locked ? ' locked' : ''}`, title: locked ? `Paid accounts only: ${a.name}` : `Add ${a.name}`, 'aria-label': locked ? `${a.name}, paid accounts only` : `Add ${a.name}`, onclick: () => useLibrarySticker(a) },
          a.thumb ? h('img', { src: a.thumb, alt: '', loading: 'lazy', decoding: 'async' }) : h('span', {}, '◌'), locked ? h('i', { class: 'cs-stk-lock', 'aria-hidden': 'true' }, icon('lock')) : null); })))));
  }
  function stickerPanel() {
    const file = h('input', { type: 'file', accept: 'image/*,.svg', style: 'display:none', onchange: (ev) => { const f = ev.target.files[0]; ev.target.value = ''; if (f) addSticker(f); } });
    const sel = st.stickers.find((k) => k.id === st.stkSel), target = layers().find((l) => l.region === st.guideFocus);
    const slider = (label, key, min, max, step, fmt = (v) => v) => h('label', { class: 'cs-stk-s' }, h('span', {}, label), h('input', { type: 'range', 'data-k': key, min, max, step, value: sel[key], oninput: (ev) => { sel[key] = +ev.target.value; ev.target.nextSibling.textContent = fmt(sel[key]); queueSticker(sel); } }), h('b', {}, fmt(sel[key])));
    return h('div', { class: 'cs-lgroup cs-stk' }, h('div', { class: 'cs-ghead static' }, h('span', { class: 'cs-gic' }, icon('star')), h('b', {}, 'Stickers'), h('small', {}, `${st.stickers.length} placed`)),
      h('p', { class: 'hint', style: 'text-align:left;margin:6px 0' }, 'First tap the body part in the list below (for example the upper arm). Then tap a sticker, or add your own PNG / SVG (you can also drop a picture on the canvas). It moves with that part.'),
      libraryGrid(),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, h('button', { class: 'btn sm', type: 'button', onclick: () => file.click() }, icon('upload'), h('span', {}, target ? `Your own picture on ${labelOf(target)}` : 'Your own picture')), file),
      ...st.stickers.map((k) => h('div', { class: `cs-stk-row${k.id === st.stkSel ? ' on' : ''}`, onclick: () => { st.stkSel = k.id; draw(); } }, h('b', {}, `Sticker on ${k.layer.split('/').pop()}`), h('button', { class: 'ib', type: 'button', title: 'Remove this sticker', 'aria-label': 'Remove this sticker', onclick: (ev) => { ev.stopPropagation(); removeSticker(k.id); } }, icon('trash')))),
      h('label', { class: 'tog cs-stk-solo', title: 'Hides every other body part and zooms in on the chosen one, so it is easy to place the sticker' }, h('input', { type: 'checkbox', checked: !!st.stkSolo, onchange: (ev) => { st.stkSolo = ev.target.checked; applySolo(); } }), 'Show only the chosen layer (hide the rest and zoom in)'),
      st.stkSolo && focusLayer() ? h('button', { class: 'btn sm', type: 'button', onclick: () => frameLayer() }, 'Zoom to this layer') : null,
      sel ? h('p', { class: 'hint', style: 'text-align:left;margin:6px 0' }, 'Drag the sticker on the picture to move it, the corner dot to resize, the round knob to turn. On a touch screen use two fingers to resize and turn.', sel.clip ? ' The faint, blurred part is outside the body part and will be cut away.' : '') : null,
      sel ? h('label', { class: 'tog cs-stk-clip', title: 'The sticker is cut to the shape of the body part, so nothing sticks out at the edge' }, h('input', { type: 'checkbox', checked: !!sel.clip, onchange: (ev) => { sel.clip = ev.target.checked; syncStickers(); } }), 'Keep it inside the body part (cut at the edge)') : null,
      sel ? h('div', { class: 'cs-stk-ctl' }, slider('Left / right', 'x', -600, 600, 1), slider('Up / down', 'y', -600, 600, 1), slider('Size', 's', 0.05, 3, 0.01, (v) => `${Math.round(v * 100)}%`), slider('Turn', 'rot', -180, 180, 1, (v) => `${v}°`), slider('Opacity', 'a', 0.1, 1, 0.01, (v) => `${Math.round(v * 100)}%`)) : null);
  }

  /* ---------- sticker handles on the picture: drag to move, corner to resize, round knob to turn; two fingers resize + turn. The part that will be cut away shows faint and blurred. ---------- */
  st.stkSolo = true;
  const mmul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const minv = (m) => { const d = m[0] * m[3] - m[1] * m[2] || 1e-9; return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]; };
  const mpt = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const focusLayer = () => layers().find((l) => l.region === st.guideFocus) || layers().find((l) => l.region === st.stickers.find((k) => k.id === st.stkSel)?.layer) || null;
  /** the slots to hide so that only the chosen layer (and its stickers) stays on the picture; the saved "hidden" list is not touched */
  function soloHide() {
    const l = st.stkSolo && st.tab === 'create' && st.def ? focusLayer() : null; if (!l) return [];
    const keep = new Set([l.slot, ...st.stickers.filter((k) => k.layer === l.region).map((k) => `stk_${k.name}`)]);
    return st.def.ske.armature[0].slot.map((x) => x.name).filter((n) => !keep.has(n)).concat(st.stickers.filter((k) => k.layer !== l.region).map((k) => `stk_${k.name}`));
  }
  let shapeCache = null;
  const shapeOf = (l) => { if (shapeCache?.region === l.region) return shapeCache.sh; const sh = layerShape(l); shapeCache = { region: l.region, sh }; return sh; };
  /** bring the chosen layer to the front of the picture: hide the rest and zoom in on it */
  function applySolo({ frame = true } = {}) {
    rebuild(); shapeCache = null;
    if (!st.stkSolo || !focusLayer()) { if (frame) st.resetView?.(); return; }
    if (frame) frameLayer();
  }
  function frameLayer(tries = 0) {
    const l = focusLayer(), sh = l && shapeOf(l), M = l && stage.boneMatrix('c', l.slot);
    if (!l || !sh) return;
    if (!M) { if (tries < 12) setTimeout(() => frameLayer(tries + 1), 100); return; }
    const w = sh.canvas.width / sh.f, hgt = sh.canvas.height / sh.f, pts = [[sh.ox, sh.oy], [sh.ox + w, sh.oy], [sh.ox, sh.oy + hgt], [sh.ox + w, sh.oy + hgt]].map(([x, y]) => mpt(M, x, y));
    const x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0])), y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]));
    const zoom = Math.min(16, Math.max(0.3, Math.min(stage.W / Math.max(40, (x1 - x0) * 1.2), stage.H / Math.max(40, (y1 - y0) * 1.2))));
    stage.userCam = { zoom, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
    stageBox.querySelector('.cs-zoomhint')?.classList.add('on');
  }
  const ov = { box: h('div', { class: 'cs-stk-box', title: 'Drag to move · two fingers to resize and turn' }), rs: h('div', { class: 'cs-stk-h rs', title: 'Drag to resize' }), rot: h('div', { class: 'cs-stk-h rot', title: 'Drag to turn' }), cv: h('canvas', { class: 'cs-stk-over', 'aria-hidden': 'true' }) };
  stageBox.append(ov.cv, ov.box, ov.rs, ov.rot);
  for (const e of [ov.box, ov.rs, ov.rot, ov.cv]) e.style.display = 'none';
  let ovQ = null, ghost = null, ghostKey = '', ghostAt = 0;
  const selSticker = () => st.stickers.find((k) => k.id === st.stkSel) || null;
  function syncSliders(k) { for (const key of ['x', 'y', 's', 'rot']) { const inp = panel.querySelector(`.cs-stk-s input[data-k="${key}"]`); if (inp) { inp.value = k[key]; const out = inp.nextSibling; if (out) out.textContent = key === 's' ? `${Math.round(k.s * 100)}%` : key === 'rot' ? `${Math.round(k.rot)}°` : Math.round(k[key]); } } }
  /** the faint, blurred picture of the part of the sticker that lies outside the body part (it is cut away when saved), drawn once per change in the bone's own space */
  function buildGhost(k, l) {
    const sh = shapeOf(l); if (!sh || !k.clip) return null;
    const cs = Math.cos((k.rot || 0) * Math.PI / 180), sn = Math.sin((k.rot || 0) * Math.PI / 180), hw = k.img.width * k.s / 2, hh = k.img.height * k.s / 2;
    const cp = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([u, v]) => [k.x + u * cs - v * sn, k.y + u * sn + v * cs]);
    const sw = sh.canvas.width / sh.f, shh = sh.canvas.height / sh.f;
    const x0 = Math.min(sh.ox, ...cp.map((p) => p[0])) - 4, y0 = Math.min(sh.oy, ...cp.map((p) => p[1])) - 4, x1 = Math.max(sh.ox + sw, ...cp.map((p) => p[0])) + 4, y1 = Math.max(sh.oy + shh, ...cp.map((p) => p[1])) + 4;
    const g = Math.min(1, 480 / Math.max(x1 - x0, y1 - y0)), c = makeCanvas(Math.max(1, Math.ceil((x1 - x0) * g)), Math.max(1, Math.ceil((y1 - y0) * g))), x = c.getContext('2d');
    x.save(); try { x.filter = 'blur(2px)'; } catch { /* no blur in this browser: the faint picture is still shown */ }
    x.globalAlpha = 0.45; x.translate((k.x - x0) * g, (k.y - y0) * g); x.rotate((k.rot || 0) * Math.PI / 180);
    x.drawImage(k.img, -hw * g, -hh * g, hw * 2 * g, hh * 2 * g); x.restore();
    x.globalCompositeOperation = 'destination-out'; x.drawImage(sh.canvas, (sh.ox - x0) * g, (sh.oy - y0) * g, sw * g, shh * g);          // what is inside the part stays out of it: it is already drawn for real
    return { c, x0, y0, g };
  }
  function overlayFrame() {
    const k = selSticker(), l = k && layers().find((x) => x.region === k.layer), M = k && st.tab === 'create' ? stage.boneMatrix('c', k.slot) : null, v = stage.view;
    if (!k || !l || !M || !v) { if (ov.box.style.display !== 'none') for (const e of [ov.box, ov.rs, ov.rot, ov.cv]) e.style.display = 'none'; ovQ = null; return; }
    const sbr = stageBox.getBoundingClientRect(), sb = { left: sbr.left + stageBox.clientLeft, top: sbr.top + stageBox.clientTop, width: stageBox.clientWidth, height: stageBox.clientHeight }, cr = stage.out.getBoundingClientRect(), f = cr.width / v.w, ox = cr.left - sb.left, oy = cr.top - sb.top;
    const P = [f, 0, 0, f, -v.x * f + ox, -v.y * f + oy], Q = mmul(P, M); ovQ = { Q, left: sb.left, top: sb.top };
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (ov.cv.width !== Math.round(sb.width * dpr) || ov.cv.height !== Math.round(sb.height * dpr)) { ov.cv.width = Math.round(sb.width * dpr); ov.cv.height = Math.round(sb.height * dpr); ov.cv.style.width = `${sb.width}px`; ov.cv.style.height = `${sb.height}px`; }
    for (const e of [ov.box, ov.rs, ov.rot, ov.cv]) e.style.display = '';
    const w = k.img.width, hgt = k.img.height, r = (k.rot || 0) * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
    const T = mmul(Q, mmul([1, 0, 0, 1, k.x, k.y], mmul([cs, sn, -sn, cs, 0, 0], mmul([k.s, 0, 0, k.s, 0, 0], [1, 0, 0, 1, -w / 2, -hgt / 2]))));
    ov.box.style.width = `${w}px`; ov.box.style.height = `${hgt}px`; ov.box.style.transformOrigin = '0 0'; ov.box.style.transform = `matrix(${T[0]},${T[1]},${T[2]},${T[3]},${T[4]},${T[5]})`;
    const lp = (u, vv) => mpt(Q, k.x + (u * cs - vv * sn) * k.s, k.y + (u * sn + vv * cs) * k.s), c0 = lp(0, 0), br = lp(w / 2, hgt / 2), tp = lp(0, -hgt / 2), dx = tp[0] - c0[0], dy = tp[1] - c0[1], dl = Math.hypot(dx, dy) || 1, kn = [tp[0] + dx / dl * 34, tp[1] + dy / dl * 34];
    ov.rs.style.transform = `translate(${br[0]}px,${br[1]}px)`; ov.rot.style.transform = `translate(${kn[0]}px,${kn[1]}px)`;
    const g = ov.cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, sb.width, sb.height);
    const gk = `${k.id}|${k.x}|${k.y}|${k.s}|${k.rot}|${k.clip}|${l.region}`;
    if (gk !== ghostKey && performance.now() - ghostAt > 60) { ghostKey = gk; ghostAt = performance.now(); ghost = buildGhost(k, l); }
    if (ghost && k.clip) { g.save(); const G = mmul(Q, [1 / ghost.g, 0, 0, 1 / ghost.g, ghost.x0, ghost.y0]); g.setTransform(dpr * G[0], dpr * G[1], dpr * G[2], dpr * G[3], dpr * G[4], dpr * G[5]); g.drawImage(ghost.c, 0, 0); g.restore(); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.lineWidth = 1.5; g.strokeStyle = '#7c6cff'; g.setLineDash([6, 4]);
    const corners = [lp(-w / 2, -hgt / 2), lp(w / 2, -hgt / 2), lp(w / 2, hgt / 2), lp(-w / 2, hgt / 2)];
    g.beginPath(); corners.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.stroke();
    g.setLineDash([]); g.beginPath(); g.moveTo(tp[0], tp[1]); g.lineTo(kn[0], kn[1]); g.stroke();
    g.fillStyle = '#fff'; for (const p of [br, kn]) { g.beginPath(); g.arc(p[0], p[1], 7, 0, Math.PI * 2); g.fill(); g.stroke(); }
  }
  {
    const pts = new Map(); let mode = null, k0 = null, base = null;
    const local = (inv, e) => mpt(inv, e.clientX - ovQ.left, e.clientY - ovQ.top);
    const begin = (e, m) => {
      const k = selSticker(); if (!k || !ovQ) return; e.preventDefault(); e.stopPropagation();
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* the pointer may already be gone */ }
      pts.set(e.pointerId, { cx: e.clientX, cy: e.clientY });
      const inv = minv(ovQ.Q);
      if (pts.size >= 2) { const [a, b] = [...pts.values()].map((p) => mpt(inv, p.cx - ovQ.left, p.cy - ovQ.top)); mode = 'pinch'; k0 = { x: k.x, y: k.y, s: k.s, rot: k.rot || 0 }; base = { inv, a, b, d: Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ang: Math.atan2(b[1] - a[1], b[0] - a[0]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }; return; }
      mode = m; k0 = { x: k.x, y: k.y, s: k.s, rot: k.rot || 0 }; base = { inv, p: local(inv, e) };
    };
    const move = (e) => {
      const k = selSticker(); if (!k || !mode || !pts.has(e.pointerId)) return; e.preventDefault();
      pts.set(e.pointerId, { cx: e.clientX, cy: e.clientY });
      const inv = base.inv;
      if (mode === 'pinch' && pts.size >= 2) {
        const [a, b] = [...pts.values()].map((p) => mpt(inv, p.cx - ovQ.left, p.cy - ovQ.top)), d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ang = Math.atan2(b[1] - a[1], b[0] - a[0]), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        k.s = Math.min(3, Math.max(0.05, k0.s * d / base.d)); k.rot = ((k0.rot + (ang - base.ang) * 180 / Math.PI + 540) % 360) - 180; k.x = k0.x + mid[0] - base.mid[0]; k.y = k0.y + mid[1] - base.mid[1];
      } else if (mode === 'move') { const p = local(inv, e); k.x = k0.x + p[0] - base.p[0]; k.y = k0.y + p[1] - base.p[1]; }
      else if (mode === 'scale') { const p = local(inv, e), d0 = Math.hypot(base.p[0] - k0.x, base.p[1] - k0.y) || 1; k.s = Math.min(3, Math.max(0.05, k0.s * Math.hypot(p[0] - k0.x, p[1] - k0.y) / d0)); }
      else if (mode === 'rot') { const p = local(inv, e); k.rot = ((k0.rot + (Math.atan2(p[1] - k0.y, p[0] - k0.x) - Math.atan2(base.p[1] - k0.y, base.p[0] - k0.x)) * 180 / Math.PI + 540) % 360) - 180; }
      k.x = Math.round(k.x * 10) / 10; k.y = Math.round(k.y * 10) / 10; k.s = +k.s.toFixed(3); k.rot = Math.round(k.rot * 10) / 10;
      syncSliders(k); queueSticker(k);
    };
    const end = (e) => { pts.delete(e.pointerId); if (pts.size === 0) { mode = null; if (selSticker()?.clip) syncStickers().catch(() => {}); } else if (pts.size === 1 && mode === 'pinch') { mode = null; } };
    for (const [el, m] of [[ov.box, 'move'], [ov.rs, 'scale'], [ov.rot, 'rot']]) { el.addEventListener('pointerdown', (e) => begin(e, m)); el.addEventListener('pointermove', move); el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); }
    ov.box.addEventListener('wheel', (e) => { const k = selSticker(); if (!k) return; e.preventDefault(); k.s = Math.min(3, Math.max(0.05, +(k.s * Math.exp(-e.deltaY * 0.001)).toFixed(3))); syncSliders(k); queueSticker(k); }, { passive: false });
  }

  /* ---------- model: rig edits (nudges + face profile) ---------- */
  const mergeEdit = (a, b) => ({ dx: (a?.dx || 0) + (b?.dx || 0), dy: (a?.dy || 0) + (b?.dy || 0), s: (a?.s ?? 1) * (b?.s ?? 1), rot: (a?.rot || 0) + (b?.rot || 0) });
  function rigEdits() {
    const fe = faceEdits(st.face, st.def.ske), xf = { ...fe.xf };
    for (const [k, e] of Object.entries(st.xf)) xf[k] = mergeEdit(xf[k], e);
    return { xf, bones: fe.bones, attach: st.attach, order: st.order, stickers: st.stickers.map(({ name, slot, x, y, s: sz, rot, a, tf }) => ({ name, slot, x, y, s: sz, rot, a, tf })) };
  }
  const currentRig = () => patchRig(st.def.ske, rigEdits());
  function rebuild() {
    if (!st.def) return;
    stage.setRig(st.def.id, currentRig(), stickerEntry() ? [...st.def.tex, stickerEntry()] : st.def.tex);
    const anims = st.anim && st.anim.json ? { [st.anim.key]: st.anim.json } : {};
    if (st.over && st.anim && st.over.json) anims[st.over.key] = st.over.json;
    stage.setLayers([{ key: 'c', charId: st.def.id, artworkPages: { ...st.artworkPages }, anims, clips: st.anim ? [{ id: 'a', kind: 'body', name: st.anim.key, start: 0, dur: 36000, off: 0 }, ...(st.over ? [{ id: 'o', kind: st.over.kind, name: st.over.key, start: 0, dur: 36000, off: 0 }] : [])] : [], flip: false, slot: 0, visible: true, xf: null, skins: st.skins, hide: [...new Set([...st.hide, ...soloHide()])], fit: st.fit, lockBounds: true }]);
  }
  const queueRig = () => { clearTimeout(rigTimer); rigTimer = setTimeout(rebuild, 120); };

  /* ---------- picking a character ---------- */
  async function pick(d, label) {
    gen++; pending = new Set(); clearTimeout(applyTimer); Object.values(st.artworkPages).forEach((k) => stage.dropArtworkCanvas(k));
    if (st.def && st.def.id !== d.id) stage.unload(st.def.id);
    stage.unload(d.id);
    // a saved character is opened on its template's skeleton again, with its settings, so everything stays editable
    const saved = !!d.baseSke, pr = d.profile || {}, src = saved ? { ...d, ske: d.baseSke } : d;
    d = src.tex?.some((t) => t.json.imagePath === STICKER_PAGE) ? { ...src, tex: src.tex.filter((t) => t.json.imagePath !== STICKER_PAGE) } : src;          // the sticker page is handled on its own
    Object.assign(st, { fit: getFit(d.id), over: null, def: d, savedId: saved ? d.id : null, skins: saved ? (pr.skins ?? null) : (d.skins ?? null), hide: new Set(saved ? pr.hide || [] : []), edit: new Map(), xf: saved ? pr.xf || {} : {}, order: saved ? pr.order || {} : {}, attach: pr.attach || {}, face: saved && pr.face ? pr.face : faceDefaults(), locked: new Set(saved ? pr.locked || [] : []), work: {}, orig: {}, artworkPages: {}, dirty: new Set(), cbox: new Map(), anim: null, open: null, openGroup: null, filter: '', name: `${d.name}${d.profile?.template ? '' : ' (mine)'}` });
    if (d.profile?.template) st.tpl = d.profile.template; else st.tpl = null;
    st.pages = d.tex.map((t) => t.json.imagePath); st.regions = new Map(); thumbs.clear();
    for (const t of d.tex) for (const r of t.json.SubTexture) st.regions.set(r.name, { page: t.json.imagePath, x: r.x, y: r.y, w: r.width, h: r.height, deg: 0 });
    // New templates show the complete character. Uploads replace their own atlas regions;
    // untouched parts keep the template artwork, and saved characters retain their visibility settings.
    toast(`Loading ${label || d.name}…`);
    try {
      await stage.loadCharacter(d);
      for (const pg of st.pages) await pageCanvas(pg);

    } catch (e) { toast(`Could not load: ${e.message}`); return; }
    try { await setAnimation(defaultAnim()); } catch { /* static pose */ }
    try { await restoreStickers(saved ? pr : null, d.pages); } catch (e) { console.warn('stickers not restored', e); st.stickers = []; }
    rebuild(); t0 = performance.now(); st.tab = 'create'; draw(); drawAnimBar();
    toast(`${label || d.name} is ready — change any layer.`);
  }

  /* ---------- animation preview ---------- */
  const animChoices = () => categoriesFor(st.def.rig).filter((c) => !c.overlay).flatMap((c) => c.animations.map((a) => ({ ...a, cat: c.name })));
  const defaultAnim = () => { const l = animChoices(); return l.find((a) => /^idle/i.test(a.name)) || l.find((a) => a.cat === 'Idle') || l[0] || null; };
  async function setAnimation(a) {
    const json = a ? await fetchAnimation(a.ref.file) : null;
    st.anim = a ? { key: a.ref.rigAnim || `a${a.ref.id}`, name: a.name, json } : null;
    t0 = performance.now(); lastFrame = 0;
    rebuild(); drawAnimBar();
  }
  function drawAnimBar() {
    if (!st.def) { animBar.replaceChildren(h('p', { class: 'hint' }, 'Pick a template, then change it layer by layer.')); return; }
    const list = animChoices(), i = list.findIndex((a) => st.anim && (a.ref.rigAnim || `a${a.ref.id}`) === st.anim.key);
    const go = async (d) => { if (!list.length) return; try { await setAnimation(list[(i + d + list.length) % list.length]); } catch (e) { toast(e.message); } };
    animBar.replaceChildren(
      h('button', { class: 'btn sm', onclick: () => go(-1), disabled: !list.length }, '‹'),
      h('span', { class: 'cs-anim-name' }, st.anim?.name || 'No animation'),
      h('button', { class: 'btn sm', onclick: () => go(1), disabled: !list.length }, '›'),
      h('div', { class: 'seg3' }, [['wide', 'Full'], ['medium', 'Upper body'], ['close', 'Face']].map(([k, l]) => h('button', { class: st.zoom === k ? 'on' : '', onclick: () => { st.zoom = k; st.resetView?.(); drawAnimBar(); } }, l))),
      h('label', { class: 'tog' }, h('input', { type: 'checkbox', checked: st.mouth, onchange: (e) => { st.mouth = e.target.checked; } }), h('span', {}, 'Test mouth')));
  }

  /* ---------- panels ---------- */
  // creators only upload their own parts (Start / Create / Save)
  const TABS = [['start', 'Start'], ['create', 'Create'], ['save', 'Save']];
  function draw() {
    if (st.def) { const sk = soloHide().join('|'); if (sk !== st.soloKey) { const was = !!st.soloKey; st.soloKey = sk; rebuild(); if (was && !sk) st.resetView?.(); } }          // a sticker's solo view comes and goes with the tab and the chosen layer
    if (!TABS.some(([key]) => key === st.tab)) st.tab = 'start';       // a tab this page does not offer is never shown (e.g. an old saved draft)
    tabs.replaceChildren(...TABS.filter(([k]) => !localPreview || k !== 'save').map(([k, l]) => h('button', { class: st.tab === k ? 'on' : '', disabled: k !== 'start' && !st.def, onclick: () => { st.tab = k; draw(); } }, l)));
    panel.replaceChildren(...{ start: panelStart, create: panelCreate, save: panelSave }[st.tab]().filter(Boolean));      // a missing item must not show up as the word "null"
  }

  async function importCharacterFiles(files) {
    const { characters } = await ingest(files).catch((er) => { toast(er.message); return { characters: [] }; });
    if (!characters.length) { toast('No character was found. A DragonBones character ZIP must contain the skeleton (_ske.json), texture atlas (_tex.json) and image.'); return; }
    for (const c of characters) { await saveCharacter(c); const i = mine.findIndex((x) => x.id === c.id); if (i >= 0) mine[i] = c; else mine.push(c); }
    toast(`Added ${characters.length} character${characters.length > 1 ? 's' : ''}.`); draw();
  }

  function panelStart() {
    const file = h('input', { type: 'file', accept: '.zip,.json,image/*', multiple: true, style: 'display:none', onchange: async (e) => {
      const files = [...e.target.files]; e.target.value = ''; await importCharacterFiles(files);
    } });
    const lib = libraryCharacters();
    const open = (e) => async () => { try { await pick(await fetchLibraryCharacter(e), `${e.name} · ${e.pose}`); st.tpl = e.template ? { id: e.id } : null; } catch (er) { toast(`Could not download: ${er.message}`); } };
    const templates = lib;
    const cloudOnly = st.cloud.filter((c) => !mine.some((m) => m.id === c.id));
    return [
      h('div', { class: 'cs-sec' }, h('h3', {}, 'Pick the base body (skeleton + animations come with it)'), h('p', { class: 'sub', style: 'font-size:12px;margin:0 0 8px' }, 'Every template comes with its layers, animations and lip-sync. Pick one, then replace its layers with your own art.'),
        characterPicker({ entries: templates, isOn: (e) => !!st.def && st.def.id === `lib:${e.id}`, onPick: (e) => open(e)() })),
      h('div', { class: 'cs-sec' }, h('h3', {}, 'My characters'), h('div', { class: 'cs-grid' },
        h('div', { class: 'cs-card add', onclick: () => file.click() }, h('span', { class: 'cs-th' }, '+'), h('b', {}, 'Add ZIP'), h('small', {}, 'DragonBones ske + tex + png')),
        mine.map((c) => h('div', { class: `cs-card ${st.def?.id === c.id ? 'on' : ''}`, onclick: () => pick(c) }, h('span', { class: 'cs-th' }, c.thumb ? h('img', { src: c.thumb, alt: '' }) : icon('user')), h('b', {}, c.name),
          h('button', { class: 'ib', title: 'Delete', onclick: async (e) => { e.stopPropagation(); if (!confirm(`Delete ${c.name}?`)) return; await deleteCharacter(c.id); deleteCharacterCloud(c.id).then(() => { st.cloud = st.cloud.filter((x) => x.id !== c.id); }).catch(() => {}); mine.splice(mine.indexOf(c), 1); draw(); } }, icon('x')))),
        cloudOnly.map((c) => h('div', { class: 'cs-card', onclick: async () => { toast(`Downloading ${c.name}…`); try { const rec = await loadCharacterCloud(c); await saveCharacter(rec); const d = await hydrateCharacter(rec); if (!d) throw new Error('This template is no longer available.'); mine.push(d); await pick(d); } catch (er) { toast(er.message); } } }, h('span', { class: 'cs-th' }, c.thumb ? h('img', { src: c.thumb, alt: '' }) : '☁'), h('b', {}, c.name), h('small', {}, '☁ from your account'),
          h('button', { class: 'ib', title: 'Delete from your account', 'aria-label': `Delete ${c.name} from your account`, onclick: async (e) => {
            e.stopPropagation(); if (!confirm(`Delete ${c.name} from your account? This cannot be undone.`)) return;
            try {
              await deleteCharacterCloud(c.id);
              st.cloud = await listCharactersCloud();      // ask the account again, so the card only disappears when it is really gone
              if (st.cloud.some((x) => x.id === c.id)) toast('This character could not be deleted right now. Please try again.'); else toast(`${c.name} was deleted.`);
            } catch (er) { toast(`Could not delete ${c.name}: ${friendlyError(er)}`); }
            draw();
          } }, icon('x'))))), file),
    ];
  }

  /** the layer's picture opens in the picture editor (brushes, fill, magic select, shadows ...); the result replaces the layer's picture */
  function paintLayer(l) {
    if (st.locked.has(l.region)) { toast('This layer is locked.'); return; }
    const src = cropOf(l.region, 2400); if (!src) { toast('This layer has no picture to edit yet.'); return; }
    openPhotoEditor({ canvas: src, title: labelOf(l), onApply: (cv) => {
      const e = editOf(l.region); e.img = cv; e.trim = null; e.removed = false; e.fill = false; e.hue = 0; e.sat = 1; e.light = 0;          // the colour changes are already inside the picture now
      queue([l.region]); autoSoon(); draw(); toast('Picture updated.');
    } });
  }
  async function putImage(l, file) {
    if (st.locked.has(l.region)) { toast('This layer is locked.'); return; }
    try {
      const e = editOf(l.region); e.img = await readImage(file, file.name); e.trim = null;
      if (st.outline && !e.mode) e.mode = 'outline'; e.removed = false;
      queue([l.region]); autoSoon();
    } catch (er) { toast(`Could not read ${file.name}: ${er.message}`); }
  }
  /** many files / a ZIP of layers: matched by layer name (ARM_L.svg, Mouth_A.png, PS_TORSO_2.svg ...) */
  async function bulkUpload(files) {
    const items = []; let psds = 0, unreadable = 0;
    toast(`Reading ${files.length} file${files.length > 1 ? 's' : ''}…`);
    for (const f of files) {
      try {
        if (/\.psd$/i.test(f.name)) { psds++; await importPsd(f); continue; }
        if (/\.zip$/i.test(f.name)) { const z = await JSZip.loadAsync(f); for (const e of Object.values(z.files)) if (!e.dir && isImage(e.name)) items.push({ name: e.name.split('/').pop(), blob: await e.async('blob') }); }
        else if (isImage(f.name)) items.push({ name: f.name, blob: f });
        else unreadable++;
      } catch (e) { console.warn('upload file failed', f.name, e); unreadable++; }
    }
    if (psds && !items.length) return;      // a PSD reports for itself (importPsd); do not overwrite its message
    const all = layers();
    const norm = (n) => n.replace(/\.[^.]+$/, '').replace(/\//g, '_');
    const hits = new Map(), unmatched = [];     // region -> layer: when two files name the same part, the later one wins
    // every picture is read and set first; the rig is rebuilt ONCE at the end (rebuilding after each file made 8 files take 8 seconds)
    for (const it of items) {
      const n = norm(it.name);
      const l = all.find((x) => norm(x.region) === n) || all.find((x) => norm(x.key) === n && !st.locked.has(x.region)) || all.find((x) => norm(x.region).replace(/^(PS|SL)_/, '') === n.replace(/^(PS|SL)_/, ''));
      if (!l || st.locked.has(l.region)) { unmatched.push(it.name); continue; }
      try {
        const e = editOf(l.region); e.img = await readImage(it.blob, it.name); e.trim = null; if (st.outline && !e.mode) e.mode = 'outline'; e.removed = false;
        hits.set(l.region, l);
      } catch (e) { console.warn('picture not readable', it.name, e); unreadable++; }
    }
    if (hits.size) { queue([...hits.keys()]); autoSoon(); }
    const parts = [hits.size ? `${hits.size} layer${hits.size > 1 ? 's' : ''} replaced.` : 'No file matched a layer name. Name files like the layers (ARM_L.png, Mouth_A.svg …).'];
    if (hits.size && unmatched.length) parts.push(`${unmatched.length} file name${unmatched.length > 1 ? 's' : ''} did not match any layer (${unmatched.slice(0, 3).join(', ')}${unmatched.length > 3 ? ' …' : ''}).`);
    if (unreadable) parts.push(`${unreadable} file${unreadable > 1 ? 's' : ''} could not be read.`);
    toast(parts.join(' '));
    draw();
  }
  /* ---------- PSD: every picture of this pose as a named layer, and back ---------- */
  const normName = (n) => String(n).replace(/\.[^.]+$/, '').replace(/[\\/]+/g, '_').trim().toLowerCase();
  const PSD_GROUPS = new Set(['Top', 'Bottom', 'Face', 'Eyes', 'Eyebrows', 'Nose', 'Ears', 'Hair', 'Earrings', 'Lips']);   // clothes + the whole face (no palms)
  /** the pictures of this pose with their fixed boxes, plus where each one stands in the rig's own set-up pose (the figure in the PSD is built from it) */
  function psdItems() {
    const base = baseOf(), all = layers().filter((l) => !layerHidden(base, l.slot, l.key) && PSD_GROUPS.has(l.group));   // clothes and the face (palms stay out)
    let built = null;
    try { built = stage.armatureFor(st.def.id, st.skins); } catch (e) { console.warn('set-up pose failed', e); }
    if (built) stage.disposeTemp(built);
    const count = new Map(); for (const l of all) count.set(l.slot, (count.get(l.slot) || 0) + 1);
    const items = all.map((l) => {
      const reg = st.regions.get(l.region), it = { l, key: l.key, name: safe(l.region), group: groupName(base, l.group), w: reg.w, h: reg.h, slotIndex: 0, panel: count.get(l.slot) > 1, art: null, cb: contentBox(l.region), kind: kindOf(l.key), ww: 0, wcx: 0, wcy: 0 };
      try {
        const slot = built?.arm.getSlot(l.slot), idx = built?.prep.disp.get(l.slot)?.get(l.key);
        if (slot && idx != null) {
          it.slotIndex = built.prep.slotIndex.get(l.slot);
          slot.displayIndex = idx; built.arm.advanceTime(0);
          const list = []; slot.collect(list);
          if (list.length) {
            const v = list[0].verts; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
            for (let k = 0; k < v.length; k += 2) { x0 = Math.min(x0, v[k]); x1 = Math.max(x1, v[k]); y0 = Math.min(y0, v[k + 1]); y1 = Math.max(y1, v[k + 1]); }
            it.ww = x1 - x0; it.wcx = (x0 + x1) / 2; it.wcy = (y0 + y1) / 2;
          }
        }
      } catch { /* picture without a set-up place goes to the grid */ }
      return it;
    });
    // rig units -> picture pixels: the median over the pictures that fill their box (the texture is stored at a smaller scale)
    const rs = items.filter((i) => i.ww > 1 && i.cb.w > 1).map((i) => i.cb.w / i.ww).sort((a, b) => a - b), s = rs.length ? rs[Math.floor(rs.length / 2)] : 0.8;
    for (const it of items) if (it.ww > 1) it.art = { x: it.wcx * s, y: it.wcy * s };
    return items;
  }
  /** a PSD (edited): each layer goes back to the picture of the same name, keeping its place inside the box */
  async function importPsd(file) {
    toast('Reading the PSD…');
    try {
      const items = psdItems(), { pos } = planPsd(items);
      const byName = new Map(items.map((i) => [normName(i.name), i])), { layers: found } = await readPsdLayers(file);
      let hit = 0; const regs = [];
      for (const pl of found) {
        const it = byName.get(normName(pl.name));
        if (!it || st.locked.has(it.l.region)) continue;
        const e = editOf(it.l.region), p = pos.get(it.name);
        if (pl.hidden || !pl.canvas) { e.removed = true; e.img = null; }
        else {
          const box = makeCanvas(p.w, p.h);
          box.getContext('2d').drawImage(pl.canvas, pl.left - p.x, pl.top - p.y);      // same spot as when it was exported
          e.img = box; e.removed = false; e.fill = false;
        }
        regs.push(it.l.region); hit++;
      }
      if (hit) queue(regs);
      toast(hit ? `${hit} layer${hit > 1 ? 's' : ''} taken from the PSD.` : `No layer of this PSD matches a part of this pose (PSD layers: ${found.slice(0, 4).map((l) => l.name).join(', ') || 'none found'}${found.length > 4 ? ' …' : ''}). Download the PSD from this character and pose, edit it and keep the layer names.`);
      draw();
    } catch (e) { console.warn(e); toast(`Could not read the PSD: ${e.message}`); }
  }

  /** the admin's name for a layer (falls back to the original name) */
  function baseOf() { return st.def?.rig?.toonChar || null; }
  function labelOf(l) { return layerName(baseOf(), l.slot, l.key, l.key); }
  /* ---------- the art decides the proportions ---------- */
  /** which limb a picture belongs to ('arm' | 'leg' | 'hand' | ''), from the bone its slot hangs on */
  function limbClass(l) {
    let lm; try { lm = stage.limbsOf(st.def.id, st.skins).limbs; } catch { return ''; }
    const bone = st.def.ske.armature[0].slot.find((x) => x.name === l.slot)?.parent, inChain = (chains) => chains.some((ch) => ch.includes(bone));
    if (!bone) return '';
    if (lm.hands.includes(bone)) return 'hand';
    if (inChain(lm.arms)) return 'arm';
    if (inChain(lm.skinLegs?.length ? lm.skinLegs : lm.legs)) return 'leg';
    return '';
  }
  /** how much longer (> 1) or shorter (< 1) than the original part the uploaded art is, when both are shown at the same width */
  function artRatio(l) {
    const e = st.edit.get(l.region);
    if (!e?.img || e.removed) return null;
    const tb = (e.trim ||= trimBox(e.img)), cb = contentBox(l.region);
    if (!(tb.w > 4 && tb.h > 4 && cb.w > 4 && cb.h > 4)) return null;
    return Math.min(2.2, Math.max(0.45, (tb.h / tb.w) / (cb.h / cb.w)));
  }
  /** after uploads: arms / legs / hands get the length of the user's art (the Body sliders move), other parts stretch their mesh along the art (xf.sv) */
  function autoProportions(quiet = false) {
    const by = { arm: [], leg: [], hand: [] }, med = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
    for (const l of layers()) {
      const r = artRatio(l); if (r == null) continue;
      const c = limbClass(l), key = `${l.slot}|${l.key}`;
      if (c) { by[c].push(r); if (st.xf[key]?.sv) st.xf[key].sv = 1; }
      else if (st.outline && !st.edit.get(l.region)?.noGeo) { const cur = st.xf[key] || (st.xf[key] = { dx: 0, dy: 0, s: 1, rot: 0, sv: 1 }); cur.sv = Math.abs(r - 1) < 0.05 ? 1 : r; }
    }
    const f = st.fit || (st.fit = getFit(st.def.id)), lim = (k, v) => Math.min(FIT_LIMITS[k][1], Math.max(FIT_LIMITS[k][0], v)), said = [];
    for (const [k, key, name] of [['arm', 'arm', 'Arms'], ['leg', 'leg', 'Legs'], ['hand', 'hand', 'Hands']]) if (by[k].length) { f[key] = lim(key, med(by[k])); said.push(`${name} ${Math.round(f[key] * 100)}%`); }
    setFit(st.def.id, f); queueRig();
    if (!quiet) toast(said.length ? `Lengths set from your art: ${said.join(', ')}` : 'Upload arm, leg or hand pictures first — then their length is taken from them.');
  }
  let autoTimer = 0;
  const autoSoon = () => { if (!st.outline || st.autoLen === false) return; clearTimeout(autoTimer); autoTimer = setTimeout(() => { autoProportions(true); if (st.tab === 'create' || st.tab === 'body') draw(); }, 900); };

  /* ---------- create my own character: the parts to draw, a template sheet, upload per part ---------- */
  const CREATE_ORDER = ['Face', 'Hair', 'Eyes', 'Eyebrows', 'Nose', 'Lips', 'Ears', 'Earrings', 'Top', 'Bottom', 'Shoes', 'Palms'];
  const GROUP_COLOUR = { Top: '#b4c8ff', Bottom: '#f3f28a', Shoes: '#ffcf8a', Face: '#f0f070', Hair: '#d0e08c', Eyes: '#9ae6f5', Eyebrows: '#7fd8ea', Nose: '#ffc9b0', Lips: '#6aeaf5', Ears: '#a8f5c5', Earrings: '#e8c0ff', Palms: '#e4e4e4' };
  const createRows = () => {
    // one picture per slot (the one the character shows) + every mouth shape; the other variants (more hand shapes, eyelids …) stay in the Layers tab
    const base = baseOf(), all = layers().filter((l) => !layerHidden(base, l.slot, l.key) && (st.slot_attach(l.slot) === l.key || l.group === 'Lips' || l.region === st.guideFocus)), rank = (g) => (CREATE_ORDER.indexOf(g) < 0 ? 99 : CREATE_ORDER.indexOf(g));
    return all.sort((a, b) => rank(a.group) - rank(b.group) || labelOf(a).localeCompare(labelOf(b)));
  };
  /** one picture with a box per part (true proportions), its name and pixel size */
  function panelCreate() {
    const rows = createRows(), isUtility = l => localPreview && st.previewUtilityRegions?.has(l.region), artworkRows = rows.filter(l => !isUtility(l)), done = artworkRows.filter((l) => st.edit.get(l.region)?.img).length;
    const bulk = h('input', { type: 'file', multiple: true, accept: '.psd,.zip,image/*,.svg', style: 'display:none', onchange: (ev) => { const f = [...ev.target.files]; ev.target.value = ''; bulkUpload(f); } });
    const groups = new Map();
    for (const l of rows) (groups.get(l.group) || groups.set(l.group, []).get(l.group)).push(l);
    const row = (l) => {
      const reg = st.regions.get(l.region), e = st.edit.get(l.region), file = h('input', { type: 'file', accept: 'image/*,.svg', style: 'display:none', onchange: (ev) => { const f = ev.target.files[0]; ev.target.value = ''; if (f) putImage(l, f).then(draw); } });
      return h('div', { class: `cs-lrow cs-crow ${e?.img ? 'done' : ''} ${st.guideFocus === l.region ? 'rig-guide-selected' : ''}`, 'data-rig-region': l.region, title: 'Tap to choose this part (for stickers and the guide)', onclick: (ev) => { if (ev.target.closest('button,input,label,a')) return; st.guideFocus = st.guideFocus === l.region ? null : l.region; draw(); if (st.stkSolo) applySolo(); } }, thumb(l.region), h('div', { class: 'cs-lname' }, h('b', {}, labelOf(l)), h('small', {}, `${reg.w}×${reg.h}px${isUtility(l) ? ' · Transparent utility slot' : e?.img ? ` · PNG ${e.img.width}×${e.img.height}px` : ''}`)),
        h('button', { class: 'ib cs-edit', title: 'Edit this picture: brushes, fill, magic select, shadows', 'aria-label': `Edit ${labelOf(l)}`, onclick: (ev) => { ev.stopPropagation(); paintLayer(l); } }, icon('pencil')), h('button', { class: `btn sm cs-up ${e?.img ? '' : 'pri'}`, onclick: (ev) => { ev.stopPropagation(); file.click(); } }, icon(e?.img ? 'refresh' : 'upload'), h('span', {}, e?.img ? 'Replace' : 'Upload')), file);
    };
    return [
      h('p', { class: 'sub', style: 'font-size:12px;margin:0 0 8px' }, 'Draw these parts in your own style (same angle as the template, transparent background), upload them one by one, or all together with the template sheet / a PSD. The skeleton, animations, lip-sync and physics come with the base body, so every animation works on your character.'),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
        h('button', { class: 'btn sm', title: 'An edited PSD or a ZIP / many files named like the parts', onclick: () => bulk.click() }, icon('upload'), h('span', {}, 'Upload many')), bulk),
      h('div', { class: 'cs-guide-status', 'aria-live': 'polite' }, (() => { const l = rows.find((item) => item.region === st.guideFocus); const img = l && st.edit.get(l.region)?.img; const reg = l && st.regions.get(l.region); return l ? `${labelOf(l)} · ${img ? `PNG ${img.width} × ${img.height}px · ` : ''}fixed universal-rig target ${reg.w} × ${reg.h}px · all uploaded parts stay visible` : `All template parts and uploaded parts show together.`; })()),
      stickerPanel(),
      h('label', { class: 'tog' }, h('input', { type: 'checkbox', checked: st.outline, onchange: (ev) => { st.outline = ev.target.checked; } }), "Optional: stretch the art to the part outline (turn off to compare the uploaded shape against the fixed rig guide)"),
      h('label', { class: 'tog' }, h('input', { type: 'checkbox', checked: st.autoLen !== false, onchange: (ev) => { st.autoLen = ev.target.checked; if (ev.target.checked) autoProportions(); } }), 'Optional: adjust arm / leg / hand lengths from the uploaded art (leave off to keep the universal rig fixed)'),
      h('div', { class: 'cs-prog' }, h('b', {}, localPreview ? `${done} of ${artworkRows.length} artwork placements · ${rows.length - artworkRows.length} transparent utility slots validated` : `${done} of ${rows.length} parts uploaded`), h('div', { class: 'cs-bar' }, h('i', { style: `width:${artworkRows.length ? Math.round((done / artworkRows.length) * 100) : 0}%` }))),
      h('p', { class: 'hint', style: 'text-align:left;margin:0' }, 'Parts you skip stay as the base body shows them. Save tab: keep it in your account.'),
      ...[...groups].map(([g, list]) => h('div', { class: 'cs-lgroup' }, h('div', { class: 'cs-ghead static' }, h('span', { class: 'cs-gic' }, icon(GROUP_ICON[g] || 'shapes')), h('b', {}, groupName(baseOf(), g)), h('small', {}, `${list.filter((l) => st.edit.get(l.region)?.img).length}/${list.length}`)), h('div', { class: 'cs-lbody' }, ...list.map(row)))),
    ];
  }
  /** the finished character: edits baked into rig + images, plus the edit profile */
  async function bake() {
    for (const pg of st.pages) await pageCanvas(pg);
    if (pending.size) { clearTimeout(applyTimer); await flush(); }
    const profile = { template: st.tpl, skins: st.skins, hide: [...st.hide], face: st.face, xf: st.xf, order: st.order, attach: st.attach, locked: [...st.locked], fit: st.fit || getFit(st.def.id), ...stickerProfile() };
    const ske = bakeSke(st.def.ske, profile), tex = [], pages = {};
    for (const t of st.def.tex) {
      const pg = t.json.imagePath, image = st.dirty.has(pg) ? await toBlob(st.work[pg]) : t.image;
      tex.push({ json: t.json, image });
      if (st.dirty.has(pg) || st.def.pages?.[pg]) pages[pg] = image;       // only pictures the user changed are kept; the rest comes from the template
    }
    if (st.stickers.length && st.stkBlob) { tex.push({ json: stickerAtlasJson(st.stkAtlas), image: st.stkBlob }); pages[STICKER_PAGE] = st.stkBlob; }          // the sticker page is saved with the character
    return { ske, tex, pages, profile };
  }
  function snapshot() {
    const c = makeCanvas(160, 200), g = c.getContext('2d'), src = stage.out, k = Math.min(160 / src.width, 200 / src.height);
    const uc = stage.userCam; stage.userCam = null;
    try { stage.render(previewTime(performance.now()), 0, [], [{ start: 0, end: 1e9, speaker: 'c', type: 'medium', focus: 'auto' }]); g.fillStyle = '#eef2f7'; g.fillRect(0, 0, 160, 200); g.drawImage(src, (160 - src.width * k) / 2, (200 - src.height * k) / 2, src.width * k, src.height * k); return c.toDataURL('image/webp', 0.8); } catch { return ''; } finally { stage.userCam = uc; }
  }
  const newId = () => `c${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
  /** saves the character: small record on this device and (logged in) in the account; checks the per-user limits first */
  async function saveNow(nameVal, asNew) {
    const { ske, tex, pages, profile } = await bake(), baseId = st.def.base || (st.def.lib ? st.def.id : null), id = !asNew && st.savedId ? st.savedId : newId();
    const kept = mine.filter((c) => c.id !== id).length + st.cloud.filter((c) => c.id !== id && !mine.some((m) => m.id === c.id)).length;
    if (kept >= LIMITS.characters) throw new Error(`You can only keep ${LIMITS.characters} characters. Please delete one first.`);
    let total = 0;
    for (const b of Object.values(pages)) { if (b.size > LIMITS.pageBytes) throw new Error(`One picture page is ${mb(b.size)}, but the limit is ${mb(LIMITS.pageBytes)}. Please use smaller pictures.`); total += b.size; }
    if (total > LIMITS.characterBytes) throw new Error(`This character's pictures total ${mb(total)}, but the limit is ${mb(LIMITS.characterBytes)}.`);
    setFit(id, profile.fit);
    const name = nameVal.trim() || 'My character', thumb = snapshot(), pose = st.def.pose || '';
    let rec;
    if (baseId) rec = { id, name, pose, base: baseId, profile, pages, thumb };
    else { const { bones, slots, skins, ...keep } = st.def.rig; rec = { id, name, pose, ske, tex, rig: rigInfo(ske, keep), anims: [], skins: null, thumb, profile }; }     // a character that did not come from a template keeps its whole skeleton
    await saveCharacter(rec);
    const full = baseId ? await hydrateCharacter(rec) : rec, i = mine.findIndex((c) => c.id === id);
    if (i >= 0) mine[i] = full; else mine.push(full);
    if (baseId) st.savedId = id;
    let msg = `✓ Saved on this device (${mb(total) === '0 MB' ? 'a few KB' : mb(total)} of your own pictures).`;
    if (await cloudReady()) {
      try { await saveCharacterCloud(rec); if (!st.cloud.some((c) => c.id === id)) st.cloud.push({ id }); msg = '✓ Saved on this device and in your account.'; }
      catch (er) { msg = `✓ Saved on this device. Account: ${friendlyError(er)}`; }
    }
    else if (user?.uid && user.uid !== 'debug') msg += ' (Cloud saving is unavailable right now.)';
    return msg;
  }
  function panelSave() {
    const name = h('input', { type: 'text', value: st.name, oninput: (e) => { st.name = e.target.value; } });
    const status = h('p', { class: 'hint', style: 'text-align:left' }, '');
    const changed = st.edit.size + st.hide.size + Object.keys(st.xf).length + Object.keys(st.attach).length + (st.skins ? 1 : 0);
    const go = (asNew) => async (e) => {
      const btn = e.currentTarget; btn.disabled = true; status.textContent = 'Saving…';
      try { const msg = await saveNow(name.value, asNew); status.textContent = msg; toast(msg); draw(); } catch (er) { status.textContent = `Could not save: ${friendlyError(er)}`; } finally { btn.disabled = false; }
    };
    return [h('div', { class: 'cs-sec' }, h('h3', {}, 'Save this character'),
      h('p', { class: 'sub', style: 'font-size:12px;margin:0 0 8px' }, `Saved on this device and, when you are logged in, in your 12toons account (up to ${LIMITS.characters} characters). Only your own pictures and settings are stored — the skeleton and the untouched parts come from the template. 12toons (the animation studio) then loads exactly this character and plays every animation on it.`),
      h('label', { class: 'f' }, 'Name', name),
      h('div', { class: 'row', style: 'margin-top:12px' },
        h('button', { class: 'btn pri', onclick: go(false) }, icon('download'), h('span', {}, st.savedId ? 'Update this character' : 'Save character')),
        st.savedId ? h('button', { class: 'btn', onclick: go(true) }, icon('plus'), h('span', {}, 'Save as a new copy')) : null,
      ),
      status,
      h('p', { class: 'hint', style: 'text-align:left' }, changed ? `${changed} change${changed > 1 ? 's' : ''} will be saved.` : 'Nothing changed yet — this saves the template as it is.'))];
  }

  // characters already saved in the account
  cloudReady().then(async (ok) => { if (ok) { st.cloud = await listCharactersCloud(); if (st.tab === 'start') draw(); } }).catch(() => {});
  let draftSignature = '', writingDraft = null;
  const imageBlobs = new WeakMap(), imageIds = new WeakMap(); let imageSeq=0;
  async function saveDraft() {
    if (localPreview) return;
    if (writingDraft) { await writingDraft; return saveDraft(); }
    if (!st.def || st.busy || pending.size) return;
    const fields = ['tpl','skins','xf','order','attach','face','fit','name','savedId','tab','open','openGroup','filter','zoom','mouth','createMode','outline','anim','over'];
    const state=structuredClone(Object.fromEntries(fields.map(k=>[k,st[k]??null])));
    state.hide=[...st.hide];state.locked=[...st.locked];state.camera=structuredClone(stage.userCam);
    { const stk = stickerProfile(); state.stickers = stk.stickers || null; state.stickerAtlas = stk.stickerAtlas || null; }          // the stickers are kept in the draft too (their picture page is stored beside it)
    const edits=[...st.edit].map(([key,e])=>{if(e.img&&!imageIds.has(e.img))imageIds.set(e.img,++imageSeq);return [key,{...e,img:e.img?imageIds.get(e.img):null}];});
    const sig=JSON.stringify({id:st.def.id,state,edits});
    if(sig===draftSignature)return;
    const stickerBlob=st.stickers.length?st.stkBlob:null, draftDef=structuredClone(st.def), draftEdits=[...st.edit].map(([k,e])=>[k,{...e}]);
    writingDraft=(async()=>{
      const serialized=[];
      for(const [key,e] of draftEdits){
        let img=null;
        if(e.img){if(!imageBlobs.has(e.img)){const c=makeCanvas(e.img.width,e.img.height);c.getContext('2d').drawImage(e.img,0,0);imageBlobs.set(e.img,await toBlob(c,'image/png'));}img=imageBlobs.get(e.img);}
        serialized.push([key,{...e,img}]);
      }
      await putDraft('draft',{id:'current',def:draftDef,state,edits:serialized,stickerPage:stickerBlob,ts:Date.now()});
      draftSignature=sig;
    })();
    try {await writingDraft;}finally{writingDraft=null;}
  }
  root.flushDraft=async()=>{
    // Do not change project scope while canvas edits or an IndexedDB save are in flight.
    while(st.busy)await new Promise(resolve=>setTimeout(resolve,20));
    if(pending.size)await flush();await saveDraft();
  };
  const hideSave=()=>{if(document.hidden&&root.isConnected)root.flushDraft().catch(e=>{draftStatus.textContent='Local save failed: '+friendlyError(e);});};
  document.addEventListener('visibilitychange',hideSave);
  const draftStatus=h('span',{class:'sub cs-status'},localPreview ? 'Preview only · cloud saving disabled' : 'Saved locally');root.querySelector('header').append(draftStatus);
  const offStatus=localPreview ? () => {} : onSyncStatus(s=>{draftStatus.textContent=s.text;draftStatus.title=s.error;});
  const draftTimer=setInterval(()=>{if(root.isConnected&&!document.hidden)saveDraft().catch(e=>{draftStatus.textContent='Local save failed: '+friendlyError(e);});},3000);
  if (import.meta.env?.DEV && location.search.includes('debug')) window.__charstudio = { st, layers, stage };      // for the browser tests
  root.dispose=()=>{clearInterval(draftTimer);offStatus();document.removeEventListener('visibilitychange',hideSave);};
  const draft=await getDraft('draft','current');
  if(draft?.def && !localPreview){
    await pick(draft.def);
    const { stickers: draftStickers, stickerAtlas: draftAtlas, ...draftRest } = draft.state;
    Object.assign(st,draftRest,{hide:new Set(draft.state.hide),locked:new Set(draft.state.locked)});
    st.edit=new Map(await Promise.all(draft.edits.map(async([key,e])=>[key,{...e,img:e.img?await readImage(e.img):null}])));
    pending=new Set(st.edit.keys());await flush();
    try { await restoreStickers({ stickers: draftStickers, stickerAtlas: draftAtlas }, { [STICKER_PAGE]: draft.stickerPage }); } catch (e) { console.warn('stickers not restored', e); st.stickers = []; }
    rebuild();stage.userCam=draft.state.camera;
  }
  draw(); drawAnimBar();
  if (localPreview) {
    root.captureArtworkFrame = () => {
      if (stage.gl.isContextLost()) throw new Error('The browser\'s graphics context was lost. Please reload this local preview.');
      const time = previewTime(performance.now());
      stage.render(time, 0, mouthClips(time), [{ start: 0, end: 1e9, speaker: 'c', type: st.zoom, focus: 'auto' }]);
      return stage.out.toDataURL('image/png');
    };
    root.loadArtworkPack = async (manifestUrl) => {
      if (!st.def) {
        const entry = libraryCharacters().find((e) => e.template && e.charBase === 'sadhubaba' && e.id.endsWith('-front-side')) || libraryCharacters().find((e) => e.template);
        if (!entry) throw new Error('No animation rig is set yet.');
        await pick(await fetchLibraryCharacter(entry), 'local preview rig');
      }
      const response = await fetch(manifestUrl);
      if (!response.ok) throw new Error('The artwork list is not available.');
      const manifest = await response.json(), all = layers(), report = [];
      st.previewUtilityRegions = new Set(manifest.filter(p => p.status === 'transparent-utility-slot').map(p => p.region));
      for (const part of manifest) {
        const layer = all.find(l => l.slot === part.slot && l.key === part.key && l.region === part.region);
        if (!layer) throw new Error(`This layer was not found in the rig: ${part.slot}/${part.region}`);
        const imageResponse = await fetch(`/local-character-art/${part.file}`);
        if (!imageResponse.ok) throw new Error(`Artwork not found: ${part.file}`);
        const img = await readImage(await imageResponse.blob()), reg = st.regions.get(layer.region);
        if (img.width !== reg.w || img.height !== reg.h) throw new Error(`Size mismatch: ${part.file}`);
        Object.assign(editOf(layer.region), { img, trim: null, removed: false });
        st.attach[layer.slot] = layer.key; st.hide.delete(layer.slot); pending.add(layer.region);
        report.push({ slot: layer.slot, region: layer.region, width: img.width, height: img.height });
      }
      st.createMode = true; st.tab = 'create'; st.mouth = false; st.anim = null; st.over = null;
      await flush(); rebuild(); draw(); drawAnimBar();
      return report;
    };
    root.querySelector('header .btn.ok').disabled = true;
    root.querySelector('header .btn.ok').textContent = 'Local artwork preview';
  }
  raf = requestAnimationFrame(loop);
  redrawLibrary = async () => { if (!root.isConnected) return; try { const again = await hydrateAll(savedRaw); for (const c of again) if (!mine.some((x) => x.id === c.id)) mine.push(c); } catch { /* keep what is shown */ } if (st.tab === 'start') draw(); };          // the shared library arrived late: show it
  pageReady = true;
  return root;
}

