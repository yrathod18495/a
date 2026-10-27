import { friendlyError } from '../shared/hinglish-errors.js';
// 12toons Character Studio.
// Start from a template (or any rig ZIP), then change it layer by layer: upload / download / remove / lock every layer, colour it,
// nudge it, fit the face (eyes, brows, nose, lips, ears), pick the outfit — all live on the canvas. Save = baked character
// (rig + atlas + images + edit profile) in this device's database and, when logged in, in your cloud account.
import JSZip from 'jszip';
import { testerGroupVisible, testerLayerDownloadable, testerCanSave } from './tester-parts.js';
import { h, logo } from './dom.js';
import { Stage } from './db/stage.js';
import { characterPicker } from './charpick.js';
import { refreshLayerRules, layerName, groupName, layerHidden } from './layerrules.js';
import { ingest } from './ingest.js';
import { buildPsd, readPsdLayers, planPsd, kindOf } from './psd.js';
import { patchRig, faceEdits, faceDefaults, bakeSke, dragToEdit, FACE } from './rigedit.js';
import { LIMITS, mb } from './limits.js';
import { saveCharacter, deleteCharacter, loadCharacters, get as getDraft, put as putDraft } from './store.js';
import { onSyncStatus } from './project-sync.js';
import { loadCatalog, hydrateAll, hydrateCharacter, libraryCharacters, fetchLibraryCharacter, cdn, categoriesFor, fetchAnimation, url as assetUrl, refreshTesterRules, setTesterRules, getTesterRules } from './catalog.js';
import { getFit, setFit, FIT_PRESETS, FIT_LIMITS } from './universal.js';
import { rigInfo } from './db/info.js';
import { cloudReady, saveCharacterCloud, deleteCharacterCloud, listCharactersCloud, loadCharacterCloud, saveTesterSubmission, watchTesterConfig } from './cloud.js';

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

const GROUP_ICON = { Top: '👚', Bottom: '👖', Shoes: '👟', Eyes: '👁', Eyebrows: '〰', Face: '🙂', Nose: '👃', Ears: '👂', Hair: '💇', Lips: '👄', Palms: '✋', Earrings: '💎', Other: '🧩' };

/** tester = true: the page for testers (no way out to the other pages, only the animations the admin allowed, saves go to the database) */
export async function view({ user, home, toast, tester = false, logout, localPreview = false }) {
  localPreview = import.meta.env.DEV && localPreview;
  const [rawMine] = await Promise.all([loadCharacters().then((l) => l.filter((c) => c.ske || c.base)), loadCatalog(), refreshLayerRules(), tester ? refreshTesterRules() : null]);
  const mine = await hydrateAll(rawMine);            // saved characters are small (template + settings + own pictures): put them together again
  let groupsData = [];
  try { groupsData = await fetch(assetUrl('12toons/groups.json')).then((r) => r.json()); } catch { /* optional */ }
  const groupOf = new Map();
  for (const g of groupsData) for (const a of g.attachments) groupOf.set(a, g.name);

  const stage = new Stage({ maxTex: 4096 });
  stage.setSize('4:5', 720);
  const st = {
    outline: false, autoLen: !tester, guideFocus: null, createMode: !!tester, def: null, tpl: null, skins: null, hide: new Set(), edit: new Map(), xf: {}, order: {}, place: true, attach: {}, face: faceDefaults(), locked: new Set(),
    regions: new Map(), pages: [], orig: {}, work: {}, artworkPages: {}, dirty: new Set(), cbox: new Map(), anim: null, tab: 'start', open: null, openGroup: null, filter: '',
    permissionsError: '', busy: false, mouth: false, zoom: 'wide', name: '', cloud: [],
  };
  let gen = 0, pending = new Set(), applyTimer = 0, rigTimer = 0, t0 = performance.now(), raf = 0, lastFrame = 0;
  const panel = h('div', { class: 'cs-panel' }), tabs = h('div', { class: 'cs-tabs' }), stageBox = h('div', { class: 'cs-stage' }, stage.out);
  let rigGuideStatus = null;
  const animBar = h('div', { class: 'cs-anim' }), placeBar = h('div', { class: 'cs-place', hidden: true });
  const restrictedTester = () => tester && !testerCanSave(getTesterRules());
  /** testers only get Sadhu Baba in the 3/4 front pose; the full character / pose list stays with the admin Character Studio */
  const templateChoices = () => libraryCharacters().filter((e) => e.template && (!tester || (e.charBase === 'sadhubaba' && e.id.endsWith('-front-side'))));
  const partVisible = l => !tester || testerGroupVisible(getTesterRules(), baseOf(), l.group);
  const partDownloadable = l => !tester || (partVisible(l) && !layerHidden(baseOf(), l.slot, l.key) && testerLayerDownloadable(getTesterRules(), baseOf(), l));
  const saveButton = h('button', { class: 'btn ok', onclick: () => { if (st.def) { st.tab = 'save'; draw(); } else toast('Please choose a character first.'); } }, '💾 Save');
  const root = h('div', { class: 'sh cs' },
    h('header', { class: 'sh-bar' }, tester ? h('span', { class: 'sh-crumb' }, 'Character Tester') : logo(home), h('span', { class: 'sp' }),
      saveButton, tester ? h('button', { class: 'btn', onclick: logout }, '⎋ Log out') : h('button', { class: 'btn', onclick: home }, '⌂ Home')),
    h('div', { class: 'cs-body' }, h('div', { class: 'cs-left' }, stageBox, animBar, tester ? placeBar : null), h('div', { class: 'cs-right' }, tabs, panel)));

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
    } catch (e) { console.warn(e); }
  };

  /* ---------- free zoom / pan on the preview: wheel = zoom at the cursor, drag = move, double click = back ---------- */
  {
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

  /* ---------- model: rig edits (nudges + face profile) ---------- */
  const mergeEdit = (a, b) => ({ dx: (a?.dx || 0) + (b?.dx || 0), dy: (a?.dy || 0) + (b?.dy || 0), s: (a?.s ?? 1) * (b?.s ?? 1), rot: (a?.rot || 0) + (b?.rot || 0) });
  function rigEdits() {
    const fe = faceEdits(st.face, st.def.ske), xf = { ...fe.xf };
    for (const [k, e] of Object.entries(st.xf)) xf[k] = mergeEdit(xf[k], e);
    return { xf, bones: fe.bones, attach: st.attach, order: st.order };
  }
  const currentRig = () => patchRig(st.def.ske, rigEdits());
  function rebuild() {
    if (!st.def) return;
    stage.setRig(st.def.id, currentRig());
    const anims = st.anim && st.anim.json ? { [st.anim.key]: st.anim.json } : {};
    if (st.over && st.anim && st.over.json) anims[st.over.key] = st.over.json;
    stage.setLayers([{ key: 'c', charId: st.def.id, artworkPages: { ...st.artworkPages }, anims, clips: st.anim ? [{ id: 'a', kind: 'body', name: st.anim.key, start: 0, dur: 36000, off: 0 }, ...(st.over ? [{ id: 'o', kind: st.over.kind, name: st.over.key, start: 0, dur: 36000, off: 0 }] : [])] : [], flip: false, slot: 0, visible: true, xf: null, skins: st.skins, hide: [...st.hide], fit: st.fit, lockBounds: true }]);
  }
  const queueRig = () => { clearTimeout(rigTimer); rigTimer = setTimeout(rebuild, 120); };

  /* ---------- picking a character ---------- */
  async function pick(d, label) {
    gen++; pending = new Set(); clearTimeout(applyTimer); Object.values(st.artworkPages).forEach((k) => stage.dropArtworkCanvas(k));
    if (st.def && st.def.id !== d.id) stage.unload(st.def.id);
    stage.unload(d.id);
    // a saved character is opened on its template's skeleton again, with its settings, so everything stays editable
    const saved = !!d.baseSke, pr = d.profile || {}, src = saved ? { ...d, ske: d.baseSke } : d;
    d = src;
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
    rebuild(); t0 = performance.now(); st.tab = st.createMode || !tester ? 'create' : 'anims'; draw(); drawAnimBar();
    toast(`${label || d.name} is ready — change any layer.`);
  }

  /* ---------- animation preview ---------- */
  const animChoices = () => categoriesFor(st.def.rig, { tester }).filter((c) => !c.overlay).flatMap((c) => c.animations.map((a) => ({ ...a, cat: c.name })));
  const defaultAnim = () => { const l = animChoices(); return l.find((a) => /^idle/i.test(a.name)) || l.find((a) => a.cat === 'Idle') || l[0] || null; };
  async function setAnimation(a) {
    const json = a ? await fetchAnimation(a.ref.file) : null;
    if (tester && a && !animChoices().some(item => String(item.ref.id) === String(a.ref.id))) throw new Error('This animation is no longer enabled for testers.');
    st.anim = a ? { key: a.ref.rigAnim || `a${a.ref.id}`, name: a.name, json } : null;
    t0 = performance.now(); lastFrame = 0;
    rebuild(); drawAnimBar();
  }
  function drawAnimBar() {
    if (!st.def) { animBar.replaceChildren(h('p', { class: 'hint' }, tester ? 'Create your character to start the live preview.' : 'Pick a template, then change it layer by layer.')); return; }
    const list = animChoices(), i = list.findIndex((a) => st.anim && (a.ref.rigAnim || `a${a.ref.id}`) === st.anim.key);
    const go = async (d) => { if (!list.length) return; try { await setAnimation(list[(i + d + list.length) % list.length]); } catch (e) { toast(e.message); } };
    animBar.replaceChildren(
      h('button', { class: 'btn sm', onclick: () => go(-1), disabled: !list.length }, '‹'),
      h('span', { class: 'cs-anim-name' }, st.anim?.name || 'No animation'),
      h('button', { class: 'btn sm', onclick: () => go(1), disabled: !list.length }, '›'),
      h('div', { class: 'seg3' }, [['wide', 'Full'], ['medium', 'Upper body'], ['close', 'Face']].map(([k, l]) => h('button', { class: st.zoom === k ? 'on' : '', onclick: () => { st.zoom = k; st.resetView?.(); drawAnimBar(); } }, l))),
      h('label', { class: 'tog' }, h('input', { type: 'checkbox', checked: st.mouth, onchange: (e) => { st.mouth = e.target.checked; } }), '👄 Test mouth'));
  }

  /* ---------- panels ---------- */
  // testers get every editing tab; creators on the normal page only upload their own parts (Start / Create / Save)
  const TABS = tester
    ? [['start', 'Start'], ['create', 'Create'], ['layers', 'Layers'], ['face', 'Face'], ['anims', 'Animations'], ['body', 'Body'], ['outfit', 'Outfit'], ['save', 'Save']]
    : [['start', 'Start'], ['create', 'Create'], ['save', 'Save']];
  function draw() {
    if (!TABS.some(([key]) => key === st.tab)) st.tab = 'start';       // a tab this page does not offer is never shown (e.g. a draft saved on the tester page)
    drawPlaceBar();
    tabs.replaceChildren(...TABS.filter(([k]) => (k !== 'create' || st.createMode || !tester) && (!localPreview || k !== 'save')).map(([k, l]) => h('button', { class: st.tab === k ? 'on' : '', disabled: k !== 'start' && !st.def, onclick: () => { st.tab = k; draw(); } }, l)));
    panel.replaceChildren(...{ start: panelStart, create: panelCreate, layers: panelLayers, face: panelFace, outfit: panelOutfit, anims: panelAnims, body: panelBody, save: panelSave }[st.tab]().filter(Boolean));      // a missing item must not show up as the word "null"
  }

  async function importCharacterFiles(files) {
    const { characters } = await ingest(files).catch((er) => { toast(er.message); return { characters: [] }; });
    if (!characters.length) { toast('No character was found. A DragonBones character ZIP must contain the skeleton (_ske.json), texture atlas (_tex.json) and image.'); return; }
    for (const c of characters) { await saveCharacter(c); const i = mine.findIndex((x) => x.id === c.id); if (i >= 0) mine[i] = c; else mine.push(c); }
    if (tester) { st.createMode = false; await pick(characters[0], 'your uploaded character'); }
    toast(`Added ${characters.length} character${characters.length > 1 ? 's' : ''}.`); draw();
  }

  function panelStart() {
    const file = h('input', { type: 'file', accept: '.zip,.json,image/*', multiple: true, style: 'display:none', onchange: async (e) => {
      const files = [...e.target.files]; e.target.value = ''; await importCharacterFiles(files);
    } });
    const lib = tester ? [] : libraryCharacters();
    const open = (e) => async () => { try { await pick(await fetchLibraryCharacter(e), `${e.name} · ${e.pose}`); st.tpl = e.template ? { id: e.id } : null; } catch (er) { toast(`Could not download: ${er.message}`); } };
    const templates = lib;
    const cloudOnly = st.cloud.filter((c) => !mine.some((m) => m.id === c.id));
    if (tester) return [
      h('div', { class: 'cs-sec tester-create' }, h('h3', {}, 'Create my own character'),
        h('p', { class: 'sub', style: 'font-size:12px;margin:0 0 10px' }, 'Upload your character or draw and upload its parts. Your artwork appears on the live preview.'),
        h('div', { class: 'cs-grid' }, h('button', { class: 'cs-mode on', onclick: async () => {
            st.createMode = true; st.outline = false; st.autoLen = false;
            if (st.def) { rebuild(); st.tab = 'create'; draw(); focusRig(createRows()[0]); return; }
            const base = templateChoices().find((e) => e.template);
            if (!base) { toast('No animation rig is set yet.'); return; }
            try { await pick(await fetchLibraryCharacter(base), 'custom character base'); rebuild(); st.tab = 'create'; draw(); focusRig(createRows()[0]); }
            catch (er) { toast(`Could not load the animation rig: ${er.message}`); }
          } }, h('b', {}, 'Create my own character'), h('small', {}, 'Open custom upload workspace')))),
      (mine.length || cloudOnly.length) ? h('div', { class: 'cs-sec' }, h('h3', {}, 'Your saved characters'),
        h('p', { class: 'sub', style: 'font-size:12px;margin:0 0 8px' }, 'Tap one to keep editing it — this is exactly what the admin sees in the review list.'),
        h('div', { class: 'cs-grid' },
          mine.map((c) => h('div', { class: `cs-card ${st.def?.id === c.id ? 'on' : ''}`, onclick: () => { st.createMode = true; pick(c); } }, h('span', { class: 'cs-th' }, c.thumb ? h('img', { src: c.thumb, alt: '' }) : '🎭'), h('b', {}, c.name),
            h('button', { class: 'ib', title: 'Delete', onclick: async (e) => { e.stopPropagation(); if (!confirm(`Delete ${c.name}?`)) return; await deleteCharacter(c.id); deleteCharacterCloud(c.id).then(() => { st.cloud = st.cloud.filter((x) => x.id !== c.id); }).catch(() => {}); mine.splice(mine.indexOf(c), 1); draw(); } }, '✕'))),
          cloudOnly.map((c) => h('div', { class: 'cs-card', onclick: async () => { toast(`Downloading ${c.name}…`); try { const rec = await loadCharacterCloud(c); await saveCharacter(rec); const d = await hydrateCharacter(rec); if (!d) throw new Error('This template is no longer available.'); mine.push(d); st.createMode = true; await pick(d); } catch (er) { toast(er.message); } } }, h('span', { class: 'cs-th' }, c.thumb ? h('img', { src: c.thumb, alt: '' }) : '☁'), h('b', {}, c.name), h('small', {}, '☁ saved earlier'),
            h('button', { class: 'ib', title: 'Delete', onclick: async (e) => { e.stopPropagation(); if (!confirm(`Delete ${c.name}?`)) return; await deleteCharacterCloud(c.id); st.cloud = st.cloud.filter((x) => x.id !== c.id); draw(); } }, '✕'))))) : null,
    ];
    return [
      h('div', { class: 'cs-sec' }, h('h3', {}, 'Pick the base body (skeleton + animations come with it)'), h('p', { class: 'sub', style: 'font-size:12px;margin:0 0 8px' }, 'Every template comes with its layers, animations and lip-sync. Pick one, then replace its layers with your own art.'),
        characterPicker({ entries: templates, isOn: (e) => !!st.def && st.def.id === `lib:${e.id}`, onPick: (e) => open(e)() })),
      h('div', { class: 'cs-sec' }, h('h3', {}, 'My characters'), h('div', { class: 'cs-grid' },
        h('div', { class: 'cs-card add', onclick: () => file.click() }, h('span', { class: 'cs-th' }, '+'), h('b', {}, 'Add ZIP'), h('small', {}, 'DragonBones ske + tex + png')),
        mine.map((c) => h('div', { class: `cs-card ${st.def?.id === c.id ? 'on' : ''}`, onclick: () => pick(c) }, h('span', { class: 'cs-th' }, c.thumb ? h('img', { src: c.thumb, alt: '' }) : '🎭'), h('b', {}, c.name),
          h('button', { class: 'ib', title: 'Delete', onclick: async (e) => { e.stopPropagation(); if (!confirm(`Delete ${c.name}?`)) return; await deleteCharacter(c.id); deleteCharacterCloud(c.id).then(() => { st.cloud = st.cloud.filter((x) => x.id !== c.id); }).catch(() => {}); mine.splice(mine.indexOf(c), 1); draw(); } }, '✕'))),
        cloudOnly.map((c) => h('div', { class: 'cs-card', onclick: async () => { toast(`Downloading ${c.name}…`); try { const rec = await loadCharacterCloud(c); await saveCharacter(rec); const d = await hydrateCharacter(rec); if (!d) throw new Error('This template is no longer available.'); mine.push(d); await pick(d); } catch (er) { toast(er.message); } } }, h('span', { class: 'cs-th' }, c.thumb ? h('img', { src: c.thumb, alt: '' }) : '☁'), h('b', {}, c.name), h('small', {}, '☁ from your account')))), file),
    ];
  }

  function nudgeSliders(l) {
    const k = `${l.slot}|${l.key}`, e = st.xf[k] || { dx: 0, dy: 0, s: 1, rot: 0, sv: 1 };
    const sl = (label, prop, min, max, step, show) => {
      const out = h('span', { class: 'v' }, show(e[prop])), input = h('input', { type: 'range', min, max, step, value: e[prop] });
      input.addEventListener('input', () => { const cur = st.xf[k] || (st.xf[k] = { dx: 0, dy: 0, s: 1, rot: 0, sv: 1 }); cur[prop] = +input.value; out.textContent = show(cur[prop]); queueRig(); });
      return h('label', { class: 'cs-sl' }, h('span', {}, label), input, out);
    };
    return [sl('Left / right', 'dy', -80, 80, 1, (v) => `${v}`), sl('Up / down', 'dx', -80, 80, 1, (v) => `${v}`), sl('Size', 's', 0.5, 1.8, 0.02, (v) => `${Math.round(v * 100)}%`), sl('Length (shape follows art)', 'sv', 0.5, 2, 0.02, (v) => `${Math.round(v * 100)}%`), sl('Turn', 'rot', -45, 45, 1, (v) => `${v}°`)];
  }
  function colourSliders(regs, e0) {
    const e = e0 || { hue: 0, sat: 1, light: 0 };
    const sl = (label, key, min, max, step, show) => {
      const out = h('span', { class: 'v' }, show(e[key])), input = h('input', { type: 'range', min, max, step, value: e[key] });
      input.addEventListener('input', () => { out.textContent = show(+input.value); for (const r of regs) editOf(r)[key] = +input.value; queue(regs); });
      return h('label', { class: 'cs-sl' }, h('span', {}, label), input, out);
    };
    return [sl('Colour', 'hue', -180, 180, 1, (v) => `${v}°`), sl('Richness', 'sat', 0, 2, 0.05, (v) => `${Math.round(v * 100)}%`), sl('Light', 'light', -50, 50, 1, (v) => `${v}`)];
  }
  async function putImage(l, file) {
    if (!partVisible(l)) {
      toast(getTesterRules().verified ? `The "${groupName(baseOf(), l.group)}" group is hidden for testers in Tester Permissions. Ask the admin to show it.` : 'Your permissions could not be loaded yet. Please check your connection and reload the page.');
      return;
    }
    if (st.locked.has(l.region)) { toast('This layer is locked.'); return; }
    try {
      const e = editOf(l.region); e.img = await readImage(file, file.name); e.trim = null;
      if (st.outline && !e.mode) e.mode = 'outline'; e.removed = false;
      if (tester) { st.attach[l.slot] = l.key; st.hide.delete(l.slot); st.guideFocus = l.region; rebuild(); }
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
    const all = layers().filter(partVisible);
    const norm = (n) => n.replace(/\.[^.]+$/, '').replace(/\//g, '_');
    const hits = new Map(), unmatched = [];     // region -> layer: when two files name the same part, the later one wins
    let lastHit = null;
    // every picture is read and set first; the rig is rebuilt ONCE at the end (rebuilding after each file made 8 files take 8 seconds)
    for (const it of items) {
      const n = norm(it.name);
      const l = all.find((x) => norm(x.region) === n) || all.find((x) => norm(x.key) === n && !st.locked.has(x.region)) || all.find((x) => norm(x.region).replace(/^(PS|SL)_/, '') === n.replace(/^(PS|SL)_/, ''));
      if (!l || st.locked.has(l.region)) { unmatched.push(it.name); continue; }
      try {
        const e = editOf(l.region); e.img = await readImage(it.blob, it.name); e.trim = null; if (st.outline && !e.mode) e.mode = 'outline'; e.removed = false;
        if (tester) { st.attach[l.slot] = l.key; st.hide.delete(l.slot); st.guideFocus = l.region; lastHit = l; }
        hits.set(l.region, l);
      } catch (e) { console.warn('picture not readable', it.name, e); unreadable++; }
    }
    if (hits.size) { queue([...hits.keys()]); autoSoon(); }
    const parts = [hits.size ? `${hits.size} layer${hits.size > 1 ? 's' : ''} replaced.` : 'No file matched a layer name. Name files like the layers (ARM_L.png, Mouth_A.svg …).'];
    if (hits.size && unmatched.length) parts.push(`${unmatched.length} file name${unmatched.length > 1 ? 's' : ''} did not match any layer (${unmatched.slice(0, 3).join(', ')}${unmatched.length > 3 ? ' …' : ''}).`);
    if (unreadable) parts.push(`${unreadable} file${unreadable > 1 ? 's' : ''} could not be read.`);
    toast(parts.join(' '));
    draw();
    if (tester && lastHit) focusRig(lastHit);
  }
  async function downloadLayer(l) {
    if (!partDownloadable(l)) { toast('This part is not available for download.'); return; }
    const c = cropOf(l.region), blob = await toBlob(c, 'image/png'), a = h('a', { href: URL.createObjectURL(blob), download: `${safe(l.region)}.png` });
    document.body.append(a); a.click(); a.remove();
  }
  /* ---------- PSD: every picture of this pose as a named layer, and back ---------- */
  const normName = (n) => String(n).replace(/\.[^.]+$/, '').replace(/[\\/]+/g, '_').trim().toLowerCase();
  const PSD_GROUPS = new Set(['Top', 'Bottom', 'Face', 'Eyes', 'Eyebrows', 'Nose', 'Ears', 'Hair', 'Earrings', 'Lips']);   // clothes + the whole face (no palms)
  /** the pictures of this pose with their fixed boxes, plus where each one stands in the rig's own set-up pose (the figure in the PSD is built from it) */
  function psdItems() {
    const base = baseOf(), all = layers().filter((l) => !layerHidden(base, l.slot, l.key) && partVisible(l) && PSD_GROUPS.has(l.group));   // clothes and the face (palms stay out)
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
  async function downloadPsd() {
    if (!st.def) return;
    toast('Building the PSD…');
    try {
      await new Promise((r) => setTimeout(r, 30));
      const items = psdItems().filter(item => partDownloadable(item.l)), blob = buildPsd(items.map((i) => ({ ...i, canvas: cropOf(i.l.region) })));
      const a = h('a', { href: URL.createObjectURL(blob), download: `${safe(st.def.name).replace(/[^\w\-]+/g, '_')}-${safe(st.def.pose || 'pose')}.psd` });
      document.body.append(a); a.click(); a.remove();
      toast(`PSD ready: ${items.length} layers (clothes + face), named like the parts. Edit it anywhere and upload it back.`);
    } catch (e) { console.warn(e); toast(`Could not create the PSD: ${e.message}`); }
  }
  /** a PSD from downloadPsd (edited): each layer goes back to the picture of the same name, keeping its place inside the box */
  async function importPsd(file) {
    toast('Reading the PSD…');
    try {
      const items = psdItems(), { pos } = planPsd(items);
      const byName = new Map(items.map((i) => [normName(i.name), i])), { layers: found } = await readPsdLayers(file);
      let hit = 0, lastHit = null; const regs = [];
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
        if (tester && !pl.hidden && e.img) { st.attach[it.l.slot] = it.l.key; st.hide.delete(it.l.slot); st.guideFocus = it.l.region; lastHit = it.l; }
        regs.push(it.l.region); hit++;
      }
      if (hit) queue(regs);
      toast(hit ? `${hit} layer${hit > 1 ? 's' : ''} taken from the PSD.` : `No layer of this PSD matches a part of this pose (PSD layers: ${found.slice(0, 4).map((l) => l.name).join(', ') || 'none found'}${found.length > 4 ? ' …' : ''}). Download the PSD from this character and pose, edit it and keep the layer names.`);
      draw();
      if (tester && lastHit) focusRig(lastHit);
    } catch (e) { console.warn(e); toast(`Could not read the PSD: ${e.message}`); }
  }
  async function downloadAll() {
    if (!layers().some(partDownloadable)) { toast('No part is available for download.'); return; }
    const z = new JSZip();
    for (const l of layers().filter(partDownloadable)) { const blob = await toBlob(cropOf(l.region), 'image/png'); z.file(`${safe(l.region)}.png`, blob); }
    const blob = await z.generateAsync({ type: 'blob' }), a = h('a', { href: URL.createObjectURL(blob), download: `${safe(st.def.name)}-layers.zip` });
    document.body.append(a); a.click(); a.remove();
  }

  /** the admin's name for a layer (falls back to the original name) */
  function baseOf() { return st.def?.rig?.toonChar || null; }
  function labelOf(l) { return layerName(baseOf(), l.slot, l.key, l.key); }
  function layerRow(l) {
    const reg = st.regions.get(l.region), e = st.edit.get(l.region), locked = st.locked.has(l.region), open = st.open === l.id, hidden = st.hide.has(l.slot);
    const file = h('input', { type: 'file', accept: 'image/*,.svg', style: 'display:none', onchange: (ev) => { const f = ev.target.files[0]; ev.target.value = ''; if (f) putImage(l, f); } });
    const changed = !!(e && (e.img || e.removed || e.hue || e.sat !== 1 || e.light)) || !!st.xf[`${l.slot}|${l.key}`];
    const siblings = layers().filter((x) => x.slot === l.slot).length > 1;
    const shownNow = (st.slot_attach?.(l.slot)) === l.key;
    return h('div', { class: `cs-layer ${hidden || e?.removed ? 'off' : ''} ${locked ? 'locked' : ''}` },
      h('div', { class: 'cs-lrow' }, thumb(l.region), h('div', { class: 'cs-lname' }, h('b', {}, `${siblings && shownNow ? '● ' : ''}${labelOf(l)}`), changed ? h('small', {}, 'changed') : null),
        h('button', { class: 'ib', title: 'Download this layer (PNG)', onclick: () => downloadLayer(l) }, '⬇'),
        h('button', { class: 'ib', title: 'Upload your own picture for this layer', disabled: locked, onclick: () => file.click() }, '⬆'),
        h('button', { class: 'ib', title: locked ? 'Unlock' : 'Lock', onclick: () => { locked ? st.locked.delete(l.region) : st.locked.add(l.region); draw(); } }, locked ? '🔒' : '🔓'),
        h('button', { class: 'ib', title: 'Edit colour & position', onclick: () => { st.open = open ? null : l.id; draw(); } }, open ? '▴' : '⚙')),
      open ? h('div', { class: 'cs-ctl' }, ...colourSliders([l.region], e), ...nudgeSliders(l),
        h('label', { class: 'cs-sl' }, h('span', {}, 'Fit'), h('select', { onchange: (ev) => { const ed = editOf(l.region); ed.mode = ev.target.value; ed.fill = ev.target.value === 'fill'; queue([l.region]); } },
          [['fit', 'Keep proportions'], ['fill', 'Fill the frame (crop)'], ['outline', "Match the part's outline (stretch)"]].map(([v, t]) => h('option', { value: v, selected: (e?.mode || (e?.fill ? 'fill' : 'fit')) === v }, t))), h('span', { class: 'v' })),
        h('div', { class: 'row' },
          h('button', { class: 'btn sm', disabled: locked, onclick: () => { editOf(l.region).removed = !e?.removed; queue([l.region]); draw(); } }, e?.removed ? '↩ Bring back' : '🗑 Remove picture'),
          siblings ? h('button', { class: 'btn sm', onclick: () => { st.attach[l.slot] = shownNow ? '' : l.key; rebuild(); draw(); } }, shownNow ? '○ Hide this picture' : '◉ Use this picture') : null,
          h('button', { class: 'btn sm', onclick: () => { hidden ? st.hide.delete(l.slot) : st.hide.add(l.slot); rebuild(); draw(); } }, hidden ? '👁 Show slot' : '🙈 Hide slot'),
          h('button', { class: 'btn sm', disabled: locked, onclick: () => { st.edit.delete(l.region); delete st.xf[`${l.slot}|${l.key}`]; queue([l.region]); queueRig(); draw(); } }, '↺ Reset')), file) : file);
  }
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
    const base = baseOf(), all = layers().filter((l) => partVisible(l) && !layerHidden(base, l.slot, l.key) && (st.slot_attach(l.slot) === l.key || l.group === 'Lips' || l.region === st.guideFocus)), rank = (g) => (CREATE_ORDER.indexOf(g) < 0 ? 99 : CREATE_ORDER.indexOf(g));
    return all.sort((a, b) => rank(a.group) - rank(b.group) || labelOf(a).localeCompare(labelOf(b)));
  };
  let offPlaceKeys = () => {};
  /* ---------- placing a part by hand (tester page): drag it on the preview, arrow keys or buttons, forward / back, size ---------- */
  const selectedPart = () => (tester && st.def && st.guideFocus ? layers().find((l) => l.region === st.guideFocus) || null : null);
  const xfKey = (l) => `${l.slot}|${l.key}`;
  /**
   * Where the middle of this part is in the armature (setup pose) with the given edit: the rig is built once for real and measured. A part's mesh is tied to several bones
   * (each with its own size and turn), so a picture edit never moves it exactly by the edit's amount; measuring is the only way to make a drag follow the mouse.
   */
  function partCentre(l, e) {
    const k = xfKey(l), prev = st.xf[k]; st.xf[k] = e;
    let t = null;
    try {
      stage.setRig(st.def.id, patchRig(st.def.ske, rigEdits()));
      t = stage.armatureFor(st.def.id, st.skins);
      const slot = t.arm.getSlot(l.slot), idx = t.prep.disp.get(l.slot)?.get(l.key);
      if (!slot || idx == null) return null;
      slot.displayIndex = idx; t.arm.advanceTime(0);
      const list = []; slot.collect(list);
      let x = 0, y = 0, n = 0;
      for (const it of list) for (let i = 0; i < it.verts.length; i += 2) { x += it.verts[i]; y += it.verts[i + 1]; n++; }
      return n ? { x: x / n, y: y / n } : null;
    } catch (er) { console.warn('part measure failed', er); return null; }
    finally { if (t) stage.disposeTemp(t); if (prev) st.xf[k] = prev; else delete st.xf[k]; }
  }
  let calib = null;
  /** how far (and which way) the part's middle moves in the armature for one unit of dx / dy: [a, b, c, d] with world = [[a, c], [b, d]] . (dx, dy); null if it cannot be measured */
  function jacobian(l) {
    const k = xfKey(l);
    if (calib && calib.key === k && performance.now() - calib.at < 4000) return calib.J;
    const e = { dx: 0, dy: 0, s: 1, rot: 0, sv: 1, ...(st.xf[k] || {}) }, d = 25, c0 = partCentre(l, e), cx = partCentre(l, { ...e, dx: e.dx + d }), cy = partCentre(l, { ...e, dy: e.dy + d });
    stage.setRig(st.def.id, currentRig());
    let J = null;
    if (c0 && cx && cy) { const m = [(cx.x - c0.x) / d, (cx.y - c0.y) / d, (cy.x - c0.x) / d, (cy.y - c0.y) / d]; if (Math.abs(m[0] * m[3] - m[1] * m[2]) > 1e-6) J = m; }
    calib = { key: k, J, at: performance.now() };
    return J;
  }
  /** move the selected part by (cx, cy) CANVAS pixels (y down): canvas -> armature -> the edit that moves the part's middle exactly there */
  function movePart(cx, cy) {
    const l = selectedPart(), layer = stage.layers.find((x) => x.key === 'c');
    if (!l || !layer?.mat || (!cx && !cy)) return;
    const wx = cx / layer.mat[0], wy = cy / layer.mat[3], J = jacobian(l), k = xfKey(l), e = st.xf[k] || { dx: 0, dy: 0, s: 1, rot: 0, sv: 1 };
    let add;
    if (J) { const det = J[0] * J[3] - J[1] * J[2]; add = { dx: (J[3] * wx - J[2] * wy) / det, dy: (-J[1] * wx + J[0] * wy) / det }; }
    else add = dragToEdit(st.def.ske.armature[0], l.slot, wx, wy);          // measuring failed: the bone-axes estimate
    st.xf[k] = { ...e, dx: (e.dx || 0) + add.dx, dy: (e.dy || 0) + add.dy };
    queueRig(); S_dirtyDraft();
  }
  const cssToCanvas = () => { const r = stage.out.getBoundingClientRect(), v = stage.view || { w: stage.W, h: stage.H }; return { kx: v.w / (r.width || 1), ky: v.h / (r.height || 1) }; };
  const S_dirtyDraft = () => { if (placeNote) placeNote.textContent = noteOf(selectedPart()); };
  const noteOf = (l) => { if (!l) return 'Please choose a part first (tap its name in the list).'; const e = st.xf[xfKey(l)], moved = e && (e.dx || e.dy || (e.s && e.s !== 1)), order = st.order[l.slot] || 0; return `${labelOf(l)}${moved || order ? ` · moved${order ? ` · ${order > 0 ? 'forward' : 'backward'} ${Math.abs(order)}` : ''}` : ''}`; };
  let placeNote = null;
  function drawPlaceBar() {
    if (!tester) return;
    const l = selectedPart(); placeBar.hidden = !st.def || st.tab === 'start' || st.tab === 'anims';
    const btn = (label, title, on, cls = '') => h('button', { type: 'button', class: `btn sm ${cls}`, title, onclick: on, disabled: !l }, label);
    const step = (dx, dy) => () => { const { kx, ky } = cssToCanvas(); movePart(dx * 3 * kx, dy * 3 * ky); };
    const size = (f) => () => { const k = xfKey(l), e = st.xf[k] || { dx: 0, dy: 0, s: 1, rot: 0, sv: 1 }; st.xf[k] = { ...e, s: Math.min(3, Math.max(0.2, (e.s || 1) * f)) }; queueRig(); S_dirtyDraft(); };
    const order = (n) => () => { st.order[l.slot] = (st.order[l.slot] || 0) + n; if (!st.order[l.slot]) delete st.order[l.slot]; queueRig(); S_dirtyDraft(); };
    placeNote = h('span', { class: 'cs-place-note' }, noteOf(l));
    placeBar.replaceChildren(
      h('button', { type: 'button', class: `btn sm ${st.place ? 'pri' : ''}`, 'aria-pressed': String(st.place), title: 'When on, you can drag the part in the preview with the mouse', onclick: () => { st.place = !st.place; stage.out.style.cursor = st.place && selectedPart() ? 'move' : ''; drawPlaceBar(); } }, st.place ? '✋ Hand placement: ON' : '✋ Hand placement: OFF'),
      btn('⬅', 'Left', step(-1, 0)), btn('⬆', 'Up', step(0, -1)), btn('⬇', 'Down', step(0, 1)), btn('➡', 'Right', step(1, 0)),
      btn('−', 'Smaller', size(0.97)), btn('＋', 'Bigger', size(1.03)),
      btn('⬆ Forward', 'Bring this part forward, in front of other parts', order(1)), btn('⬇ Backward', 'Send this part backward, behind other parts', order(-1)),
      btn('↺ Reset', 'Reset this part\'s position, size and front-to-back order', () => { delete st.xf[xfKey(l)]; delete st.order[l.slot]; queueRig(); drawPlaceBar(); if (st.tab === 'layers') draw(); }),
      placeNote);
    stage.out.style.cursor = st.place && l ? 'move' : '';
  }
  {
    const cv = stage.out; let drag = null;
    cv.addEventListener('pointerdown', (e) => {
      if (!st.place || !selectedPart() || e.button !== 0) return;
      e.stopImmediatePropagation(); drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId);
    }, true);
    cv.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const { kx, ky } = cssToCanvas(); movePart((e.clientX - drag.x) * kx, (e.clientY - drag.y) * ky); drag = { x: e.clientX, y: e.clientY };
    });
    const end = () => { if (!drag) return; drag = null; if (st.tab === 'layers') draw(); };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    /* right click on the preview: list every part under the mouse (top first) and select the one the user picks, like "select layer" in Photoshop */
    let ctx = null;
    const closeCtx = () => { ctx?.remove(); ctx = null; };
    const partsAt = (cx, cy) => {
      const layer = stage.layers.find((x) => x.key === 'c');
      if (!layer?.mat || !st.def) return [];
      const px = (cx - layer.mat[4]) / layer.mat[0], py = (cy - layer.mat[5]) / layer.mat[3], seen = new Set(), hit = [];
      for (const it of stage.collect(layer)) {
        const { verts: v, idx } = it;
        for (let i = 0; i + 2 < idx.length; i += 3) {
          const ax = v[idx[i] * 2], ay = v[idx[i] * 2 + 1], bx = v[idx[i + 1] * 2], by = v[idx[i + 1] * 2 + 1], qx = v[idx[i + 2] * 2], qy = v[idx[i + 2] * 2 + 1];
          const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by), d2 = (px - qx) * (by - qy) - (bx - qx) * (py - qy), d3 = (px - ax) * (qy - ay) - (qx - ax) * (py - ay);
          if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) { if (!seen.has(it.slot)) { seen.add(it.slot); hit.push(it.slot); } break; }
        }
      }
      return hit.reverse().map((slot) => layers().find((l) => l.slot === slot && l.key === st.slot_attach(slot)) || layers().find((l) => l.slot === slot)).filter(Boolean);
    };
    cv.addEventListener('contextmenu', (e) => {
      if (!tester || !st.def) return;
      e.preventDefault(); e.stopImmediatePropagation(); closeCtx();
      const r = cv.getBoundingClientRect(), { kx, ky } = cssToCanvas(), found = partsAt((e.clientX - r.left) * kx, (e.clientY - r.top) * ky);
      ctx = h('div', { class: 'cs-ctx', role: 'menu' }, h('b', {}, found.length ? 'Choose a layer' : 'There is no part here'),
        found.map((l) => h('button', { type: 'button', role: 'menuitem', class: st.guideFocus === l.region ? 'on' : '', onclick: () => { closeCtx(); st.place = true; focusRig(l); draw(); } }, labelOf(l))));
      document.body.append(ctx);
      ctx.style.left = Math.min(e.clientX, innerWidth - ctx.offsetWidth - 8) + 'px'; ctx.style.top = Math.min(e.clientY, innerHeight - ctx.offsetHeight - 8) + 'px';
    }, true);
    const away = (e) => { if (ctx && !ctx.contains(e.target)) closeCtx(); };
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCtx(); });
    const keys = (e) => {
      if (!root.isConnected || !tester || !st.place || !selectedPart() || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input,select,textarea,[contenteditable=true]')) return;
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!d) return;
      e.preventDefault(); const { kx, ky } = cssToCanvas(), n = e.shiftKey ? 10 : 1; movePart(d[0] * n * kx, d[1] * n * ky);
    };
    document.addEventListener('keydown', keys);
    offPlaceKeys = () => { document.removeEventListener('keydown', keys); document.removeEventListener('pointerdown', away, true); closeCtx(); };
  }
  function focusRig(l) {
    if (!tester || !l) return;
    st.guideFocus = l.region;
    const current = layers().find((item) => item.slot === l.slot && item.key === st.slot_attach(l.slot));
    const currentHasArt = !!(current && st.edit.get(current.region)?.img && !st.edit.get(current.region)?.removed);
    const selectedHasArt = !!(st.edit.get(l.region)?.img && !st.edit.get(l.region)?.removed);
    if (selectedHasArt) { st.attach[l.slot] = l.key; st.hide.delete(l.slot); }
    else if (!currentHasArt) { delete st.attach[l.slot]; st.hide.delete(l.slot); } // Keep the template part visible until custom artwork replaces it.
    rebuild();
    const reg = st.regions.get(l.region), uploaded = st.edit.get(l.region)?.img;
    if (rigGuideStatus) rigGuideStatus.textContent = uploaded
      ? `${labelOf(l)} · PNG ${uploaded.width} × ${uploaded.height}px · fixed rig target ${reg.w} × ${reg.h}px`
      : `${labelOf(l)} · fixed universal rig target ${reg.w} × ${reg.h}px · uploaded parts stay visible together`;
    panel.querySelectorAll('.cs-crow').forEach((el) => el.classList.toggle('rig-guide-selected', el.dataset.rigRegion === l.region));
    drawPlaceBar();
  }
  /** one picture with a box per part (true proportions), its name and pixel size */
  async function templateSheet() {
    if (restrictedTester()) return;
    const rows = createRows(), W = 2400, M = 40, GAP = 20, HEAD = 150, FOOT = 80;
    const dims = rows.map((l) => { const r = st.regions.get(l.region); return { l, w: r.w, h: r.h }; });
    let k = 0.5, lay;
    for (let it = 0; it < 30; it++, k *= 0.93) {            // biggest scale at which every box still fits the sheet width, tallest first
      let x = M, y = HEAD, rowh = 0; lay = [];
      for (const d of [...dims].sort((a, b) => b.h - a.h)) {
        const w = Math.max(150, Math.round(d.w * k)), h = Math.max(70, Math.round(d.h * k));
        if (x + w > W - M) { x = M; y += rowh + GAP + 26; rowh = 0; }
        lay.push({ ...d, x, y, bw: w, bh: h }); x += w + GAP; rowh = Math.max(rowh, h);
      }
      if (y + rowh + FOOT < 3600) { lay.H = y + rowh + FOOT + 30; break; }
    }
    const H = lay.H || 3600, c = makeCanvas(W, H), g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    const grad = g.createLinearGradient(0, 0, W, 0); grad.addColorStop(0, '#2563eb'); grad.addColorStop(1, '#0ea5e9'); g.fillStyle = grad; g.fillRect(0, 0, W, 110);
    if (!tester) { g.fillStyle = '#fff'; g.font = '700 56px sans-serif'; g.fillText('12toons', M, 74); }
    g.fillStyle = '#fff'; g.font = '600 34px sans-serif'; g.fillText(`${st.def.name} · PART TEMPLATE — draw each part inside its own box, same angle, keep the file name the same (shown as the small label inside the box)`, M + (tester ? 0 : 290), 70);
    for (const b of lay) {
      g.fillStyle = GROUP_COLOUR[b.l.group] || '#ddd'; g.fillRect(b.x, b.y, b.bw, b.bh); g.strokeStyle = '#444'; g.lineWidth = 2; g.strokeRect(b.x, b.y, b.bw, b.bh);
      g.fillStyle = '#111'; g.font = '600 20px sans-serif'; g.fillText(labelOf(b.l).slice(0, Math.max(8, Math.floor(b.bw / 11))), b.x + 8, b.y + 26); g.fillStyle = '#444'; g.font = '14px sans-serif'; g.fillText(safe(b.l.region).slice(0, Math.floor(b.bw / 8)), b.x + 8, b.y + 44); g.fillStyle = '#111';
      g.fillStyle = '#555'; g.font = '16px sans-serif'; g.fillText(`${b.w}×${b.h}px`, b.x + 8, b.y + b.bh - 10);
    }
    if (!tester) { g.fillStyle = '#2563eb'; g.font = '600 24px sans-serif'; g.fillText('12toons AI Animation Studio · Character template · upload the finished parts in the Character Studio (Create tab) or as a ZIP / PSD', M, H - 30); }
    const blob = await toBlob(c, 'image/png'), a = h('a', { href: URL.createObjectURL(blob), download: `${tester ? 'character' : '12toons'}-${safe(st.def.name).replace(/[^\w\-]+/g, '_')}-part-template.png` });
    document.body.append(a); a.click(); a.remove();
  }
  function panelCreate() {
    const rows = createRows(), isUtility = l => localPreview && st.previewUtilityRegions?.has(l.region), artworkRows = rows.filter(l => !isUtility(l)), done = artworkRows.filter((l) => st.edit.get(l.region)?.img).length;
    const bulk = h('input', { type: 'file', multiple: true, accept: '.psd,.zip,image/*,.svg', style: 'display:none', onchange: (ev) => { const f = [...ev.target.files]; ev.target.value = ''; bulkUpload(f); } });
    const groups = new Map();
    for (const l of rows) (groups.get(l.group) || groups.set(l.group, []).get(l.group)).push(l);
    const row = (l) => {
      const reg = st.regions.get(l.region), e = st.edit.get(l.region), file = h('input', { type: 'file', accept: 'image/*,.svg', style: 'display:none', onchange: (ev) => { const f = ev.target.files[0]; ev.target.value = ''; if (f) putImage(l, f).then(draw); } });
      return h('div', { class: `cs-lrow cs-crow ${e?.img ? 'done' : ''} ${st.guideFocus === l.region ? 'rig-guide-selected' : ''}`, 'data-rig-region': l.region, tabindex: '0', onclick: () => focusRig(l), onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); focusRig(l); } } }, thumb(l.region), h('div', { class: 'cs-lname' }, h('b', {}, labelOf(l)), h('small', {}, `${reg.w}×${reg.h}px${isUtility(l) ? ' · Transparent utility slot' : e?.img ? ` · PNG ${e.img.width}×${e.img.height}px` : ''}`)),
        partDownloadable(l) ? h('button', { class: 'ib', title: 'Download this box (PNG) to draw in', onclick: (ev) => { ev.stopPropagation(); downloadLayer(l); } }, '⬇') : null, h('button', { class: `btn sm ${e?.img ? '' : 'pri'}`, onclick: (ev) => { ev.stopPropagation(); focusRig(l); file.click(); } }, e?.img ? 'Replace' : '⬆ Upload'), file);
    };
    return [
      tester && templateChoices().length > 1 ? h('label', { class: 'cs-guide-status' }, 'Character template', h('select', {
        'aria-label': 'Character template', disabled: !!st.loadingTemplate,
        onchange: async (ev) => {
          if (st.loadingTemplate) return;
          const entry = templateChoices().find(e => String(e.id) === ev.target.value);
          if (!entry) return;
          st.loadingTemplate = true; draw();
          try {
            const def = await fetchLibraryCharacter(entry);
            st.createMode = true; st.outline = false; st.autoLen = false; st.guideFocus = null;
            await pick(def, `${entry.name} · ${entry.pose}`);
            st.tpl = { id: entry.id };
          } catch (error) { toast(`Could not load the template: ${error.message}`); }
          finally { st.loadingTemplate = false; draw(); }
        },
      }, templateChoices().map(e => h('option', {
        value: e.id, selected: st.def.id === `lib:${e.id}` || st.tpl?.id === e.id,
      }, `${e.name} · ${e.pose}`))), h('small', {}, 'Selecting a template starts a fresh character. Upload parts to replace its artwork.')) : null,
      h('p', { class: 'sub', style: 'font-size:12px;margin:0 0 8px' }, 'Draw these parts in your own style (same angle as the template, transparent background), upload them one by one, or all together with the template sheet / a PSD. The skeleton, animations, lip-sync and physics come with the base body, so every animation works on your character.'),
      tester ? h('button', { class: 'btn sm pri', onclick: () => bulk.click() }, '⬆ Upload PNG parts / ZIP to the fixed rig') : null,
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
        !restrictedTester() ? h('button', { class: 'btn sm pri', title: 'One picture: a coloured box for every part, true proportions, names and sizes', onclick: templateSheet }, '⬇ Part template sheet') : null,
        rows.some(partDownloadable) ? h('button', { class: 'btn sm', title: 'Every box as its own PNG', onclick: downloadAll }, '⬇ Part boxes (ZIP)') : null,
        h('button', { class: 'btn sm', title: 'An edited PSD or a ZIP / many files named like the parts', onclick: () => bulk.click() }, '⬆ Upload many'), bulk),
      rigGuideStatus = h('div', { class: 'cs-guide-status', 'aria-live': 'polite' }, (() => { const l = rows.find((item) => item.region === st.guideFocus); const img = l && st.edit.get(l.region)?.img; const reg = l && st.regions.get(l.region); return l ? `${labelOf(l)} · ${img ? `PNG ${img.width} × ${img.height}px · ` : ''}fixed universal-rig target ${reg.w} × ${reg.h}px · all uploaded parts stay visible` : `All template parts and uploaded parts show together.`; })()),
      h('label', { class: 'tog' }, h('input', { type: 'checkbox', checked: st.outline, onchange: (ev) => { st.outline = ev.target.checked; } }), "Optional: stretch the art to the part outline (turn off to compare the uploaded shape against the fixed rig guide)"),
      h('label', { class: 'tog' }, h('input', { type: 'checkbox', checked: st.autoLen !== false, onchange: (ev) => { st.autoLen = ev.target.checked; if (ev.target.checked) autoProportions(); } }), 'Optional: adjust arm / leg / hand lengths from the uploaded art (leave off to keep the universal rig fixed)'),
      h('div', { class: 'cs-prog' }, h('b', {}, localPreview ? `${done} of ${artworkRows.length} artwork placements · ${rows.length - artworkRows.length} transparent utility slots validated` : `${done} of ${rows.length} parts uploaded`), h('div', { class: 'cs-bar' }, h('i', { style: `width:${artworkRows.length ? Math.round((done / artworkRows.length) * 100) : 0}%` }))),
      h('p', { class: 'hint', style: 'text-align:left;margin:0' }, tester ? 'The complete template character is visible from the start. Upload a custom part to replace it in the same rig slot. All other template parts and your earlier uploads remain visible.' : 'Parts you skip stay as the base body shows them. Body tab: legs / arms / hands length. Save tab: keep it in your account.'),
      tester && !groups.size ? h('p', {class:'sub', role:'status'}, 'No part groups are currently available. Ask the admin to enable groups in Tester Permissions.') : null,
      ...[...groups].map(([g, list]) => h('div', { class: 'cs-lgroup' }, h('div', { class: 'cs-ghead static' }, h('span', {}, GROUP_ICON[g] || '🧩'), h('b', {}, groupName(baseOf(), g)), h('small', {}, `${list.filter((l) => st.edit.get(l.region)?.img).length}/${list.length}`)), h('div', { class: 'cs-lbody' }, ...list.map(row)))),
    ];
  }
  function panelLayers() {
    const all = layers(), q = st.filter.toLowerCase(), base = baseOf();
    const byGroup = new Map();
    for (const l of all) if (!layerHidden(base, l.slot, l.key) && (!q || labelOf(l).toLowerCase().includes(q) || l.key.toLowerCase().includes(q) || groupName(base, l.group).toLowerCase().includes(q))) (byGroup.get(l.group) || byGroup.set(l.group, []).get(l.group)).push(l);
    const order = [...groupsData.map((g) => g.name), 'Other', 'Parts'].filter((g, i, a) => byGroup.has(g) && a.indexOf(g) === i);
    const bulk = h('input', { type: 'file', multiple: true, accept: '.psd,.zip,image/*,.svg', style: 'display:none', onchange: (ev) => { const f = [...ev.target.files]; ev.target.value = ''; bulkUpload(f); } });
    const search = h('input', { type: 'text', placeholder: 'Search layers…', value: st.filter, oninput: (ev) => { st.filter = ev.target.value; draw(); const i = panel.querySelector('input[type=text]'); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); } });
    const colourAll = h('div', { class: 'cs-lgroup' }, h('button', { class: 'cs-ghead', onclick: () => { st.openGroup = st.openGroup === '*' ? null : '*'; draw(); } }, h('span', {}, '🎨'), h('b', {}, 'Colour the whole character'), h('span', { class: 'sp' }), h('span', {}, st.openGroup === '*' ? '▾' : '▸')),
      st.openGroup === '*' ? h('div', { class: 'cs-ctl' }, ...colourSliders([...new Set(all.map((l) => l.region))], null)) : null);
    return [
      h('div', { class: 'row', style: 'gap:6px' },
        h('button', { class: 'btn sm', title: 'Upload an edited PSD, or many layers at once (a ZIP, or files named like the layers)', onclick: () => bulk.click() }, '⬆ Upload PSD / layers'),
        h('button', { class: 'btn sm', title: 'Every picture of this pose as a named layer in one PSD. Edit it in Photoshop / Krita / Photopea and upload it back', onclick: downloadPsd }, '⬇ PSD'),
        h('button', { class: 'btn sm', title: 'Download every layer as PNG, edit them anywhere, upload them back', onclick: downloadAll }, '⬇ All layers (ZIP)'),
        h('button', { class: 'btn sm', onclick: () => { if (!confirm('Undo every change on this character?')) return; pick(st.def); } }, '↺ Start over'), bulk),
      search, colourAll,
      ...order.map((g) => {
        const rows = byGroup.get(g), open = st.openGroup === g || !!q;
        return h('div', { class: 'cs-lgroup' }, h('button', { class: 'cs-ghead', onclick: () => { st.openGroup = st.openGroup === g ? null : g; draw(); } }, h('span', {}, GROUP_ICON[g] || '🧩'), h('b', {}, groupName(base, g)), h('small', {}, `${rows.length}`), h('span', { class: 'sp' }), h('span', {}, open ? '▾' : '▸')), open ? h('div', { class: 'cs-lrows' }, rows.map(layerRow)) : null);
      }),
    ];
  }

  /* ---------- tester: the animations the admin allowed ---------- */
  async function playOver(a) {
    const json = a && !a.ref.rigAnim ? await fetchAnimation(a.ref.file) : null;
    if (tester && a && !categoriesFor(st.def.rig, { tester }).some(c => c.animations.some(item => String(item.ref.id) === String(a.ref.id)))) throw new Error('This animation is no longer enabled for testers.');
    st.over = a ? { key: a.ref.rigAnim || `a${a.ref.id}`, kind: a.ref.layer || 'face', name: a.name, json } : null;
    rebuild(); draw();
  }
  function panelAnims() {
    const cats = categoriesFor(st.def.rig, { tester });
    const total = cats.reduce((n, c) => n + c.animations.length, 0);
    const bodyAnimations = cats.filter((c) => !c.overlay).flatMap((c) => c.animations);
    const quick = tester ? [
      ['walk', '🚶 Walk', /\bwalk(?:ing)?\b/i],
      ['run', '🏃 Run', /\brun(?:ning)?\b/i],
      ['talk', '💬 Talk', /\b(?:talk(?:ing)?|speak(?:ing)?)\b/i],
    ].map(([key, label, pattern]) => {
      const clip = bodyAnimations.find((a) => pattern.test(a.name));
      const active = clip && st.anim?.key === (clip.ref.rigAnim || `a${clip.ref.id}`);
      return h('button', {
        class: `btn sm ${active ? 'pri' : ''}`,
        disabled: !clip,
        title: clip ? `Play the approved ${clip.name} animation` : `No ${key} animation is enabled for this tester account`,
        onclick: async () => { if (!clip) return; try { await setAnimation(clip); if (key === 'talk') st.mouth = true; draw(); drawAnimBar(); } catch (e) { toast(`${key} could not play: ${e.message}`); } },
      }, label);
    }) : [];
    return [!cats.length ? h('p', { class: 'sub', role: st.permissionsError ? 'alert' : 'status' }, st.permissionsError ? `Could not load animation permissions: ${friendlyError({ message: st.permissionsError })}` : tester ? 'No animations are enabled for this template. Ask the admin to enable clips in Tester Permissions.' : 'This character has no animations.') : null,
      tester ? h('button', { class: 'btn sm', onclick: () => offTesterRules.refresh?.() }, 'Refresh animation permissions') : null,
      h('p', { class: 'sub', style: 'font-size:12px;margin:0' }, `${total} animation${total > 1 ? 's' : ''}${tester ? ' for you' : ''}. Tap one to see it on your character — check how the face and the layers move. Arms / legs / face animations play on top of the body animation.`),
      tester ? h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap', 'aria-label': 'Quick animation preview' }, ...quick) : null,
      ...cats.map((c) => h('div', { class: 'cs-lgroup' }, h('div', { class: 'cs-ghead', style: 'cursor:default' }, h('b', {}, c.name), h('small', {}, `${c.animations.length}`)),
        h('div', { class: 'cs-lrows tst-anims' }, c.animations.map((a) => {
          const k = a.ref.rigAnim || `a${a.ref.id}`, on = c.overlay ? st.over?.key === k : st.anim?.key === k;
          return h('button', { class: `tst-a ${on ? 'on' : ''}`, onclick: async () => { try { if (c.overlay) await playOver(a); else { await setAnimation(a); draw(); } } catch (e) { toast(`The animation could not play: ${e.message}`); } } }, h('b', {}, a.name), h('small', {}, a.length ? `${(+a.length).toFixed(1)}s` : ''));
        })))),
      st.over ? h('button', { class: 'btn sm', onclick: () => playOver(null) }, '✕ Remove the layer animation') : null].filter(Boolean);
  }

  function panelFace() {
    const supported = st.def.rig.bones.some((b) => /^Eyeball_R$|^Eyebrow_R_N$/.test(b.name)) || st.def.rig.slots.some((s) => s.name === 'Nose');
    if (!supported) return [h('p', { class: 'sub' }, 'Face fitting needs a template with a separate face (eyes, brows, nose, lips, ears), like the Neha template.')];
    return [h('p', { class: 'sub', style: 'font-size:12px;margin:0' }, 'Move and resize the face parts so your art fits. The canvas updates live.'),
      ...FACE.map((g) => h('div', { class: 'cs-lgroup' },
        h('button', { class: 'cs-ghead', onclick: () => { st.openGroup = st.openGroup === `f:${g.key}` ? null : `f:${g.key}`; draw(); } }, h('span', {}, g.icon), h('b', {}, g.label), h('span', { class: 'sp' }), h('span', {}, st.openGroup === `f:${g.key}` ? '▾' : '▸')),
        st.openGroup === `f:${g.key}` ? h('div', { class: 'cs-ctl' }, ...g.sliders.map(([k, label, min, max, step]) => {
          const out = h('span', { class: 'v' }, String(st.face[g.key][k])), input = h('input', { type: 'range', min, max, step, value: st.face[g.key][k] });
          input.addEventListener('input', () => { st.face[g.key][k] = +input.value; out.textContent = input.value; queueRig(); });
          return h('label', { class: 'cs-sl' }, h('span', {}, label), input, out);
        }), h('button', { class: 'btn sm', onclick: () => { st.face[g.key] = faceDefaults()[g.key]; queueRig(); draw(); } }, '↺ Reset')) : null)),
      h('button', { class: 'btn sm', onclick: () => { st.face = faceDefaults(); queueRig(); draw(); } }, '↺ Reset the whole face')];
  }

  const FIXED = new Set(['body', 'head', 'ear', 'eye_ball', 'eye_lid', 'lip', 'nose', 'hand_palm']);
  const CAT = { top_cloth: 'Top', bottom_cloth: 'Bottom', full_cloth: 'Full outfit', shoes: 'Shoes', hair: 'Hair', accessories: 'Accessories' };
  const pretty = (s) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  /** body proportions + automatic physics: the same character runs every animation with shorter / longer limbs */
  function panelBody() {
    const f = st.fit || (st.fit = getFit(st.def.id)), apply = () => { setFit(st.def.id, f); queueRig(); };
    const sl = (label, key) => {
      const [min, max] = FIT_LIMITS[key], out = h('span', { class: 'v' }, `${Math.round(f[key] * 100)}%`), input = h('input', { type: 'range', min, max, step: 0.01, value: f[key] });
      input.addEventListener('input', () => { f[key] = +input.value; out.textContent = `${Math.round(f[key] * 100)}%`; apply(); });
      return h('label', { class: 'cs-sl' }, h('span', {}, label), input, out);
    };
    const fromArt = h('button', { class: 'btn', title: 'Compares your uploaded arm / leg / hand pictures with the original ones', onclick: () => { autoProportions(); draw(); } }, '📏 Set from my art');
    const preset = ([name, v]) => h('button', { class: 'btn', onclick: () => { Object.assign(f, v); apply(); draw(); } }, name);
    const mapRows = () => {
      let auto; try { auto = stage.limbsOf(st.def.id, st.skins).limbs; } catch { return [h('p', { class: 'sub' }, 'This is not available for this character.')]; }
      const guess = { legs: auto.legs.map((c) => c[0]).join(', '), arms: auto.arms.map((c) => c[0]).join(', '), hands: auto.hands.join(', '), hip: auto.hip || '' };
      return [['legs', 'Legs'], ['arms', 'Arms'], ['hands', 'Hands'], ['hip', 'Hips']].map(([key, label]) => {
        const input = h('input', { type: 'text', placeholder: guess[key] || 'auto', value: f.map?.[key] || '', style: 'flex:1;min-width:0' });
        input.addEventListener('change', () => { f.map = { ...(f.map || {}), [key]: input.value.trim() }; apply(); });
        return h('label', { class: 'cs-sl', style: 'display:flex;gap:8px;align-items:center' }, h('span', { style: 'width:48px' }, label), input);
      });
    };
    const phys = h('input', { type: 'checkbox', checked: f.phys !== false });
    phys.addEventListener('change', () => { f.phys = phys.checked; apply(); });
    return [h('p', { class: 'sub', style: 'font-size:12px;margin:0' }, 'Make the legs, arms and hands shorter or longer. The hips sink by themselves so the feet stay on the ground, and every animation keeps working. Saved for this character in the animation studio too.'),
      h('div', { class: 'cs-sec' }, h('h3', {}, 'Presets'), h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, FIT_PRESETS.map(preset), fromArt)),
      h('div', { class: 'cs-sec' }, h('h3', {}, 'Length'), sl('Legs', 'leg'), sl('Arms', 'arm'), sl('Hands', 'hand')),
      h('details', { class: 'cs-sec' }, h('summary', { style: 'cursor:pointer;font-weight:700' }, 'Bone map (advanced)'), h('p', { class: 'sub', style: 'font-size:12px;margin:6px 0' }, 'Found automatically from the skeleton. If a limb is wrong, type the first bone name of each limb (comma separated).'), ...mapRows()),
      h('div', { class: 'cs-sec' }, h('h3', {}, 'Physics'), h('label', { style: 'display:flex;gap:8px;align-items:center;font-size:13px' }, phys, 'Automatic physics for hair, dupatta, kurta, lungi and earrings (added where the rig has none)'))];
  }
  function panelOutfit() {
    const names = skinList().map((s) => s.name).filter((n) => n !== 'default');
    if (!names.length) return [h('p', { class: 'sub' }, 'This character has no separate outfit parts.')];
    const combined = names.some((n) => n.includes('/'));
    const worn = () => new Set(st.skins || names);
    const reset = () => { gen++; pending = new Set(); st.edit = new Map(); Object.values(st.artworkPages).forEach((k) => stage.dropArtworkCanvas(k)); st.work = {}; st.orig = {}; st.artworkPages = {}; st.dirty = new Set(); st.cbox = new Map(); st.hide = new Set(); st.open = null; thumbs.clear(); Promise.all(st.pages.map(pageCanvas)).then(() => { rebuild(); draw(); }); };
    if (!combined) {                // whole outfits (Saree / Salvar / Business ...): one at a time
      const pickSkin = (n) => { st.skins = [n]; reset(); };
      return [h('p', { class: 'sub', style: 'font-size:12px' }, 'Choose an outfit. Your colour edits restart for the new outfit.'),
        h('div', { class: 'cs-grid' }, names.map((n) => h('div', { class: `cs-card ${st.skins?.length === 1 && st.skins[0] === n ? 'on' : ''}`, onclick: () => pickSkin(n) }, h('span', { class: 'cs-th' }, '👗'), h('b', {}, n === 'Buisness' ? 'Business' : n))))];
    }
    const groups = new Map();
    for (const n of names) { const [cat, ...rest] = n.split('/'); const key = rest.length ? cat : n === 'body' ? 'body' : '_o'; (groups.get(key) || groups.set(key, []).get(key)).push({ name: n, label: rest.length ? pretty(rest[rest.length - 1] === 'normal' ? rest[0] : rest[rest.length - 1]) : n }); }
    const set = (cat, item) => { const w = worn(); for (const it of groups.get(cat)) w.delete(it.name); if (item) w.add(item); st.skins = [...w].length === names.length ? null : [...w]; reset(); };
    const section = ([cat, items]) => h('div', { class: 'cs-sec' }, h('h3', {}, cat === '_o' ? 'Outfit' : CAT[cat] || pretty(cat)),
      h('div', { class: 'cs-grid' }, cat !== '_o' ? h('div', { class: `cs-card ${!items.some((i) => worn().has(i.name)) ? 'on' : ''}`, onclick: () => set(cat, null) }, h('span', { class: 'cs-th' }, '∅'), h('b', {}, 'None')) : null,
        items.map((it) => h('div', { class: `cs-card ${worn().has(it.name) ? 'on' : ''}`, onclick: () => set(cat, it.name) }, h('span', { class: 'cs-th' }, '👕'), h('b', { title: it.name }, it.label)))));
    const all = [...groups];
    return [h('p', { class: 'sub', style: 'font-size:12px;margin:0' }, 'Pick what the character wears. Colour edits restart when the outfit changes.'), ...all.filter(([c]) => !FIXED.has(c)).map(section),
      h('details', { class: 'cs-sec' }, h('summary', { style: 'cursor:pointer;font-weight:700' }, 'Base parts'), h('p', { class: 'sub', style: 'font-size:12px;margin:6px 0 0' }, all.filter(([c]) => FIXED.has(c)).map(([c, items]) => `${pretty(c)}: ${items.map((i) => i.label).join(', ')}`).join(' · ')))];
  }

  /** the finished character: edits baked into rig + images, plus the edit profile */
  async function bake() {
    for (const pg of st.pages) await pageCanvas(pg);
    if (pending.size) { clearTimeout(applyTimer); await flush(); }
    const profile = { template: st.tpl, skins: st.skins, hide: [...st.hide], face: st.face, xf: st.xf, order: st.order, attach: st.attach, locked: [...st.locked], fit: st.fit || getFit(st.def.id) };
    const ske = bakeSke(st.def.ske, profile), tex = [], pages = {};
    for (const t of st.def.tex) {
      const pg = t.json.imagePath, image = st.dirty.has(pg) ? await toBlob(st.work[pg]) : t.image;
      tex.push({ json: t.json, image });
      if (st.dirty.has(pg) || st.def.pages?.[pg]) pages[pg] = image;       // only pictures the user changed are kept; the rest comes from the template
    }
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
    if (tester && user?.uid) { try { localStorage.setItem(`tester-last-character-${user.uid}`, id); } catch { /* the page then opens a fresh rig */ } }
    const full = baseId ? await hydrateCharacter(rec) : rec, i = mine.findIndex((c) => c.id === id);
    if (i >= 0) mine[i] = full; else mine.push(full);
    if (baseId) st.savedId = id;
    let msg = `✓ Saved on this device (${mb(total) === '0 MB' ? 'a few KB' : mb(total)} of your own pictures).`;
    if (await cloudReady()) {
      let cloudError = null;
      try { await saveCharacterCloud(rec); if (!st.cloud.some((c) => c.id === id)) st.cloud.push({ id }); msg = '✓ Saved on this device and in your account.'; }
      catch (er) { cloudError = er; msg = `✓ Saved on this device. Account: ${friendlyError(er)}`; }
      if (tester) {          // the database row is saved even when the picture upload failed, so the admin always sees the submission
        try { await saveTesterSubmission(rec, user); msg = cloudError ? `✓ Settings saved to the database, but the pictures could not be uploaded: ${friendlyError(cloudError)}` : '✓ Saved in the database — the animation studio now uses this character with your face settings.'; }
        catch (er) { msg += ` Not saved to the database: ${friendlyError(er)}`; }
      }
    } else if (tester) { try { await saveTesterSubmission(rec, user); msg = '✓ Settings saved to the database. The pictures were not uploaded (cloud storage is not set up); they only exist on this device.'; } catch (er) { msg = `✓ Saved on this device. Not saved to the database: ${friendlyError(er)}`; } }
    else if (user?.uid && user.uid !== 'debug') msg += ' (Cloud saving is not set up yet.)';
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
      h('p', { class: 'sub', style: 'font-size:12px;margin:0 0 8px' }, tester ? 'Your character and settings are saved for the animation review. Your uploaded pictures are stored with this character; the animation rig makes the allowed movements available.' : `Saved on this device and, when you are logged in, in your 12toons account (up to ${LIMITS.characters} characters). Only your own pictures and settings are stored — the skeleton and the untouched parts come from the template. 12toons (the animation studio) then loads exactly this character and plays every animation on it.`),
      h('label', { class: 'f' }, 'Name', name),
      h('div', { class: 'row', style: 'margin-top:12px' },
        h('button', { class: 'btn pri', onclick: go(false) }, st.savedId ? '💾 Update this character' : '💾 Save character'),
        st.savedId ? h('button', { class: 'btn', onclick: go(true) }, '＋ Save as a new copy') : null,
        h('button', { class: 'btn', onclick: async () => {
          const { ske, tex } = await bake(), z = new JSZip(), base = safe(name.value.trim() || 'character').replace(/[^\w\-]+/g, '_');
          z.file(`${base}_ske.json`, JSON.stringify(ske));
          tex.forEach((t, i) => { z.file(`${base}_tex_${i}.json`, JSON.stringify(t.json)); z.file(safe(t.json.imagePath), t.image); });
          const blob = await z.generateAsync({ type: 'blob' }), a = h('a', { href: URL.createObjectURL(blob), download: `${base}.zip` }); document.body.append(a); a.click(); a.remove();
        } }, '⬇ Download ZIP')), status,
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
    const edits=[...st.edit].map(([key,e])=>{if(e.img&&!imageIds.has(e.img))imageIds.set(e.img,++imageSeq);return [key,{...e,img:e.img?imageIds.get(e.img):null}];});
    const sig=JSON.stringify({id:st.def.id,state,edits});
    if(sig===draftSignature)return;
    const draftDef=structuredClone(st.def), draftEdits=[...st.edit].map(([k,e])=>[k,{...e}]);
    writingDraft=(async()=>{
      const serialized=[];
      for(const [key,e] of draftEdits){
        let img=null;
        if(e.img){if(!imageBlobs.has(e.img)){const c=makeCanvas(e.img.width,e.img.height);c.getContext('2d').drawImage(e.img,0,0);imageBlobs.set(e.img,await toBlob(c,'image/png'));}img=imageBlobs.get(e.img);}
        serialized.push([key,{...e,img}]);
      }
      await putDraft('draft',{id:'current',def:draftDef,state,edits:serialized,ts:Date.now()});
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
  const draftStatus=h('span',{class:'sub'},localPreview ? 'Preview only · cloud saving disabled' : 'Saved locally');root.querySelector('header').append(draftStatus);
  const offStatus=localPreview ? () => {} : onSyncStatus(s=>{draftStatus.textContent=s.text;draftStatus.title=s.error;});
  const draftTimer=setInterval(()=>{if(root.isConnected&&!document.hidden)saveDraft().catch(e=>{draftStatus.textContent='Local save failed: '+friendlyError(e);});},3000);
  const offTesterRules = tester && !localPreview ? watchTesterConfig(config => {
    st.permissionsError = '';
    setTesterRules(config);
    if (!st.def) return;
    const allowed = categoriesFor(st.def.rig, { tester: true });
    const keys = new Set(allowed.flatMap(c => c.animations.map(a => a.ref.rigAnim || `a${a.ref.id}`)));
    if (st.anim && !keys.has(st.anim.key)) { st.anim = null; st.mouth = false; }
    if (st.over && !keys.has(st.over.key)) st.over = null;
    rebuild(); draw(); drawAnimBar();
  }, e => { st.permissionsError = e.message; st.mouth = false; setTesterRules(null); if (st.anim || st.over) { st.anim = null; st.over = null; rebuild(); } if (st.def) { draw(); drawAnimBar(); } }) : () => {};
  if (import.meta.env?.DEV && location.search.includes('debug')) window.__charstudio = { st, layers, stage };      // for the browser tests
  root.dispose=()=>{offPlaceKeys();offTesterRules();clearInterval(draftTimer);offStatus();document.removeEventListener('visibilitychange',hideSave);};
  const draft=await getDraft('draft','current');
  if(draft?.def && !tester){
    await pick(draft.def);
    Object.assign(st,draft.state,{hide:new Set(draft.state.hide),locked:new Set(draft.state.locked)});
    st.edit=new Map(await Promise.all(draft.edits.map(async([key,e])=>[key,{...e,img:e.img?await readImage(e.img):null}])));
    pending=new Set(st.edit.keys());await flush();rebuild();stage.userCam=draft.state.camera;
  }
  draw(); drawAnimBar();
  if (tester) {
    // after a refresh, carry on with the character that was saved last instead of a blank rig
    let reopened = false;
    try {
      const lastId = (() => { try { return localStorage.getItem(`tester-last-character-${user?.uid}`); } catch { return null; } })(), last = lastId && mine.find((c) => c.id === lastId);
      if (last) { st.createMode = true; await pick(last); st.tab = 'create'; rebuild(); draw(); drawAnimBar(); reopened = true; }
    } catch (er) { toast(`Could not reopen your saved character: ${er.message}`); }
    try {
      const base = reopened ? null : templateChoices().find((e) => e.template);
      if (base) {
        await pick(await fetchLibraryCharacter(base), 'custom character rig');
        st.createMode = true;
        st.tab = 'create'; rebuild(); draw(); drawAnimBar();
      }
    } catch (er) { toast(`Could not set up the custom character workspace: ${er.message}`); }
  }
  if (localPreview) {
    root.captureArtworkFrame = () => {
      if (stage.gl.isContextLost()) throw new Error('The browser\'s graphics context was lost. Please reload this local preview.');
      const time = previewTime(performance.now());
      stage.render(time, 0, mouthClips(time), [{ start: 0, end: 1e9, speaker: 'c', type: st.zoom, focus: 'auto' }]);
      return stage.out.toDataURL('image/png');
    };
    root.loadArtworkPack = async (manifestUrl) => {
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
      setTesterRules({ anims: { '*': categoriesFor(st.def.rig, { all: true }).flatMap(c => c.animations.map(a => String(a.ref.id))) }, limit: 0 });
      st.createMode = true; st.tab = 'create'; st.mouth = false; st.anim = null; st.over = null;
      await flush(); rebuild(); draw(); drawAnimBar();
      return report;
    };
    root.querySelector('header .btn.ok').disabled = true;
    root.querySelector('header .btn.ok').textContent = 'Local artwork preview';
  }
  raf = requestAnimationFrame(loop);
  return root;
}

