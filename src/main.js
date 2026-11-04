import { TEAR_STYLES, TEAR_IMAGE_URL, tearConfig, loadTearSprite } from './tears.js';
import { EditHistory } from './edit-history.js';
import { PREVIEW_MODES, readPreviewMode, savePreviewMode, previewFrameDue } from './preview-quality.js';
import './style.css';
import './studio.css';
import './timeline.css';
import { timelineIcon, pruneTimelineThumbnails } from './timeline-icons.js';
import { peaksOf, peakMax, barsFor, drawWave } from './waveform.js';
import { icon, watchIcons } from './icons.js';
import { installTips } from './tips.js';
import './studio-icons.css';
import { syncPresentation } from './sync-feedback.js';
import { brandWordmark, swipeAway } from './dom.js';
import { creditsBadge } from './credits-badge.js';
import { lockedFor, PAID_MESSAGE } from '../shared/asset-access.js';
import { ingest, isNarrator } from './ingest.js';
import { analyse } from './lipsync.js';
import { Stage, ASPECTS, BACKGROUNDS, aspectOf } from './db/stage.js';
import { Player, buildTimeline } from './player.js';
import { characterPicker } from './charpick.js';
import { exportOffline, exportParallel, workerCount, exportRealtime, canExportOffline, pickType, bitrateFor } from './exporter.js';
import { loadCharacters, saveCharacter, deleteCharacter, all as dbAll, put as dbPut, del as dbDel, get as dbGet, resetAll, context as projectContext, listBgLibrary } from './store.js';
import { startAutoSync, cloudReady, listCharactersCloud, loadCharacterCloud, deleteCharacterCloud } from './cloud.js';
import { describeMotion, buildBrief, extractJson } from './brief.js';
import { loadAi, saveAi, listModels, transcribe, direct } from './ai.js';
import { loadCatalog, hydrateCharacter, categoriesFor, fetchAnimation, url as assetUrl, libraryCharacters, libraryStatus, fetchLibraryCharacter, cdn, modePools, idleRef, modeEntries, MODE_REFS, cloudRef } from './catalog.js';
import { pictureUrl } from './cloud-characters.js';
import { getFit, setFit } from './universal.js';
import { onSyncStatus, syncStatus, syncCurrent } from './project-sync.js';
import { listStudioAssets, downloadStudioAsset } from './studio-assets.js';

import { emptyScene, sequencePlan, uniqueSceneName } from './scenes.js';
import { authorizeExport, finishExport, ExportLimitError, currentPlan, refreshPlan } from './export-plan.js';
import { BG_EFFECTS, bgEffectId } from '../shared/bg-effects.js';
import { propFromAsset, isEffect, isHeld, isHandAsset, actualPropSize, placeProp } from '../shared/studio-effects.js';
import { friendlyError } from '../shared/hinglish-errors.js';
import { DEFAULT_GRADE, GRADE_CONTROLS, GRADE_PRESETS, cleanGrade, gradeActive, gradeAt, presetGrade, presetOf } from '../shared/color-grade.js';
import { thin, pathLength, pathKeys, simplify, insertAt, anchorPath, DEPTH_DEFAULT } from '../shared/motion-path.js';
import { resizeClip, contentLength, snap as snapTo, snapDelta, MIN_CLIP } from '../shared/timeline-edit.js';
import { presetKeys, withPreset, PRESETS as CAM_PRESETS } from '../shared/camera-presets.js';
import { saveLabel } from '../shared/save-time.js';
import { estimateSeconds, prettyTime, estimateMegabytes, BASIS_TEXT, rememberSpeed, lastSpeed, rememberSize, sizeRatio } from '../shared/export-estimate.js';
import { DEFAULT_LAYOUT, SHORTCUT_GROUPS, EXPORT_PRESETS, presetMatch, loadLayout, saveLayout, applyLayout, clampPanel, clampTimeline } from './studio-layout.js';

const initialPreviewMode = readPreviewMode();
const COLORS = ['#7c5cff', '#35d0ba', '#ffb454', '#ff6b9a', '#5bb8ff', '#b6e354'];
const S = {
  scenes: [], sceneId: null, exportScope: 'all',
  step: 3, characters: [], libDefs: new Map(), myBgs: [], props: [], sharedAssets: [], bgId: null, bgClips: [], paths: {}, pathDraw: null, pathEdit: false, grade: { ...DEFAULT_GRADE }, gradeKeys: [], gradeSel: null, bgSel: null, propSel: null, clipboard: null, bgAtTime: false, selectedPropId: null, canvasMode: 'backgrounds', lines: [], speakers: [], order: [],
  ready: false, editorZoom: 1, pps: 30, lineSel: null, script: new Map(), solo: {}, ai: loadAi(), cast: new Map(), shots: new Map(), applyAll: false, panelOpen: true,
  aspect: '16:9', previewMode: initialPreviewMode, preview: PREVIEW_MODES[initialPreviewMode].short, exporting: false, dirty: true, maxStep: 1, tab: 'audio', animFor: null, sel: null,
  quality: 720, expMethod: 'fast', fps: 30, level: 'high', format: 'webm',
  manual: {}, mclip: null, addMode: false,            // animations the user placed on the timeline: { <character key>: [{id, kind, ref, start, dur, off}] }
  charKeys: {}, ckSel: null, motionFor: null,          // movement keyframes per character: { <character key>: [{id, t, x, y, mul, flip, ease}] }
  camKeys: [], camSel: null, camPeek: false,           // camera keyframes: [{id, t, cx, cy, zoom, ease}]
};
const uid = () => Math.random().toString(36).slice(2, 9);
const clone = (o) => JSON.parse(JSON.stringify(o));   // undo / redo snapshots must not share objects with the live state
let audioCtx, stage, player;
let sceneChanging = false;
const sceneAudio = new Map();
const $app = document.getElementById('app');

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), event => ['click', 'input', 'change', 'drop'].includes(k.slice(2)) && !el.hasAttribute('data-history-control') ? historyAction(() => v(event), editGroup(event)) : v(event));
    else if (k === 'style') el.style.cssText = v;
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
};
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(Math.floor((s % 1) * 10))}`;
const toast = (msg) => { const t = h('div', { class: 'toast' }, msg); document.body.append(t); swipeAway(t); };
const busy = (msg, onCancel) => {
  const bar = h('i'), txt = h('div', {}, msg), el = h('div', { class: 'busy' }, h('div', { class: 'card' }, txt, h('div', { class: 'bar', style: 'margin:12px 0 0' }, bar),
    onCancel && h('button', { class: 'btn sm', style: 'margin-top:14px', onclick: onCancel }, 'Cancel')));
  document.body.append(el);
  return { set: (m, p) => { txt.textContent = m; if (p != null) bar.style.width = `${Math.round(p * 100)}%`; }, done: () => el.remove() };
};

function modal(title, body, onClose) {
  const close = () => { onClose?.(); el.remove(); };
  const el = h('div', { class: 'modal', onclick: (e) => e.target === el && close() },
    h('div', { class: 'sheet' }, h('div', { class: 'row', style: 'margin-bottom:12px' }, h('h2', { style: 'margin:0' }, title), h('span', { class: 'sp' }), h('button', { class: 'btn sm', onclick: close }, '✕')), body));
  document.body.append(el);
  return close;
}

async function boot() {
  [S.characters, S.myBgs, S.props] = await Promise.all([loadCharacters().then((l) => l.filter((c) => c.ske || c.base)), dbAll('backgrounds'), dbAll('props')]);
  await loadCatalog();
  S.sharedAssets = await listStudioAssets().catch((e) => { console.warn('Shared studio library unavailable:', e.message); return []; });
  S.props.forEach((p) => p.blob && bid(p.blob));
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  stage = new Stage({ maxTex: PREVIEW_MODES[S.previewMode].maxTex });
  stage.setSize(S.aspect, S.preview);
  await stage.setProps(S.props);
  player = new Player(audioCtx);
  requestStudioFrame();
  const restored = await restoreProject();
  if (!S.scenes.length) { S.sceneId = uid(); S.scenes = [{ id: S.sceneId, name: 'Scene 1', doc: null }]; }
  S.ready = true;
  hist.reset(docOf());
  setInterval(() => { if (!document.hidden) tick(); }, 1000);
  if (!restored) { await prepareStudio(); render(); }
}

/* ---------------- the workbench ---------------- */
/** the workbench is always the dark gray look; the site's own day / night choice comes back when the studio closes */
const studioTheme = {
  saved: null,
  enter() { const root = document.documentElement; if (this.saved == null) this.saved = root.dataset.theme || ''; root.dataset.theme = 'night'; root.style.colorScheme = 'dark'; document.body.classList.add('studio-dark'); },
  leave() { const root = document.documentElement; if (this.saved != null) { if (this.saved) root.dataset.theme = this.saved; root.style.colorScheme = this.saved === 'night' ? 'dark' : 'light'; this.saved = null; } document.body.classList.remove('studio-dark'); },
};
let iconsWatched = false;
function render() {
  if (!iconsWatched) { iconsWatched = true; watchIcons(document.body); installTips(document.body); }
  $app.replaceChildren(h('div', { class: 'wrap s3 ws' }, topBar(), viewStudio()));
  mountStage(); document.querySelector('.ws').dataset.previewQuality = S.previewMode; applyLayout(wsEl(), S.layout); placeDock('rail'); placeDock('panel'); dockShow('rail'); dockShow('panel');
}
function topBar() {
  // The 12toons name sits in the middle of the bar; quality, save state, undo / redo, export — then the X that leaves the studio.
  // A paid account or an admin gets a faint amber edge on the Project ID box (the server says who is paid; free accounts and the debug session see no change).
  const bar = h('header', { class: 'topbar studio-bar' }, headerTools());
  const paint = () => bar.querySelector('.project-id')?.toggleAttribute('data-t', currentPlan().tier === 'paid');
  paint(); refreshPlan().then(paint).catch(() => {});
  return bar;
}
/** audio lines changed (added / removed): rebuild the voices, the timeline and the characters */
async function afterAudioChange() {
  buildSpeakers();
  await prepareStudio();
  fitTimeline(); drawLineBox(); drawTabs(); S.dirty = true;
}
function fitTimeline() { if (!tlScroll) return; S.pps = Math.max(4, (tlScroll.clientWidth - 24) / Math.max(player.total, 1)); drawTimeline(); tlScroll.scrollLeft = 0; }

async function onFiles(files) {
  if (!files.length) return;
  const b = busy('Reading files…');
  try {
    await audioCtx.resume();
    const { characters, audio, scripts } = await ingest(files);
    for (const c of characters) {
      const i = S.characters.findIndex((x) => x.name === c.name);
      if (i >= 0) { c.id = S.characters[i].id; S.characters[i] = c; } else S.characters.push(c);
      await saveCharacter(c);
    }
    if (characters.length) toast(`Added ${characters.length} character${characters.length > 1 ? 's' : ''} to your library`);
    let n = 0;
    for (const a of audio) {
      b.set(`Decoding audio ${++n}/${audio.length}…`, n / audio.length);
      try {
        const raw = await a.e.read();
        const buffer = await audioCtx.decodeAudioData(raw.slice(0));
        S.lines.push({ id: crypto.randomUUID(), order: a.order, file: a.file, speaker: a.speaker, raw, buffer, visemes: analyse(buffer) });
      } catch { toast(`${a.file} could not be decoded`); }
    }
    S.lines.sort((x, y) => x.order - y.order || x.file.localeCompare(y.file, undefined, { numeric: true }));
    if (scripts?.length) {
      // script text -> lines: by audio file name, by line number, or by position
      const strip = (f) => f.replace(/\.[^.]+$/, '').toLowerCase();
      let hit = 0;
      S.lines.forEach((l, i) => {
        const t = scripts.find((x) => x.file && strip(x.file.split('/').pop()) === strip(l.file)) || scripts.find((x) => x.order != null && x.order === l.order)
          || (scripts.length === S.lines.length ? scripts[i] : null);
        if (t && !S.script.get(l.id)) { S.script.set(l.id, t.text); hit++; }
      });
      if (hit) toast(`Script found — text added for ${hit} line${hit > 1 ? 's' : ''}.`);
    }
    if (!characters.length && !audio.length) toast('No audio or character bundle was found in these files.');
  } catch (e) { toast(`Could not read: ${e.message}`); }
  b.done(); await afterAudioChange();
}

/* ---------------- voices and characters ---------------- */
function buildSpeakers() {
  const old = new Map(S.speakers.map((s) => [s.key, s]));
  const spk = [];
  for (const l of S.lines) {
    const key = l.speaker.toLowerCase();
    if (!spk.some((s) => s.key === key)) {
      const narr = isNarrator(l.speaker);
      spk.push(old.get(key) || {
        key, name: l.speaker, narrator: narr, color: COLORS[spk.length % COLORS.length],
        charId: null, clips: null, flip: false, visible: true,
      });
    }
  }
  S.speakers = [...spk, ...S.speakers.filter((s) => s.manual && !spk.some((x) => x.key === s.key))];   // characters added by hand have no voice
  S.order = [...S.order.filter((k) => S.speakers.some((s) => s.key === k)), ...S.speakers.map((s) => s.key).filter((k) => !S.order.includes(k))];
  // face each other by default: every 2nd on-screen character is mirrored (only when not touched before)
  S.speakers.filter((s) => s.charId).forEach((s, i) => { if (s.flip === false && !s._flipSet) s.flip = i % 2 === 1; });
}
const charOf = (s) => S.characters.find((c) => c.id === s.charId) || S.libDefs.get(s.charId);

/** animation refs: {source:'lib', id, name, file} | {source:'local', name} (from the character zip) | {source:'custom', id, name} */
function defaultBody(def) {
  const cats = categoriesFor(def.rig).filter((c) => !c.overlay);
  const a = (cats.find((c) => /idle/i.test(c.name)) || cats[0])?.animations[0];
  if (a) return { ...a.ref };
  return null;
}
const animKey = (r) => (r.source === 'lib' ? `a${r.id}` : r.source === 'custom' ? `c${r.id}` : r.name);
/** the small picture of an animation in the list; an uploaded character's GIF is downloaded once and kept by the browser */
function posterImg(poster, type = 'gif') {
  if (!String(poster).startsWith('cloud:')) return h('img', { src: assetUrl(poster), alt: '', loading: 'lazy', decoding: 'async' });
  if (type === 'mp4') {                                              // the preview is a tiny looping video (muted, plays by itself, like a GIF)
    const video = h('video', { class: 'animation-poster', loop: true, playsinline: true, preload: 'auto', 'aria-hidden': 'true', tabindex: '-1' });
    video.muted = true; video.autoplay = true;
    pictureUrl(cloudRef(poster), 'video/mp4').then((u) => { video.src = u; video.play().catch(() => {}); }).catch(() => { video.remove(); });
    return video;
  }
  const img = h('img', { alt: '', decoding: 'async' });
  pictureUrl(cloudRef(poster)).then((u) => { img.src = u; }).catch(() => { img.remove(); });
  return img;
}
async function animJson(def, r) {
  if (r.source === 'lib') return fetchAnimation(r.file);
  if (r.source === 'custom') return (await dbGet('animations', r.id))?.json; // Read-only playback for older projects.
  if (r.source === 'rig') return fetchAnimation(r.file || `${def.rig.animDir}${r.name.replace(/\//g, '_')}.json`);
  return def.localAnims?.[r.name];
}
const sameRef = (a, b) => a && b && a.source === b.source && (a.source === 'local' ? a.name === b.name : a.id === b.id);

/* ---- character chooser (characters are downloaded from their links; animations and expressions live in the studio) ---- */
const definitionJobs = new Map();
async function ensureCharacter(id) {
  const saved = S.characters.find(c => c.id === id), ready = saved || S.libDefs.get(id);
  if (ready?.ske) { if (S.libDefs.has(id)) { S.libDefs.delete(id); S.libDefs.set(id, ready); } return ready; }
  if (definitionJobs.has(id)) return definitionJobs.get(id);
  const job = (async () => {
    if (saved) {
      const def = await hydrateCharacter(saved);
      if (!def) throw new Error('The template for the saved character is not available.');
      S.characters[S.characters.indexOf(saved)] = def; return def;
    }
    const entry = libraryCharacters().find(e => `lib:${e.id}` === id);
    if (!entry) throw new Error('This character template is no longer available.');
    const def = await fetchLibraryCharacter(entry); S.libDefs.set(id, def); return def;
  })().finally(() => definitionJobs.delete(id));
  definitionJobs.set(id, job); return job;
}
async function useCharacter(s, id) {
  if (id) {
    const loading = busy('Loading character…');
    try { await ensureCharacter(id); }
    catch (error) { toast(`Could not load the character: ${error.message}`); return false; }
    finally { loading.done(); }
  }
  s.charId = id; s._chosen = true; if (id) S.sel = s.key;
  // a character that has only the automatic name ("Character 2") is called by the name of the character it got (Roshan, Maya ...); a second one gets a number
  const picked = id ? charOf(s) : null;
  if (picked?.name && (s._auto || /^Character \d+$/.test(s.name))) {
    let name = picked.name, n = 2; while (S.speakers.some((x) => x !== s && x.name === name)) name = `${picked.name} ${n++}`;
    s.name = name; s._auto = true;
  }
  S.speakers.filter(x => x.charId).forEach((x, i) => { if (!x._flipSet) x.flip = i % 2 === 1; });
  return true;
}
function chooseCharacter(s, after) {
  let close;
  const card = (img, title, sub, on, sel) => h('button', { class: `cc ${sel ? 'on' : ''}`, onclick: on },
    h('div', { class: 'th' }, img ? h('img', { src: img, alt: '', loading: 'lazy' }) : h('span', {}, '🚫')), h('b', {}, title), sub && h('small', {}, sub));
  const cloudBox = h('div');
  const pick = id => historyAction(async () => { if (await useCharacter(s, id)) { close(); await after(); } });
  close = modal(`Character for ${s.name}`, h('div', {},
    h('div', { class: 'gridc' }, card(null, 'No character', 'Voice only', () => pick(null), !s.charId)),
    h('h2', { style: 'margin:16px 0 8px' }, 'Characters'),
    libraryCharacters().some((e) => e.template) ? characterPicker({ entries: libraryCharacters(), isOn: (e) => s.charId === `lib:${e.id}`, onPick: (e) => pick(`lib:${e.id}`), steps: true }) : libraryStatus() ? h('p', { class: 'sub', role: 'alert' }, libraryStatus()) : null,
    S.characters.length ? [h('h2', { style: 'margin:16px 0 8px' }, 'Your characters'), h('div', { class: 'gridc' }, S.characters.map((c) => { const wrap = h('div', { class: 'cc-wrap' }, card(c.thumb || null, c.name, 'from your device', () => pick(c.id), s.charId === c.id),
      h('button', { type: 'button', class: 'cc-del', 'aria-label': `Delete ${c.name}`, title: 'Delete this character', onclick: async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete “${c.name}” for good? It is removed from this device and from your account.`)) return;
        try { await deleteCharacter(c.id); await deleteCharacterCloud(c.id).catch(() => {}); S.characters = S.characters.filter((x) => x.id !== c.id); wrap.remove(); toast('Character deleted.'); } catch (er) { toast(`Could not delete: ${er.message}`); }
      } }, icon('trash'))); return wrap; }))] : null,
    cloudBox));
  cloudReady().then(async (ok) => {
    if (!ok) return;
    const list = (await listCharactersCloud()).filter((m) => !S.characters.some((c) => c.id === m.id));
    if (!list.length) return;
    cloudBox.replaceChildren(h('h2', { style: 'margin:16px 0 8px' }, '☁ Saved in your account'), h('div', { class: 'gridc' }, list.map((m) => card(m.thumb || null, m.name, 'tap to download', async () => {
      const b = busy(`Downloading ${m.name}…`);
      try { const d = await loadCharacterCloud(m); await saveCharacter(d); S.characters.push(d); b.done(); await pick(d.id); } catch (e) { b.done(); toast(`Could not download: ${e.message}`); }
    }, false))));
  }).catch(() => {});
}

/* Compact rows render only the visible window; previews start only on request. */
const browserObservers = new Set();
let activePreview = null;
function stopAll() { thumbPlay.stop(); for (const observer of browserObservers) observer.disconnect(); browserObservers.clear(); activePreview?.pause(); activePreview = null; }
/* ---- live animation thumbnails: no GIFs. One shared mini stage plays the animation under the pointer on the
   speaker's own character. Nothing is downloaded until the pointer rests on a row (animations are cached afterwards). ---- */
const thumbPlay = (() => {
  let mini = null, loadedId = null, job = 0, raf = 0, host = null, shelf = null;
  const stop = () => {
    job++; cancelAnimationFrame(raf); raf = 0;
    if (host && shelf) host.replaceChildren(...shelf);
    host = shelf = null;
  };
  async function start(el, def, a) {
    stop();
    const my = job;
    if (!el || !def?.ske || a.ref.source === 'mode' || a.cat.overlay) return;
    await new Promise((resolve) => setTimeout(resolve, 220));            // only when the pointer rests on the row
    if (my !== job || !el.isConnected) return;
    try {
      const anim = await animJson(def, a.ref);
      if (my !== job || !anim) return;
      if (!mini) { mini = new Stage({ maxTex: 1024 }); mini.setSize('1:1', 192); mini.fullView = false; }
      if (loadedId !== def.id) { for (const id of [...mini.assets.keys()]) mini.unload(id); await mini.loadCharacter(def); loadedId = def.id; }
      if (my !== job) return;
      const name = animKey(a.ref), len = Math.max(0.5, +a.length || 3);
      mini.setLayers([{ fit: getFit(def.id), skins: def.skins ?? null, key: 'thumb', charId: def.id, swap: null, anims: { [name]: anim }, clips: [{ id: 'thumb', kind: 'body', name, start: 0, dur: len, off: 0 }], present: null, flip: false, xf: null, mask: null, maskKeys: [], maskFollow: '', slot: 0, visible: true, keys: [] }]);
      host = el; shelf = [...el.childNodes]; el.replaceChildren(mini.out);
      let t = 0, last = performance.now();
      const frame = (now) => {
        if (my !== job) return;
        const dt = Math.min(0.1, (now - last) / 1000); last = now; t = (t + dt) % len;
        try { mini.render(t, dt, [], []); } catch { stop(); return; }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    } catch { /* the still poster simply stays */ }
  }
  return { start, stop };
})();
function animBrowser({ getSpeaker, chips, onPick, selectedRef }) {
  const root = h('div', { class: 'ab' });
  let cat = null, q = '', scrollTop = 0, observer;
  const draw = () => {
    observer?.disconnect(); browserObservers.delete(observer);
    const s = getSpeaker(), def = s && charOf(s);
    if (!def) { root.replaceChildren(h('p', { class: 'sub' }, 'Please choose a character first.')); return; }
    const modes = modeEntries(def.rig);
    const cats = [...(modes.animations.length ? [modes] : []), ...categoriesFor(def.rig)];
    if (!cats.length) { root.replaceChildren(h('p', { class: 'sub' }, 'No admin animations are available for this character.')); return; }
    const curRef = selectedRef();
    if (!cat || !cats.some(c => c.key === cat)) cat = (cats.find(c => curRef && c.animations.some(a => sameRef(a.ref, curRef))) || cats[0]).key;
    const current = cats.find(c => c.key === cat);
    const list = (q.trim() ? cats : [current]).flatMap(c => c.animations.map(a => ({ ...a, cat: c }))).filter(a => a.name.toLowerCase().includes(q.trim().toLowerCase()));
    const viewport = h('div', { class: 'animation-list', tabindex: '0', 'aria-label': 'Animation results' });
    // a grid of big cards (preview picture, length on top, name below): two columns, three when the panel is wide; only the visible rows are drawn
    const GAP = 8, CARD = 176, ROW = CARD + GAP;
    const colsNow = () => ((viewport.clientWidth || 360) >= 560 ? 3 : 2);
    let cols = colsNow();
    const windowEl = h('div', { class: 'animation-window' });
    const sizeWindow = () => { windowEl.style.height = `${Math.ceil(list.length / cols) * ROW}px`; windowEl.dataset.cols = String(cols); windowEl.dataset.row = String(ROW); };
    sizeWindow();
    viewport.append(windowEl);
    let start = -1, end = -1;
    const paint = () => {
      const c = colsNow(); if (c !== cols) { cols = c; start = end = -1; sizeWindow(); }
      const firstRow = Math.max(0, Math.floor(viewport.scrollTop / ROW) - 1), rows = Math.ceil((viewport.clientHeight || 640) / ROW) + 3;
      const nextStart = firstRow * cols, nextEnd = Math.min(list.length, nextStart + rows * cols);
      if (nextStart === start && nextEnd === end) return;
      start = nextStart; end = nextEnd;
      windowEl.replaceChildren(...list.slice(start, end).map((a, offset) => {
        const chosen = sameRef(selectedRef(), a.ref), index = start + offset, col = index % cols, hasGif = !!a.poster;
        const apply = h('button', { class: 'animation-apply', 'aria-pressed': String(!!chosen), title: `Apply ${a.name}`, onclick: async () => {
          apply.disabled = true;
          try { scrollTop = viewport.scrollTop; await onPick(s, a.ref, !!a.cat.overlay, a.length); if (root.isConnected) draw(); else { observer?.disconnect(); browserObservers.delete(observer); } }
          catch (error) { toast(`Could not apply the animation: ${error.message}`); apply.disabled = false; }
        } }, h('span', { class: 'animation-thumb', 'aria-hidden': 'true' }, hasGif ? posterImg(a.poster, a.posterType) : '▶'),
        h('span', { class: 'animation-copy', title: a.cat.layer || a.cat.name }, h('b', {}, a.name), h('span', { class: 'animation-check', 'aria-hidden': 'true' }, chosen ? '✓' : '+')));
        const row = h('div', { class: `animation-row${chosen ? ' on' : ''}`, style: `top:${Math.floor(index / cols) * ROW}px;left:calc(${col} * (100% + ${GAP}px) / ${cols});width:calc((100% - ${(cols - 1) * GAP}px) / ${cols});height:${CARD}px` }, apply);
        if (!a.cat.overlay && a.ref.source !== 'mode' && !hasGif) {          // a card that has its own looping picture keeps it; the others play live when the pointer rests on them
          const thumb = () => row.querySelector('.animation-thumb');
          row.addEventListener('pointerenter', () => thumbPlay.start(thumb(), def, a)); row.addEventListener('pointerleave', thumbPlay.stop);
          apply.addEventListener('focus', () => thumbPlay.start(thumb(), def, a)); apply.addEventListener('blur', thumbPlay.stop);
        }
        if (a.preview) row.append(h('button', { class: 'ib animation-preview', title: `Preview ${a.name}`, onclick: () => {
          activePreview?.pause(); const video = h('video', { src: assetUrl(a.preview), controls: true, muted: true, playsinline: true, preload: 'none', style: 'max-width:100%' });
          activePreview = video; modal(a.name, video, () => video.pause()); video.play().catch(() => {});
        } }, '▷'));
        return row;
      }));
    };
    viewport.addEventListener('scroll', () => { scrollTop = viewport.scrollTop; paint(); }, { passive: true });
    root.replaceChildren(h('div', { class: 'animation-filters' },
      ...(chips ? [chips(draw)] : []),
      h('div', { class: 'row' }, h('select', { 'aria-label': 'Animation category', onchange: e => { cat = e.target.value; q = ''; scrollTop = 0; draw(); } }, cats.map(c => h('option', { value: c.key, selected: c.key === cat }, `${c.name} (${c.animations.length})`)))),
      h('input', { type: 'search', class: 'search', 'aria-label': 'Search animations', placeholder: 'Search animations…', value: q, oninput: e => { q = e.target.value; const caret = e.target.selectionStart; scrollTop = 0; draw(); const search = root.querySelector('.search'); search.focus(); search.setSelectionRange(caret, caret); } }),
      h('small', { class: 'animation-count', role: 'status' }, `${list.length} animation${list.length === 1 ? '' : 's'} · click to apply`)),
      list.length ? viewport : h('p', { class: 'sub' }, 'No matching animations. Try another category or search.'));
    paint(); viewport.scrollTop = scrollTop;
    observer = new ResizeObserver(paint); observer.observe(viewport); browserObservers.add(observer);
  };
  draw(); return { el: root, draw, dispose: () => { observer?.disconnect(); browserObservers.delete(observer); } };
}

/* ---------------- step 3: studio ---------------- */
let bgSelEl, tlUndo, tlRedo, clipBar, camEl, camHandles = {}, emptyEl, headEl, timeEl, playBtn, panelEl, tabsEl, selEl, propSelEl, selBar, charBar, clipNav, selToolsEl, wrapEl, exportBtn, hintEl, tlScroll, tlInner, tlLabels, tlBox, lineBox, startPill, handleEls = {};

const sOf = (k) => S.speakers.find((x) => x.key === k);
const lineById = (id) => player.clips.find((c) => c.id === id);
const lineAt = (t) => player.clips.find((c) => t >= c.start && t < c.end) || [...player.clips].reverse().find((c) => c.start <= t) || player.clips[0];

/*
 * Every audio line decides which characters are in frame and what each one plays:
 * the speaker talks, everybody else is idle — unless you changed it for that line.
 */
function defaultAnims(def) {
  const pools = modePools(def.rig);
  return {
    talk: pools.talk.length ? MODE_REFS.speaker : pools.idle[0]?.ref ?? null,        // the speaker: mix of all talking animations
    idle: idleRef(def.rig) ?? (pools.hands.length || pools.idle.length ? MODE_REFS.listener : null),        // everybody else (and a character that was just added): the plain idle animation, not a random pick
  };
}
/** small seeded random generator, so the same project always plays the same mix */
function rngFrom(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}
/** a mode (speaker / listener) becomes a playlist of library animations; anything else is one clip */
function expandBody(ref, def, start, end, seed) {
  if (!ref) return [];
  if (ref.source !== 'mode') return [{ ref, start, dur: end - start, off: 0 }];
  const pools = modePools(def.rig), rnd = rngFrom(seed), speaker = ref.id === 'speaker';
  const pool = speaker ? pools.talk : (pools.hands.length ? pools.hands : pools.idle);
  if (!pool.length) { const f = pools.idle[0]?.ref ?? pools.talk[0]?.ref; return f ? [{ ref: f, start, dur: end - start, off: 0 }] : []; }
  const out = [];
  let t = start, last = -1;
  while (t < end - 0.05) {
    let k = Math.floor(rnd() * pool.length);
    if (pool.length > 1 && k === last) k = (k + 1 + Math.floor(rnd() * (pool.length - 1))) % pool.length;
    last = k;
    const a = pool[k];
    let len = speaker ? 3.5 + rnd() * 3 : 6 + rnd() * 5;
    if (end - (t + len) < 1.5) len = end - t;
    len = Math.min(len, end - t);
    if (!(len > 0.01)) break;
    out.push({ ref: a.ref, start: t, dur: len, off: a.length > len ? rnd() * (a.length - len) : 0 });
    t += len;
  }
  return out;
}
/** camera plan: one entry per audio line (shot type + who the camera looks at) */
const shotPlan = () => player.clips.map((c) => ({ start: c.start, end: c.end, speaker: c.speaker, ...(S.shots.get(c.id) || {}) }));
const castOf = (lineId, key) => { let m = S.cast.get(lineId); if (!m) S.cast.set(lineId, (m = {})); return (m[key] ||= {}); };
/** animation layers that run on top of the body animation */
const LAYER_KINDS = ['legs', 'hand', 'face'];
/** what one character does during one line */
function resolveLine(L, s) {
  const o = S.cast.get(L.id)?.[s.key] || {}, d = defaultAnims(charOf(s)), speaking = L.speaker === s.key;
  const auto = speaking ? d.talk : d.idle;
  const seq = !o.body && o.seq?.length ? o.seq : null;   // timed animations chosen by the AI
  return { inFrame: o.in !== false, speaking, body: o.body ?? seq?.[0].ref ?? auto, auto: !o.body && !seq, seq, face: o.face ?? null, hand: o.hand ?? null, legs: o.legs ?? null };
}
/** timeline clips + "in frame" ranges for one character, derived from the audio lines */
const LAYER_ALL = ['body', ...LAYER_KINDS];
/** clips the user put on the timeline win over the automatic ones: the automatic clips are cut around them */
function layerPlan(s) {
  const plan = basePlan(s), man = S.manual[s.key] || [], def = charOf(s);
  if (!man.length) return plan;
  const clips = [], refs = [...plan.refs], extra = [];
  for (const kind of LAYER_ALL) {
    const mine = man.filter((m) => m.kind === kind && m.dur > 0.05).sort((a, b) => a.start - b.start);
    const own = mine.map((m, i) => ({ ...m, end: Math.min(m.start + m.dur, mine[i + 1] ? mine[i + 1].start : Infinity) })).filter((m) => m.end - m.start > 0.03);
    for (const c of plan.clips.filter((x) => x.kind === kind)) {
      let pieces = [[c.start, c.start + c.dur]];
      for (const m of own) pieces = pieces.flatMap(([a, b]) => (m.end <= a || m.start >= b) ? [[a, b]] : [[a, Math.min(b, m.start)], [Math.max(a, m.end), b]].filter(([x, y]) => y - x > 0.03));
      pieces.forEach(([a, b], j) => clips.push({ ...c, id: `${c.id}~${j}`, start: a, dur: b - a, off: (c.off || 0) + (a - c.start) }));
    }
    for (const m of own) {
      if (m.ref.source === 'mode') expandBody(m.ref, def, m.start, m.end, `${s.key}|m|${m.id}`).forEach((seg, j) => { refs.push(seg.ref); clips.push({ id: `m:${m.id}:${j}`, kind, name: animKey(seg.ref), start: seg.start, dur: seg.dur, off: seg.off, manual: true }); });
      else { refs.push(m.ref); clips.push({ id: `m:${m.id}`, kind, name: animKey(m.ref), start: m.start, dur: m.end - m.start, off: m.off || 0, manual: true, ...(m.span > 0 ? { rate: rateOf(m) } : {}) }); }
      if (kind === 'body') extra.push({ start: m.start, end: m.end });
    }
  }
  clips.sort((a, b) => a.start - b.start);
  return { ...plan, clips, refs, present: plan.present ? [...plan.present, ...extra] : plan.present };
}
function basePlan(s) {
  const def = charOf(s), clips = [], present = [], refs = [], idleRef = modePools(def.rig).idle[0]?.ref ?? null;
  if (idleRef) refs.push(idleRef);
  if (!player.clips.length) {          // no audio yet: everybody just stands there, a little alive
    const o = S.solo[s.key] || {}, body = o.body || defaultAnims(def).idle;
    (body ? expandBody(body, def, 0, player.total, `${s.key}|solo`) : []).forEach((seg, j) => { refs.push(seg.ref); clips.push({ id: `solo:body:${j}`, kind: 'body', name: animKey(seg.ref), start: seg.start, dur: seg.dur, off: seg.off }); });
    for (const kind of LAYER_KINDS) if (o[kind]) { refs.push(o[kind]); clips.push({ id: `solo:${kind}`, kind, name: animKey(o[kind]), start: 0, dur: player.total, off: 0 }); }
    return { clips, present: null, refs, idleRef };
  }
  player.clips.forEach((L, i) => {
    const r = resolveLine(L, s);
    const start = i === 0 ? 0 : L.start, end = i === player.clips.length - 1 ? player.total : player.clips[i + 1].start;
    if (!r.inFrame) return;
    present.push({ start, end });
    const segs = r.seq
      ? r.seq.map((g, j) => { const a = j === 0 ? start : Math.min(L.start + g.at, end - 0.2), b = j + 1 < r.seq.length ? Math.min(L.start + r.seq[j + 1].at, end) : end; return { ref: g.ref, start: a, dur: Math.max(0.1, b - a), off: 0 }; })
      : expandBody(r.body, def, start, end, `${s.key}|${L.id}|${r.body?.id ?? r.body?.name}`);
    segs.forEach((seg, j) => {
      refs.push(seg.ref);
      clips.push({ id: `${L.id}:body:${j}`, kind: 'body', name: animKey(seg.ref), start: seg.start, dur: seg.dur, off: seg.off });
    });
    for (const kind of LAYER_KINDS) if (r[kind]) { refs.push(r[kind]); clips.push({ id: `${L.id}:${kind}`, kind, name: animKey(r[kind]), start, dur: end - start, off: 0 }); }
  });
  return { clips, present, refs, idleRef };
}

/* ---- background music: one file per scene, played from the start under the voices (looped to the end of the scene) ---- */
const musicAudio = new Map();                                // music id -> { raw, buffer, name }
const musicBuffer = (id) => musicAudio.get(id)?.buffer || null;
/** the file comes back from the project database (it is also part of the cloud save) */
async function loadMusic(id) {
  if (!id || musicAudio.has(id)) return musicAudio.get(id) || null;
  try {
    const rec = await dbGet('audio', id); if (!rec?.raw) return null;
    const entry = { raw: rec.raw, name: rec.name || 'Music', buffer: await audioCtx.decodeAudioData(rec.raw.slice(0)) };
    musicAudio.set(id, entry); return entry;
  } catch { return null; }
}
const musicSettings = (m) => ({ volume: m.volume ?? 0.35, fadeIn: m.fadeIn || 0, fadeOut: m.fadeOut || 0, muted: !!m.muted });
function syncMusic() { player.music = S.music && musicBuffer(S.music.id) ? { buffer: musicBuffer(S.music.id), ...musicSettings(S.music) } : null; S.dirty = true; if (player.playing) player.seek(player.time); }
async function addMusic(file) {
  if (S.exporting) return;
  const b = busy('Reading the music…');
  try {
    await audioCtx.resume();
    const raw = await file.arrayBuffer(), buffer = await audioCtx.decodeAudioData(raw.slice(0)), id = `music-${uid()}${uid()}`, name = file.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'Music';
    await dbPut('audio', { id, raw, name });
    const old = S.music?.id; musicAudio.set(id, { raw, buffer, name });
    S.music = { id, name, volume: 0.35, fadeIn: 0, fadeOut: 2, muted: false };
    if (old) dropMusicRecord(old);
    syncMusic(); drawTimeline(); drawTabs();
  } catch { toast('This music file could not be opened. Please choose an MP3, WAV, M4A or OGG file.'); } finally { b.done(); }
}
function dropMusicRecord(id) { if (S.scenes.some((sc) => sc.id !== S.sceneId && sc.doc?.music?.id === id) || S.music?.id === id) return; musicAudio.delete(id); }
function removeMusic() { const id = S.music?.id; S.music = null; syncMusic(); if (id) dropMusicRecord(id); drawTimeline(); drawTabs(); }
function setMusic(patch, { redraw = false } = {}) { Object.assign(S.music, patch); syncMusic(); if (redraw) { drawTimeline(); drawTabs(); } }
/** the music as the export wants it: one entry per scene that has music, placed at that scene's time window */
function musicForExport(sequence) {
  if (!sequence) return S.music && musicBuffer(S.music.id) ? [{ buffer: musicBuffer(S.music.id), ...musicSettings(S.music), start: 0, end: player.total }] : [];
  return sequence.map((scene) => { const m = scene.doc.music; return m && musicBuffer(m.id) ? { buffer: musicBuffer(m.id), ...musicSettings(m), start: scene.start, end: scene.end } : null; }).filter(Boolean);
}
async function prepareStudio({ quiet = false } = {}) {
  const b = quiet ? { done() {} } : busy('Setting up characters & lip-sync…');
  try {
    for (const s of S.speakers) { const d = charOf(s); if (d) await stage.loadCharacter(d); }
    const tl = buildTimeline(S.lines.map((l) => ({ id: l.id, speaker: l.speaker.toLowerCase(), file: l.file, buffer: l.buffer, visemes: l.visemes, trimStart: l.trimStart || 0, trimEnd: l.trimEnd || 0, gapBefore: l.gapBefore, ...mixOf(l) })));
    if (!tl.clips.length) tl.total = sceneLen();       // an empty scene is 8 seconds long (longer when clips or camera keys are placed later)
    player.setTimeline(tl); syncMusic();
    await applyLayers();
  } catch (e) { console.error(e); toast(`Setup failed: ${e.message}`); }
  S.animFor = S.speakers.find((s) => s.charId)?.key ?? null;
  if (!lineById(S.lineSel)) S.lineSel = player.clips[0]?.id ?? null;
  b.done(); S.dirty = true;
}
/** everything needed to draw the characters (back -> front): used by the stage and by the export workers */
async function buildLayerSpecs() {
  const withChar = S.speakers.filter((s) => s.charId && charOf(s));
  const keys = S.order.filter((k) => withChar.some((s) => s.key === k));
  const layers = [];
  for (const k of keys) {
    const s = withChar.find((x) => x.key === k), def = charOf(s), plan = layerPlan(s), anims = {};
    for (const ref of plan.refs) {
      const name = animKey(ref);
      if (name in anims) continue;
      try { anims[name] = await animJson(def, ref); } catch (e) { toast(`Could not load the animation "${ref.name}": ${e.message}`); }
    }
    // gestures that only move the arms get the idle animation underneath, so head / chest keep moving
    const idleKey = plan.idleRef ? animKey(plan.idleRef) : null, drives = (j) => (j?.bone || []).some((b) => /^(head|pelvis|neck|torso\d*)$/i.test(b.name));
    const clips = plan.clips.filter((c) => anims[c.name]).map((c) => ({ ...c, base: c.kind === 'body' && idleKey && anims[idleKey] && c.name !== idleKey && !drives(anims[c.name]) ? idleKey : undefined }));
    layers.push({ fit: getFit(s.charId), skins: s.skins ?? def.skins ?? null, key: s.key, charId: s.charId, anims, clips, present: plan.present, flip: s.flip, xf: s.xf ? { ...s.xf } : null, mask: s.mask ? { ...s.mask } : null, maskKeys: s.maskKeys || [], maskFollow: s.maskFollow || '', tears: s.tears ? tearConfig(s.tears) : null, tearFacingBack: /\bback\b/i.test(def.pose || ''), slot: withChar.indexOf(s), visible: s.visible, keys: (S.charKeys[s.key] || []).map((k) => ({ t: k.t, x: k.x, y: k.y, mul: k.mul, flip: !!k.flip, ease: k.ease })) });
  }
  return layers.reverse(); // front-first -> back-first
}
/** (re)builds the characters on the stage (needed when animations or images change) */
async function applyLayers() {
  const layers = await buildLayerSpecs();
  await stage.setTearSprite(layers.some(layer => layer.tears?.style) ? await loadTearSprite() : null);
  const bad = stage.setLayers(layers);
  const activeIds = new Set(layers.map(l => l.charId));
  for (const id of stage.assets.keys()) if (!activeIds.has(id)) stage.unload(id);
  const unused = [...S.libDefs.keys()].filter(id => !activeIds.has(id));
  for (const id of unused.slice(0, Math.max(0, unused.length - 2))) S.libDefs.delete(id);
  if (bad.length) toast(`Some animations did not fit this character, so they were skipped (${bad.map((k) => sOf(k)?.name).join(', ')})`);
  S.dirty = true;
}
/** cheap update when only the "in frame" switches changed */
function refreshPresence() {
  for (const s of S.speakers) if (s.charId) { const p = layerPlan(s); stage.setClips(s.key, p.clips, p.present); }
  S.dirty = true;
}

/* ---------------- workspace layout: wide canvas, self-hiding side menus, focus mode ---------------- */
S.layout = loadLayout(); S.loop = S.layout.loop; S.expOpen = { quick: true, out: true, pic: true, file: false };
const layoutUi = {};
const wsEl = () => document.querySelector('.ws');
function setLayout(patch) {
  Object.assign(S.layout, patch); S.loop = S.layout.loop;
  saveLayout(S.layout); applyLayout(wsEl(), S.layout); syncLayoutUi();
  requestAnimationFrame(fitEditor);
}
function syncLayoutUi() {
  layoutUi.focus?.setAttribute('aria-pressed', String(S.layout.focus));
  layoutUi.loop?.setAttribute('aria-pressed', String(S.layout.loop));
}
const toggleFocus = () => setLayout({ focus: !S.layout.focus });

/* The tool menu (left) and the side panel (right) slide away after 5 s without use and slide back
   when the pointer touches the screen edge, a tool is chosen, or the keyboard focuses them. No buttons. */
const DOCK_IDLE_MS = 5000, dockTimer = { rail: 0, panel: 0 };
const dockEl = (name) => (name === 'rail' ? tabsEl : panelEl);
const dockOut = (name) => wsEl()?.getAttribute(`data-dock-${name}`) === 'out';
// the camera frame overlay sits on the canvas only while the Camera panel is genuinely on screen; re-check the instant the panel's dock state changes, not just on the next lazy render tick
const afterDockChange = (name) => { if (name === 'panel') { syncFullView(); updateCamBox?.(); } };
function dockArm(name) { clearTimeout(dockTimer[name]); dockTimer[name] = setTimeout(() => dockHide(name), DOCK_IDLE_MS); }
function dockShow(name) { wsEl()?.setAttribute(`data-dock-${name}`, 'in'); syncPills(); dockArm(name); afterDockChange(name); }
function dockHide(name) {
  const el = dockEl(name), active = document.activeElement;
  const busy = el && (el.matches(':hover') || (el.contains(active) && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName)) || el.querySelector('.advanced-tools[open],.upload-tools[open]'));
  if (busy || document.querySelector('.modal') || S.exporting) { dockArm(name); return; }   // still in use: look again in 5 s
  wsEl()?.setAttribute(`data-dock-${name}`, 'out'); syncPills(); afterDockChange(name);
}
function dockToggle(name) {
  if (S.layout.focus) setLayout({ focus: false });
  if (dockOut(name)) dockShow(name); else { clearTimeout(dockTimer[name]); wsEl()?.setAttribute(`data-dock-${name}`, 'out'); syncPills(); afterDockChange(name); }
}
/** true exactly while the camera panel is visibly open (not merely logically open — it may have idle-hidden off-screen); character selection is blocked only then, so it must never go stale. */
function syncFullView() {
  const fv = S.tab === 'camera' && S.panelOpen && !S.camPeek && !dockOut('panel');
  if (stage.fullView !== fv) { stage.fullView = fv; S.dirty = true; }
  return stage.fullView;
}
function dockWire(el, name) {
  for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel']) el.addEventListener(type, () => dockArm(name), { passive: true });
  el.addEventListener('focusin', () => dockShow(name));
}
/* The tool menu and the side panel can be dragged anywhere on the workspace (grip on the menu, title bar on the panel).
   Where they were left is remembered; double-click the grip / title bar to dock them back. A floating menu that has slid
   away leaves a small round button in its place; touching it brings the menu back. */
const dockKey = { rail: 'railPos', panel: 'panelPos' }, pills = {};
const floatingOk = () => innerWidth > 860 && innerWidth < 1000;          // from 1000 px the three-column workspace is fixed (panel and menu cannot float)
const clampTo = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));
function railCount() { return [...tabsEl.children].filter((c) => !c.classList.contains('dock-grip') && !c.classList.contains('rail-label')).length; }
function placeDock(name) {
  const el = dockEl(name), ws = wsEl(), studio = ws?.querySelector('.studio');
  if (!el || !studio) return;
  const pos = floatingOk() ? S.layout[dockKey[name]] : null;
  ws.toggleAttribute(`data-${name}-free`, !!pos); el.classList.toggle('free', !!pos);
  for (const prop of ['left', 'top', 'right', 'bottom', 'width', 'height']) el.style[prop] = '';
  if (pos) {
    const area = studio.getBoundingClientRect(), w = name === 'panel' ? Math.min(pos.w || S.layout.panelW, area.width - 8) : 0, h = name === 'panel' ? Math.min(pos.h || 420, area.height - 8) : 0;
    Object.assign(el.style, { left: `${clampTo(pos.x, 0, area.width - (w || 70))}px`, top: `${clampTo(pos.y, 0, area.height - 60)}px`, right: 'auto', bottom: 'auto' });
    if (name === 'panel') Object.assign(el.style, { width: `${w}px`, height: `${h}px` });
    else el.style.setProperty('--rail-count', String(railCount()));
  }
  syncPills();
}
function syncPills() {
  for (const name of ['rail', 'panel']) {
    const pill = pills[name], el = dockEl(name);
    if (!pill || !el) continue;
    const show = el.classList.contains('free') && dockOut(name) && (name === 'rail' || S.panelOpen);
    pill.classList.toggle('show', show);
    if (show) Object.assign(pill.style, { left: el.style.left, top: el.style.top });
  }
}
function dockPill(name) {
  const pill = pills[name] = h('button', { type: 'button', class: 'dock-pill', title: name === 'rail' ? 'Open the tool menu' : 'Open the side panel', 'aria-label': name === 'rail' ? 'Open the tool menu' : 'Open the side panel', onclick: () => dockShow(name) }, name === 'rail' ? '🧰' : '🗂');
  pill.addEventListener('pointerenter', () => dockShow(name));
  return pill;
}
function startDockDrag(name, event) {
  if (!floatingOk() || event.button > 0) return;
  event.preventDefault();
  const el = dockEl(name), studio = wsEl().querySelector('.studio'), area = studio.getBoundingClientRect(), box = el.getBoundingClientRect(), key = dockKey[name];
  const pos = S.layout[key] ||= { x: Math.round(box.left - area.left), y: Math.round(box.top - area.top), w: Math.round(box.width), h: Math.round(box.height) };
  placeDock(name);
  const startX = event.clientX, startY = event.clientY, fromX = pos.x, fromY = pos.y;
  const move = (e) => { pos.x = Math.round(clampTo(fromX + e.clientX - startX, 0, area.width - Math.min(box.width, 70))); pos.y = Math.round(clampTo(fromY + e.clientY - startY, 0, area.height - 60)); placeDock(name); dockArm(name); };
  const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); saveLayout(S.layout); };
  addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
}
function resetDock(name) { S.layout[dockKey[name]] = null; saveLayout(S.layout); placeDock(name); }
function rememberPanelSize() {
  const pos = S.layout.panelPos;
  if (!pos || !panelEl.classList.contains('free')) return;
  const w = Math.round(panelEl.offsetWidth), h = Math.round(panelEl.offsetHeight);
  if (w !== pos.w || h !== pos.h) { pos.w = w; pos.h = h; saveLayout(S.layout); }
}
addEventListener('resize', () => { if ($app.hidden) return; placeDock('rail'); placeDock('panel'); });
function dockEdge(side) {
  const name = side === 'left' ? 'rail' : 'panel', el = h('div', { class: `dock-edge dock-edge-${side}`, 'aria-hidden': 'true' });
  el.addEventListener('pointerenter', () => dockShow(name));
  return el;
}
function layoutTools() {
  const btn = (key, label, title, onclick) => layoutUi[key] = h('button', { type: 'button', class: 'btn sm icon-btn', title, 'aria-label': title, 'aria-pressed': 'false', onclick }, label);
  const box = h('div', { class: 'layout-tools' },
    btn('loop', icon('repeat'), 'Loop playback (L)', () => setLayout({ loop: !S.layout.loop })),
    btn('focus', icon('maximize'), 'Focus mode — canvas only (F)', toggleFocus), btn('help', icon('info'), 'Keyboard shortcuts (?)', showShortcuts));
  syncLayoutUi(); return box;
}
/** "Show outside the frame": the editor looks at a larger area; the part inside the video frame is bright, what sticks out of it is dimmed. Editor only, never exported. */
const OVERFLOW_ZOOM = 1.5;
let overflowEl = null, overflowToggle = null;
function overflowBtn() {
  overflowToggle = h('button', { type: 'button', class: 'btn sm icon-btn', 'aria-pressed': 'false', title: 'Show what is outside the video frame (dimmed)', 'aria-label': 'Show what is outside the video frame', onclick: () => setOverflow(!stage.overflow) }, icon('eye'));
  return overflowToggle;
}
function setOverflow(on) {
  if (on && (S.exporting || S.step !== 3)) return;
  stage.overflow = !!on; stage.overCam = null; overflowToggle?.setAttribute('aria-pressed', String(!!on)); overflowToggle?.classList.toggle('on', !!on);
  if (overflowEl) { overflowEl.hidden = !on; const z = 1 / OVERFLOW_ZOOM, f = overflowEl.firstChild; Object.assign(f.style, { left: `${((1 - z) / 2) * 100}%`, top: `${((1 - z) / 2) * 100}%`, width: `${z * 100}%`, height: `${z * 100}%` }); }
  if (on) { selEl && (selEl.hidden = true); Object.values(handleEls).forEach((e) => { e.hidden = true; }); if (propSelEl) propSelEl.hidden = true; hideSelBar(); }
  updateBgSel(); S.dirty = true; if (!on) updateSel();
}
function resizeHandle(cls, label, onDrag, onReset) {
  const el = h('div', { class: `resize-handle ${cls}`, role: 'separator', title: `${label} — drag to resize, double-click to reset` });
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('dragging');
    const start = { x: e.clientX, y: e.clientY, panelW: S.layout.panelW, tlH: S.layout.tlH || document.querySelector('.ws .tlwrap')?.offsetHeight || 180 };
    const move = (ev) => onDrag(ev, start);
    const up = () => { el.classList.remove('dragging'); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); saveLayout(S.layout); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  });
  el.addEventListener('dblclick', onReset);
  return el;
}
const panelHandle = () => resizeHandle('resize-panel', 'Side panel', (ev, start) => { S.layout.panelW = clampPanel(start.panelW + (start.x - ev.clientX), innerWidth); applyLayout(wsEl(), S.layout); }, () => setLayout({ panelW: DEFAULT_LAYOUT.panelW }));
const TL_TALL = () => Math.round(innerHeight * 0.58);
const timelineHandle = () => {
  const handle = resizeHandle('resize-tl', 'Timeline', (ev, start) => { S.layout.tlH = clampTimeline(start.tlH + (start.y - ev.clientY), innerHeight); applyLayout(wsEl(), S.layout); }, () => setLayout({ tlH: 0 }));
  const tall = () => (S.layout.tlH || 0) >= TL_TALL() - 8;
  const toggle = h('button', { type: 'button', class: 'tl-toggle' });
  const sync = () => { const up = !tall(); toggle.replaceChildren(icon(up ? 'chevron-up' : 'chevron-down')); toggle.title = toggle.ariaLabel = up ? 'Make the timeline taller' : 'Back to the normal timeline size'; };
  toggle.addEventListener('pointerdown', e => e.stopPropagation());
  toggle.addEventListener('dblclick', e => e.stopPropagation());
  toggle.addEventListener('click', () => { setLayout({ tlH: tall() ? 0 : clampTimeline(TL_TALL(), innerHeight) }); sync(); });
  handle.append(h('span', { class: 'tl-grip', 'aria-hidden': 'true' }), toggle);
  handle.addEventListener('pointerup', () => setTimeout(sync, 0)); handle.addEventListener('dblclick', () => setTimeout(sync, 0));
  sync(); return handle;
};
function showShortcuts() {
  modal('Keyboard shortcuts', h('div', { class: 'shortcut-list' }, SHORTCUT_GROUPS.map(([title, rows]) => h('section', {}, h('h3', {}, title), h('dl', {}, rows.flatMap(([key, what]) => [h('dt', {}, h('kbd', {}, key)), h('dd', {}, what)]))))));
}
window.addEventListener('keydown', (e) => {
  if ($app.hidden || S.step !== 3 || S.exporting || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input,select,textarea,[contenteditable=true],[contenteditable=""]') || document.querySelector('.modal,dialog[open]')) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key, seekBy = (d) => { player.seek(Math.min(player.total, Math.max(0, player.time + d))); S.dirty = true; };
  const onTab = !!e.target.closest?.('[role=tab]');
  const actions = {
    f: toggleFocus, '[': () => dockToggle('rail'), ']': () => dockToggle('panel'), '?': showShortcuts, '0': () => setEditorZoom(1),
    l: () => setLayout({ loop: !S.layout.loop }),
    Home: () => { player.seek(0); S.dirty = true; }, End: () => seekBy(player.total),
    ArrowLeft: onTab ? null : () => seekBy(e.shiftKey ? -1 : -0.1), ArrowRight: onTab ? null : () => seekBy(e.shiftKey ? 1 : 0.1),
    Escape: S.layout.focus ? toggleFocus : (multi.size ? clearMulti : null),
  };
  const run = actions[key];
  if (run && !(e.shiftKey && key.length === 1 && key !== '?' && key !== '[' && key !== ']')) { e.preventDefault(); run(); }
});

const TABS = [['audio', 'Audio', 'mic'], ['chars', 'Characters', 'users'], ['anim', 'Animations', 'film'], ['tears', 'Tears', 'droplet'], ['motion', 'Move', 'move'], ['grade', 'Colour', 'palette'], ['camera', 'Camera', 'video'], ['mask', 'Mask', 'mask'], ['ai', 'AI', 'sparkles'], ['canvas', 'Background', 'image'], ['props', 'Objects', 'log'], ['effects', 'Effects', 'zap'], ['export', 'Export', 'download']];
function viewStudio() {
  playBtn = h('button', { class: 'btn pri icon-btn play-btn', title: 'Play (Space)', 'aria-label': 'Play', onclick: togglePlay }, icon('play'));
  timeEl = h('span', { class: 'time' }, '0:00.0');
  headEl = h('div', { class: 'phead' });
  tlLabels = h('div', { class: 'tl-labels' });
  tlInner = h('div', { class: 'tl-inner' }); wireBoxSelect();
  tlScroll = h('div', { class: 'tl-scroll' }, tlInner);
  tlBox = h('div', { class: 'tl2' }, tlLabels, tlScroll);
  // phone: a grip above the timeline. Tap = bigger timeline / back; drag up or down = any size in between
  const grip = h('button', { type: 'button', class: 'tl-size-grip', 'aria-label': 'Make the timeline bigger or smaller', title: 'Tap to make the timeline bigger or smaller, or drag it up and down' }, icon('chevron-up'));
  const gripIcon = () => grip.replaceChildren(icon(wsEl()?.dataset.tl === 'big' ? 'chevron-down' : 'chevron-up'));
  grip.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    const ws = wsEl(), prev = ws.querySelector('.prev'), y0 = e.clientY, h0 = prev.getBoundingClientRect().height; let moved = false;
    grip.setPointerCapture(e.pointerId);
    const mv = (ev) => {
      if (!moved && Math.abs(ev.clientY - y0) < 8) return;
      moved = true; ws.dataset.tl = ''; ws.style.setProperty('--prev-h', `${Math.round(Math.min(h0 + 40, Math.max(90, h0 + ev.clientY - y0)))}px`); fitEditor();
    };
    const up = () => {
      grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
      if (!moved) { ws.style.removeProperty('--prev-h'); ws.dataset.tl = ws.dataset.tl === 'big' ? '' : 'big'; fitEditor(); }
      gripIcon();
    };
    grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
  });
  lineBox = h('div', { class: 'linebox' });
  tabsEl = h('div', { class: 'tabs big' });
  panelEl = h('div', { class: 'panel' });
  dockWire(tabsEl, 'rail'); dockWire(panelEl, 'panel'); panelEl.addEventListener('pointerup', rememberPanelSize);
  const zoom = (f) => { const left = tlScroll.scrollLeft / S.pps; S.pps = Math.min(300, Math.max(4, S.pps * f)); drawTimeline(); tlScroll.scrollLeft = left * S.pps; };
  // two fingers on the timeline zoom it (pinch), around the point between the fingers: the buttons are only for a mouse
  {
    let d0 = 0, pps0 = 0, mid = 0, t0 = 0;
    const gap = (e) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    tlScroll.addEventListener('touchstart', (e) => { if (e.touches.length === 2) { d0 = gap(e); pps0 = S.pps; mid = (e.touches[0].clientX + e.touches[1].clientX) / 2 - tlScroll.getBoundingClientRect().left; t0 = (tlScroll.scrollLeft + mid) / S.pps; } }, { passive: true });
    tlScroll.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 2 || !d0) return; e.preventDefault();
      S.pps = Math.min(300, Math.max(4, pps0 * (gap(e) / d0))); drawTimeline(); tlScroll.scrollLeft = Math.max(0, t0 * S.pps - mid);
    }, { passive: false });
    tlScroll.addEventListener('touchend', (e) => { if (e.touches.length < 2) d0 = 0; }, { passive: true });
  }
  const fit = fitTimeline;
  const tools = h('div', { class: 'tltools' },
    tlUndo = h('button', { class: 'btn sm icon-btn tl-hist', 'data-history-control': true, 'aria-label': 'Undo', title: 'Undo (Ctrl+Z)', onclick: () => stepHistory(-1) }, icon('undo')),
    tlRedo = h('button', { class: 'btn sm icon-btn tl-hist', 'data-history-control': true, 'aria-label': 'Redo', title: 'Redo (Ctrl+Y)', onclick: () => stepHistory(1) }, icon('redo')),
    h('b', { class: 'timeline-title' }, 'Timeline'),
    h('button', { class: 'btn sm icon-btn tl-zoom', title: 'Zoom out timeline', 'aria-label': 'Zoom out timeline', onclick: () => zoom(1 / 1.5) }, icon('zoom-out')), h('button', { class: 'btn sm icon-btn tl-zoom', title: 'Zoom in timeline', 'aria-label': 'Zoom in timeline', onclick: () => zoom(1.5) }, icon('zoom-in')),
    h('button', { class: 'btn sm icon-btn tl-zoom', title: 'Fit whole timeline', 'aria-label': 'Fit whole timeline', onclick: fit }, icon('maximize')),
    snapBtn = h('button', { class: 'btn sm icon-btn snap-toggle', type: 'button', 'aria-pressed': String(snapOn()), title: 'Snap: clips stick to other clips, the playhead and whole seconds. Hold Alt while dragging to move freely.', 'aria-label': 'Snap clips', onclick: () => setSnap(!snapOn()) }, icon('magnet')), h('span', { class: 'tl-sep', 'aria-hidden': 'true' }), editTools(), clipBar = h('div', { class: 'clipbar', hidden: true }));
  drawTimeline(); drawLineBox(); drawTabs();
  setTimeout(fit, 0);
  const root = h('div', { class: 'workbench' },
    h('div', { class: 'studio' },
      h('div', { class: 'prev' }, h('div', { class: 'stagehost' }, h('div', { class: 'stagebox', id: 'stagebox' }), emptyEl = emptyCard(), startPill = h('button', { class: 'start-pill', type: 'button', hidden: true, title: 'Show the quick start guide', 'aria-label': 'Show the quick start guide', onclick: () => setStartHidden(false) }, '☰ Quick start')),
        h('div', { class: 'controls' }, playBtn, h('button', { class: 'btn icon-btn', title: 'Back to start', 'aria-label': 'Back to start', onclick: () => { player.seek(0); selectLine(player.clips[0]?.id, false); S.dirty = true; } }, icon('skip-back')), timeEl, h('span', { class: 'sp' }),
          h('div', { class: 'editor-zoom' }, h('button', { class: 'btn sm icon-btn', title: 'Zoom out in editor', 'aria-label': 'Zoom out in editor', onclick: () => setEditorZoom(S.editorZoom / 1.25) }, icon('zoom-out')), h('button', { class: 'btn sm icon-btn', title: 'Fit scene in editor', 'aria-label': 'Fit scene in editor', onclick: () => setEditorZoom(1) }, icon('maximize')), zoomLabel = h('output', { 'aria-label': 'Editor zoom' }, '100%'), h('button', { class: 'btn sm icon-btn', title: 'Zoom in editor', 'aria-label': 'Zoom in editor', onclick: () => setEditorZoom(S.editorZoom * 1.25) }, icon('zoom-in'))), overflowBtn(), layoutTools()),
        selBar = h('div', { class: 'selbar', hidden: true })),
      h('div', { class: 'tlwrap' }, h('div', { class: 'scene-row' }, sceneTabs(), grip), tools, tlBox),
      h('div', { class: 'side' }, tabsEl, panelEl), charBar = h('div', { class: 'char-bar', hidden: true, role: 'toolbar', 'aria-label': 'Selected character' }), clipNav = h('div', { class: 'clip-nav', hidden: true, role: 'toolbar', 'aria-label': 'Selected clip' }), dockEdge('left'), dockEdge('right'), dockPill('rail'), dockPill('panel'), panelHandle(), timelineHandle()));
  // phone: the Play button sits in the scene row (one row less); on a wide screen it stays at the start of the player controls
  const phone = matchMedia('(max-width: 860px)'), placePlay = () => {
    const controls = root.querySelector('.controls');
    if (phone.matches) tools.prepend(playBtn); else controls.prepend(playBtn);          // phone: Play is the first button of the timeline tools row
  };
  placePlay(); phone.addEventListener('change', placePlay);
  return root;
}
function sceneTabs() {
  const strip = h('div', { class: 'scene-tabs', role: 'tablist', 'aria-label': 'Scenes' });
  const active = S.scenes.findIndex(scene => scene.id === S.sceneId);
  for (const scene of S.scenes) {
    const selected = scene.id === S.sceneId;
    strip.append(h('div', { class: `scene-tab${selected ? ' active' : ''}` },
      h('button', { role: 'tab', 'aria-selected': String(selected), onclick: () => switchScene(scene.id) }, scene.name),
      h('details', { class: 'scene-menu', ontoggle: e => { const menu = e.currentTarget; if (!menu.open) return; const box = menu.querySelector('.scene-menu-items'), rect = menu.getBoundingClientRect(); box.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - 156))}px`; box.style.top = `${Math.max(8, rect.top - box.offsetHeight - 4)}px`; } }, h('summary', { 'aria-label': `Options for ${scene.name}` }, '⋮'),
        h('div', { class: 'scene-menu-items' },
          ...[['Rename', () => editScene(scene.id, 'rename')], ['Duplicate', () => editScene(scene.id, 'duplicate')], ['Move left', () => editScene(scene.id, 'left')], ['Move right', () => editScene(scene.id, 'right')], ['Delete', () => editScene(scene.id, 'delete')]].map(([label, action]) => h('button', { onclick: action }, label))))));
  }
  strip.append(h('button', { class: 'new-scene', onclick: () => editScene(null, 'new') }, '+ New Scene'));
  strip.addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) || e.target.getAttribute('role') !== 'tab') return;
    e.preventDefault();
    const index = e.key === 'Home' ? 0 : e.key === 'End' ? S.scenes.length - 1 : (active + (e.key === 'ArrowRight' ? 1 : -1) + S.scenes.length) % S.scenes.length;
    switchScene(S.scenes[index].id);
  });
  queueMicrotask(() => strip.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  return strip;
}
function rememberScene() {
  const scene = S.scenes.find(scene => scene.id === S.sceneId);
  if (scene) scene.doc = clone(sceneDoc());
}
async function activateScene(scene) {
  S.sceneId = scene.id; S.tearPlacement = false; S.tearFor = null;
  S.sel = S.animFor = S.lineSel = S.mclip = S.camSel = S.ckSel = null;
  await loadSceneDoc(clone(scene.doc || emptyScene(S.aspect)));
  await prepareStudio({ quiet: true });
  player.seek(0); S.dirty = true;
}
async function switchScene(id, { play = false } = {}) {
  if (sceneChanging || S.exporting || previewChanging || hist.busy || !S.scenes.some(scene => scene.id === id)) return;
  if (id === S.sceneId) return;
  sceneChanging = true; player.pause();
  const progress = busy('Opening scene…');
  try {
    while (saving) await new Promise(resolve => setTimeout(resolve, 20));
    await tick({ sceneCommit: true });
    rememberScene();
    await activateScene(S.scenes.find(scene => scene.id === id));
    render(); await tick({ sceneCommit: true });
    if (play) await player.play();
  } catch (error) { toast(`The scene could not be opened: ${error.message}`); }
  finally { progress.done(); sceneChanging = false; S.dirty = true; }
}
let sceneDialogOpen = false;
function confirmSceneDelete(scene) {
  player.pause(); S.dirty = true;
  sceneDialogOpen = true;
  document.querySelectorAll('.scene-menu[open]').forEach(menu => { menu.open = false; });
  return new Promise(resolve => {
    const focusTarget = document.querySelector('.scene-tabs [aria-selected=true]');
    const dialog = h('dialog', { class: 'scene-delete-dialog', 'aria-labelledby': 'scene-delete-title', 'aria-describedby': 'scene-delete-description', onclick: event => {
      const rect = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close('cancel');
    } }, h('form', { method: 'dialog' },
      h('span', { class: 'scene-delete-icon', 'aria-hidden': 'true' }, '✦'),
      h('h2', { id: 'scene-delete-title' }, 'Delete scene?'),
      h('p', { id: 'scene-delete-description' }, `“${scene.name}” and its characters, audio and animation clips will be removed from this project. You can undo this change.`),
      h('div', { class: 'scene-delete-actions' },
        h('button', { class: 'btn', type: 'submit', value: 'cancel', autofocus: true }, 'Cancel'),
        h('button', { class: 'btn pri', type: 'submit', value: 'delete' }, 'Delete scene'))));
    dialog.addEventListener('close', () => {
      const confirmed = dialog.returnValue === 'delete';
      dialog.remove(); sceneDialogOpen = false;
      if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
      resolve(confirmed);
    }, { once: true });
    document.body.append(dialog); dialog.showModal();
  });
}
async function editScene(id, action) {
  if (sceneChanging || sceneDialogOpen || S.exporting || previewChanging || hist.busy) return;
  const index = S.scenes.findIndex(scene => scene.id === id), scene = S.scenes[index];
  let name;
  if (action === 'rename') { name = prompt('Scene name', scene.name)?.trim().slice(0, 80); if (!name) return; }
  if (action === 'delete' && S.scenes.length === 1) { toast('A project must have at least one scene.'); return; }
  if (action === 'delete' && !await confirmSceneDelete(scene)) return;
  sceneChanging = true; player.pause();
  const progress = busy('Updating scenes…');
  try {
    while (saving) await new Promise(resolve => setTimeout(resolve, 20));
    await tick({ sceneCommit: true });
    rememberScene();
    if (action === 'rename') scene.name = name;
    if (action === 'left' && index > 0) [S.scenes[index - 1], S.scenes[index]] = [scene, S.scenes[index - 1]];
    if (action === 'right' && index < S.scenes.length - 1) [S.scenes[index + 1], S.scenes[index]] = [scene, S.scenes[index + 1]];
    if (action === 'new' || action === 'duplicate') {
      const next = { id: uid(), name: uniqueSceneName(S.scenes, action === 'duplicate' ? `${scene.name} copy` : null), doc: action === 'duplicate' ? clone(scene.doc) : emptyScene(S.aspect) };
      S.scenes.splice(action === 'duplicate' ? index + 1 : S.scenes.length, 0, next);
      await activateScene(next);
    }
    if (action === 'delete') {
      S.scenes.splice(index, 1);
      if (S.sceneId === id) await activateScene(S.scenes[Math.min(index, S.scenes.length - 1)]);
    }
    render(); await tick({ sceneCommit: true });
  } catch (error) { toast(`Switching scenes failed: ${error.message}`); }
  finally { progress.done(); sceneChanging = false; S.dirty = true; }
}

// A toolbar group stays within the viewport, including the bottom mobile rail.
function placeToolbarGroup(group) {
  if (!group.open) return;
  const popup = group.querySelector('.upload-tools-list, .advanced-tools-list');
  const trigger = group.querySelector('summary').getBoundingClientRect();
  const verticalRail = innerWidth > 860 || (innerWidth > 600 && innerHeight <= 500);
  const left = verticalRail ? trigger.right + 10 : trigger.left;
  const top = verticalRail ? trigger.top : trigger.top - popup.offsetHeight - 8;
  popup.style.bottom = 'auto'; popup.style.right = 'auto';   // a phone's stylesheet also pins the bottom edge; with a top as well the box collapsed to a thin strip
  popup.style.left = `${Math.max(8, Math.min(left, innerWidth - popup.offsetWidth - 8))}px`;
  popup.style.top = `${Math.max(8, Math.min(top, innerHeight - popup.offsetHeight - 8))}px`;
}
// pop-up menus close when you tap anywhere else, and after you pick something inside them
const POPUPS = '#app :is(.upload-tools,.advanced-tools,.scene-menu,.studio-menu,.save-status,.char-more)[open]';
document.addEventListener('pointerdown', event => {
  for (const group of document.querySelectorAll(POPUPS)) if (!group.contains(event.target)) group.open = false;
}, true);
document.addEventListener('click', event => {
  const inside = event.target.closest?.('.advanced-tools-list button,.scene-menu-items button,.studio-menu button,.studio-menu a,.cb-more-list button');
  if (inside && !inside.closest('.cb-nudge')) for (const group of document.querySelectorAll(POPUPS)) if (group.contains(inside)) group.open = false;          // the arrows keep the list open for another tap
}, false);
window.addEventListener('resize', () => {
  for (const group of document.querySelectorAll('#app .upload-tools[open]')) group.open = false;
});

const wideStudio = () => matchMedia('(min-width: 1000px)').matches;
function drawTabs() {
  stopAll();
  tabsEl.className = `tabs big${S.panelOpen ? '' : ' shut'}`;
  const advanced = new Set(['motion', 'camera', 'mask', 'ai', 'tears', 'effects', 'grade']);
  const button = ([key, label, ic], openOnly = false) => h('button', { type: 'button', class: S.tab === key && S.panelOpen ? 'on' : '', 'aria-pressed': String(S.tab === key && S.panelOpen), title: label, onclick: () => {
    if (S.tab === key && !openOnly && !wideStudio()) S.panelOpen = !S.panelOpen; else { S.tab = key; S.panelOpen = true; }
    drawTabs(); S.dirty = true; if (S.panelOpen) dockShow('panel');
  } }, h('span', { class: 'ti', 'aria-hidden': 'true' }, icon(ic)), h('span', { class: 'sr' }, label));
  const byKey = Object.fromEntries(TABS.map(t => [t[0], t]));
  const rail = (label, keys) => [h('div', { class: 'rail-label' }, label), ...keys.map(k => button(byKey[k]))];
  const adv = (label, keys) => [h('div', { class: 'adv-label' }, label), ...keys.map(k => button(byKey[k]))];
  const more = h('details', {
    class: `advanced-tools${advanced.has(S.tab) || S.tab === 'export' ? ' has-active' : ''}`,
    ontoggle: event => {
      const group = event.currentTarget;
      if (group.open) { upload.open = false; placeToolbarGroup(group); }
    },
  },
    h('summary', { title: 'Advanced tools' }, h('span', { class: 'ti', 'aria-hidden': 'true' }, icon('settings')), h('span', { class: 'sr' }, 'Advanced')),
    h('div', { class: 'advanced-tools-list' }, ...adv('Look', ['tears', 'effects', 'grade']), ...adv('Direct', ['motion', 'camera', 'mask']), ...adv('Smart', ['ai']), ...adv('Finish', ['export'])));
  // phone bar: Upload (the voices), Characters, Animations, Props, Background and Advanced (which ends with Export; Export is also in the header)
  const upload = h('button', { type: 'button', class: S.tab === 'audio' && S.panelOpen ? 'on' : '', 'aria-pressed': String(S.tab === 'audio' && S.panelOpen), title: 'Upload', 'aria-label': 'Upload', onclick: () => {
    if (S.tab === 'audio' && !wideStudio()) S.panelOpen = !S.panelOpen; else { S.tab = 'audio'; S.panelOpen = true; }
    more.open = false; drawTabs(); S.dirty = true; if (S.panelOpen) dockShow('panel');
  } }, h('span', { class: 'ti', 'aria-hidden': 'true' }, icon('upload')), h('span', { class: 'sr' }, 'Upload'));
  if (wideStudio()) {
    // On a big screen the tools are a plain labelled list, in the order a person works: voices, characters, animations, then the rest.
    const done = { audio: S.lines.length > 0, chars: S.speakers.some((x) => x.charId), anim: Object.values(S.manual || {}).some((list) => list?.length) };
    const railBtn = (key, step) => { const [, text, ic] = byKey[key], active = S.tab === key; return h('button', { type: 'button', class: `rail-btn${active ? ' on' : ''}${step && done[key] ? ' done' : ''}`, 'aria-pressed': String(active), onclick: () => { S.tab = key; S.panelOpen = true; drawTabs(); S.dirty = true; dockShow('panel'); } },
      h('span', { class: 'rb-ico', 'aria-hidden': 'true' }, icon(ic)), h('span', { class: 'rb-label' }, text), step ? h('span', { class: 'rb-step', 'aria-hidden': 'true' }, done[key] ? '✓' : String(step)) : null); };
    tabsEl.replaceChildren(h('div', { class: 'rail-title' }, 'Start here'), railBtn('audio', 1), railBtn('chars', 2), railBtn('anim', 3),
      h('div', { class: 'rail-title' }, 'Scene'), ...['canvas', 'props'].map((key) => railBtn(key)),
      h('div', { class: 'rail-title' }, 'Finish'), railBtn('export'),
      h('details', { class: 'rail-more', open: advanced.has(S.tab) }, h('summary', {}, 'More tools'), ...['tears', 'effects', 'grade', 'motion', 'camera', 'mask', 'ai'].map((key) => railBtn(key))));
  } else tabsEl.replaceChildren(h('div', { class: 'rail-label' }, 'Create'), upload,
    ...['chars', 'anim', 'props', 'canvas'].map(key => button(byKey[key])), more);
  panelEl.className = `panel${S.panelOpen ? ' open' : ''}${S.tab === 'anim' ? ' animation-panel-host' : ''}`;
  const label = TABS.find(t => t[0] === S.tab)?.[1] || 'Tools';
  panelEl.replaceChildren(h('div', { class: 'sheet-close', title: 'Drag to place the panel anywhere · double-click to reset', onpointerdown: (e) => { if (!e.target.closest('button')) startDockDrag('panel', e); }, ondblclick: (e) => { if (!e.target.closest('button')) resetDock('panel'); } }, h('b', {}, label), h('button', { class: 'btn sm icon-btn', title: 'Close', 'aria-label': 'Close', onclick: () => { S.panelOpen = false; drawTabs(); } }, icon('x'))),
    { audio: tabAudio, chars: tabChars, anim: tabAnim, tears: tabTears, motion: tabMotion, camera: tabCamera, mask: tabMask, ai: tabAi, canvas: tabCanvas, props: () => libraryTab('prop'), effects: () => libraryTab('effect'), grade: tabGrade, export: tabExport }[S.tab]());
  tabsEl.append(h('div', { class: 'dock-grip', title: 'Drag to place the menu anywhere · double-click to reset', 'aria-hidden': 'true', onpointerdown: (e) => startDockDrag('rail', e), ondblclick: () => resetDock('rail') }, '⠿⠿⠿'));
  placeDock('rail'); placeDock('panel');      // drawTabs rewrites the classes: put a dragged menu back where it was
  S.dirty = true; syncLayoutUi();
}

/* ---- timeline: ruler + the audio lines (the main track) ---- */
const RULER = 28;
/** ruler marks: a label every `major` seconds (never closer than ~56 px), a small tick every second, finer when zoomed in */
// [label every N seconds, small ticks per label]: the ticks between two labels are always evenly spaced, like a ruler
const RULER_STEPS = [[0.1, 5], [0.2, 4], [0.5, 5], [1, 10], [2, 4], [5, 5], [10, 10], [15, 5], [30, 6], [60, 6], [120, 4], [300, 5], [600, 10], [900, 5], [1800, 6], [3600, 6]];
function rulerSteps(pps) {
  const [major, parts] = RULER_STEPS.find(([v]) => v * pps >= 72) || RULER_STEPS.at(-1);
  return { major, parts, minor: major / parts };
}
function selectLine(id, seek = true) {
  if (!id) return;
  S.lineSel = id; S.mclip = S.bgSel = S.propSel = null;        // choosing an audio line un-selects any animation clip, background clip or prop
  const L = lineById(id);
  if (seek && L) { player.seek(L.start + 0.01); }
  drawTimeline(); drawLineBox(); drawClipBar(); S.dirty = true;
  if (S.tab === 'anim' && S.panelOpen) drawTabs();
}
/** which animation each character layer plays right now (at the playhead), shown under the layer name */
const laneClips = new Map();
let animSeen = -1;
function refreshLayerAnim(force = true) {
  if (!tlLabels || (!force && Math.abs(player.time - animSeen) < 0.05)) return;
  animSeen = player.time;
  for (const el of tlLabels.querySelectorAll('[data-anim]')) {
    const at = (laneClips.get(el.dataset.anim) || []).find((c) => player.time >= c.start - 0.001 && player.time < c.end);
    const text = at?.name || 'No animation';
    if (el.textContent !== text) { el.textContent = text; el.dataset.tip = `Animation: ${text}`; }
    el.classList.toggle('none', !at);
  }
}
function drawTimeline() {
  if (!tlInner) return;
  const total = player.total || 1, pps = S.pps;
  const background = S.myBgs.find(bg => bg.id === S.bgId);
  const portrait = speaker => { const character = charOf(speaker); return character?.thumb || character?.thumbnail || null; };
  pruneTimelineThumbnails([background?.blob, ...S.order.map(sOf).filter(Boolean).map(portrait)]);
  tlBox.style.setProperty('--timeline-second', `${pps}px`);
  const { major, parts } = rulerSteps(pps);
  tlBox.style.setProperty('--tl-major', `${major * pps}px`);          // the faint vertical lines in every lane follow the labels of the ruler
  const ticks = [], clock = (t) => (total >= 60 ? `${Math.floor(t / 60)}:${(t % 60).toFixed(major < 1 ? 1 : 0).padStart(major < 1 ? 4 : 2, '0')}` : `${+t.toFixed(2)}s`);
  for (let i = 0; i * major <= total + 1e-6; i++) {
    ticks.push(h('span', { class: 'tick', style: `left:${i * major * pps}px` }, clock(+(i * major).toFixed(3))));
    for (let j = 1; j < parts; j++) {
      const t = i * major + j * major / parts;
      if (t > total + 1e-6) break;
      ticks.push(h('i', { class: `tmin${parts % 2 === 0 && j === parts / 2 ? '' : ' fine'}`, style: `left:${t * pps}px` }));
    }
  }
  const ruler = h('div', { class: 'ruler', style: `height:${RULER}px` }, ticks);
  let scrubbing = false;
  const scrub = (e) => { player.seek(Math.min(total, Math.max(0, (e.clientX - tlInner.getBoundingClientRect().left) / pps))); S.dirty = true; followLine(); };
  ruler.addEventListener('pointerdown', (e) => { if (S.exporting) return; scrubbing = true; ruler.setPointerCapture(e.pointerId); scrub(e); });
  ruler.addEventListener('pointermove', (e) => scrubbing && scrub(e));
  ruler.addEventListener('pointerup', () => { scrubbing = false; });
  const fileLabel = (id) => { const f = S.lines.find((l) => l.id === id)?.file; return String(f?.name ?? f ?? '').replace(/\.[^.]+$/, ''); };
  const lane = h('div', { class: 'lane2 audio', style: 'height:52px' });
  player.clips.forEach((c, i) => {
    const sp = sOf(c.speaker);
    const lz = h('i', { class: 'lz' }), rz = h('i', { class: 'rz' }), trimmed = (S.lines.find((l) => l.id === c.id)?.trimStart || 0) + (S.lines.find((l) => l.id === c.id)?.trimEnd || 0) > 0;
    const el = h('div', { class: `tclip voice ${c.id === S.lineSel && !(S.mclip || S.bgSel || S.propSel) ? 'sel' : ''} ${trimmed ? 'trimmed' : ''} ${c.muted ? 'muted' : ''} ${c.solo ? 'solo' : ''} ${isLocked('audio') ? 'locked' : ''}`, title: 'Drag the middle to move the audio · drag an edge to trim it · double-click to remove the trim', style: `left:${c.start * pps}px;width:${Math.max(8, (c.end - c.start) * pps)}px;background:${sp?.color || '#888'}`, onclick: () => !S.exporting && !voiceMoved && selectLine(c.id) },
      lz, voiceWave(c), h('span', { class: 'tn' }, `${i + 1} · ${sp?.name || ''}${fileLabel(c.id) ? ` · ${fileLabel(c.id)}` : ''}`), c.muted ? h('span', { class: 'vmix' }, 'muted') : c.solo ? h('span', { class: 'vmix' }, 'solo') : null, rz);
    el.addEventListener('pointerdown', (e) => { if (e.button) return; dragVoice(e, c, e.target === rz ? 'right' : e.target === lz ? 'left' : 'move', el); });
    el.addEventListener('dblclick', async () => { const line = S.lines.find((l) => l.id === c.id); if (!line || S.exporting || !(line.trimStart || line.trimEnd)) return; line.trimStart = 0; line.trimEnd = 0; await retimeAudio(); drawTimeline(); });
    lane.append(el);
  });
  // no audio yet: show only the ruler and the animation lanes (audio can still be added in the Audio tab)
  const hasAudio = player.clips.length > 0;
  const labels = [h('div', { class: 'rl ruler', style: `height:${RULER}px` }, 'Layers'), ...(hasAudio ? [h('div', { class: 'rl audio', style: 'height:52px' }, timelineIcon(null, 'audio'), h('span', { class: 'lt' }, 'Audio'), lockBtn('audio', 'the audio layer'))] : [])], lanes = [ruler, ...(hasAudio ? [lane] : [])];
  if (S.music && musicBuffer(S.music.id)) { labels.push(h('div', { class: 'rl audio', style: 'height:34px', onclick: () => openTab('audio') }, timelineIcon(null, 'audio'), h('span', { class: 'lt' }, 'Music'))); lanes.push(musicLane(total, pps)); }
  // the scene background, named like the audio and animation clips
  const bgName = S.bgId ? (S.myBgs.find((r) => r.id === S.bgId)?.name || 'Background image').replace(/\.[^.]+$/, '') : (BACKGROUNDS[stage.bg.preset] || BACKGROUNDS[0]).name;
  if (S.bgId || stage.bg.preset !== 0 || S.bgClips.length) {
    labels.push(h('div', { class: 'rl audio', style: 'height:38px', onclick: () => openTab('canvas') }, timelineIcon(background?.blob, 'background'), h('span', { class: 'lt' }, 'Background'), lockBtn('bg', 'the background layer'),
      h('button', { type: 'button', class: 'rx delete-layer', title: 'Delete background layer', 'aria-label': 'Delete background layer', disabled: S.exporting, onclick: event => { event.stopPropagation(); return removeBackgroundLayer(); } }, '🗑')));
    const bgLane = h('div', { class: 'lane2 bg', style: 'height:38px' },
      (S.bgId || stage.bg.preset !== 0) && !S.bgClips.some((c) => c.base) ? h('div', { class: 'tclip bg base', title: `Background · ${bgName} (whole scene) — click to select, then split, trim or move it`, onpointerdown: (e) => { if (e.button || S.exporting) return; e.preventDefault(); takeBaseBackground(); }, style: `left:0;width:${Math.max(40, total * pps)}px` }, h('span', { class: 'tn' }, `Background · ${bgName}`)) : null);
    for (const c of S.bgClips) {
      const nm = (c.bgId ? (S.myBgs.find((r) => r.id === c.bgId)?.name || 'Background image').replace(/\.[^.]+$/, '') : (BACKGROUNDS[c.preset] || BACKGROUNDS[0]).name), lz = h('i', { class: 'lz' }), rz = h('i', { class: 'rz' });
      const el = h('div', { 'data-key': keyOf('bg', c.id), class: `tclip bg mine ${c.id === S.bgSel ? 'sel' : ''} ${multi.has(keyOf('bg', c.id)) ? 'msel' : ''} ${isLocked('bg') ? 'locked' : ''}`, title: `${nm} — drag to move, drag an edge to resize`, style: `left:${c.start * pps}px;width:${Math.max(6, c.dur * pps)}px` }, lz, h('span', { class: 'tn' }, `🖼 ${nm}`), rz);
      el.addEventListener('pointerdown', (e) => dragBgClip(e, c, e.target === rz ? 'right' : e.target === lz ? 'left' : 'move', el));
      bgLane.append(el);
    }
    lanes.push(bgLane);
  }
  // props and effects: one row each, visible from start to end
  // a prop that was split (or duplicated) stays on the same row as the piece it came from: pieces share a `lane`
  const propRows = new Map();
  for (const prop of S.props.filter((p) => p.visible !== false)) { const key = prop.lane || prop.id; if (!propRows.has(key)) propRows.set(key, []); propRows.get(key).push(prop); }
  for (const rowProps of propRows.values()) {
    const rowEls = [];
    for (const prop of rowProps) {
    const start = prop.start || 0, end = prop.end ?? total, lz = h('i', { class: 'lz' }), rz = h('i', { class: 'rz' });
    const el = h('div', { 'data-key': keyOf('prop', prop.id), class: `tclip prop ${isEffect(prop) ? 'fx' : ''} mine ${prop.id === S.propSel ? 'sel' : ''} ${multi.has(keyOf('prop', prop.id)) ? 'msel' : ''} ${isLocked(`prop:${prop.lane || prop.id}`) ? 'locked' : ''}`, title: `${prop.name} — drag to move, drag an edge to resize`, style: `left:${start * pps}px;width:${Math.max(6, (end - start) * pps)}px` }, lz, h('span', { class: 'tn' }, `${isEffect(prop) ? '✨' : '🧸'} ${prop.name}`), rz);
    el.addEventListener('pointerdown', (e) => dragPropRange(e, prop, e.target === rz ? 'right' : e.target === lz ? 'left' : 'move', el));
      rowEls.push(el);
    }
    labels.push(h('div', { class: 'rl char', style: 'height:30px' }, h('span', { class: 'lt face' }, isEffect(rowProps[0]) ? 'Effect' : 'Prop'), lockBtn(`prop:${rowProps[0].lane || rowProps[0].id}`, 'this row')));
    lanes.push(h('div', { class: 'lane2 prop', style: 'height:30px' }, ...rowEls));
  }
  laneClips.clear();
  const KIND_ICON = { body: '🎬', hand: '✋', legs: '🦵', face: '🙂' }, LH = 46;
  for (const s of S.order.map(sOf).filter((x) => x?.charId && charOf(x))) {
    const plan = layerPlan(s), kinds = ['body', ...LAYER_KINDS.filter((k) => plan.clips.some((c) => c.kind === k) || (S.manual[s.key] || []).some((m) => m.kind === k))], nameOf = new Map(plan.refs.map((r) => [animKey(r), r.name]));
    kinds.forEach((kind, i) => {
      const ln = h('div', { class: 'lane2 char', style: `height:${LH}px;--track-color:${s.color}` });
      ln.addEventListener('click', (e) => { if (e.target === ln) selectChar(s.key); });          // empty space on the character's row too
      // many tiny automatic clips in a row (one per spoken sound) would be unreadable: three or more are drawn as one block
      const autos = plan.clips.filter((x) => x.kind === kind && !x.manual).sort((a, b) => a.start - b.start), tiny = (c) => c.dur * pps < 44, items = [];
      for (let k = 0; k < autos.length;) {
        let end = k + 1;
        while (tiny(autos[end - 1]) && autos[end] && tiny(autos[end]) && autos[end].start - (autos[end - 1].start + autos[end - 1].dur) < 0.15) end++;
        if (end - k >= 3) items.push({ group: autos.slice(k, end) }); else for (let j = k; j < end; j++) items.push({ c: autos[j] });
        k = end;
      }
      for (const item of items) {
        if (item.group) {
          const first = item.group[0], last = item.group.at(-1), names = item.group.map((x) => (nameOf.get(x.name) || x.name).replace(/^Listener · /, ''));
          const el = h('div', { class: `tclip ${kind} auto`, title: `${s.name} · ${names.length} automatic clips: ${names.join(', ')}`, style: `left:${first.start * pps}px;width:${Math.max(6, (last.start + last.dur - first.start) * pps)}px` }, h('span', { class: 'tn' }, `${s.name} · ${names.length} clips`));
          el.addEventListener('click', () => { const L = lineAt(first.start + 0.01); if (L && player.clips.length) selectLine(L.id); selectChar(s.key); });
          ln.append(el); continue;
        }
        const c = item.c;
        const name = (nameOf.get(c.name) || c.name).replace(/^Listener · /, '');
        const ref = plan.refs.find((r) => animKey(r) === c.name), soloBody = c.id.startsWith('solo:body') && S.solo[s.key]?.bodyLen > 0;
        const pickable = !!ref && (soloBody || !c.id.startsWith('solo:')), lz = pickable && h('i', { class: 'lz' }), rz = pickable && h('i', { class: 'rz' });
        const el = h('div', { class: `tclip ${kind} auto`, title: `${s.name} · ${name}${pickable ? ' — drag to move, drag an edge to resize' : ' (automatic)'}`, style: `left:${c.start * pps}px;width:${Math.max(6, c.dur * pps)}px` }, lz || null, h('span', { class: 'tn' }, `${s.name} · ${name}`), rz || null);
        el.addEventListener('click', () => { const L = lineAt(c.start + 0.01); if (L && player.clips.length) selectLine(L.id); selectChar(s.key); });          // tapping a character's row selects the character
        if (pickable) el.addEventListener('pointerdown', (e) => {
          const mode = e.target === rz ? 'right' : e.target === lz ? 'left' : 'move';
          // an automatic clip (from the voice, or the animation picked without audio) becomes the user's own clip the first time it is dragged
          const m = soloBody ? takeSoloBody(s) : takeAutoClip(s, kind, c, ref);
          if (!m) return;
          e.preventDefault(); e.stopPropagation(); drawTimeline();
          const fresh = [...tlInner.querySelectorAll('.tclip.mine')].find((x) => x.dataset.mid === m.id);
          if (fresh) dragClip(e, m, mode, fresh);
        });
        ln.append(el);
      }
      for (const m of (S.manual[s.key] || []).filter((x) => x.kind === kind)) {
        const name = m.ref.name.replace(/^Listener · /, ''), rz = h('i', { class: 'rz' }), lz = h('i', { class: 'lz' });
        const el = h('div', { 'data-mid': m.id, 'data-key': keyOf('clip', m.id), class: `tclip ${kind} mine ${m.id === S.mclip ? 'sel' : ''} ${multi.has(keyOf('clip', m.id)) ? 'msel' : ''} ${isLocked(`char:${s.key}`) ? 'locked' : ''}`, title: `${s.name} · ${name} — drag to move, drag an edge to resize`, style: `left:${m.start * pps}px;width:${Math.max(6, m.dur * pps)}px` }, lz, h('span', { class: 'tn' }, `${s.name} · ${name}`), rz);
        el.addEventListener('pointerdown', (e) => dragClip(e, m, e.target === rz ? 'right' : e.target === lz ? 'left' : 'move', el));
        ln.append(el);
      }
      if (kind === 'body') {                       // the path of this character: flag A (start) and flag B (end) sit on its animation clip, drag them to change the time
        const path = S.paths[s.key], pc = path?.clipId && (S.manual[s.key] || []).find((x) => x.id === path.clipId);
        if (pc) for (const [which, t] of [['a', pc.start], ['b', pc.start + pc.dur]]) {
          const f = h('div', { class: `pflag ${which}`, title: which === 'a' ? 'Path start (drag to change the time)' : 'Path end (drag to change the time)', style: `left:${t * pps}px` }, h('i', { class: 'pf-pole' }), h('span', { class: 'pf-cloth' }, which === 'a' ? icon('route') : null, which.toUpperCase()));
          f.addEventListener('pointerdown', (e) => dragPathFlag(e, pc, which, f)); ln.append(f);
        }
      }
      labels.push(h('div', { class: 'rl char', style: `height:${LH}px;--track-color:${s.color};cursor:pointer`, onclick: () => selectChar(s.key) }, i === 0 ? [timelineIcon(portrait(s)), h('span', { class: 'lt-wrap' }, h('span', { class: 'lt', title: s.name }, s.name), h('small', { class: 'lanim', 'data-anim': `${s.key}|body` }, '')), h('button', { class: 'rx add', title: `Add an animation for ${s.name} at the playhead`, onclick: () => clipPicker(s) }, '＋'), lockBtn(`char:${s.key}`, s.name), h('button', { type: 'button', class: 'rx delete-layer', title: `Delete ${s.name} from scene`, 'aria-label': `Delete ${s.name} from scene`, disabled: S.exporting, onclick: () => removeCharacterFrom(s) }, '🗑')] : h('span', { class: 'lt-wrap' }, h('span', { class: 'lt face' }, `${KIND_ICON[kind]} ${kind}`), h('small', { class: 'lanim', 'data-anim': `${s.key}|${kind}` }, ''))));
      laneClips.set(`${s.key}|${kind}`, [...plan.clips.filter((x) => x.kind === kind).map((c) => ({ start: c.start, end: c.start + c.dur, name: (nameOf.get(c.name) || c.name).replace(/^Listener · /, '') })), ...(S.manual[s.key] || []).filter((x) => x.kind === kind).map((m) => ({ start: m.start, end: m.start + m.dur, name: m.ref.name.replace(/^Listener · /, '') }))]);
      lanes.push(ln);
    });
    const cks = (S.charKeys[s.key] || []).filter((k) => !k.pathKey);          // the keyframes a path makes are not drawn: the path is the two flags on the layer
    if (cks.length) {
      const kl = h('div', { class: 'lane2 cam move', style: 'height:30px' });
      for (const k of cks.slice().sort((a, b) => a.t - b.t)) {
        const d = h('i', { class: `kf mv ${k.id === S.ckSel ? 'sel' : ''}`, title: `${s.name} · ${k.t.toFixed(2)}s — right-click to delete`, style: `left:${k.t * pps}px;background:${s.color}` });
        d.addEventListener('pointerdown', (e) => dragCharKey(e, s, k, d));
        d.addEventListener('contextmenu', (e) => {
          e.preventDefault(); if (S.exporting || !confirm(`Delete this keyframe of ${s.name}?`)) return;
          S.charKeys[s.key] = S.charKeys[s.key].filter((x) => x !== k); if (!S.charKeys[s.key].length) delete S.charKeys[s.key];
          stage.setLayerKeys(s.key, S.charKeys[s.key] || []); if (S.ckSel === k.id) S.ckSel = null;
          drawTimeline(); if (S.tab === 'motion') drawTabs(); S.dirty = true;
        });
        kl.append(d);
      }
      labels.push(h('div', { class: 'rl char', style: 'height:30px' }, h('span', { class: 'lt face' }, '◆ move'))); lanes.push(kl);
    }
  }
  if (S.gradeKeys.length) {
    const gl = h('div', { class: 'lane2 cam move', style: 'height:30px' });
    for (const k of S.gradeKeys.slice().sort((a, b) => a.t - b.t)) {
      const d = h('i', { class: `kf mv grade ${k.id === S.gradeSel ? 'sel' : ''}`, title: `Colour · ${k.t.toFixed(2)}s — right-click to delete`, style: `left:${k.t * pps}px;background:#c084fc` });
      d.addEventListener('pointerdown', (e) => dragGradeKey(e, k, d));
      d.addEventListener('contextmenu', (e) => {
        e.preventDefault(); if (S.exporting || !confirm('Delete this colour keyframe?')) return;
        S.gradeKeys = S.gradeKeys.filter((x) => x !== k); if (S.gradeSel === k.id) S.gradeSel = null;
        syncGrade(); updateTotal(); drawTimeline(); if (S.tab === 'grade') drawTabs();
      });
      gl.append(d);
    }
    labels.push(h('div', { class: 'rl char', style: 'height:30px', onclick: () => openTab('grade') }, h('span', { class: 'lt face' }, '🎨 Colour'))); lanes.push(gl);
  }
  // camera keyframes: the row only shows up once the user has added one (from the Camera tab), same as Colour above
  if (S.camKeys.length) {
    const cl = h('div', { class: 'lane2 cam', style: 'height:38px' });
    for (const k of [...S.camKeys].sort((a, b) => a.t - b.t)) {
      const d = h('i', { class: `kf ${k.id === S.camSel ? 'sel' : ''}`, title: `${k.t.toFixed(2)}s · ${k.zoom.toFixed(2)}× — right-click to delete`, style: `left:${k.t * pps}px` });
      d.addEventListener('pointerdown', (e) => dragKey(e, k, d));
      d.addEventListener('contextmenu', (e) => {
        e.preventDefault(); if (S.exporting || !confirm('Delete this camera keyframe?')) return;
        S.camKeys = S.camKeys.filter((x) => x !== k); if (S.camSel === k.id) S.camSel = null;
        syncCam(); drawTimeline(); if (S.tab === 'camera') drawTabs();
      });
      cl.append(d);
    }
    labels.push(h('div', { class: 'rl audio', style: 'height:38px', onclick: () => openTab('camera') }, timelineIcon(null, 'camera'), h('span', { class: 'lt' }, 'Camera'))); lanes.push(cl);
  }
  tlLabels.replaceChildren(...labels);
  refreshLayerAnim();
  tlInner.style.width = `${Math.ceil(total * pps) + 60}px`;
  tlInner.replaceChildren(...lanes, headEl);
  drawClipBar();
  headEl.style.left = `${player.time * pps}px`;
}

/* ---------- the user's own animation clips on the timeline ---------- */
const findManual = (id) => { for (const [k, list] of Object.entries(S.manual)) { const m = list.find((x) => x.id === id); if (m) return { s: sOf(k), m, list }; } return null; };
/** an empty scene is 8 s; otherwise the end of the last clip (animation, background clip, effect with an end) decides. Trimming clips shortens the scene. With audio the voice decides the length. */
const sceneLen = () => contentLength({ solo: S.solo, speakers: S.speakers, manual: S.manual, bgClips: S.bgClips, props: S.props, camKeys: S.camKeys, charKeys: S.charKeys, gradeKeys: S.gradeKeys });
/** background clips as the stage wants them: the picture is looked up in the user's own backgrounds */
const bgClipJobs = () => S.bgClips.map((c) => ({ fx: c.fx || null, start: c.start, dur: c.dur, xf: c.xf || null, preset: c.preset ?? 0, blob: c.bgId ? S.myBgs.find((r) => r.id === c.bgId)?.blob ?? null : null }));
const bgBlankOutside = () => S.bgClips.some((c) => c.base);
const syncBgClips = async () => { await stage.setBackgroundClips(bgClipJobs(), bgBlankOutside()); S.dirty = true; };
function updateTotal() {
  if (player.clips.length) return;
  const len = sceneLen();
  if (Math.abs(len - player.total) > 0.01) { player.total = len; fitTimeline(); }
}
const snap = (v) => Math.round(v * 20) / 20;
/** a path moves with the animation clip it was drawn for: same start and same length, so that animation plays all the way along the path.
    Change the clip on the timeline (move it, stretch it) and the path follows; delete the clip and the path goes with it. */
function syncPaths() {
  for (const [key, path] of Object.entries(S.paths || {})) {
    if (!path.clipId) {                                   // a path made before paths followed their clip: it takes the animation that plays where the path starts, so the animation lasts the whole way
      const m = (S.manual[key] || []).find((x) => x.kind === 'body' && path.start >= x.start - 0.05 && path.start < x.start + x.dur);
      if (m) { path.clipId = m.id; path.start = +m.start.toFixed(2); path.dur = Math.max(0.5, +m.dur.toFixed(2)); applyPath(key); }
      continue;
    }
    const m = (S.manual[key] || []).find((x) => x.id === path.clipId);
    if (!m) { delete S.paths[key]; applyPath(key); continue; }
    if (Math.abs(path.start - m.start) > 0.005 || Math.abs(path.dur - m.dur) > 0.005) { path.start = +m.start.toFixed(2); path.dur = Math.max(0.5, +m.dur.toFixed(2)); applyPath(key); }
  }
}
/** the animation clip a new path is drawn for: the selected one, else the one under the playhead (an animation picked without audio becomes a clip of its own) */
function pathClipFor(s) {
  const body = (S.manual[s.key] || []).filter((m) => m.kind === 'body');
  return body.find((x) => x.id === S.mclip) || body.find((x) => player.time >= x.start - 0.01 && player.time < x.start + x.dur) || (body.length === 1 ? body[0] : null) || takeSoloBody(s);
}
function commitClips(redraw = true) { syncPaths(); updateTotal(); refreshPresence(); if (redraw) { drawTimeline(); } else drawClipBar(); }
/** how many seconds of the animation one second of the clip shows: a clip made with a `span` plays that part of the animation over its whole length (slower when the clip is longer) */
const DEFAULT_CLIP = 5, rateOf = (m) => (m.span > 0 && m.dur > 0 ? m.span / m.dur : 1);
async function addClip(s, ref, overlay, length) {
  const kind = ref.layer || (overlay ? 'face' : 'body'), dur = DEFAULT_CLIP;          // every animation comes onto the timeline 5 seconds long; it plays once over the clip, so a longer clip is slower and a shorter one faster
  const start = Math.max(0, snap(Math.min(player.time, Math.max(0, player.total - 0.3))));
  const m = { id: uid(), kind, ref: { ...ref }, start, dur, off: 0, ...(length > 0 && ref.source !== 'mode' ? { span: +length.toFixed(3) } : {}) };
  (S.manual[s.key] ||= []).push(m); S.mclip = m.id;
  updateTotal();
  const b = busy('Adding animation…');
  try { await applyLayers(); } catch (e) { console.error(e); toast(`Could not add the animation: ${e.message}`); } finally { b.done(); }
  drawTimeline(); S.dirty = true;
}
/** opens the animation list for one character; the chosen animation is placed at the playhead */
function clipPicker(s, onPick) {
  let close;
  const ab = animBrowser({ getSpeaker: () => s, chips: null, selectedRef: () => null, onPick: async (sp, ref, overlay, length) => { close(); await (onPick ? onPick(ref, overlay, length) : addClip(sp, ref, overlay, length)); } });
  close = modal(`Add an animation · ${s.name}`, h('div', {}, h('p', { class: 'sub', style: 'font-size:12px;margin:0 0 8px' }, onPick ? 'Pick the animation that replaces this clip.' : `It is placed at the playhead (${fmt(player.time)}). Add the same animation as many times as you like.`), ab.el), () => ab.dispose());
}
/**
 * Drag one timeline item. mode: 'move' | 'left' | 'right'. `io` says how to read / write the item:
 * get() -> {start, dur, off}, set({start, dur, off}), room (how far the head may be pulled back), select(), after() (once, when released).
 */
/* ---- layer locks: a locked layer's clips cannot be moved, trimmed, split, deleted or edited by number (they can still be selected and played) ---- */
const lockKeyOf = (key) => {
  const i = key.indexOf(':'), kind = key.slice(0, i), id = key.slice(i + 1);
  if (kind === 'bg') return 'bg';
  if (kind === 'prop') { const p = S.props.find((x) => x.id === id); return p ? `prop:${p.lane || p.id}` : null; }
  if (kind === 'clip') { const f = findManual(id); return f ? `char:${f.s?.key}` : null; }
  return null;
};
const isLocked = (lock) => !!(lock && S.locks?.[lock]);
const isKeyLocked = (key) => isLocked(lockKeyOf(key));
function toggleLock(lock) {
  S.locks = { ...(S.locks || {}) }; if (S.locks[lock]) delete S.locks[lock]; else S.locks[lock] = true;
  for (const k of [...multi]) if (isKeyLocked(k)) multi.delete(k);
  S.dirty = true; drawTimeline(); drawClipBar();
}
const lockedToast = () => toast('This layer is locked. Unlock it with the lock button on the left of the timeline.');
/** pressing on a locked clip only selects it; the notice appears if the user then tries to drag it */
function blockedDrag(e, select) {
  e.preventDefault(); e.stopPropagation(); select?.();
  const x0 = e.clientX, done = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', done); removeEventListener('pointercancel', done); };
  const mv = (ev) => { if (Math.abs(ev.clientX - x0) > 3) { lockedToast(); done(); } };
  addEventListener('pointermove', mv); addEventListener('pointerup', done); addEventListener('pointercancel', done);
}
const lockBtn = (lock, name) => h('button', { type: 'button', class: `rx lock-layer ${isLocked(lock) ? 'on' : ''}`, 'aria-pressed': String(isLocked(lock)), title: isLocked(lock) ? `Unlock ${name}` : `Lock ${name}`, 'aria-label': `${isLocked(lock) ? 'Unlock' : 'Lock'} ${name}`, onclick: (e) => { e.stopPropagation(); toggleLock(lock); } }, icon(isLocked(lock) ? 'lock' : 'unlock'));
/* ---- multi-select: Shift + click or a box drawn on the timeline picks several clips (animation clips, backgrounds, props); drag, copy, duplicate and delete work on all of them ---- */
const multi = new Set();
const keyOf = (kind, id) => `${kind}:${id}`;
const singleKey = () => (S.mclip ? keyOf('clip', S.mclip) : S.bgSel ? keyOf('bg', S.bgSel) : S.propSel ? keyOf('prop', S.propSel) : null);
function multiResolve() {
  const out = [];
  for (const key of multi) {
    const i = key.indexOf(':'), kind = key.slice(0, i), id = key.slice(i + 1);
    if (kind === 'clip') { const f = findManual(id); if (f) out.push({ key, kind, id, f, m: f.m, get: () => ({ start: f.m.start, dur: f.m.dur, off: f.m.off || 0 }), set: (r) => { f.m.start = r.start; } }); }
    else if (kind === 'bg') { const c = S.bgClips.find((x) => x.id === id); if (c) out.push({ key, kind, id, c, get: () => ({ start: c.start, dur: c.dur, off: 0 }), set: (r) => { c.start = r.start; } }); }
    else { const p = S.props.find((x) => x.id === id); if (p) out.push({ key, kind, id, p, get: () => { const start = p.start || 0; return { start, dur: Math.max(MIN_CLIP, (p.end ?? player.total) - start), off: 0 }; }, set: (r) => { const dur = Math.max(MIN_CLIP, (p.end ?? player.total) - (p.start || 0)); p.start = r.start; p.end = +(r.start + dur).toFixed(2); } }); }
  }
  return out;
}
function paintMulti() { tlInner?.querySelectorAll('.tclip[data-key]').forEach((n) => n.classList.toggle('msel', multi.has(n.dataset.key))); }
function clearMulti() { if (!multi.size) return; multi.clear(); paintMulti(); updateEditTools(); }
function setMulti(keys) {
  multi.clear(); for (const k of keys) multi.add(k);
  if (multi.size >= 2) { S.mclip = S.bgSel = S.propSel = null; S.lineSel = null; tlInner?.querySelectorAll('.tclip.sel').forEach((x) => x.classList.remove('sel')); clipBar && (clipBar.hidden = true); }
  paintMulti(); updateEditTools(); updateBgSel(); S.dirty = true;
}
function toggleMulti(key) {
  const keys = new Set(multi); if (!keys.size) { const s = singleKey(); if (s) keys.add(s); }
  keys.has(key) ? keys.delete(key) : keys.add(key);
  if (keys.size === 1) { clearMulti(); const [k] = keys, i = k.indexOf(':'); selectOnly(k.slice(0, i), k.slice(i + 1)); drawTimeline(); return; }
  setMulti(keys);
}
/** a box dragged over empty space on the timeline selects every clip it touches */
function wireBoxSelect() {
  // a tap on empty space in the timeline leaves the selected clip / character: the bottom bar is the normal menu again
  tlInner.addEventListener('click', (e) => {
    if (S.exporting || e.target.closest('.tclip,.ruler,.phead,.pflag,button,input,.kf,.dia,.lane2.char')) return;
    const had = dropItemSelection();
    if (S.sel) { S.sel = null; updateSel(); S.dirty = true; } else if (had) updateSel();
  });
  tlInner.addEventListener('pointerdown', (e) => {
    if (e.button || S.exporting || e.pointerType === 'touch' || e.target.closest('.tclip,.ruler,.phead,button')) return;      // a finger scrolls the timeline; the box is for mouse and pen
    const area = tlInner.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY; let box = null;
    const mv = (ev) => {
      if (!box && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      if (!box) { box = h('div', { class: 'tl-box' }); tlInner.append(box); }
      const x1 = Math.min(x0, ev.clientX), y1 = Math.min(y0, ev.clientY), w = Math.abs(ev.clientX - x0), hh = Math.abs(ev.clientY - y0);
      Object.assign(box.style, { left: `${x1 - area.left}px`, top: `${y1 - area.top}px`, width: `${w}px`, height: `${hh}px` });
    };
    const up = (ev) => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up); removeEventListener('pointercancel', stop);
      if (ev.type === 'pointercancel') { box?.remove(); return; }
      if (!box) { clearMulti(); return; }
      const r = box.getBoundingClientRect(); box.remove();
      const hits = [...tlInner.querySelectorAll('.tclip[data-key]')].filter((n) => !isKeyLocked(n.dataset.key)).filter((n) => { const b = n.getBoundingClientRect(); return b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom; }).map((n) => n.dataset.key);
      if (hits.length >= 2) setMulti(hits); else { clearMulti(); if (hits.length === 1) { const k = hits[0], i = k.indexOf(':'); selectOnly(k.slice(0, i), k.slice(i + 1)); drawTimeline(); } }
    };
    const stop = (ev) => up(ev);
    addEventListener('pointermove', mv); addEventListener('pointerup', up); addEventListener('pointercancel', stop);
  });
}
/* the same actions as for one clip, for the whole selection */
function copyMulti() {
  const items = multiResolve(); if (items.length < 2) return false;
  const base = Math.min(...items.map((m) => m.get().start));          // a prop keeps its picture (a plain copy), the others are deep-copied
  S.clipboard = { type: 'multi', base, items: items.map((m) => ({ kind: m.kind, key: m.f?.s?.key, data: m.kind === 'prop' ? { ...m.p } : clone(m.m || m.c) })) };
  try { if (!localStorage.getItem('toons-hint-copy')) { localStorage.setItem('toons-hint-copy', '1'); toast('Copied. Move the playhead, then Paste.'); } } catch { /* no hint */ }
  updateEditTools(); return true;
}
async function pasteMulti(at) {
  const cb = S.clipboard, offset = at - cb.base, made = []; let needLayers = false;
  for (const it of cb.items) {
    if (it.kind === 'clip') { const s = sOf(it.key) || S.speakers.find((x) => x.charId); if (!s?.charId) continue; const m = { ...clone(it.data), id: uid(), start: Math.max(0, +(it.data.start + offset).toFixed(2)) }; (S.manual[s.key] ||= []).push(m); made.push(keyOf('clip', m.id)); needLayers = true; }
    else if (it.kind === 'bg') { const c = { ...clone(it.data), id: uid(), start: Math.max(0, +(it.data.start + offset).toFixed(2)) }; S.bgClips.push(c); made.push(keyOf('bg', c.id)); }
    else { const start = it.data.start || 0, len = Math.max(MIN_CLIP, (it.data.end ?? player.total) - start), p = { ...it.data, id: uid(), start: Math.max(0, +(start + offset).toFixed(2)) }; p.end = +(p.start + len).toFixed(2); if (it.data.attach) p.attach = { ...it.data.attach }; S.props.push(p); await dbPut('props', p); made.push(keyOf('prop', p.id)); }
  }
  if (needLayers) { const b = busy('Pasting clips…'); try { await applyLayers(); } catch (e) { toast(`Could not paste the clips: ${e.message}`); } finally { b.done(); } }
  await syncBgClips(); await stage.setProps(S.props); updateTotal(); S.dirty = true; drawTimeline(); setMulti(made); refreshPresence();
}
async function deleteMulti() {
  for (const m of multiResolve()) {
    if (isKeyLocked(m.key)) continue;
    if (m.kind === 'clip') m.f.list.splice(m.f.list.indexOf(m.m), 1);
    else if (m.kind === 'bg') S.bgClips = S.bgClips.filter((x) => x !== m.c);
    else { await dbDel('props', m.p.id); S.props = S.props.filter((p) => p.id !== m.p.id); }
  }
  multi.clear(); await syncBgClips(); await stage.setProps(S.props); S.dirty = true; commitClips();
}
/* ---- snapping: while a clip is dragged its edges are pulled to the edges of other clips, the playhead and whole seconds ---- */
const snapOn = () => { if (S.snapOn === undefined) { try { S.snapOn = localStorage.getItem('12toons.snap') !== 'off'; } catch { S.snapOn = true; } } return S.snapOn; };
function snapPoints(skip) {
  const skipIds = new Set([].concat(skip)), pts = new Set([0, +player.total.toFixed(2), +player.time.toFixed(2)]);
  for (let s = 1; s < player.total; s++) pts.add(s);
  for (const c of player.clips) if (!skipIds.has(c.id)) { pts.add(+c.start.toFixed(2)); pts.add(+c.end.toFixed(2)); }
  for (const list of Object.values(S.manual || {})) for (const m of list || []) if (!skipIds.has(m.id)) { pts.add(+m.start.toFixed(2)); pts.add(+(m.start + m.dur).toFixed(2)); }
  for (const c of S.bgClips) if (!skipIds.has(c.id)) { pts.add(+c.start.toFixed(2)); pts.add(+(c.start + c.dur).toFixed(2)); }
  for (const pr of S.props) if (!skipIds.has(pr.id)) { pts.add(+(pr.start || 0).toFixed(2)); if (pr.end != null) pts.add(+pr.end.toFixed(2)); }
  return [...pts];
}
let snapLineEl = null;
function showSnapLine(t) {
  if (t == null) { snapLineEl?.remove(); snapLineEl = null; return; }
  if (!snapLineEl && tlInner) { snapLineEl = h('div', { class: 'snap-line', 'aria-hidden': 'true' }); tlInner.append(snapLineEl); }
  if (snapLineEl) snapLineEl.style.left = `${t * S.pps}px`;
}
function setSnap(on) {
  S.snapOn = !!on; try { localStorage.setItem('12toons.snap', on ? 'on' : 'off'); } catch { /* optional */ }
  snapBtn?.setAttribute('aria-pressed', String(!!on)); snapBtn?.classList.toggle('on', !!on);
}
let snapBtn = null;
function dragItem(e, mode, el, io) {
  if (S.exporting) return;
  e.preventDefault(); e.stopPropagation();
  if (io.lock && isLocked(io.lock)) { blockedDrag(e, io.select); return; }                // a locked layer can be selected, not changed
  if (e.shiftKey && io.key) { if (!isKeyLocked(io.key)) toggleMulti(io.key); else lockedToast(); return; }                                // Shift + click adds the clip to (or removes it from) the selection
  const group = mode === 'move' && io.key && multi.size >= 2 && multi.has(io.key) ? multiResolve() : null;       // dragging a selected clip moves the whole selection
  if (!group) io.select?.();
  const x0 = e.clientX, from = io.get(), pps = S.pps, groupFrom = group?.map((m) => m.get()); let moved = false, raf = 0, ghost = null;
  el.setPointerCapture?.(e.pointerId);
  const exclude = group ? group.map((m) => m.id) : [io.id];
  const points = snapOn() ? snapPoints(exclude) : [];
  const gStart = group ? Math.min(...groupFrom.map((f) => f.start)) : 0, gEnd = group ? Math.max(...groupFrom.map((f) => f.start + f.dur)) : 0;
  const mv = (ev) => {
    if (Math.abs(ev.clientX - x0) > 2) moved = true;
    if (moved && !ghost && !group && mode !== 'move' && el.parentNode) {                                 // while stretching: the clip turns light and dotted, a dotted frame stays where it was
      ghost = h('div', { class: 'tclip-ghost', style: `left:${el.offsetLeft}px;width:${el.offsetWidth}px` }); el.parentNode.append(ghost); el.classList.add('resizing');
    }
    let delta = (ev.clientX - x0) / pps, at = null;
    const box = group ? { start: gStart, dur: gEnd - gStart } : from;
    if (points.length && !ev.altKey) ({ delta, at } = snapDelta({ mode, start: box.start, dur: box.dur, delta, points, within: 8 / pps }));          // hold Alt to move freely
    showSnapLine(at);
    if (group) {
      delta = Math.max(delta, -gStart);
      group.forEach((m, i) => { const r = resizeClip({ mode: 'move', ...groupFrom[i], delta, step: at != null ? 0.01 : undefined }); m.set(r); const node = tlInner?.querySelector(`[data-key="${m.key}"]`); if (node) node.style.left = `${r.start * pps}px`; });
    } else {
      const r = resizeClip({ mode, ...from, delta, min: io.min ?? MIN_CLIP, room: io.room ?? from.off ?? 0, step: at != null ? 0.01 : undefined });
      io.set(r);
      el.style.left = `${r.start * pps}px`; el.style.width = `${Math.max(6, r.dur * pps)}px`;
    }
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; refreshPresence(); });
  };
  const finish = async () => {
    if (group) { if (group.some((m) => m.kind === 'bg')) await syncBgClips(); if (group.some((m) => m.kind === 'prop')) { await stage.setProps(S.props); for (const m of group) if (m.kind === 'prop') await dbPut('props', m.p); S.dirty = true; } commitClips(); return; }
    const done = io.after?.(); if (done?.then) await done; commitClips();
  };
  const up = () => {
    showSnapLine(null); ghost?.remove(); el.classList.remove('resizing'); el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
    if (!moved) { if (group) { clearMulti(); io.select?.(); } drawClipBar(); return; }                 // a plain click on a selected clip selects just that one
    finish();
  };
  el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}
/** drag the head or tail of a voice line to cut it shorter (or bring back what was cut); later lines slide up, the scene gets shorter */
let voiceMoved = false;
function dragVoice(e, c, mode, el) {
  const line = S.lines.find((l) => l.id === c.id);
  if (!line) return;
  if (isLocked('audio')) { blockedDrag(e, null); return; }
  if (mode === 'move') {
    // slide the line along the timeline: only the silence before it (and after it) changes, so the lines after it stay where they are while there is room
    const at = S.lines.indexOf(line), clips = player.clips, prevEnd = at ? clips[at - 1]?.end ?? 0 : 0, next = S.lines[at + 1], nextGap = next ? clips[at + 1].start - c.end : 0;
    let start = c.start;
    dragItem(e, 'move', el, {
      id: c.id, min: 0.2, room: Infinity,
      get: () => ({ start: c.start, dur: c.end - c.start, off: 0 }),
      set: (r) => { r.start = Math.max(prevEnd, +r.start.toFixed(2)); start = r.start; },
      after: async () => {
        const delta = +(start - c.start).toFixed(2); if (!delta) return;
        voiceMoved = true; setTimeout(() => { voiceMoved = false; }, 250);          // the click that ends a drag must not select / seek
        line.gapBefore = +Math.max(0, c.start - prevEnd + delta).toFixed(2);
        if (next) next.gapBefore = +Math.max(0, nextGap - delta).toFixed(2);
        await retimeAudio(); drawTimeline(); drawLineBox();
      },
    });
    return;
  }
  const whole = c.end - c.start, from = { start: c.start, dur: whole, off: line.trimStart || 0 };
  let result = from;
  dragItem(e, mode, el, {
    id: c.id, min: 0.2, room: line.trimStart || 0,
    get: () => from,
    set: (r) => { result = mode === 'right' ? { ...r, dur: Math.min(r.dur, whole + (line.trimEnd || 0)) } : r; },
    after: async () => {
      if (mode === 'left') line.trimStart = Math.max(0, +result.off.toFixed(2));
      else line.trimEnd = Math.max(0, +((line.trimEnd || 0) + whole - result.dur).toFixed(2));
      await retimeAudio();
    },
  });
}
/** the voice lines changed length: rebuild the timeline, keep the playhead where it was */
async function retimeAudio() {
  const at = player.time; player.pause();
  await prepareStudio({ quiet: true });
  player.seek(Math.min(at, player.total)); S.dirty = true;
}
const selectOnly = (kind, id) => { if (multi.size) { multi.clear(); paintMulti(); } S.mclip = kind === 'clip' ? id : null; S.bgSel = kind === 'bg' ? id : null; S.propSel = kind === 'prop' ? id : null; document.querySelectorAll('.tclip.sel').forEach((x) => x.classList.remove('sel')); drawClipBar(); if (kind === 'clip' && S.tab === 'anim' && S.panelOpen) redrawPanel(); };
function dragClip(e, m, mode, el) {
  dragItem(e, mode === 'size' ? 'right' : mode, el, {
    id: m.id, key: keyOf('clip', m.id), lock: `char:${findManual(m.id)?.s?.key}`,
    get: () => ({ start: m.start, dur: m.dur, off: m.span > 0 ? 1e6 : m.off || 0 }),          // a clip with a span is stretched, not trimmed: its edges can go any way
    set: (r) => { m.start = r.start; m.dur = r.dur; if (!(m.span > 0)) m.off = r.off; },
    select: () => { selectOnly('clip', m.id); el.classList.add('sel'); },
  });
}
/** an automatic one-animation clip (no audio yet) becomes the user's own clip the first time it is dragged, so it can be moved, trimmed or stretched */
function takeSoloBody(s) {
  const o = S.solo[s.key];
  if (!(o?.body && o.bodyLen > 0)) return null;
  const m = { id: uid(), kind: 'body', ref: { ...o.body }, start: 0, dur: o.bodyLen, off: 0 };
  (S.manual[s.key] ||= []).push(m); delete o.body; delete o.bodyLen;
  return m;
}
/** an automatic clip of the voice plan becomes a clip of the user's own (same animation, same time) so it can be moved and resized */
function takeAutoClip(s, kind, c, ref) {
  const m = { id: uid(), kind, ref: { ...ref }, start: +c.start.toFixed(2), dur: +c.dur.toFixed(2), off: +(c.off || 0).toFixed(2) };
  (S.manual[s.key] ||= []).push(m);
  return m;
}
/** the whole-scene background becomes a normal background clip on the same row (the first time it is clicked), so it can be split, trimmed and moved like a prop */
function takeBaseBackground() {
  let c = S.bgClips.find((x) => x.base);
  if (!c) {
    c = { id: uid(), base: true, start: 0, dur: Math.max(1, +player.total.toFixed(2)), preset: stage.bg.preset, bgId: S.bgId || null };
    S.bgClips.push(c);
  }
  selectOnly('bg', c.id); syncBgClips(); commitClips();
}
function dragBgClip(e, c, mode, el) {
  dragItem(e, mode, el, {
    id: c.id, key: keyOf('bg', c.id), lock: 'bg', room: Infinity, off: 0,
    get: () => ({ start: c.start, dur: c.dur, off: 0 }),
    set: (r) => { c.start = r.start; c.dur = r.dur; },
    select: () => { selectOnly('bg', c.id); el.classList.add('sel'); },
    after: () => { syncBgClips(); },
  });
}
/** a prop / effect is visible from start to end; with no end it stays to the end of the scene */
function dragPropRange(e, prop, mode, el) {
  dragItem(e, mode, el, {
    id: prop.id, key: keyOf('prop', prop.id), lock: `prop:${prop.lane || prop.id}`, room: Infinity,
    get: () => { const start = prop.start || 0; return { start, dur: Math.max(MIN_CLIP, (prop.end ?? player.total) - start), off: 0 }; },
    set: (r) => { prop.start = r.start; prop.end = +(r.start + r.dur).toFixed(2); },
    select: () => { selectOnly('prop', prop.id); el.classList.add('sel'); },
    after: () => { stage.setProps(S.props); S.dirty = true; dbPut('props', prop); },
  });
}
/** two arrow buttons that nudge a value by 0.1 s (no typing): ‹ = earlier / shorter, › = later / longer */
const NUDGE = 0.1;
function arrows(label, get, set, after) {
  const go = (d) => { set(get() + d); after(); };
  return h('div', { class: 'cb-arrows', role: 'group', 'aria-label': label }, h('span', {}, label),
    h('button', { type: 'button', class: 'btn sm icon-btn', 'aria-label': label === 'Move' ? 'Move earlier' : 'Shorter', title: label === 'Move' ? 'Move earlier (0.1 s)' : 'Shorter (0.1 s)', onclick: () => go(-NUDGE) }, icon('chevron-left')),
    h('button', { type: 'button', class: 'btn sm icon-btn', 'aria-label': label === 'Move' ? 'Move later' : 'Longer', title: label === 'Move' ? 'Move later (0.1 s)' : 'Longer (0.1 s)', onclick: () => go(NUDGE) }, icon('chevron-right')));
}
const replaceClip = (s, m) => clipPicker(s, async (ref, overlay, length) => { m.ref = { ...ref }; m.kind = ref.layer || (overlay ? 'face' : 'body'); if (length > 0 && ref.source !== 'mode') { m.span = +length.toFixed(3); m.off = 0; } else { delete m.span; if (length) m.dur = Math.max(0.3, +length.toFixed(2)); } const b = busy('Applying…'); try { await applyLayers(); } catch (er) { toast(er.message); } finally { b.done(); } commitClips(); });
/** move the selected clip (which = 'start') or make it longer / shorter (which = 'dur') by `delta` seconds: the arrows of the bottom bar on a phone */
function nudgeSelected(which, delta) {
  const it = selectedItem(); if (!it) return;
  const r = (v) => +v.toFixed(2);
  if (it.kind === 'clip') { const m = it.f.m; if (which === 'start') m.start = Math.max(0, r(m.start + delta)); else m.dur = Math.max(0.2, r(m.dur + delta)); setTimeout(commitClips, 0); }
  else if (it.kind === 'bg') { const c = it.bc; if (which === 'start') c.start = Math.max(0, r(c.start + delta)); else c.dur = Math.max(MIN_CLIP, r(c.dur + delta)); syncBgClips(); setTimeout(commitClips, 0); }
  else if (it.kind === 'prop') {
    const pr = it.pr, len = (pr.end ?? player.total) - (pr.start || 0);
    if (which === 'start') { pr.start = Math.max(0, r((pr.start || 0) + delta)); if (pr.end != null) pr.end = r(pr.start + len); } else pr.end = r((pr.start || 0) + Math.max(MIN_CLIP, len + delta));
    stage.setProps(S.props); dbPut('props', pr); setTimeout(commitClips, 0);
  }
}
/** true when a clip, background clip, prop or group was selected (and now is not): choosing a character, or tapping empty space, leaves the clip tools */
const dropItemSelection = () => { if (!(S.mclip || S.bgSel || S.propSel || multi.size)) return false; S.mclip = S.bgSel = S.propSel = null; clearMulti(); drawTimeline(); drawClipBar(); return true; };
const clearClipSelection = () => { S.bgReplace = null; S.mclip = null; S.bgSel = null; S.propSel = null; clearMulti(); drawTimeline(); drawClipBar(); };
/** phone: what you can do with the selected clip (Split, Copy, Duplicate, Path, Delete and a More list) sits in the bottom bar, in place of the menu, instead of rows at the top */
/** Crop of a background clip: zoom into the picture and choose which part stays in the frame */
function openBgCrop(c) {
  if (!c) return;
  const xf = bgXf(c), range = () => Math.max(0, (xf.s - 1) / 2);
  const zoom = h('input', { type: 'range', min: 100, max: 300, value: Math.round(Math.max(1, xf.s) * 100), 'aria-label': 'Zoom' });
  const px = h('input', { type: 'range', min: -100, max: 100, value: 0, 'aria-label': 'Left / right' }), py = h('input', { type: 'range', min: -100, max: 100, value: 0, 'aria-label': 'Up / down' });
  const sync = () => { const r = range(); px.value = r ? Math.round(xf.x / r * 100) : 0; py.value = r ? Math.round(xf.y / r * 100) : 0; px.disabled = py.disabled = !r; };
  const apply = () => { const r = range(); xf.x = +(px.value / 100 * r).toFixed(4); xf.y = +(py.value / 100 * r).toFixed(4); pushBg(c); };
  zoom.addEventListener('input', () => { xf.s = clampBgScale(Math.max(1, zoom.value / 100)); const r = range(); xf.x = Math.max(-r, Math.min(r, xf.x)); xf.y = Math.max(-r, Math.min(r, xf.y)); sync(); pushBg(c); });
  px.addEventListener('input', apply); py.addEventListener('input', apply);
  if (xf.s < 1) { xf.s = 1; xf.x = xf.y = 0; pushBg(c); }
  sync();
  const row = (label, input) => h('label', { class: 'cb-field' }, h('span', {}, label), input);
  const close = modal('Crop background', h('div', {}, row('Zoom', zoom), row('Left / right', px), row('Up / down', py),
    h('div', { class: 'row', style: 'margin-top:10px;gap:8px' }, h('button', { type: 'button', class: 'btn sm', onclick: () => { xf.s = 1; xf.x = xf.y = 0; zoom.value = 100; sync(); pushBg(c); } }, 'Reset'), h('span', { class: 'sp' }), h('button', { type: 'button', class: 'btn sm pri', onclick: () => close() }, 'Done'))));
}
/** Replace: the next background picked in the Background tab takes the place of this clip's picture (same time and length) */
function replaceBg(c) {
  if (!c) return;
  S.bgReplace = c.id; openTab('canvas'); toast('Pick the new background: it replaces the selected one.');
}
async function replaceBgWith(rec, preset) {
  const c = S.bgClips.find((x) => x.id === S.bgReplace); S.bgReplace = null; if (!c) return false;
  c.bgId = rec?.id ?? null; c.preset = preset ?? 0; c.xf = null;
  await syncBgClips(); S.dirty = true; commitClips(); drawTabs(); return true;
}
/** the Path tool has its own bottom bar (like a text tool in a video editor): what you can do while the path is being edited */
function drawPathNav() {
  const key = S.pathDraw.key, has = !!S.paths[key], sig = `path|${key}|${has}`;
  clipNav.hidden = false; if (clipNav.dataset.sig === sig) return; clipNav.dataset.sig = sig;
  const btn = (ic, text, onclick, extra = {}) => h('button', { type: 'button', class: 'cb-btn', title: text, 'aria-label': text, onclick, ...extra }, icon(ic), h('span', {}, text));
  clipNav.replaceChildren(h('div', { class: 'cb-list' },
    btn('x', 'Cancel', () => S.pathDraw?.cancel()),
    btn('rotate', 'Bring back', () => S.pathDraw?.bringBack(), { title: 'Bring the shadow back into the picture' }),
    ...(has ? [btn('trash', 'Remove path', () => { const k = S.pathDraw?.key; S.pathDraw?.cancel(); if (k) { delete S.paths[k]; applyPath(k); drawTimeline(); drawClipBar(); } }, { class: 'cb-btn danger' })] : []),
    btn('check', 'Done', () => S.pathDraw?.finish(), { class: 'cb-btn on' })));
}
function drawClipNav() {
  if (!clipNav) return;
  if (S.pathDraw) { drawPathNav(); return; }
  const many = multi.size >= 2, it = selectedItem();
  if (!it && !many) { clipNav.hidden = true; clipNav.dataset.sig = ''; return; }
  const f = S.mclip && findManual(S.mclip), s = f?.s, m = f?.m, kind = many ? 'multi' : it.kind, canNudge = !many && ['clip', 'bg', 'prop'].includes(kind);
  const hasPath = !!(s && m && S.paths[s.key]?.clipId === m.id), inPath = !!(s && S.pathDraw?.key === s.key), sig = [kind, m?.id, !!S.clipboard, hasPath, S.sel ? 1 : 0, m?.kind, inPath].join('|');
  clipNav.hidden = false;
  if (clipNav.dataset.sig === sig) return;
  clipNav.dataset.sig = sig;
  const btn = (ic, text, onclick, extra = {}) => h('button', { type: 'button', class: 'cb-btn', title: text, 'aria-label': text, onclick, ...extra }, icon(ic), h('span', {}, text));
  const nudge = (label, which) => h('div', { class: 'cb-nudge' }, h('span', {}, label),
    h('button', { type: 'button', class: 'btn sm icon-btn', 'aria-label': which === 'start' ? 'Move earlier' : 'Shorter', onclick: () => nudgeSelected(which, -NUDGE) }, icon('chevron-left')),
    h('button', { type: 'button', class: 'btn sm icon-btn', 'aria-label': which === 'start' ? 'Move later' : 'Longer', onclick: () => nudgeSelected(which, NUDGE) }, icon('chevron-right')));
  clipNav.replaceChildren(
    h('div', { class: 'cb-list' },
      btn('scissors', 'Split', splitSelected, { disabled: many }), btn('copy', 'Copy', copySelected),
      ...(kind === 'bg' ? [btn('log', 'Objects', () => openTab('props'), { title: 'Objects (stone, tree ...): pick one to put on the scene' }), btn('crop', 'Crop', () => openBgCrop(it.bc)), btn('swap', 'Replace', () => replaceBg(it.bc))] : []),
      ...(kind === 'clip' && m?.kind === 'body' && s ? [btn('route', 'Path', () => startPathShadow(s), inPath ? { class: 'cb-btn on', 'aria-pressed': 'true' } : {})] : []),
      ...(kind === 'clip' && s ? [btn('swap', 'Replace', () => replaceClip(s, m))] : []),
      ...(kind !== 'bg' && kind !== 'clip' ? [btn('layers', 'Duplicate', duplicateSelected)] : []),
      btn('trash', 'Delete', deleteSelected, { class: 'cb-btn danger' })),
    h('details', { class: 'char-more' },
      h('summary', { title: 'More', 'aria-label': 'More clip tools' }, icon('more'), h('span', {}, 'More')),
      h('div', { class: 'cb-more-list' },
        ...(canNudge ? [nudge('Move', 'start'), nudge('Length', 'dur')] : []),
        btn('paste', 'Paste', pasteClip, { disabled: !S.clipboard }), btn('skip-back', 'Prev', () => jumpEdge(-1)), btn('skip-forward', 'Next', () => jumpEdge(1)),
        ...(kind === 'bg' || kind === 'clip' ? [btn('layers', 'Duplicate', duplicateSelected)] : []),
        ...(hasPath ? [btn('x', 'Remove path', () => { delete S.paths[s.key]; applyPath(s.key); drawTimeline(); drawClipBar(); })] : []),
        ...(kind === 'clip' && S.sel ? [btn('users', 'Character', () => { S.mclip = null; drawTimeline(); drawClipBar(); })] : []),
        btn('x', 'Done', clearClipSelection, { 'aria-label': 'Close the clip tools' }))));
}
function drawClipBar() {
  updateEditTools(); updateBgSel(); drawClipNav();
  if (!clipBar) return;
  clipBar.classList.toggle('locked', selectedLocked());
  const bc = S.bgSel && S.bgClips.find((x) => x.id === S.bgSel), pr = !bc && S.propSel && S.props.find((x) => x.id === S.propSel);
  if (bc || pr) return rangeBar(bc, pr);
  const f = S.mclip && findManual(S.mclip);
  if (!f) { clipBar.hidden = true; return; }
  const { s, m, list } = f;
  const num = (label, get, set) => h('label', { class: 'cb-n' }, label, h('input', { type: 'number', step: 0.05, min: 0, value: get().toFixed(2), onchange: (e) => { set(+e.target.value || 0); setTimeout(commitClips, 0); } }));
  const btn = (txt, fn, title) => h('button', { class: `btn sm${/Delete/.test(txt) ? ' cb-del' : ''}`, title, onclick: fn }, txt);
  clipBar.hidden = false;
  clipBar.replaceChildren(
    
    arrows('Move', () => m.start, (v) => { m.start = Math.max(0, +v.toFixed(2)); }, () => setTimeout(commitClips, 0)), arrows('Length', () => m.dur, (v) => { m.dur = Math.max(0.2, +v.toFixed(2)); }, () => setTimeout(commitClips, 0)),
    btn('⇄ Replace', () => replaceClip(s, m), 'Pick another animation for this clip'),
    ...(m.kind === 'body' ? [h('button', { type: 'button', class: 'btn sm walk-to', title: 'Path: drag the character\'s shadow to where it should go', onclick: () => startPathShadow(s) }, icon('route'), h('span', {}, 'Path')) ] : []),
    ...(S.paths[s.key]?.clipId === m.id ? [h('button', { type: 'button', class: 'btn sm path-remove', title: 'Remove the path of this animation', onclick: () => { delete S.paths[s.key]; applyPath(s.key); drawTimeline(); drawClipBar(); } }, icon('x'), h('span', {}, 'Path')) ] : []),
    btn('🗑 Delete', deleteSelected, 'Remove this animation: the character goes back to idle'),
    btn('✕', () => { S.mclip = null; drawTimeline(); }, 'Close'));
}

/** copy the selected timeline item (animation clip, background clip, prop / effect); paste puts a copy at the playhead */
function copySelected() {
  if (multi.size >= 2) return copyMulti();
  const f = S.mclip && findManual(S.mclip), bc = S.bgSel && S.bgClips.find((x) => x.id === S.bgSel), pr = S.propSel && S.props.find((x) => x.id === S.propSel);
  if (f) S.clipboard = { type: 'clip', key: f.s?.key, data: clone(f.m) };
  else if (bc) S.clipboard = { type: 'bg', data: clone(bc) };
  else if (pr) S.clipboard = { type: 'prop', data: { ...pr } };
  else if (S.lineSel && lineModel(S.lineSel)) S.clipboard = { type: 'line', data: { id: S.lineSel } };      // an audio line is copied by reference to its sound
  else { toast('Please choose a clip on the timeline first, then copy it.'); return false; }
  // the hint is shown the first time only (and kept short); after that the Paste button / Ctrl+V are enough
  try { if (!localStorage.getItem('toons-hint-copy')) { localStorage.setItem('toons-hint-copy', '1'); toast('Copied. Move the playhead, then Paste.'); } } catch { /* no hint */ }
  drawClipBar(); return true;
}
/* ---------- the always-visible edit toolbar: split / copy / paste / duplicate / delete / jump between clips ---------- */
/** is the one selected item on a locked layer? */
const selectedLocked = () => { if (multi.size >= 2) return false; if (S.mclip) return isKeyLocked(keyOf('clip', S.mclip)); if (S.bgSel) return isLocked('bg'); if (S.propSel) return isKeyLocked(keyOf('prop', S.propSel)); if (S.lineSel && !S.mclip) return isLocked('audio'); return false; };
const selectedItem = () => {
  const f = S.mclip && findManual(S.mclip), bc = S.bgSel && S.bgClips.find((x) => x.id === S.bgSel), pr = S.propSel && S.props.find((x) => x.id === S.propSel);
  if (f) return { kind: 'clip', f };
  if (bc) return { kind: 'bg', bc };
  if (pr) return { kind: 'prop', pr };
  const line = S.lineSel && lineById(S.lineSel);          // nothing else is picked: the audio line under the playhead
  return line ? { kind: 'line', line } : null;
};
/* ---- audio lines in the edit toolbar: split at the playhead, duplicate, delete, copy / paste ---- */
const lineModel = (id) => S.lines.find((l) => l.id === id);
/** the mixing settings of a line that differ from the defaults: mute, solo, volume (1 = unchanged), fade in / out in seconds */
const mixOf = (l) => ({ ...(l.muted ? { muted: true } : {}), ...(l.solo ? { solo: true } : {}), ...(Number.isFinite(l.volume) && l.volume !== 1 ? { volume: l.volume } : {}), ...(l.fadeIn > 0 ? { fadeIn: l.fadeIn } : {}), ...(l.fadeOut > 0 ? { fadeOut: l.fadeOut } : {}) });
/** a copy of an audio line that shares the sound but is its own line (own script text, camera shot and character choices) */
function copyOfLine(src, patch = {}) {
  const id = crypto.randomUUID(), copy = { ...src, ...patch, id };
  if (S.script.has(src.id)) S.script.set(id, S.script.get(src.id));
  if (S.cast.has(src.id)) S.cast.set(id, clone(S.cast.get(src.id)));
  if (S.shots.has(src.id)) S.shots.set(id, clone(S.shots.get(src.id)));
  return copy;
}
/** after the audio lines changed: split / duplicate / paste keep the zoom and the playhead; a delete also refreshes the speakers */
async function lineEdited(selectId, { full = false } = {}) {
  S.lineSel = selectId; S.mclip = S.bgSel = S.propSel = null;
  if (full) await afterAudioChange();
  else { await retimeAudio(); drawTimeline(); drawLineBox(); drawTabs(); }
  drawClipBar(); S.dirty = true;
}
async function splitLine(c) {
  const t = player.time, line = lineModel(c.id);
  if (!line || t <= c.start + 0.1 || t >= c.end - 0.1) { toast('Move the playhead inside the audio first, then press Split.'); return; }
  const cut = +((line.trimStart || 0) + (t - c.start)).toFixed(3), second = copyOfLine(line, { trimStart: cut, trimEnd: line.trimEnd || 0, gapBefore: 0, fadeIn: 0 });
  line.fadeOut = 0;                                                   // the fade-in stays on the first part and the fade-out on the second          // the two parts touch: no pause is added at the cut
  line.trimEnd = +Math.max(0, line.buffer.duration - cut).toFixed(3);       // the first part now ends at the playhead
  S.lines.splice(S.lines.indexOf(line) + 1, 0, second);
  await lineEdited(second.id); player.seek(Math.min(t, player.total)); followLine();
}
async function duplicateLine(c) {
  const line = lineModel(c.id); if (!line) return;
  const copy = copyOfLine(line); S.lines.splice(S.lines.indexOf(line) + 1, 0, copy); await lineEdited(copy.id);
}
async function deleteLine(c) {
  const index = S.lines.findIndex((l) => l.id === c.id); if (index < 0) return;
  S.lines.splice(index, 1); await lineEdited((S.lines[index] || S.lines[index - 1])?.id ?? null, { full: true });
}
async function splitSelected() {
  if (selectedLocked()) { lockedToast(); return; }
  if (multi.size >= 2) { toast('Split works on one clip. Click a single clip first.'); return; }
  const it = selectedItem();
  if (!it) { toast('Choose a clip on the timeline first, then press Split.'); return; }
  if (it.kind === 'line') { await splitLine(it.line); return; }
  const t = player.time, inside = (a, b) => t > a + 0.1 && t < b - 0.1;
  if (it.kind === 'clip') {
    const { m, list } = it.f; if (!inside(m.start, m.start + m.dur)) { toast('Move the playhead inside the clip first.'); return; }
    const at = snap(t), r = rateOf(m), c = { ...m, id: uid(), ref: { ...m.ref }, start: at, dur: m.start + m.dur - at, off: (m.off || 0) + (at - m.start) * r };
    if (m.span > 0) { c.span = +(m.span - (at - m.start) * r).toFixed(3); m.span = +((at - m.start) * r).toFixed(3); }          // each half keeps its part of the animation at the same speed
    m.dur = at - m.start; list.push(c); S.mclip = c.id; commitClips(); return;
  }
  if (it.kind === 'bg') {
    const bc = it.bc; if (!inside(bc.start, bc.start + bc.dur)) { toast('Move the playhead inside the clip first.'); return; }
    const at = snapTo(t), c = { ...clone(bc), id: uid(), start: at, dur: +(bc.start + bc.dur - at).toFixed(2) };
    bc.dur = +(at - bc.start).toFixed(2); S.bgClips.push(c); selectOnly('bg', c.id); await syncBgClips(); commitClips(); return;
  }
  const pr = it.pr, start = pr.start || 0, end = pr.end ?? player.total; if (!inside(start, end)) { toast('Move the playhead inside the clip first.'); return; }
  const at = snapTo(t), c = { ...pr, id: uid(), start: at, end: +end.toFixed(2) };
  if (pr.attach) c.attach = { ...pr.attach };
  c.lane = pr.lane = pr.lane || pr.id;                       // the new piece stays on the same row
  pr.start = start; pr.end = +at.toFixed(2); S.props.push(c); selectOnly('prop', c.id);
  await dbPut('props', pr); await dbPut('props', c); await stage.setProps(S.props); S.dirty = true; commitClips();
}
async function duplicateSelected() {
  if (selectedLocked()) { lockedToast(); return; }
  if (multi.size >= 2) { const items = multiResolve(), end = Math.max(...items.map((m) => { const f = m.get(); return f.start + f.dur; })); if (copyMulti()) await pasteMulti(+end.toFixed(2)); return; }
  const it = selectedItem(); if (!it) { toast('Choose a clip on the timeline first.'); return; }
  if (it.kind === 'line') { await duplicateLine(it.line); return; }
  if (it.kind === 'clip') { const { m, list } = it.f, c = { ...m, id: uid(), ref: { ...m.ref }, start: snap(m.start + m.dur) }; list.push(c); S.mclip = c.id; commitClips(); return; }
  if (it.kind === 'bg') { const bc = it.bc, c = { ...clone(bc), id: uid(), start: +(bc.start + bc.dur).toFixed(2) }; S.bgClips.push(c); selectOnly('bg', c.id); await syncBgClips(); commitClips(); return; }
  const pr = it.pr, len = Math.max(MIN_CLIP, (pr.end ?? player.total) - (pr.start || 0)), at = +((pr.end ?? player.total)).toFixed(2), c = { ...pr, id: uid(), start: at, end: +(at + len).toFixed(2) };
  if (pr.attach) c.attach = { ...pr.attach };
  c.lane = pr.lane = pr.lane || pr.id;
  S.props.push(c); selectOnly('prop', c.id); await dbPut('props', pr); await dbPut('props', c); await stage.setProps(S.props); S.dirty = true; commitClips();
}
async function deleteSelected() {
  if (selectedLocked()) { lockedToast(); return; }
  if (multi.size >= 2) { await deleteMulti(); return; }
  const it = selectedItem(); if (!it) { toast('Choose a clip on the timeline first.'); return; }
  if (it.kind === 'line') { await deleteLine(it.line); return; }
  if (it.kind === 'clip') { it.f.list.splice(it.f.list.indexOf(it.f.m), 1); S.mclip = null; commitClips(); return; }
  if (it.kind === 'bg') { S.bgClips = S.bgClips.filter((x) => x !== it.bc); S.bgSel = null; await syncBgClips(); commitClips(); return; }
  await dbDel('props', it.pr.id); S.props = S.props.filter((p) => p.id !== it.pr.id); S.propSel = null; await stage.setProps(S.props); S.dirty = true; commitClips();
}
/** every start / end of a clip on the timeline, sorted: "previous / next edit" jumps between them */
function clipEdges() {
  const edges = new Set([0, +player.total.toFixed(2)]);
  for (const list of Object.values(S.manual || {})) for (const m of list || []) { edges.add(+m.start.toFixed(2)); edges.add(+(m.start + m.dur).toFixed(2)); }
  for (const c of S.bgClips) { edges.add(+c.start.toFixed(2)); edges.add(+(c.start + c.dur).toFixed(2)); }
  for (const pr of S.props) { edges.add(+(pr.start || 0).toFixed(2)); if (pr.end != null) edges.add(+pr.end.toFixed(2)); }
  return [...edges].sort((a, b) => a - b);
}
function jumpEdge(dir) {
  const t = player.time, edges = clipEdges(), next = dir > 0 ? edges.find((e) => e > t + 0.02) : [...edges].reverse().find((e) => e < t - 0.02);
  if (next != null) { player.seek(next); S.dirty = true; }
}
let editBtns = {};
function editTools() {
  const b = (key, label, ic, fn, tip, cls = '') => (editBtns[key] = h('button', { type: 'button', class: `edit-btn edit-${key} ${cls}`, title: tip, 'aria-label': tip, onclick: fn }, icon(ic), h('span', {}, label)));
  return h('div', { class: 'edittools', role: 'toolbar', 'aria-label': 'Edit the selected clip' },
    b('prev', 'Prev', 'skip-back', () => jumpEdge(-1), 'Jump to the previous clip edge'), b('next', 'Next', 'skip-forward', () => jumpEdge(1), 'Jump to the next clip edge'),
    b('split', 'Split', 'scissors', splitSelected, 'Cut the selected clip at the playhead', 'needs-sel'),
    b('copy', 'Copy', 'copy', copySelected, 'Copy the selected clip (Ctrl+C)', 'needs-sel'), b('paste', 'Paste', 'paste', pasteClip, 'Paste at the playhead (Ctrl+V)'),
    b('dup', 'Duplicate', 'layers', duplicateSelected, 'Add the same clip again, right after this one', 'needs-sel'),
    b('del', 'Delete', 'trash', deleteSelected, 'Delete the selected clip', 'needs-sel del'));
}
function updateEditTools() {
  const many = multi.size >= 2, has = !!selectedItem() || many;
  for (const el of Object.values(editBtns)) if (el?.classList.contains('needs-sel')) { el.disabled = !has; }
  if (editBtns.split) editBtns.split.disabled = many || !has;
  if (editBtns.paste) editBtns.paste.disabled = !S.clipboard;
  drawClipNav();
}

async function pasteClip() {
  const cb = S.clipboard;
  if (!cb) { toast('Please copy a clip first.'); return; }
  const at = snapTo(player.time);
  if (cb.type === 'multi') { await pasteMulti(at); return; }
  if (cb.type === 'line') {
    const src = lineModel(cb.data.id); if (!src) { toast('The copied audio line is no longer in the scene.'); return; }
    const here = S.lines.findIndex((l) => l.id === lineAt(player.time)?.id), copy = copyOfLine(src);
    S.lines.splice(here >= 0 ? here + 1 : S.lines.length, 0, copy); await lineEdited(copy.id); return;
  }
  if (cb.type === 'clip') {
    const s = sOf(cb.key) || S.speakers.find((x) => x.charId);
    if (!s?.charId) { toast('The character for this clip is not in the scene.'); return; }
    const m = { ...clone(cb.data), id: uid(), start: at }; (S.manual[s.key] ||= []).push(m); selectOnly('clip', m.id);
    const b = busy('Pasting clip…'); try { await applyLayers(); } catch (e) { toast(`Could not paste the clip: ${e.message}`); } finally { b.done(); }
  } else if (cb.type === 'bg') {
    const c = { ...clone(cb.data), id: uid(), start: at }; S.bgClips.push(c); selectOnly('bg', c.id); await syncBgClips();
  } else {
    const len = Math.max(MIN_CLIP, (cb.data.end ?? player.total) - (cb.data.start || 0)), prop = { ...cb.data, id: uid(), start: at, end: +(at + len).toFixed(2) };
    if (cb.data.attach) prop.attach = { ...cb.data.attach };
    S.props.push(prop); selectOnly('prop', prop.id); await dbPut('props', prop); await stage.setProps(S.props);
  }
  updateTotal(); S.dirty = true; drawTimeline(); refreshPresence();
}
/** the bar under the timeline for a selected background clip or prop / effect: exact start and length */
function rangeBar(bc, pr) {
  const num = (label, get, set) => h('label', { class: 'cb-n' }, label, h('input', { type: 'number', step: 0.05, min: 0, value: get().toFixed(2), onchange: (e) => { set(+e.target.value || 0); if (bc) syncBgClips(); else { stage.setProps(S.props); dbPut('props', pr); } setTimeout(commitClips, 0); } }));
  const btn = (txt, fn, title) => h('button', { class: `btn sm${/Delete/.test(txt) ? ' cb-del' : ''}`, title, onclick: fn }, txt);
  const name = bc ? (bc.bgId ? S.myBgs.find((r) => r.id === bc.bgId)?.name || 'Background image' : (BACKGROUNDS[bc.preset] || BACKGROUNDS[0]).name) : pr.name;
  clipBar.hidden = false;
  clipBar.replaceChildren(
    arrows('Move', () => (bc ? bc.start : pr.start || 0), (v) => { if (bc) bc.start = Math.max(0, +v.toFixed(2)); else { const len = (pr.end ?? player.total) - (pr.start || 0); pr.start = Math.max(0, +v.toFixed(2)); if (pr.end != null) pr.end = +(pr.start + len).toFixed(2); } }, () => { if (bc) syncBgClips(); else { stage.setProps(S.props); dbPut('props', pr); } setTimeout(commitClips, 0); }),
    arrows('Length', () => (bc ? bc.dur : (pr.end ?? player.total) - (pr.start || 0)), (v) => { if (bc) bc.dur = Math.max(MIN_CLIP, +v.toFixed(2)); else pr.end = +((pr.start || 0) + Math.max(MIN_CLIP, v)).toFixed(2); }, () => { if (bc) syncBgClips(); else { stage.setProps(S.props); dbPut('props', pr); } setTimeout(commitClips, 0); }),
    ...(bc ? [] : [btn('↔ Whole scene', () => { delete pr.start; delete pr.end; stage.setProps(S.props); dbPut('props', pr); S.dirty = true; commitClips(); }, 'Remove start / end: show through the whole scene')]),
    btn('🗑 Delete', deleteSelected, bc ? 'Remove this background clip' : 'Remove this prop'),
    btn('✕', () => { S.bgSel = null; S.propSel = null; clipBar.hidden = true; drawTimeline(); }, 'Close'));
}

/* ---------- movement keyframes of a character (position, size, facing) ---------- */
let tlTimer = 0;
const scheduleTl = () => { clearTimeout(tlTimer); tlTimer = setTimeout(() => drawTimeline(), 220); };
function syncChars() {
  if (!stage?.layers) return;
  for (const s of S.speakers) if (s.charId) stage.setLayerKeys(s.key, S.charKeys[s.key] || []);
  if (S.step === 3) updateTotal(); S.dirty = true;
}
/** where a character is right now, as key values */
function charNow(key) {
  const l = stage.layers.find((x) => x.key === key);
  if (!l?.anchor) return null;
  return { x: l.axf ?? l.anchor.x / stage.W, y: l.ayf ?? (stage.H - l.anchor.y) / stage.H, mul: l.mul ?? 1, flip: !!l.flip };
}
function writeCharKey(l, patch = {}) {
  const t = +player.time.toFixed(2), list = (S.charKeys[l.key] ||= []);
  let k = list.find((x) => Math.abs(x.t - t) < 0.06);
  if (!k) { k = { id: uid(), t, ease: 'smooth' }; list.push(k); }
  const now = charNow(l.key);
  Object.assign(k, now, patch); S.ckSel = k.id;
  stage.setLayerKeys(l.key, list); S.dirty = true; scheduleTl();
  return k;
}
function dragCharKey(e, s, k, d) {
  if (S.exporting) return;
  e.preventDefault(); e.stopPropagation();
  S.ckSel = k.id; S.motionFor = s.key; player.seek(Math.min(player.total, k.t)); S.dirty = true;
  const x0 = e.clientX, t0 = k.t, pps = S.pps; d.setPointerCapture(e.pointerId);
  const mv = (ev) => { k.t = Math.max(0, +snap(t0 + (ev.clientX - x0) / pps).toFixed(2)); d.style.left = `${k.t * pps}px`; stage.setLayerKeys(s.key, S.charKeys[s.key]); S.dirty = true; };
  const up = () => { d.removeEventListener('pointermove', mv); d.removeEventListener('pointerup', up); d.removeEventListener('pointercancel', up); updateTotal(); player.seek(Math.min(player.total, k.t)); drawTimeline(); if (S.tab === 'motion') drawTabs(); };
  d.addEventListener('pointermove', mv); d.addEventListener('pointerup', up); d.addEventListener('pointercancel', up);
  if (S.tab === 'motion') drawTabs();
}
function tabMotion() {
  const chars = S.order.map(sOf).filter((x) => x?.charId);
  if (!chars.length) return h('p', { class: 'sub' }, 'No character on stage. Add one in the Characters tab.');
  if (!chars.some((x) => x.key === S.motionFor)) S.motionFor = (chars.find((x) => x.key === S.animFor) || chars[0]).key;
  const s = sOf(S.motionFor), list = (S.charKeys[s.key] || []).slice().sort((a, b) => a.t - b.t), k = list.find((x) => x.id === S.ckSel) || null;
  const segb = (items, cur, on) => h('div', { class: 'seg' }, items.map(([key, l]) => h('button', { class: String(cur()) === String(key) ? 'on' : '', onclick: () => { on(key); drawTabs(); } }, l)));
  const apply = () => { stage.setLayerKeys(s.key, S.charKeys[s.key]); S.dirty = true; scheduleTl(); };
  const sl = (label, get, set, min, max, step, show) => { const out = h('span', { class: 'v' }, show(get())), input = h('input', { type: 'range', min, max, step, value: get() }); input.addEventListener('input', () => { set(+input.value); out.textContent = show(+input.value); apply(); }); input.addEventListener('change', () => drawTabs()); return h('label', { class: 'cs-sl' }, h('span', {}, label), input, out); };
  const goto = (key) => { S.ckSel = key.id; player.seek(Math.min(player.total, key.t)); S.dirty = true; drawTabs(); };
  const addHere = () => { const l = stage.layers.find((x) => x.key === s.key); if (!l) return; writeCharKey(l); drawTabs(); };
  return h('div', { class: 'list' },
    h('div', { class: 'tabs' }, chars.map((c) => h('button', { class: c.key === s.key ? 'on' : '', onclick: () => { S.motionFor = c.key; S.sel = c.key; updateSel(); drawTabs(); } }, h('span', { class: 'dot', style: `background:${c.color};display:inline-block;margin-right:6px` }), c.name))),
    h('div', { class: 'card flat' }, h('h2', {}, `🏃 Movement keyframes · ${s.name}`),
      h('p', { class: 'sub', style: 'font-size:12px;margin:0 0 8px' }, list.length ? 'The character follows its keyframes. Move the playhead, then drag or resize the character on the stage — a keyframe is made there. A character holds its first / last keyframe before / after them.' : 'Now the character stays where you put it. Press ＋ Keyframe here to start: set the first position, then move the playhead and drag the character somewhere else.'),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, h('button', { class: 'btn ok', onclick: addHere }, '＋ Keyframe here'),
        list.length ? h('button', { class: 'btn', onclick: () => { if (confirm(`Delete all keyframes of ${s.name}? The character stays where it is now.`)) { const now = charNow(s.key); delete S.charKeys[s.key]; stage.setLayerKeys(s.key, []); const l = stage.layers.find((x) => x.key === s.key); if (l && now) { l.axf = now.x; l.ayf = now.y; l.mul = now.mul; l.flip = now.flip; saveXf(l); stage.layout(); } S.ckSel = null; drawTimeline(); drawTabs(); S.dirty = true; } } }, 'Clear all') : null)),
    k ? h('div', { class: 'card flat' }, h('h2', {}, `Keyframe at ${k.t.toFixed(2)} s`),
      sl('Left ↔ right', () => k.x, (v) => { k.x = v; }, -0.2, 1.2, 0.005, (v) => `${Math.round(v * 100)}%`),
      sl('Height (feet)', () => k.y, (v) => { k.y = v; }, -0.3, 0.8, 0.005, (v) => `${Math.round(v * 100)}%`),
      sl('Size', () => k.mul, (v) => { k.mul = v; }, 0.2, 4, 0.02, (v) => `${Math.round(v * 100)}%`),
      h('label', { class: 'tog' }, h('input', { type: 'checkbox', checked: !!k.flip, onchange: (e) => { k.flip = e.target.checked; apply(); } }), '⇋ Face the other way from here'),
      h('div', { class: 'cb-ease' }, h('span', {}, 'Move to the next keyframe'), segb([['smooth', 'Smooth'], ['linear', 'Even'], ['in', 'Slow start'], ['out', 'Slow end'], ['hold', 'Jump']], () => k.ease || 'smooth', (v) => { k.ease = v; apply(); })),
      h('label', { class: 'cs-sl' }, h('span', {}, 'Time (s)'), h('input', { type: 'number', step: 0.05, min: 0, value: k.t.toFixed(2), onchange: (e) => { k.t = Math.max(0, +(+e.target.value || 0).toFixed(2)); apply(); updateTotal(); player.seek(Math.min(player.total, k.t)); drawTimeline(); drawTabs(); } })),
      h('div', { class: 'row', style: 'gap:6px' }, h('button', { class: 'btn', onclick: () => { const c = { ...k, id: uid(), t: +(k.t + 1).toFixed(2) }; S.charKeys[s.key].push(c); S.ckSel = c.id; apply(); updateTotal(); player.seek(Math.min(player.total, c.t)); drawTimeline(); drawTabs(); } }, '⧉ Copy 1 s later'),
        h('button', { class: 'btn', onclick: () => { S.charKeys[s.key] = S.charKeys[s.key].filter((x) => x !== k); if (!S.charKeys[s.key].length) delete S.charKeys[s.key]; stage.setLayerKeys(s.key, S.charKeys[s.key] || []); S.ckSel = null; drawTimeline(); drawTabs(); S.dirty = true; } }, '🗑 Delete'))) : null,
    h('div', { class: 'card flat' }, h('h2', {}, `Keyframes (${list.length})`),
      list.length ? list.map((x, i) => h('div', { class: `item ${x.id === S.ckSel ? 'on' : ''}`, style: 'cursor:pointer', onclick: () => goto(x) }, h('span', { class: 'chip' }, i + 1), h('b', {}, `${x.t.toFixed(2)} s`), h('small', { style: 'margin-left:8px' }, `${Math.round(x.x * 100)}% · ${Math.round(x.mul * 100)}% · ${x.ease || 'smooth'}${x.flip ? ' · ⇋' : ''}`))) : h('p', { class: 'sub', style: 'font-size:12px;margin:0' }, 'None yet.')));
}

/* ---------- colour grading of the whole scene ---------- */
/** the grade the viewer sees at the playhead (the scene's grade, or the keyed one) */
const gradeNow = () => gradeAt(S.gradeKeys, player ? player.time : 0, S.grade);
const syncGrade = () => { if (stage) { stage.grade = gradeActive(S.grade) ? S.grade : null; stage.gradeKeys = S.gradeKeys; } S.dirty = true; };
/** change the scene's grade (patch = some controls); `replace` starts again from neutral first. With keys on the timeline the key at the playhead is edited (made if missing) */
function setGrade(patch, replace = false) {
  if (S.gradeKeys.length && !replace) {
    const t = +player.time.toFixed(2);
    let k = S.gradeKeys.find((x) => Math.abs(x.t - t) < 0.06);
    if (!k) { k = { id: uid(), t, grade: cleanGrade(gradeNow()) }; S.gradeKeys.push(k); }
    k.grade = cleanGrade({ ...k.grade, ...patch }); S.gradeSel = k.id; syncGrade(); scheduleTl();
    return;
  }
  S.grade = cleanGrade({ ...(replace ? DEFAULT_GRADE : S.grade), ...patch });
  syncGrade();
}
let gradeFields = new Map(), gradeSeen = -1;
/** sliders follow the playhead when the grade is keyed over time */
const refreshGradeFields = () => { const g = gradeNow(); for (const [key, { input, num }] of gradeFields) { input.value = g[key]; num.value = +g[key].toFixed(2); } };
function addGradeKey() {
  const t = +player.time.toFixed(2);
  let k = S.gradeKeys.find((x) => Math.abs(x.t - t) < 0.06);
  if (!k) { k = { id: uid(), t, grade: cleanGrade(gradeNow()) }; S.gradeKeys.push(k); }
  S.gradeSel = k.id; syncGrade(); updateTotal(); drawTimeline(); drawTabs();
}
function dragGradeKey(e, k, d) {
  if (S.exporting) return;
  e.preventDefault(); e.stopPropagation();
  S.gradeSel = k.id; player.seek(Math.min(player.total, k.t)); S.dirty = true;
  const x0 = e.clientX, t0 = k.t, pps = S.pps; let moved = false;
  d.setPointerCapture(e.pointerId);
  const mv = (ev) => { if (Math.abs(ev.clientX - x0) > 2) moved = true; k.t = Math.max(0, snapTo(t0 + (ev.clientX - x0) / pps)); d.style.left = `${k.t * pps}px`; syncGrade(); };
  const up = () => { d.removeEventListener('pointermove', mv); d.removeEventListener('pointerup', up); d.removeEventListener('pointercancel', up); if (moved) updateTotal(); drawTimeline(); if (S.tab === 'grade') drawTabs(); };
  d.addEventListener('pointermove', mv); d.addEventListener('pointerup', up); d.addEventListener('pointercancel', up);
}
function tabGrade() {
  const shown = gradeNow(), on = gradeActive(S.grade) || S.gradeKeys.length > 0, current = S.gradeKeys.length ? null : presetOf(S.grade), keyed = S.gradeKeys.length > 0;
  gradeFields = new Map();
  const row = (c) => {
    const input = h('input', { type: 'range', min: c.min, max: c.max, step: c.step, value: shown[c.key], 'aria-label': c.label });
    const num = h('input', { type: 'number', class: 'grade-num', min: c.min, max: c.max, step: c.step, value: +shown[c.key].toFixed(2), 'aria-label': `${c.label} value` });
    const set = (v) => { setGrade({ [c.key]: v }); refreshGradeFields(); markTouched(); };
    input.addEventListener('input', () => set(+input.value)); num.addEventListener('change', () => set(+num.value));
    input.addEventListener('dblclick', () => set(c.neutral));
    gradeFields.set(c.key, { input, num });
    return h('div', { class: 'grade-row' }, h('label', {}, c.label, num), input);
  };
  const tint = h('input', { type: 'color', class: 'grade-color', value: shown.tint, 'aria-label': 'Tint colour' });
  tint.addEventListener('input', () => { setGrade({ tint: tint.value, ...(gradeNow().tintAmount === 0 ? { tintAmount: 0.3 } : {}) }); refreshGradeFields(); markTouched(); });
  const reset = h('button', { class: 'btn sm', type: 'button', disabled: !on, onclick: () => { S.gradeKeys = []; S.gradeSel = null; setGrade({}, true); drawTimeline(); drawTabs(); } }, 'Reset All ↺');
  const text = () => (S.gradeKeys.length ? `The grade changes over time (${S.gradeKeys.length} keyframe). The sliders change the keyframe at the playhead.` : gradeActive(S.grade) ? 'Grade is on: it applies to the whole scene.' : 'No grade yet.');
  const status = h('small', { class: 'sub' }, text());
  const markTouched = () => { status.textContent = text(); reset.disabled = !(gradeActive(S.grade) || S.gradeKeys.length); };
  const groups = [...new Set(GRADE_CONTROLS.map((c) => c.group))], keys = S.gradeKeys.slice().sort((a, b) => a.t - b.t);
  return h('div', { class: 'list grade-panel' },
    h('div', { class: 'card flat' }, h('div', { class: 'row', style: 'justify-content:space-between;align-items:center' }, h('h2', { style: 'margin:0' }, '🎨 Colour Grading'), reset),
      h('p', { class: 'sub', style: 'font-size:12px;margin:6px 0 8px' }, 'Affects the whole scene (background + characters + props + effects). The same look appears in the export. Double-click a slider to reset that control to neutral.'), status),
    h('div', { class: 'card flat' }, h('h3', {}, 'Looks'), h('div', { class: 'grade-presets' }, GRADE_PRESETS.map((p) => h('button', { type: 'button', class: current === p.id ? 'on' : '', onclick: () => { setGrade(presetGrade(p.id), !keyed); drawTabs(); } }, p.label)))),
    h('div', { class: 'card flat' }, h('h3', {}, '◆ Change over time'),
      h('p', { class: 'sub', style: 'font-size:12px;margin:0 0 8px' }, 'Move the playhead wherever you like, pick a look, then add a keyframe. The grade glides automatically between two keyframes (like day to night).'),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, h('button', { class: 'btn ok', type: 'button', onclick: addGradeKey }, '＋ Keyframe here')),
      keys.map((k, i) => h('div', { class: `item ${k.id === S.gradeSel ? 'on' : ''}`, style: 'cursor:pointer', onclick: () => { S.gradeSel = k.id; player.seek(Math.min(player.total, k.t)); S.dirty = true; drawTabs(); } },
        h('span', { class: 'chip' }, i + 1), h('b', {}, `${k.t.toFixed(2)} s`),
        h('button', { class: 'ib', style: 'margin-left:auto', title: 'Remove keyframe', onclick: (e) => { e.stopPropagation(); S.gradeKeys = S.gradeKeys.filter((x) => x !== k); syncGrade(); drawTimeline(); drawTabs(); } }, '✕')))),
    ...groups.map((group) => h('div', { class: 'card flat' }, h('h3', {}, group), ...GRADE_CONTROLS.filter((c) => c.group === group).map(row),
      group === 'Colour' ? h('div', { class: 'grade-row grade-tint' }, h('label', {}, 'Tint colour'), tint) : null)),
    h('p', { class: 'sub', style: 'font-size:12px' }, 'Tip: add the background and characters first, then grade.'));
}

/* ---------- motion paths: draw a line with the pen, the character follows it ---------- */
/** (re)build the movement keys of a character from its path; keys of an older path are replaced, the user's own keys stay */
function applyPath(key) {
  const path = S.paths[key], keep = (S.charKeys[key] || []).filter((k) => !k.pathKey);
  const now = charNow(key), keys = path ? pathKeys(path, path.mul ?? now?.mul ?? 1, `${key}p`).map((k) => ({ ...k, id: uid() })) : [];
  const all = [...keep, ...keys];
  if (all.length) S.charKeys[key] = all; else delete S.charKeys[key];
  stage.setLayerKeys(key, S.charKeys[key] || []); updateTotal(); S.dirty = true; drawTimeline();
}
/** scene point (fractions, y from the bottom) <-> position inside the picture on screen (fractions, y down), through the camera view */
const viewOf = () => stage.view || { x: 0, y: 0, w: stage.W, h: stage.H };
const toScreen = (p) => { const v = viewOf(); return { x: (p.x * stage.W - v.x) / v.w, y: ((1 - p.y) * stage.H - v.y) / v.h }; };
const fromScreen = (fx, fy) => { const v = viewOf(); return { x: (v.x + fx * v.w) / stage.W, y: 1 - (v.y + fy * v.h) / stage.H }; };
const penLine = (pts) => pts.map((p) => { const q = toScreen(p); return `${(q.x * 100).toFixed(2)},${(q.y * 100).toFixed(2)}`; }).join(' ');
/** the character's own picture */
const portraitOf = (s) => { const c = charOf(s), t = c?.thumb || c?.thumbnail || null; return t && !/^(https?:|blob:|data:)/.test(t) ? cdn(t) : t; };
function stopPathDraw() { const had = S.pathDraw; S.pathDraw?.cleanup(); S.pathDraw = null; if (had) { updateSel(); drawClipNav(); } }
/**
 * Path: a faint shadow of the character appears; drag it to where the character should go. Letting go makes the path:
 * a straight way from where the character stands (flag A) to where the shadow was left (flag B). The time is on the layer: the two flags
 * sit on the character's animation clip (its start and end) and can be dragged like keyframes.
 */
function startPathShadow(s) {
  if (S.exporting || !wrapEl) return;
  const clip = pathClipFor(s);
  if (!clip) { toast(`Please add an animation for ${s.name} first (for example walk): the character keeps playing it while it moves along the path.`); return; }
  const old = S.paths[s.key];
  if (!old) player.seek(Math.min(player.total, clip.start));
  const now = charNow(s.key), A = old?.pts?.[0] ? { x: old.pts[0].x, y: old.pts[0].y } : now && { x: now.x, y: now.y };
  if (!A) { toast('Please select the character first.'); return; }
  stopPathDraw(); player.pause(); drawTimeline();
  const box = stage.layers.find((l) => l.key === s.key)?.box, v = viewOf(), src = portraitOf(s);
  const heightPct = box ? ((box.y1 - box.y0) / v.h) * 100 : 40, widthPct = box ? ((box.x1 - box.x0) / v.w) * 100 : 14;
  const layer = h('div', { class: 'pathshadow-layer' }), svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('preserveAspectRatio', 'none'); svg.innerHTML = '<polyline points=""/>';
  const shadow = src ? h('img', { class: 'pathshadow', src, alt: '', draggable: 'false' }) : h('div', { class: 'pathshadow blob' });
  shadow.style.height = `${heightPct}%`; if (!src) shadow.style.width = `${widthPct}%`;
  if (s.flip) shadow.style.setProperty('--flip', '-1');
  const flag = (which) => h('i', { class: `pflag stage ${which}` }, which.toUpperCase());
  const flagA = flag('a'), flagB = flag('b');
  const bar = h('div', { class: 'pathbar' }, h('span', { class: 'pathhint' }, 'Drag the shadow box, then press Done'),
    h('button', { type: 'button', class: 'btn sm pb-desk', onclick: () => cancel() }, 'Cancel'), h('button', { type: 'button', class: 'btn sm pri pb-desk', onclick: () => finish() }, 'Done'));          // on a phone these two are in the bottom bar
  const arrow = h('button', { type: 'button', class: 'path-arrow', hidden: true, 'aria-label': 'Bring the shadow back into the picture', title: 'Bring the shadow back into the picture', onclick: () => bringBack() }, icon('undo'));
  for (const type of ['pointerdown', 'pointerup', 'pointermove', 'click']) arrow.addEventListener(type, (e) => e.stopPropagation());
  for (const type of ['pointerdown', 'pointerup', 'pointermove', 'click']) bar.addEventListener(type, (e) => e.stopPropagation());
  layer.append(svg, shadow, flagA, flagB, bar, arrow);
  wrapEl.append(layer);
  const line = svg.querySelector('polyline');
  const at = (e) => { const r = stage.out.getBoundingClientRect(), p = fromScreen((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); return { x: Math.min(1.8, Math.max(-0.8, p.x)), y: Math.min(1.3, Math.max(-0.5, p.y)) }; };          // far enough outside the frame for the character to walk out of the picture
  const place = (el, p) => { const q = toScreen(p); el.style.left = `${q.x * 100}%`; el.style.top = `${q.y * 100}%`; };
  let B = old?.pts?.at(-1) ? { x: old.pts.at(-1).x, y: old.pts.at(-1).y } : { x: Math.min(1.1, A.x + 0.22), y: A.y };
  const show = () => {
    place(shadow, B); place(flagA, A); place(flagB, B); line.setAttribute('points', penLine([A, B]));
    // more than 70 % of the shadow is outside the picture: an arrow at the edge points to it, a tap brings it back in
    const lr = layer.getBoundingClientRect(), sr = shadow.getBoundingClientRect();
    if (lr.width && sr.width && sr.height) {
      const iw = Math.max(0, Math.min(sr.right, lr.right) - Math.max(sr.left, lr.left)), ih = Math.max(0, Math.min(sr.bottom, lr.bottom) - Math.max(sr.top, lr.top));
      const out = iw * ih / (sr.width * sr.height) < 0.3;
      arrow.hidden = !out;
      if (out) {
        const cx = sr.left + sr.width / 2 - lr.left, cy = sr.top + sr.height / 2 - lr.top, ax = Math.min(lr.width - 28, Math.max(28, cx)), ay = Math.min(lr.height - 28, Math.max(28, cy));
        Object.assign(arrow.style, { left: `${ax}px`, top: `${ay}px`, transform: 'translate(-50%,-50%)' }); arrow.style.setProperty('--flipx', cx < lr.width / 2 ? '-1' : '1');          // the u-turn arrow points back into the picture from either side
      }
    }
  };
  show();
  let down = false, grab = { x: 0, y: 0 };
  // only a touch ON the shadow (or its B flag) picks it up, and it moves by the finger's distance: a touch anywhere else does nothing, so the shadow never jumps. Lifting the finger does not finish: press Done.
  const onDown = (e) => {
    const hit = (el) => { const r = el.getBoundingClientRect(), pad = 26; return e.clientX >= r.left - pad && e.clientX <= r.right + pad && e.clientY >= r.top - pad && e.clientY <= r.bottom + pad; };
    if (!hit(shadow) && !hit(flagB)) return;
    e.preventDefault(); e.stopPropagation(); layer.setPointerCapture(e.pointerId); down = true;
    const p = at(e); grab = { x: B.x - p.x, y: B.y - p.y };
  };
  const onMove = (e) => { if (down) { const p = at(e); B = { x: p.x + grab.x, y: p.y + grab.y }; show(); } };
  const onUp = () => { down = false; };
  function bringBack() { B = { x: Math.min(0.9, Math.max(0.1, B.x)), y: Math.min(0.85, Math.max(0.05, B.y)) }; show(); }
  function cancel() { stopPathDraw(); drawTabs(); }
  function finish() {
    if (Math.hypot(B.x - A.x, B.y - A.y) < 0.03) { toast('Please drag the shadow a little further from the character.'); return; }
    S.paths[s.key] = { pts: [A, { x: +B.x.toFixed(4), y: +B.y.toFixed(4) }], depth: old?.depth ?? DEPTH_DEFAULT, clipId: clip.id, start: +clip.start.toFixed(2), dur: Math.max(0.5, +clip.dur.toFixed(2)), smooth: old?.smooth ?? false, flipBase: !!(now?.flip ?? old?.flipBase), mul: old?.mul ?? now?.mul ?? 1 };
    stopPathDraw(); applyPath(s.key); player.seek(Math.min(player.total, S.paths[s.key].start)); drawTabs(); drawTimeline();
  }
  const key = (e) => { if (e.key === 'Escape') { stopPathDraw(); drawTabs(); } };
  layer.addEventListener('pointerdown', onDown); layer.addEventListener('pointermove', onMove); layer.addEventListener('pointerup', onUp); layer.addEventListener('pointercancel', onUp); window.addEventListener('keydown', key);
  S.pathDraw = { key: s.key, finish, cancel, bringBack, cleanup: () => { layer.remove(); document.body.classList.remove('path-mode'); window.removeEventListener('keydown', key); } };
  document.body.classList.add('path-mode');          // the A / B flags on the timeline can be dragged only while the Path tool is open
  updateSel(); drawClipNav(); show();          // the Path button is lit while the shadow is being placed
}
/** the two small flags on a character's animation clip (A = where the path starts in time, B = where it ends): drag one to change the time, like a keyframe */
function dragPathFlag(e, m, which, el) {
  if (S.exporting || isLocked(`char:${findManual(m.id)?.s?.key}`)) return;
  e.preventDefault(); e.stopPropagation(); el.setPointerCapture(e.pointerId);
  const x0 = e.clientX, from = { start: m.start, dur: m.dur, off: m.off || 0 }, pps = S.pps; let moved = false;
  const lane = el.parentNode, clipEl = lane.querySelector(`[data-mid="${m.id}"]`);
  const mv = (ev) => {
    if (Math.abs(ev.clientX - x0) > 2) moved = true;
    const r = resizeClip({ mode: which === 'a' ? 'left' : 'right', ...from, delta: (ev.clientX - x0) / pps, min: MIN_CLIP, room: from.off ?? 0 });
    m.start = r.start; m.dur = r.dur; m.off = r.off;
    el.parentNode.querySelector('.pflag.a').style.left = `${m.start * pps}px`; el.parentNode.querySelector('.pflag.b').style.left = `${(m.start + m.dur) * pps}px`;
    if (clipEl) { clipEl.style.left = `${m.start * pps}px`; clipEl.style.width = `${Math.max(6, m.dur * pps)}px`; }
  };
  const up = () => {
    el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
    if (!moved) { selectOnly('clip', m.id); drawTimeline(); return; }
    commitClips();                                              // the path takes the clip's new start and length
  };
  el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}

/* ---------- camera keyframes ---------- */
const camKeys = () => [...S.camKeys].sort((a, b) => a.t - b.t);
function syncCam() { if (stage) { stage.camKeys = camKeys().map((k) => ({ t: k.t, cx: k.cx, cy: k.cy, zoom: k.zoom, ease: k.ease })); } if (S.step === 3) updateTotal?.(); S.dirty = true; }
/** the camera at the playhead: key values if the camera follows keys, else what the automatic shot shows now */
const camNow = () => { const f = stage.frameAt(shotPlan(), player.time); return { cx: f.cx / stage.W, cy: f.cy / stage.H, zoom: f.zoom }; };
/** edit the key at the playhead (or create one there) */
function editKey(patch) {
  const t = +player.time.toFixed(2);
  let k = S.camKeys.find((x) => Math.abs(x.t - t) < 0.06);
  if (!k) { k = { id: uid(), t, ...camNow(), ease: 'smooth' }; S.camKeys.push(k); }
  Object.assign(k, patch); S.camSel = k.id;
  syncCam(); drawTimeline(); S.dirty = true;
  return k;
}
function dragKey(e, k, d) {
  if (S.exporting) return;
  e.preventDefault(); e.stopPropagation();
  S.camSel = k.id; player.seek(Math.min(player.total, k.t)); S.dirty = true;
  const x0 = e.clientX, t0 = k.t, pps = S.pps; let moved = false;
  d.setPointerCapture(e.pointerId);
  const mv = (ev) => { if (Math.abs(ev.clientX - x0) > 2) moved = true; k.t = Math.max(0, +snap(t0 + (ev.clientX - x0) / pps).toFixed(2)); d.style.left = `${k.t * pps}px`; syncCam(); };
  const up = () => { d.removeEventListener('pointermove', mv); d.removeEventListener('pointerup', up); d.removeEventListener('pointercancel', up); player.seek(Math.min(player.total, k.t)); drawTimeline(); if (S.tab === 'camera') drawTabs(); };
  d.addEventListener('pointermove', mv); d.addEventListener('pointerup', up); d.addEventListener('pointercancel', up);
  if (S.tab === 'camera') drawTabs();
}
/** the camera rectangle drawn over the stage while the Camera tab is open (drag it to move, drag a corner to zoom) */
function mountCamBox() {
  camEl = h('div', { class: 'camframe', hidden: true, 'data-cam': 'move' }, h('span', { class: 'camtag' }, '🎥'));
  camHandles = Object.fromEntries(['tl', 'tr', 'bl', 'br'].map((c) => [c, h('i', { class: `camhd c-${c}`, 'data-cam': c, hidden: true })]));
  wrapEl.append(camEl, ...Object.values(camHandles));
}
function updateCamBox() {
  if (!camEl) return;
  const show = syncFullView() && S.step === 3 && !S.exporting;
  camEl.hidden = !show; Object.values(camHandles).forEach((x) => { x.hidden = !show; });
  if (!show) return;
  const k = stage.out.clientWidth / stage.W, f = stage.frameAt(shotPlan(), player.time);
  Object.assign(camEl.style, { left: `${f.x0 * k}px`, top: `${f.y0 * k}px`, width: `${(f.x1 - f.x0) * k}px`, height: `${(f.y1 - f.y0) * k}px` });
  const pos = { tl: [f.x0, f.y0], tr: [f.x1, f.y0], bl: [f.x0, f.y1], br: [f.x1, f.y1] };
  for (const [c, [x, y]] of Object.entries(pos)) Object.assign(camHandles[c].style, { left: `${x * k}px`, top: `${y * k}px` });
}
let camDrag = null;
function camPointerDown(e) {
  const mode = e.target.dataset?.cam; if (!mode || S.exporting) return false;
  const r = stage.out.getBoundingClientRect(), k = stage.W / r.width, f = stage.frameAt(shotPlan(), player.time);
  camDrag = { mode, k, x0: e.clientX, y0: e.clientY, cx0: f.cx, cy0: f.cy, zoom0: f.zoom, rect: r };
  wrapEl.setPointerCapture(e.pointerId); return true;
}
function camPointerMove(e) {
  if (!camDrag) return false;
  const d = camDrag, W = stage.W, H = stage.H;
  if (d.mode === 'move') {
    const vw = W / d.zoom0, vh = H / d.zoom0;
    const cx = Math.min(W - vw / 2, Math.max(vw / 2, d.cx0 + (e.clientX - d.x0) * d.k)), cy = Math.min(H - vh / 2, Math.max(vh / 2, d.cy0 + (e.clientY - d.y0) * d.k));
    editKey({ cx: cx / W, cy: cy / H, zoom: d.zoom0 });
  } else {
    const px = (e.clientX - d.rect.left) * d.k, half = Math.max(8, Math.abs(px - d.cx0)), zoom = Math.min(6, Math.max(1, W / (2 * half)));
    const vw = W / zoom, vh = H / zoom, cx = Math.min(W - vw / 2, Math.max(vw / 2, d.cx0)), cy = Math.min(H - vh / 2, Math.max(vh / 2, d.cy0));
    editKey({ zoom, cx: cx / W, cy: cy / H });
  }
  if (S.tab === 'camera') drawTabsSoft();
  return true;
}
const camPointerUp = () => { const was = !!camDrag; camDrag = null; if (was && S.tab === 'camera') drawTabs(); return was; };
let softTimer = 0;
function drawTabsSoft() { clearTimeout(softTimer); softTimer = setTimeout(() => { if (!camDrag) drawTabs(); }, 200); }

/** one-click camera moves (zoom, pan, shake): they add keyframes at the playhead and last `camFx.dur` seconds */
const camFx = { dur: 2, shakeDur: 0.8, strength: 'medium' };
function applyCamPreset(kind) {
  const t = +player.time.toFixed(2), want = kind === 'shake' ? camFx.shakeDur : camFx.dur, dur = +Math.min(want, player.total - t).toFixed(2);
  if (dur < 0.3) { toast('There is no room left after the playhead. Move the playhead earlier, then try again.'); return; }
  const at = (time) => { const f = stage.frameAt(shotPlan(), time); return { zoom: f.zoom, cx: f.cx / stage.W, cy: f.cy / stage.H }; };
  const from = at(t), to = at(t + dur), keys = presetKeys(kind, { t, dur, from, to, strength: camFx.strength, seed: Math.round(t * 1000) + 1 });
  S.camKeys = withPreset(S.camKeys, keys.map((k) => ({ ...k, id: uid() })));
  S.camSel = S.camKeys.find((k) => Math.abs(k.t - t) < 1e-6)?.id ?? null;
  syncCam(); player.seek(t); drawTimeline(); drawTabs(); S.dirty = true;
}
function tabCamera() {
  const k = S.camKeys.find((x) => x.id === S.camSel) || null, sorted = camKeys();
  const seg = (items, cur, on) => h('div', { class: 'seg' }, items.map(([key, l]) => h('button', { class: String(cur()) === String(key) ? 'on' : '', onclick: () => { on(key); drawTabs(); } }, l)));
  const sl = (label, get, set, min, max, step, show) => { const out = h('span', { class: 'v' }, show(get())), input = h('input', { type: 'range', min, max, step, value: get() }); input.addEventListener('input', () => { set(+input.value); out.textContent = show(+input.value); }); input.addEventListener('change', () => drawTabs()); return h('label', { class: 'cs-sl' }, h('span', {}, label), input, out); };
  const goto = (key) => { S.camSel = key.id; player.seek(Math.min(player.total, key.t)); S.dirty = true; drawTimeline(); drawTabs(); };
  const focusOn = (s) => { const l = stage.layers.find((x) => x.key === s.key); if (!l?.box) return; const b = l.box, hgt = b.y1 - b.y0; editKey({ zoom: 2.2, cx: ((b.x0 + b.x1) / 2) / stage.W, cy: (b.y0 + hgt * 0.35) / stage.H }); drawTabs(); };
  const chars = S.order.map(sOf).filter((x) => x?.charId);
  const custom = h('input', { type: 'text', placeholder: 'w:h  e.g. 2:1', value: ASPECTS[S.aspect] ? '' : S.aspect, class: 'cb-ratio', onchange: (e) => { const v = e.target.value.trim(); if (aspectOf(v).label.startsWith('Custom')) setAspect(v); else toast('Please enter a ratio like 2:1 or 5:4 (no wider than 8:1).'); } });
  return h('div', { class: 'list' },
    h('div', { class: 'card flat' }, h('h2', {}, '🎥 Camera keyframes'),
      h('p', { class: 'sub', style: 'font-size:12px;margin:0 0 8px' }, S.camKeys.length ? 'The camera follows your keyframes. Move the playhead, then drag the frame on the stage (or its corners to zoom) — a keyframe is made there automatically. Only the camera view is rendered into the video.' : 'Now the camera uses the automatic shots (one per audio line). Add a keyframe to take over: move the playhead, then drag the frame on the stage.'),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
        h('button', { class: 'btn ok', onclick: () => { editKey({}); drawTabs(); } }, '＋ Keyframe here'),
        h('button', { class: `btn ${S.camPeek ? 'pri' : ''}`, title: 'See the picture exactly as it will be rendered', onclick: () => { S.camPeek = !S.camPeek; S.dirty = true; drawTabs(); } }, S.camPeek ? '👁 Camera view: on' : '👁 Camera view: off'),
        S.camKeys.length ? h('button', { class: 'btn', onclick: () => { if (confirm('Delete all camera keyframes and go back to the automatic shots?')) { S.camKeys = []; S.camSel = null; syncCam(); drawTimeline(); drawTabs(); } } }, 'Clear all') : null)),
    h('div', { class: 'card flat cam-presets' }, h('h2', {}, 'Camera moves'),
      h('p', { class: 'sub', style: 'font-size:12px;margin:0 0 8px' }, 'One click adds the keyframes for you, starting at the playhead. You can change them afterwards.'),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, ...['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down'].map((kind) => h('button', { class: 'btn sm', type: 'button', 'data-preset': kind, onclick: () => applyCamPreset(kind) }, CAM_PRESETS[kind]))),
      h('div', { class: 'cb-ease', style: 'margin-top:8px' }, h('span', {}, 'Move lasts'), seg([[1, '1 s'], [2, '2 s'], [3, '3 s'], [5, '5 s']], () => camFx.dur, (v) => { camFx.dur = +v; })),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center' }, h('button', { class: 'btn sm', type: 'button', 'data-preset': 'shake', onclick: () => applyCamPreset('shake') }, '⚡ Shake'),
        seg([['small', 'Small'], ['medium', 'Medium'], ['strong', 'Strong']], () => camFx.strength, (v) => { camFx.strength = v; }), seg([[0.4, '0.4 s'], [0.8, '0.8 s'], [1.5, '1.5 s']], () => camFx.shakeDur, (v) => { camFx.shakeDur = +v; }))),
    k ? h('div', { class: 'card flat' }, h('h2', {}, `Keyframe at ${k.t.toFixed(2)} s`),
      sl('Zoom', () => k.zoom, (v) => { k.zoom = v; syncCam(); }, 1, 6, 0.05, (v) => `${(+v).toFixed(2)}×`),
      sl('Left ↔ right', () => k.cx, (v) => { k.cx = v; syncCam(); }, 0, 1, 0.005, (v) => `${Math.round(v * 100)}%`),
      sl('Up ↕ down', () => k.cy, (v) => { k.cy = v; syncCam(); }, 0, 1, 0.005, (v) => `${Math.round(v * 100)}%`),
      h('div', { class: 'cb-ease' }, h('span', {}, 'Move to the next keyframe'), seg([['smooth', 'Smooth'], ['linear', 'Even'], ['in', 'Slow start'], ['out', 'Slow end'], ['hold', 'Cut']], () => k.ease || 'smooth', (v) => { k.ease = v; syncCam(); })),
      h('label', { class: 'cs-sl' }, h('span', {}, 'Time (s)'), h('input', { type: 'number', step: 0.05, min: 0, value: k.t.toFixed(2), onchange: (e) => { k.t = Math.max(0, +(+e.target.value || 0).toFixed(2)); syncCam(); player.seek(Math.min(player.total, k.t)); drawTimeline(); drawTabs(); } })),
      h('div', { class: 'row', style: 'gap:6px' }, h('button', { class: 'btn', onclick: () => { const c = { ...k, id: uid(), t: +(k.t + 1).toFixed(2) }; S.camKeys.push(c); S.camSel = c.id; syncCam(); player.seek(Math.min(player.total, c.t)); drawTimeline(); drawTabs(); } }, '⧉ Copy 1 s later'),
        h('button', { class: 'btn', onclick: () => { S.camKeys = S.camKeys.filter((x) => x !== k); S.camSel = null; syncCam(); drawTimeline(); drawTabs(); } }, '🗑 Delete'))) : null,
    chars.length ? h('div', { class: 'card flat' }, h('h2', {}, 'Quick framing'), h('p', { class: 'sub', style: 'font-size:12px;margin:0 0 8px' }, 'Puts a keyframe at the playhead looking at one character.'),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, h('button', { class: 'btn', onclick: () => { editKey({ zoom: 1, cx: 0.5, cy: 0.5 }); drawTabs(); } }, 'Whole scene'), chars.map((s) => h('button', { class: 'btn', onclick: () => focusOn(s) }, s.name)))) : null,
    h('div', { class: 'card flat' }, h('h2', {}, `Keyframes (${sorted.length})`),
      sorted.length ? sorted.map((x, i) => h('div', { class: `item ${x.id === S.camSel ? 'on' : ''}`, style: 'cursor:pointer', onclick: () => goto(x) }, h('span', { class: 'chip' }, i + 1), h('b', {}, `${x.t.toFixed(2)} s`), h('small', { style: 'margin-left:8px' }, `${x.zoom.toFixed(2)}× · ${x.ease || 'smooth'}`))) : h('p', { class: 'sub', style: 'font-size:12px;margin:0' }, 'None yet.')),
    h('div', { class: 'card flat' }, h('h2', {}, '🖼 Canvas size'), h('p', { class: 'sub', style: 'font-size:12px;margin:0 0 8px' }, 'The shape of the video. The camera frame follows it.'),
      seg(Object.entries(ASPECTS).map(([a, v]) => [a, a]), () => (ASPECTS[S.aspect] ? S.aspect : ''), (v) => setAspect(v)), h('div', { class: 'row', style: 'gap:6px;align-items:center;margin-top:8px' }, h('span', { class: 'sub', style: 'margin:0;font-size:12px' }, 'Custom'), custom)));
}
function tabMask() {
  wrapEl?.querySelectorAll('.mask-edit').forEach((e)=>e.remove());
  const chars = S.order.map(sOf).filter((s) => s?.charId), selected = chars.find((s) => s.key === S.sel) || chars.find((s) => s.key === S.animFor) || chars[0];
  if (!selected) return h('div', { class: 'card flat' }, h('h2', {}, 'Character mask'), h('p', { class: 'sub' }, 'Add a character first, then choose the visible area.'));
  const mask = selected.mask || { enabled: false, shape: 'rect', x: 0.25, y: 0.15, w: 0.5, h: 0.7, invert: false };
  const update = (key, value) => { mask[key] = value; selected.mask = mask; const layer = stage.layers.find((x) => x.key === selected.key); if (layer) layer.mask = { ...mask }; if (typeof place === 'function') place(); S.dirty = true; };
  const overlay = h('div', { class: `mask-edit ${mask.shape}`, title: 'Drag to move mask; drag a corner to resize' });
  const place = () => { const r=wrapEl.getBoundingClientRect(), k=r.width/stage.W; Object.assign(overlay.style,{left:`${mask.x*stage.W*k}px`,top:`${mask.y*stage.H*k}px`,width:`${mask.w*stage.W*k}px`,height:`${mask.h*stage.H*k}px`,clipPath:mask.shape==='polygon'?`polygon(${(mask.points||[{x:0,y:0},{x:1,y:0},{x:.8,y:1},{x:.2,y:1}]).map(p=>`${p.x*100}% ${p.y*100}%`).join(',')})`:''}); overlay.className=`mask-edit ${mask.shape}${mask.enabled?' active':''}`; };
  const drag=(e,corner='')=>{e.preventDefault();e.stopPropagation();const x=e.clientX,y=e.clientY,orig={...mask},k=stage.out.clientWidth/stage.W;const move=(ev)=>{let dx=(ev.clientX-x)/k/stage.W,dy=(ev.clientY-y)/k/stage.H;if(corner){if(corner.includes('r')){mask.w=Math.max(.02,orig.w+dx)}else{mask.x=orig.x+dx;mask.w=Math.max(.02,orig.w-dx)}if(corner.includes('b'))mask.h=Math.max(.02,orig.h+dy);else{mask.y=orig.y+dy;mask.h=Math.max(.02,orig.h-dy)}}else{mask.x=orig.x+dx;mask.y=orig.y+dy}mask.x=Math.max(0,Math.min(1-mask.w,mask.x));mask.y=Math.max(0,Math.min(1-mask.h,mask.y));update('x',mask.x);place();};const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);drawTabs();};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up,{once:true});};
  overlay.addEventListener('pointerdown',(e)=>drag(e));
  for(const c of ['tl','tr','bl','br'])overlay.append(h('i',{class:`mask-handle ${c}`,onpointerdown:(e)=>drag(e,c)}));
  wrapEl.append(overlay); place();
  const range = (key, label, max = 1) => h('label', { class: 'cs-sl' }, h('span', {}, label), h('input', { type: 'range', min: 0, max, step: 0.01, value: mask[key], oninput: (e) => update(key, +e.target.value) }), h('span', { class: 'v' }, `${Math.round(mask[key] * 100)}%`));
  const choose = (shape) => { update('shape', shape); drawTabs(); };
  return h('div', { class: 'list' },
    h('div', { class: 'card flat' }, h('h2', {}, '◩ Character mask'), h('p', { class: 'sub', style: 'font-size:12px' }, 'Show only part of this character. The mask is saved with the scene and appears in video exports.'),
      h('label', { class: 'row', style: 'gap:8px;justify-content:flex-start' }, h('input', { type: 'checkbox', checked: mask.enabled, onchange: (e) => { update('enabled', e.target.checked); drawTabs(); } }), h('b', {}, 'Enable mask')),
      h('div', { class: 'cb-ease' }, h('span', {}, 'Shape'), h('div', { class: 'seg' }, [['rect', 'Rectangle'], ['ellipse', 'Ellipse'], ['polygon','Custom polygon']].map(([v, label]) => h('button', { class: mask.shape === v ? 'on' : '', onclick: () => choose(v) }, label)))),
      mask.shape==='polygon' ? h('label',{class:'cs-sl'},h('span',{},'Points as x,y percentages; separate with semicolons'),h('input',{type:'text',value:(mask.points||[{x:0,y:0},{x:1,y:0},{x:.8,y:1},{x:.2,y:1}]).map(p=>`${Math.round(p.x*100)},${Math.round(p.y*100)}`).join(';'),onchange:e=>{const pts=e.target.value.split(';').map(v=>v.split(',').map(Number)).filter(v=>v.length===2&&v.every(Number.isFinite)).slice(0,8);if(pts.length<3){toast('Please enter at least three valid x,y points.');return}mask.points=pts.map(([x,y])=>({x:Math.max(0,Math.min(100,x))/100,y:Math.max(0,Math.min(100,y))/100}));update('points',mask.points)}})) : null,
      h('label', { class: 'row', style: 'gap:8px;justify-content:flex-start;margin:10px 0' }, h('input', { type: 'checkbox', checked: mask.invert, onchange: (e) => update('invert', e.target.checked) }), h('span', {}, 'Invert · hide inside the shape')),
      range('x', 'Left position'), range('y', 'Top position'), range('w', 'Width'), range('h', 'Height'),
      h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap;margin-top:8px' }, h('button', { class: 'btn sm ok', onclick: () => { selected.maskKeys ||= []; const key = { t: player.time, x: mask.x, y: mask.y, w: mask.w, h: mask.h }; const i = selected.maskKeys.findIndex((k) => Math.abs(k.t - key.t) < 0.02); if (i >= 0) selected.maskKeys[i] = key; else selected.maskKeys.push(key); selected.maskKeys.sort((a,b)=>a.t-b.t); const layer=stage.layers.find(x=>x.key===selected.key); if(layer) layer.maskKeys=selected.maskKeys; S.dirty=true; drawTimeline(); drawTabs(); } }, '＋ Mask key at playhead'),
        h('label', { class: 'sub', style: 'font-size:12px' }, 'Follow bone ', h('select', { onchange: (e) => { selected.maskFollow=e.target.value; const layer=stage.layers.find(x=>x.key===selected.key); if(layer) layer.maskFollow=selected.maskFollow; S.dirty=true; } }, h('option', { value: '' }, 'Off'), ...['head','neck','hand_l','hand_r','root'].map(n=>h('option',{value:n,selected:selected.maskFollow===n},n))))),
      selected.maskKeys?.length ? h('div',{class:'mask-key-list'},...selected.maskKeys.map((k,i)=>h('button',{class:'btn sm',onclick:()=>{player.seek(k.t);S.dirty=true;drawTimeline();}},`Mask ${i+1} · ${k.t.toFixed(2)}s`))) : null,
      h('button', { class: 'btn sm', onclick: () => { Object.assign(mask, { x: 0.25, y: 0.15, w: 0.5, h: 0.7 }); update('x', mask.x); drawTabs(); } }, 'Reset mask area')),
    h('div', { class: 'card flat' }, h('b', {}, `Target: ${selected.name}`), h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;margin-top:8px' }, ...chars.map((s) => h('button', { class: `btn sm ${s.key === selected.key ? 'pri' : ''}`, onclick: () => { S.sel = s.key; drawTabs(); } }, s.name)))));
}
function setAspect(a) {
  S.aspect = a; stage.setSize(a, S.preview); fitEditor(); S.dirty = true; syncCam(); updateSel(); drawTabs();
}

/** while playing / scrubbing the "line layers" follow the playhead */
function followLine() {
  const L = lineAt(player.time);
  if (L && L.id !== S.lineSel) { S.lineSel = L.id; drawTimeline(); drawLineBox(); updateEditTools(); if (S.tab === 'anim' && S.panelOpen) drawTabs(); }
}

/* ---- layers of the selected audio line ---- */
/** the music row: one bar for the whole scene, the picture of the song repeated as often as it repeats in the video */
function musicLane(total, pps) {
  const m = S.music, buf = musicBuffer(m.id), width = Math.max(20, Math.round(total * pps)), canvas = h('canvas', { class: 'wave', 'aria-hidden': 'true' });
  try {
    const one = barsFor(peaksOf(buf), 0, buf.duration, Math.max(1, Math.round(buf.duration * pps))), bars = new Float32Array(Math.min(4000, width));
    for (let x = 0; x < bars.length; x++) bars[x] = one[Math.floor((x * width) / bars.length) % one.length];
    drawWave(canvas, bars, { gain: Math.min(2, (m.volume ?? 0.35) * 2) / peakMax(buf) });
  } catch { /* no picture */ }
  return h('div', { class: 'lane2 audio music', style: 'height:34px' }, h('div', { class: `tclip music ${m.muted ? 'muted' : ''}`, title: 'Background music. Open the Audio tab to change its volume or remove it.', style: `left:0;width:${width}px`, onclick: () => openTab('audio') }, canvas, h('span', { class: 'tn' }, `♪ ${m.name}${m.muted ? ' (muted)' : ''}`)));
}
/** the picture of the sound inside a voice clip: only the part that is on the timeline (after trimming), as loud as the line's volume makes it */
function voiceWave(c) {
  const canvas = h('canvas', { class: 'wave', 'aria-hidden': 'true' });
  try {
    const width = Math.min(4000, Math.max(8, Math.round((c.end - c.start) * S.pps))), from = c.trimStart || 0;
    drawWave(canvas, barsFor(peaksOf(c.buffer), from, from + (c.end - c.start), width), { gain: Math.min(2, c.volume ?? 1) / peakMax(c.buffer) });
  } catch { /* no picture if the sound cannot be read: the clip still works */ }
  return canvas;
}
/** mute, solo, volume and fades of one voice line */
function setMix(id, patch, { redraw = true } = {}) {
  const line = lineModel(id), clip = player.clips.find((c) => c.id === id);
  for (const o of [line, clip]) if (o) Object.assign(o, patch);
  S.dirty = true;
  if (redraw) { if (player.playing) player.seek(player.time); drawTimeline(); drawLineBox(); }          // playing: restart the sound so the new level is heard at once
}
function mixRow(L) {
  const len = Math.max(0.2, L.end - L.start), pct = (v) => `${Math.round(v * 100)}%`, secs = (v) => `${(+v || 0).toFixed(1)} s`;
  const toggle = (label, key, tip) => h('button', { type: 'button', class: `btn sm mix-btn ${L[key] ? 'on' : ''}`, 'aria-pressed': String(!!L[key]), title: tip, onclick: () => setMix(L.id, { [key]: !L[key] }) }, label);
  const slider = (label, min, max, step, get, show, set) => { const out = h('output', {}, show(get())), input = h('input', { type: 'range', min, max, step, value: get(), 'aria-label': label, oninput: (e) => { out.textContent = show(+e.target.value); set(+e.target.value, false); }, onchange: (e) => set(+e.target.value, true) }); return h('label', { class: 'mix-field' }, h('span', {}, label), input, out); };
  return h('div', { class: 'mixrow' },
    h('div', { class: 'mix-buttons' }, toggle('Mute', 'muted', 'Silence this line (its character still talks)'), toggle('Solo', 'solo', 'Hear only the solo lines')),
    slider('Volume', 0, 2, 0.05, () => L.volume ?? 1, pct, (v, redraw) => setMix(L.id, { volume: v }, { redraw })),
    slider('Fade in', 0, Math.min(5, len), 0.1, () => L.fadeIn || 0, secs, (v, redraw) => setMix(L.id, { fadeIn: v }, { redraw })),
    slider('Fade out', 0, Math.min(5, len), 0.1, () => L.fadeOut || 0, secs, (v, redraw) => setMix(L.id, { fadeOut: v }, { redraw })));
}
function drawLineBox() {
  if (!lineBox) return;
  const L = lineById(S.lineSel);
  const details = lineBox.closest('.line-details'); if (details) details.hidden = !player.clips.length;
  if (!L) { lineBox.replaceChildren(h('p', { class: 'sub' }, 'No audio lines yet.')); return; }
  const idx = player.clips.indexOf(L), sp = sOf(L.speaker);
  const chars = S.order.map(sOf).filter((s) => s?.charId);
  const head = h('div', { class: 'lb-head' }, h('span', { class: 'dot', style: `background:${sp?.color}` }), h('b', {}, `Line ${idx + 1} · ${sp?.name || ''}`), h('span', { class: 'chip' }, `${fmt(L.start)} – ${fmt(L.end)}`));
  const shot = S.shots.get(L.id) || { type: 'wide', focus: 'auto' };
  const setShot = (patch, all) => {
    const nx = { ...shot, ...patch };
    for (const l of all ? player.clips : [L]) S.shots.set(l.id, all ? { type: nx.type, focus: 'auto' } : nx);
    drawLineBox(); S.dirty = true;
  };
  const shotRow = h('div', { class: 'shotrow' }, h('span', { class: 'lab' }, '🎥 Shot'),
    h('div', { class: 'seg3' }, [['wide', 'Wide'], ['medium', 'Medium'], ['close', 'Close-up']].map(([k, l]) => h('button', { class: (shot.type || 'wide') === k ? 'on' : '', onclick: () => setShot({ type: k }) }, l))),
    (shot.type || 'wide') !== 'wide' ? h('div', { class: 'shotfocus' },
      h('span', { class: 'lab' }, 'on'), h('button', { class: !shot.focus || shot.focus === 'auto' ? 'on' : '', onclick: () => setShot({ focus: 'auto' }) }, 'Speaker'),
      ...chars.map((c) => h('button', { class: shot.focus === c.key ? 'on' : '', onclick: () => setShot({ focus: c.key }) }, c.name)),
      h('button', { class: 'all', title: 'Use this shot size for every line', onclick: () => setShot({}, true) }, 'All lines')) : null);
  const rows = chars.map((s) => {
    const r = resolveLine(L, s), cur = S.animFor === s.key && S.tab === 'anim' && S.panelOpen;
    return h('div', { class: `lrow ${r.inFrame ? '' : 'off'} ${cur ? 'on' : ''}` },
      h('label', { class: 'sw2', title: 'In frame for this line' }, h('input', { type: 'checkbox', checked: r.inFrame, onchange: (e) => { castOf(L.id, s.key).in = e.target.checked; refreshPresence(); drawLineBox(); } }), h('i')),
      h('button', { class: 'lmain', onclick: () => { S.animFor = s.key; S.tab = 'anim'; S.panelOpen = true; S.sel = s.key; updateSel(); drawTabs(); drawLineBox(); } },
        h('span', { class: 'dot', style: `background:${s.color}` }), h('span', { class: 'ln' }, s.name, h('small', {}, r.inFrame ? (r.speaking ? '🎤 speaking' : 'listening') : 'not in this line')),
        h('span', { class: 'la' }, r.inFrame ? (r.body ? r.body.name : 'No animation') : '—', r.inFrame && !r.auto ? h('em', {}, ' ✎') : null, r.hand ? h('small', {}, ` · ✋ ${r.hand.name}`) : null, r.legs ? h('small', {}, ` · 🦵 ${r.legs.name}`) : null, r.face ? h('small', {}, ` · 😀 ${r.face.name}`) : null)),
      r.inFrame && (!r.auto || r.face || r.hand || r.legs) ? h('button', { class: 'ib', title: 'Back to automatic (speaker / listener mode)', onclick: () => { const o = castOf(L.id, s.key); delete o.body; delete o.seq; delete o.face; delete o.hand; delete o.legs; applyLayers().then(drawLineBox); } }, '↺') : null);
  });
  lineBox.replaceChildren(head, mixRow(L), shotRow, chars.length ? h('div', { class: 'lrows' }, rows) : h('p', { class: 'sub', style: 'margin:6px 0 0' }, 'No characters on stage yet. Add one in the Characters tab.'),
    chars.length ? h('p', { class: 'hint', style: 'text-align:left;margin:6px 0 0' }, 'The speaker uses Speaker mode (mixed talking gestures), everyone else Listener mode (standing, hands held, a little movement). Tap a character to pick something else for this line.') : null);
}

/** an animation was tapped in the browser: set it for the selected line (or for every line) */
async function pickAnimation(s, ref, overlay, length) {
  if (S.addMode) { await addClip(s, ref, overlay, length); return; }
  const L = lineById(S.lineSel), kind = ref.layer || (overlay ? 'face' : null);
  if (!player.clips.length) {                 // no audio yet: the animation plays for the whole scene
    const o = (S.solo[s.key] ||= {}); o[kind || 'body'] = ref;
    if (!kind) { if (ref.source !== 'mode' && length > 0) o.bodyLen = +(+length).toFixed(2); else delete o.bodyLen; updateTotal(); drawTimeline(); }   // the scene is exactly as long as the animation
  } else {
    if (!L) { toast('Please tap an audio line first.'); return; }
    const lines = S.applyAll ? player.clips : [L];
    for (const l of lines) { const o = castOf(l.id, s.key); o.in = o.in; if (kind) o[kind] = ref; else { o.body = ref; delete o.seq; } }
  }
  const b = busy('Applying animation…');
  try { await applyLayers(); } catch (e) { console.error(e); toast(`Could not apply the animation: ${e.message}`); } finally { b.done(); }
  drawLineBox();
}

/* ---- on-canvas handles: drag to move, corner squares to resize ---- */
let previewSelect, previewChanging = false;
async function changePreviewQuality(value) {
  if (!PREVIEW_MODES[value] || value === S.previewMode || previewChanging || S.exporting) return;
  previewChanging = true; previewSelect.disabled = true;
  const resume = player.playing;
  player.pause(); const loading = busy('Changing preview quality…');
  try {
    const mode = PREVIEW_MODES[value];
    await stage.setTextureLimit(mode.maxTex);
    S.previewMode = value; S.preview = mode.short; stage.setSize(S.aspect, mode.short);
    await applyLayers(); savePreviewMode(value); fitEditor();
  } catch (error) { previewSelect.value = S.previewMode; toast(`Could not change the preview quality: ${error.message}`); }
  finally {
    previewChanging = false; previewSelect.disabled = false; previewSelect.value = S.previewMode;
    document.querySelector('.ws')?.setAttribute('data-preview-quality', S.previewMode);
    if (resume) await player.play(); S.dirty = true; loading.done();
  }
}

/* Editor zoom changes CSS dimensions only; the render/export camera is untouched. */
let stageObserver, zoomLabel;
function fitEditor() {
  const box = document.getElementById('stagebox');
  if (!box || !wrapEl || !stage) return;
  const ratio = stage.W / stage.H;
  wsEl()?.style.setProperty('--ratio', String(ratio));
  const width = Math.max(40, Math.min(box.clientWidth - 20, (box.clientHeight - 20) * ratio)) * S.editorZoom;
  wrapEl.style.width = `${width}px`; wrapEl.style.height = `${width / ratio}px`;
  if (zoomLabel) zoomLabel.value = `${Math.round(S.editorZoom * 100)}%`;
  // the floating menus cover only the canvas area, never the play / zoom controls or the timeline
  const ws = wsEl(), studio = ws?.querySelector('.studio');
  if (studio) ws.style.setProperty('--dock-bottom', `${Math.max(0, Math.round(studio.getBoundingClientRect().bottom - box.getBoundingClientRect().bottom))}px`);
  updateSel(); S.dirty = true;
}
function setEditorZoom(zoom) { S.editorZoom = Math.max(.5, Math.min(2, zoom)); fitEditor(); }

let localSaveError = '', saveDetails, saveBody, localSavedAt = 0, saveShown = null;
/** "Saved · 2 min ago" keeps counting without redrawing the whole save box */
setInterval(() => {
  if (!saveShown || !savedEl?.isConnected) return;
  const label = saveLabel(saveShown.base, saveShown.tone, saveShown.at), node = savedEl.querySelector('.save-label');
  if (node && node.textContent !== label) { node.textContent = label; savedEl.dataset.tip = label; savedEl.setAttribute('aria-label', `${label}. Open save details`); }
}, 15000);
function updateSaveStatus(state = syncStatus) {
  if (state.projectId && state.projectId !== projectContext()?.id) state = { text: 'Saved locally' };
  if (!savedEl || !saveBody) return;
  const base = localSaveError ? { label: 'Local save failed', tone: 'error' } : syncPresentation(state);
  saveShown = { base: base.label, tone: base.tone, at: state.text === 'Saved to Cloud' ? state.at : localSavedAt };
  const feedback = { ...base, label: saveLabel(base.label, base.tone, saveShown.at) };
  savedEl.replaceChildren(h('span', { class: 'save-dot', 'aria-hidden': 'true' }, icon(feedback.tone === 'saved' ? 'cloud-check' : feedback.tone === 'error' ? 'cloud-alert' : 'cloud')), h('span', { class: 'save-label' }, feedback.label));
  savedEl.dataset.tip = feedback.label;
  savedEl.setAttribute('aria-label', `${feedback.label}. Open save details`);
  saveDetails.dataset.tone = feedback.tone;
  const problem = localSaveError || state.issue?.message;
  const detail = localSaveError || state.issue?.detail || state.error;
  const retry = h('button', { class: 'btn sm', disabled: !navigator.onLine && !localSaveError, onclick: async () => {
    retry.disabled = true;
    try { await tick({ sceneCommit: true }); if (localSaveError) return; await syncCurrent(); }
    catch (error) { toast(`Sync did not complete: ${error.message}`); }
    finally { retry.disabled = false; }
  } }, localSaveError ? 'Retry local save' : 'Retry sync');
  saveBody.replaceChildren(h('b', {}, feedback.label),
    h('p', {}, problem || (feedback.tone === 'saved' ? 'Your latest changes are saved on this device and in your account.' : 'Changes save on this device first, then sync automatically when your account and connection are available.')),
    ...(detail ? [h('details', {}, h('summary', {}, 'Error details'), h('p', { class: 'save-error-detail' }, detail))] : []),
    ...(localSaveError || state.issue?.retryable || feedback.tone === 'offline' ? [retry] : []),
    ...(state.text === 'Conflict' ? [h('button', { class: 'btn sm', onclick: async () => { await tick({ sceneCommit: true }); saveDetails.open = false; location.hash = '#/toons'; } }, 'Open My Projects')] : []));
}

function mountStage() {
  selEl = h('div', { class: 'selbox', hidden: true });
  bgSelEl = h('div', { class: 'bg-sel', hidden: true, 'aria-label': 'Selected background; drag to move, drag a corner or pinch to resize' }, ...['tl', 'tr', 'bl', 'br'].map((c) => h('i', { class: `bg-hd bg-${c}`, 'data-bg': c })));
  propSelEl = h('div', { class: 'prop-sel', hidden: true, 'aria-label': 'Selected prop; drag to move' });
  handleEls = Object.fromEntries(['tl', 'tr', 'bl', 'br'].map((c) => [c, h('i', { class: `hd h-${c}`, 'data-c': c, hidden: true })]));
  tearHandlesEl = h('div', { class: 'tear-handles', hidden: true }, tearHandle('left'), tearHandle('right'));
  selToolsEl = h('div', { class: 'sel-tools', hidden: true });
  overflowEl = h('div', { class: 'of-clip', hidden: true }, h('div', { class: 'of-frame' }), h('span', { class: 'of-note' }, 'Dimmed = outside the video frame'));
  wrapEl = h('div', { class: 'stagewrap' }, stage.out, overflowEl, bgSelEl, selEl, propSelEl, ...Object.values(handleEls), tearHandlesEl, selToolsEl);
  stageObserver?.disconnect();
  const box = document.getElementById('stagebox'); box.replaceChildren(wrapEl);
  stageObserver = new ResizeObserver(fitEditor); stageObserver.observe(box); fitEditor();
  mountCamBox();
  let drag = null;
  const pointers = new Map(), pinchDist = () => { const [a, b] = [...pointers.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; };
  wrapEl.addEventListener('wheel', (e) => {            // mouse wheel over the canvas resizes the selected background (when nothing else is selected)
    const c = bgOf(); if (!c || S.exporting || S.sel || S.selectedPropId || stage.camZoom > 1.02) return;
    e.preventDefault(); bgXf(c).s = clampBgScale(bgXf(c).s * Math.exp(-e.deltaY * 0.0015)); pushBg(c);
  }, { passive: false });
  const pt = (e) => { const r = stage.out.getBoundingClientRect(), k = stage.W / r.width; return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k }; };
  const layer = () => stage.layers.find((l) => l.key === S.sel);
  wrapEl.addEventListener('pointerdown', (e) => {
    if (S.exporting || stage.overflow) return;          // while looking outside the frame the stage is view-only
    if (e.target.closest('.sel-tools')) return;   // the floating character-tools toolbar sits over the canvas; its own buttons handle their clicks
    if (camPointerDown(e)) return;
    if (syncFullView()) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const bgc = bgOf();
    if (bgc && stage.camZoom <= 1.02) {
      if (drag?.mode === 'bg' && pointers.size === 2) { drag.pinch = { d0: pinchDist() || 1, s0: bgXf(bgc).s }; return; }          // a second finger: pinch to resize
      if (e.target.dataset?.bg) {
        const r = stage.out.getBoundingClientRect(), xf = bgXf(bgc), cx = r.left + r.width / 2 + xf.x * r.width, cy = r.top + r.height / 2 + xf.y * r.height;
        drag = { mode: 'bg', kind: 'scale', c: bgc, cx, cy, r0: Math.hypot(e.clientX - cx, e.clientY - cy) || 1, s0: xf.s }; wrapEl.setPointerCapture(e.pointerId); return;
      }
    }
    const p = pt(e), hd = e.target.dataset?.c;
    if (stage.camZoom <= 1.02 && !hd) {
      const prop = [...S.props].reverse().find((x) => x.visible !== false && !coversFrame(x) && !isHeld(x) && Math.abs(p.x - x.x * stage.W) <= (x.w || .18) * stage.W / 2 && Math.abs(p.y - x.y * stage.H) <= (x.h || .18) * stage.H / 2);
      if (prop) {
        S.selectedPropId = prop.id; S.sel = null;
        drag = { mode: 'prop', prop, p0: p, x0: prop.x ?? .5, y0: prop.y ?? .65 };
        updateSel(); S.dirty = true; wrapEl.setPointerCapture(e.pointerId); return;
      }
      S.selectedPropId = null;
    }
    let l = layer();
    if (hd && l) {
      // A = the real opposite corner (stays put); C = where the handle is drawn (pinned inside the picture when the corner is off-screen)
      const b = l.box, corners = { tl: [b.x0, b.y0], tr: [b.x1, b.y0], bl: [b.x0, b.y1], br: [b.x1, b.y1] }, opp = { tl: 'br', tr: 'bl', bl: 'tr', br: 'tl' }[hd];
      const c = l.hpos?.[hd] || corners[hd];
      drag = { mode: 'scale', A: { x: corners[opp][0], y: corners[opp][1] }, C: { x: c[0], y: c[1] }, a0: { ...l.anchor }, mul0: l.mul ?? 1, tap: { x: e.clientX, y: e.clientY, t: performance.now(), pinned: e.target.classList?.contains('pinned'), key: l.key } };
    } else {
      l = stage.camZoom <= 1.02 ? stage.hitLayers(p)[0] : null;      // the character really under the mouse (its drawn shape), not just the biggest box
      S.sel = l?.key ?? null;
      if (l && doubleTapOn(l, e)) { drag = null; S.sel = l.key; historyAction(() => fitCharInFrame(l)); updateSel(); return; }          // double tap / double click: the character comes back to 100% inside the frame if (l || !bgc) dropItemSelection();          // the clip tools close when a character is touched, or when empty space is (a selected background is moved instead)
      if (l) drag = { mode: 'move', p0: p, a0: { ...l.anchor } };
      else if (bgc && stage.camZoom <= 1.02) { const xf = bgXf(bgc); drag = { mode: 'bg', kind: 'move', c: bgc, p0: { x: e.clientX, y: e.clientY }, x0: xf.x, y0: xf.y }; }          // nothing else under the finger: it moves the selected background
      updateSel(); S.dirty = true;
    }
    if (drag) wrapEl.setPointerCapture(e.pointerId);
  });
  /* right click on the stage: every character under the mouse, so one hidden behind another (or inside a big box) can still be chosen */
  let ctxMenu = null;
  const closeCtx = () => { ctxMenu?.remove(); ctxMenu = null; };
  wrapEl.addEventListener('contextmenu', (e) => {
    if (S.exporting || syncFullView() || stage.camZoom > 1.02 || e.target.dataset?.c) return;
    e.preventDefault(); closeCtx();
    const found = stage.hitLayers(pt(e)).map((l) => sOf(l.key)).filter(Boolean);
    ctxMenu = h('div', { class: 'cs-ctx', role: 'menu' }, h('b', {}, found.length ? 'Choose a character' : 'There is no character here'),
      found.map((sp) => h('button', { type: 'button', role: 'menuitem', class: S.sel === sp.key ? 'on' : '', onclick: () => { closeCtx(); selectChar(sp.key); } }, h('span', { class: 'dot', style: `background:${sp.color}` }), ` ${sp.name}`)));
    document.body.append(ctxMenu);
    ctxMenu.style.left = Math.min(e.clientX, innerWidth - ctxMenu.offsetWidth - 8) + 'px'; ctxMenu.style.top = Math.min(e.clientY, innerHeight - ctxMenu.offsetHeight - 8) + 'px';
  });
  document.addEventListener('pointerdown', (e) => { if (ctxMenu && !ctxMenu.contains(e.target)) closeCtx(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCtx(); });
  wrapEl.addEventListener('pointermove', (e) => {
    if (camPointerMove(e)) return;
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (drag?.mode === 'bg') {
      const c = drag.c, xf = bgXf(c), r = stage.out.getBoundingClientRect();
      if (drag.pinch) xf.s = clampBgScale(drag.pinch.s0 * pinchDist() / drag.pinch.d0);
      else if (drag.kind === 'scale') xf.s = clampBgScale(drag.s0 * Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy) / drag.r0);
      else { xf.x = clampBgPos(drag.x0 + (e.clientX - drag.p0.x) / r.width); xf.y = clampBgPos(drag.y0 + (e.clientY - drag.p0.y) / r.height); }
      pushBg(c); return;
    }
    if (drag?.mode === 'prop') {
      const p = pt(e), prop = drag.prop;
      prop.x = Math.max(0, Math.min(1, drag.x0 + (p.x - drag.p0.x) / stage.W));
      prop.y = Math.max(0, Math.min(1, drag.y0 + (p.y - drag.p0.y) / stage.H));
      updateSel(); S.dirty = true; return;
    }
    const l = layer();
    if (!drag || !l) return;
    const p = pt(e), W = stage.W, H = stage.H;
    let a;
    if (drag.mode === 'move') a = { x: drag.a0.x + p.x - drag.p0.x, y: drag.a0.y + p.y - drag.p0.y };
    else {
      const vx = drag.C.x - drag.A.x, vy = drag.C.y - drag.A.y;
      const r = Math.min(3 / drag.mul0, Math.max(0.2 / drag.mul0, ((p.x - drag.A.x) * vx + (p.y - drag.A.y) * vy) / (vx * vx + vy * vy)));          // 20 % ... 300 %
      l.mul = drag.mul0 * r;
      a = { x: drag.A.x + (drag.a0.x - drag.A.x) * r, y: drag.A.y + (drag.a0.y - drag.A.y) * r };
    }
    l.axf = a.x / W; l.ayf = (H - a.y) / H;
    saveXf(l); stage.layout(); updateSel(); S.dirty = true;
  });
  const end = async (e) => { pointers.delete(e?.pointerId); if (drag?.mode === 'bg') { if (!pointers.size || drag.pinch) { drag = null; S.dirty = true; } return; } if (camPointerUp()) return; if (drag?.mode === 'prop') { try { await dbPut('props', drag.prop); drawTabs(); } catch (e) { toast(`Could not save the prop's position: ${e.message}`); } } if (drag?.mode === 'scale' && drag.tap?.pinned && e?.type === 'pointerup' && performance.now() - drag.tap.t < 600 && Math.hypot(e.clientX - drag.tap.x, e.clientY - drag.tap.y) < 8) {
      // a DOUBLE tap on a handle that is stuck to the edge of the picture = the character is out of the frame: bring it back, 100%, inside (a single tap does nothing)
      const lay = stage.layers.find((x) => x.key === drag.tap.key), tap = { x: e.clientX, y: e.clientY, key: drag.tap.key, t: performance.now() }; drag = null;
      const twice = lastHandleTap && lastHandleTap.key === tap.key && tap.t - lastHandleTap.t < 450 && Math.hypot(tap.x - lastHandleTap.x, tap.y - lastHandleTap.y) < 40;
      lastHandleTap = twice ? null : tap;
      if (lay && twice) { historyAction(() => fitCharInFrame(lay)); updateSel(); } return;
    }
    if (drag && S.tab === 'motion') drawTabs(); drag = null; };
  wrapEl.addEventListener('pointerup', end); wrapEl.addEventListener('pointercancel', end);
  S.dirty = true; updateSel();
}
/** the background clip that is selected: it can be moved and resized right on the canvas (xf = offset in canvas widths / heights + scale) */
const bgOf = () => S.bgSel && S.bgClips.find((x) => x.id === S.bgSel) || null;
const bgXf = (c) => (c.xf ||= { x: 0, y: 0, s: 1 });
const clampBgScale = (v) => Math.min(6, Math.max(0.2, +v.toFixed(3))), clampBgPos = (v) => Math.min(3, Math.max(-3, +v.toFixed(4)));
function pushBg(c) { stage.setBgXf(S.bgClips.indexOf(c), c.xf); S.dirty = true; updateBgSel(); if (S.tab === 'canvas' && S.panelOpen) syncBgSize?.(); }
let syncBgSize = null;
/** dashed frame + corner handles around the selected background on the canvas */
function updateBgSel() {
  if (!bgSelEl) return;
  const c = bgOf();
  if (!c || stage.overflow || S.step !== 3 || S.exporting || player.playing || stage.camZoom > 1.02 || syncFullView()) { bgSelEl.hidden = true; return; }
  const xf = bgXf(c), cw = stage.out.clientWidth, ch = stage.out.clientHeight, w = cw * xf.s, hh = ch * xf.s;
  const x0 = Math.max(0, cw / 2 + xf.x * cw - w / 2), y0 = Math.max(0, ch / 2 + xf.y * ch - hh / 2), x1 = Math.min(cw, cw / 2 + xf.x * cw + w / 2), y1 = Math.min(ch, ch / 2 + xf.y * ch + hh / 2);
  bgSelEl.hidden = x1 <= x0 || y1 <= y0;
  Object.assign(bgSelEl.style, { left: `${x0}px`, top: `${y0}px`, width: `${Math.max(0, x1 - x0)}px`, height: `${Math.max(0, y1 - y0)}px` });
}
function saveXf(l) {
  const keys = S.charKeys[l.key];
  if (keys?.length) {
    // With keyframes (a path, a movement) the character's size belongs to the whole movement, not to one moment: every keyframe is scaled by the same amount,
    // so a smaller character stays smaller when the playhead moves. The position is a keyframe at the playhead.
    const was = stage.keyChar(keys.slice().sort((a, b) => a.t - b.t), player.time)?.mul || 1, ratio = (l.mul ?? 1) / was;
    if (Math.abs(ratio - 1) > 1e-4) { for (const k of keys) k.mul = +Math.min(3, Math.max(0.2, (k.mul || 1) * ratio)).toFixed(4); if (S.paths[l.key]) S.paths[l.key].mul = +Math.min(3, Math.max(0.2, (S.paths[l.key].mul ?? 1) * ratio)).toFixed(4); }
    const path = S.paths[l.key];
    if (path) {
      // a path is just two places (first and last): dragging the character moves the whole route, it does not add keyframes
      const was = stage.keyChar(keys.slice().sort((a, b) => a.t - b.t), player.time), nowX = l.axf ?? l.anchor.x / stage.W, nowY = l.ayf ?? (stage.H - l.anchor.y) / stage.H;
      const dx = nowX - was.axf, dy = nowY - was.ayf;
      if (Math.abs(dx) + Math.abs(dy) > 1e-4) path.pts = path.pts.map((p) => ({ x: +(p.x + dx).toFixed(4), y: +(p.y + dy).toFixed(4) }));
      applyPath(l.key); return;
    }
    writeCharKey(l); return;
  }
  const s = S.speakers.find((x) => x.key === l.key); if (s) s.xf = { mul: l.mul ?? 1, axf: l.axf, ayf: l.ayf };
}
function updateSel() {
  syncStart(); updateBgSel();
  if (stage.overflow) { selEl && (selEl.hidden = true); Object.values(handleEls).forEach((e) => { e.hidden = true; }); if (propSelEl) propSelEl.hidden = true; return; }
  if (!selEl) return;
  const fullView = syncFullView();
  const prop = S.props.find((item) => item.id === S.selectedPropId);
  if (prop && !isHeld(prop) && S.step === 3 && !fullView && stage.camZoom <= 1.02 && !player.playing) {      // a held prop has no box: it moves with the hand
    selEl.hidden = true; Object.values(handleEls).forEach((e) => { e.hidden = true; });
    hideSelBar();
    if (hintEl) hintEl.hidden = true;
    const k = stage.out.clientWidth / stage.W, w = (prop.w || .18) * stage.W * k, hgt = (prop.h || .18) * stage.H * k;
    propSelEl.hidden = false;
    Object.assign(propSelEl.style, { left: `${(prop.x ?? .5) * stage.out.clientWidth - w / 2}px`, top: `${(prop.y ?? .65) * stage.out.clientHeight - hgt / 2}px`, width: `${w}px`, height: `${hgt}px`, transform: `rotate(${prop.rotation || 0}deg)` });
    return;
  }
  if (propSelEl) propSelEl.hidden = true;
  const l = stage.layers.find((x) => x.key === S.sel);
  if (hintEl) hintEl.hidden = !!S.sel || stage.layers.length === 0;
  const hideBox = () => { selEl.hidden = true; Object.values(handleEls).forEach((e) => { e.hidden = true; }); if (selToolsEl) selToolsEl.hidden = true; };
  if (!l || l.shown === false || S.step !== 3 || fullView) { hideBox(); hideSelBar(); return; }
  if (S.tab === 'tears' && S.tearPlacement) { hideBox(); hideSelBar(); return; }
  if (selBar.dataset.key !== l.key) drawSelBar(l);
  selBar.hidden = false; drawCharBar(l);
  const r = selBar.querySelector('input[type=range]'); if (r && document.activeElement !== r) r.value = Math.round((l.mul ?? 1) * 100);
  const pct = selBar.querySelector('.pct'); if (pct) pct.textContent = `${Math.round((l.mul ?? 1) * 100)}%`;
  // the box never shows while playing or in a zoomed camera shot, so it can't cover the picture
  if (player.playing || stage.camZoom > 1.02) { hideBox(); return; }
  const k = stage.out.clientWidth / stage.W, ch = stage.out.clientHeight, cw = stage.out.clientWidth, b = l.box, m = 18;
  selEl.hidden = false;
  Object.assign(selEl.style, { left: `${b.x0 * k}px`, top: `${b.y0 * k}px`, width: `${(b.x1 - b.x0) * k}px`, height: `${(b.y1 - b.y0) * k}px` });
  // handles stay inside the picture even when the character is bigger than the frame
  l.hpos = {};
  for (const [c, [x, y]] of Object.entries({ tl: [b.x0, b.y0], tr: [b.x1, b.y0], bl: [b.x0, b.y1], br: [b.x1, b.y1] })) {
    const px = Math.min(cw - m, Math.max(m, x * k)), py = Math.min(ch - m, Math.max(m, y * k)), el = handleEls[c];
    el.hidden = false; el.style.left = `${px}px`; el.style.top = `${py}px`;
    el.classList.toggle('pinned', Math.abs(px - x * k) > 1 || Math.abs(py - y * k) > 1);
    l.hpos[c] = [px / k, py / k];
  }
  if (selToolsEl) updateSelTools(l, b, k, cw, ch);
}
/** a small floating toolbox over the selected character, for the tools that act on one character — tap a button to jump straight into that tool */
const SEL_TOOLS = [['anim', 'Animations', 'film'], ['tears', 'Tears', 'droplet'], ['mask', 'Mask', 'mask'], ['motion', 'Move', 'move'], ['props', 'Props', 'sword']];
function openCharTool(key, tab) {
  const s = sOf(key); if (!s) return;
  S.sel = key; S.animFor = key; if (tab === 'tears') S.tearFor = key; if (tab === 'motion') S.motionFor = key;
  S.tab = tab; S.panelOpen = true; dockShow('panel'); drawTabs(); updateSel(); S.dirty = true;
}
function updateSelTools(l, b, k, cw, ch) {
  if (selToolsEl.dataset.key !== l.key) {
    selToolsEl.dataset.key = l.key;
    selToolsEl.replaceChildren(...SEL_TOOLS.map(([tab, label, ic]) => h('button', { type: 'button', class: S.tab === tab && S.panelOpen ? 'on' : '', title: label, 'aria-label': label, onclick: () => openCharTool(l.key, tab) }, icon(ic))));
  } else {
    for (const [i, [tab]] of SEL_TOOLS.entries()) selToolsEl.children[i].classList.toggle('on', S.tab === tab && S.panelOpen);
  }
  selToolsEl.hidden = false;
  const w = selToolsEl.offsetWidth || SEL_TOOLS.length * 34, hgt = selToolsEl.offsetHeight || 40, m = 6;
  const above = b.y0 * k - hgt - 8, below = b.y1 * k + 8;
  const top = above >= m ? above : Math.min(below, ch - hgt - m);   // prefer just above the box; fall back below it, always kept inside the visible frame
  Object.assign(selToolsEl.style, { left: `${Math.min(Math.max(m, (b.x0 + b.x1) / 2 * k - w / 2), cw - w - m)}px`, top: `${Math.max(m, top)}px` });
}
/** select a character; one that is not in frame at the playhead gets the playhead moved to where it first appears, so its box can be shown and edited */
function selectChar(key) {
  if (!sOf(key)?.charId) return;
  S.sel = key; S.selectedPropId = null; S.animFor = key; dropItemSelection();
  const l = stage.layers.find((x) => x.key === key);
  if (l && l.shown === false && l.present?.length) { const t = Math.min(...l.present.map((x) => x.start)); if (Number.isFinite(t)) { player.seek(t); toast(`${sOf(key)?.name || 'Character'} was not in frame at this time, so the playhead was moved to its earlier shot.`); } }
  updateSel(); drawLineBox(); S.dirty = true;
}
/** two quick taps on the same character */
let lastTap = { key: null, t: 0, x: 0, y: 0 }, lastHandleTap = null;
function doubleTapOn(l, e) {
  const now = performance.now(), hit = lastTap.key === l.key && now - lastTap.t < 380 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 28;
  lastTap = hit ? { key: null, t: 0, x: 0, y: 0 } : { key: l.key, t: now, x: e.clientX, y: e.clientY };
  return hit;
}
/** size 100% and back to its own place inside the frame (a character that was dragged out of the picture or made huge / tiny) */
function fitCharInFrame(l) {
  l.mul = 1; l.axf = l.ayf = null; stage.layout();
  l.axf = l.anchor.x / stage.W; l.ayf = (stage.H - l.anchor.y) / stage.H;
  saveXf(l); stage.layout(); S.dirty = true;
}
function hideSelBar() { if (selBar) selBar.hidden = true; if (charBar) { charBar.hidden = true; charBar.dataset.key = ''; } }
const mirrorChar = (l, s) => { s.flip = !s.flip; s._flipSet = true; const cur = stage.layers.find((x) => x.key === l.key); cur.flip = s.flip; if (S.charKeys[l.key]?.length) writeCharKey(cur); stage.layout(); updateSel(); S.dirty = true; };
const resetChar = (l, s) => { s.xf = null; const cur = stage.layers.find((x) => x.key === l.key); cur.mul = 1; cur.axf = cur.ayf = null; stage.layout(); updateSel(); S.dirty = true; };
/** phone: when a character is selected, a bar with a named button for each thing you can do with it replaces the bottom menu */
/** the tool you are in is lit: the open tab, or Path while its shadow is being dragged */
function markCharBar(l) { for (const b of charBar.querySelectorAll('[data-tab]')) b.classList.toggle('on', b.dataset.tab === 'motion' ? S.pathDraw?.key === l.key : S.tab === b.dataset.tab && S.panelOpen && !S.pathDraw); }
function drawCharBar(l) {
  if (!charBar) return;
  const s = S.speakers.find((x) => x.key === l.key); if (!s) return;
  charBar.hidden = false;
  if (charBar.dataset.key === l.key) {
    markCharBar(l);
    const size = charBar.querySelector('.cb-size'), pct = charBar.querySelector('.cb-pct'); if (size && document.activeElement !== size) { size.value = Math.round((l.mul ?? 1) * 100); if (pct) pct.textContent = `${Math.round((l.mul ?? 1) * 100)}%`; }
    return;
  }
  charBar.dataset.key = l.key; queueMicrotask(() => markCharBar(l));
  const btn = (ic, text, onclick, extra = {}) => h('button', { type: 'button', class: 'cb-btn', title: text, 'aria-label': `${text}`, onclick, ...extra }, icon(ic), h('span', {}, text));
  const items = [['anim', 'Animations', 'film'], ['props', 'Props', 'sword'], ['motion', 'Path', 'route']];
  const rest = [['tears', 'Tears', 'droplet'], ['mask', 'Mask', 'mask']];
  charBar.replaceChildren(
    h('div', { class: 'cb-list' },
      ...items.map(([tab, text, ic]) => btn(ic, text, () => (tab === 'motion' ? startPathShadow(s) : openCharTool(l.key, tab)), { 'data-tab': tab })),
      btn('flip', 'Flip', () => mirrorChar(l, s), { title: 'Flip the character left / right' })),
    // everything else is one tap away in a list (no sideways scrolling to find it)
    h('details', { class: 'char-more' },
      h('summary', { title: 'More', 'aria-label': 'More character tools' }, icon('more'), h('span', {}, 'More')),
      h('div', { class: 'cb-more-list' },
        h('label', { class: 'cb-field' }, h('span', {}, 'Name'), h('input', { type: 'text', class: 'cb-name', maxlength: 80, value: s.name, 'aria-label': 'Character name', onchange: (e) => { const name = e.target.value.trim(); if (!name) { e.target.value = s.name; return; } s.name = name; s._auto = false; drawTabs(); drawLineBox(); drawTimeline(); S.dirty = true; } })),
        h('label', { class: 'cb-field' }, h('span', {}, 'Size ', h('b', { class: 'cb-pct' }, `${Math.round((l.mul ?? 1) * 100)}%`)), h('input', { type: 'range', class: 'cb-size', min: 20, max: 300, value: Math.round((l.mul ?? 1) * 100), 'aria-label': 'Character size', oninput: (e) => {
          const cur = stage.layers.find((x) => x.key === l.key); if (!cur) return;
          cur.axf ??= cur.anchor.x / stage.W; cur.ayf ??= (stage.H - cur.anchor.y) / stage.H;            // keep the feet where they are
          cur.mul = e.target.value / 100; saveXf(cur); stage.layout(); updateSel(); S.dirty = true; charBar.querySelector('.cb-pct').textContent = `${Math.round(cur.mul * 100)}%`;
        } })),
        ...rest.map(([tab, text, ic]) => btn(ic, text, () => openCharTool(l.key, tab), { 'data-tab': tab })),
        btn('rotate', 'Reset', () => resetChar(l, s)),
        btn('trash', 'Delete', () => removeCharacterFrom(s), { class: 'cb-btn danger', disabled: S.exporting }),
        btn('x', 'Done', () => { S.sel = null; selBar.dataset.key = ''; updateSel(); S.dirty = true; }, { 'aria-label': 'Close the character tools' }))));
}
function drawSelBar(l) {
  const s = S.speakers.find((x) => x.key === l.key);
  selBar.dataset.key = l.key; selBar.hidden = false;
  selBar.replaceChildren(
    h('span', { class: 'dot', style: `background:${s.color}` }), h('input', { class: 'character-name', 'aria-label': 'Selected character name', value: s.name, maxlength: 80, onchange: e => { const name = e.target.value.trim(); if (!name) { e.target.value = s.name; return; } s.name = name; s._auto = false; drawTabs(); drawLineBox(); drawTimeline(); S.dirty = true; } }),
    h('span', { class: 'pct' }, `${Math.round((l.mul ?? 1) * 100)}%`),
    h('input', { type: 'range', min: 20, max: 300, value: Math.round((l.mul ?? 1) * 100), 'aria-label': 'Size', oninput: (e) => {
      const m = e.target.value / 100, cur = stage.layers.find((x) => x.key === l.key);
      cur.axf ??= cur.anchor.x / stage.W; cur.ayf ??= (stage.H - cur.anchor.y) / stage.H; // keep feet where they are
      cur.mul = m; saveXf(cur); stage.layout(); updateSel(); S.dirty = true;
    } }),
    h('button', { class: 'btn sm icon-btn', title: 'Flip the character left / right', 'aria-label': 'Flip', onclick: () => mirrorChar(l, s) }, icon('flip')),
    h('button', { type: 'button', class: 'btn sm delete-character', title: 'Delete selected character', 'aria-label': 'Delete selected character', disabled: S.exporting, onclick: () => removeCharacterFrom(s) }, '🗑 Delete'),
    h('button', { class: 'btn sm icon-btn', title: 'Hide the box', 'aria-label': 'Hide the box', onclick: () => { S.sel = null; selBar.dataset.key = ''; updateSel(); S.dirty = true; } }, icon('x')),
    h('button', { class: 'btn sm icon-btn', title: 'Reset size & position', 'aria-label': 'Reset size and position', onclick: () => resetChar(l, s) }, icon('rotate')));
}
window.addEventListener('resize', () => fitEditor());

async function removeCharacterFrom(s) {
  if (S.exporting || !s?.charId) return;
  if ((S.manual[s.key] || []).some(clip => clip.id === S.mclip)) S.mclip = null;
  if (S.pathDraw?.key === s.key) stopPathDraw();
  if ((S.charKeys[s.key] || []).some(key => key.id === S.ckSel)) S.ckSel = null;
  delete S.solo[s.key]; delete S.manual[s.key]; delete S.charKeys[s.key]; delete S.paths[s.key];
  for (const cast of S.cast.values()) delete cast[s.key];
  s.charId = null;
  if (s.manual) { S.speakers = S.speakers.filter(speaker => speaker !== s); S.order = S.order.filter(key => key !== s.key); }
  if (S.sel === s.key) S.sel = null;
  if (S.tearFor === s.key) { S.tearFor = null; S.tearPlacement = false; }
  S.animFor = S.speakers.find(speaker => speaker.charId)?.key ?? null;
  const b = busy('Removing character…');
  try { await applyLayers(); }
  catch (error) { toast(`A problem occurred while removing the character: ${error.message}`); }
  finally { b.done(); }
  updateTotal(); drawTimeline(); drawLineBox(); drawTabs(); updateSel(); S.dirty = true;
}
async function removeBackgroundLayer() {
  if (S.exporting) return;
  S.bgId = null; S.bgClips = []; S.bgSel = null; stage.bg.preset = 0;
  await stage.setBackgroundImage(null); await syncBgClips();
  updateTotal(); drawTimeline(); drawTabs(); S.dirty = true;
}
function addCharacterTo(s) {
  chooseCharacter(s, async () => {
    const b = busy('Loading character…');
    try { const d = charOf(s); if (d) await stage.loadCharacter(d); await applyLayers(); } catch (e) { toast(e.message); }
    b.done(); if (s.charId) S.animFor = s.key;
    drawTimeline(); drawLineBox(); drawTabs(); S.dirty = true;
  });
}
/* ---- start of a scene: audio is optional, so the workbench is open from the first second ---- */
const openTab = (k) => { S.tab = k; S.panelOpen = true; drawTabs(); dockShow('panel'); };
/** the "Start your scene" card can be closed; a small "Quick start" button then brings it back (the choice is remembered on this device) */
let startHidden = false;
try { startHidden = localStorage.getItem('12toons-start-hidden') === '1'; } catch { /* the card simply stays open */ }
function syncStart() {
  const needed = !(S.lines.length > 0 || S.speakers.some((x) => x.charId));
  if (emptyEl) emptyEl.hidden = !needed || startHidden;
  if (startPill) startPill.hidden = !needed || !startHidden;
}
function setStartHidden(hidden) {
  startHidden = hidden;
  try { localStorage.setItem('12toons-start-hidden', hidden ? '1' : '0'); } catch { /* optional */ }
  syncStart();
}
function emptyCard() {
  const step = (n, title, text, label, action, kind = '') => h('li', { class: 'start-step' }, h('span', { class: 'start-n', 'aria-hidden': 'true' }, String(n)),
    h('div', { class: 'start-copy' }, h('b', {}, title), h('small', {}, text)), h('button', { class: `btn ${kind}`, onclick: action }, label));
  return h('div', { class: 'empty' }, h('div', { class: 'empty-in' },
    h('button', { class: 'start-close', type: 'button', title: 'Close this guide', 'aria-label': 'Close the quick start guide', onclick: () => setStartHidden(true) }, '✕'),
    h('b', { class: 'empty-title' }, 'Start your scene'),
    h('p', { class: 'empty-sub' }, 'Three quick steps. Audio is optional, and you can do them in any order.'),
    h('ol', { class: 'start-steps' },
      step(1, 'Add your voice lines', 'Upload audio and every voice gets its own character.', 'Add audio', () => openTab('audio'), 'pri'),
      step(2, 'Add a character', 'Choose who appears in your scene.', 'Add character', addManualCharacter, 'ok'),
      step(3, 'Pick a background', 'Set the place where your story happens.', 'Background', () => openTab('canvas'))),
    h('p', { class: 'start-note' }, 'Then choose animations in the list on the left, and press Export when you are happy.')));
}
/** a character that does not belong to any voice (works without audio) */
function newManualSpeaker() {
  const n = S.speakers.filter((s) => s.manual).length + 1;
  let key = `actor${n}`; while (S.speakers.some((s) => s.key === key)) key += 'x';
  return { key, name: `Character ${n}`, narrator: false, color: COLORS[S.speakers.length % COLORS.length], charId: null, flip: false, visible: true, manual: true };
}
/** the chosen character joins the stage (the speaker is only added once it really has a character) */
async function finishManualCharacter(s) {
  const key = s.key;
  if (!s.charId) { S.speakers = S.speakers.filter((x) => x !== s); S.order = S.order.filter((k) => k !== key); drawTabs(); return; }
  S.speakers.push(s); S.order.push(key);
  const b = busy('Loading character…');
  try { const d = charOf(s); if (d) await stage.loadCharacter(d); S.speakers.filter((x) => x.charId).forEach((x, i) => { if (!x._flipSet) x.flip = i % 2 === 1; }); await applyLayers(); } catch (e) { toast(e.message); }
  b.done(); S.animFor = key; drawTimeline(); drawLineBox(); drawTabs(); S.dirty = true;
}
function addManualCharacter() {
  const s = newManualSpeaker();
  chooseCharacter(s, () => finishManualCharacter(s));
}
/** the Audio tab card for the scene's background music */
function musicCard() {
  const file = h('input', { type: 'file', accept: 'audio/*', style: 'display:none', onchange: async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await addMusic(f); } });
  if (!S.music) return h('div', { class: 'card flat music-card' }, h('h2', {}, 'Background music'), h('p', { class: 'sub', style: 'font-size:12px;margin:0 0 8px' }, 'Optional. One song plays softly under the voices for the whole scene and repeats if it is shorter.'), h('button', { class: 'btn', type: 'button', onclick: () => file.click() }, '♪ Add music'), file);
  const m = S.music, buf = musicBuffer(m.id), dur = buf ? `${buf.duration.toFixed(0)} s` : '';
  const slider = (label, min, max, step, get, show, set) => { const out = h('output', {}, show(get())); const input = h('input', { type: 'range', min, max, step, value: get(), 'aria-label': `Music ${label.toLowerCase()}`, oninput: (e) => { out.textContent = show(+e.target.value); set(+e.target.value, false); }, onchange: (e) => set(+e.target.value, true) }); return h('label', { class: 'mix-field' }, h('span', {}, label), input, out); };
  return h('div', { class: 'card flat music-card' }, h('h2', {}, 'Background music'),
    h('div', { class: 'row', style: 'align-items:center;gap:8px;margin-bottom:6px' }, h('b', { style: 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, `♪ ${m.name}`), h('span', { class: 'chip' }, dur)),
    slider('Volume', 0, 1, 0.01, () => m.volume ?? 0.35, (v) => `${Math.round(v * 100)}%`, (v, redraw) => setMusic({ volume: v }, { redraw })),
    slider('Fade in', 0, 10, 0.5, () => m.fadeIn || 0, (v) => `${(+v).toFixed(1)} s`, (v, redraw) => setMusic({ fadeIn: v }, { redraw })),
    slider('Fade out', 0, 10, 0.5, () => m.fadeOut || 0, (v) => `${(+v).toFixed(1)} s`, (v, redraw) => setMusic({ fadeOut: v }, { redraw })),
    h('div', { class: 'row', style: 'gap:6px;margin-top:6px' },
      h('button', { class: `btn sm mix-btn ${m.muted ? 'on' : ''}`, type: 'button', 'aria-pressed': String(!!m.muted), onclick: () => setMusic({ muted: !m.muted }, { redraw: true }) }, 'Mute music'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => file.click() }, 'Replace'), file,
      h('button', { class: 'btn sm danger', type: 'button', onclick: removeMusic }, 'Remove')));
}
function tabAudio() {
  const input = h('input', { type: 'file', multiple: true, accept: '.zip,.json,.txt,audio/*', style: 'display:none', onchange: async (e) => { const f = [...e.target.files]; e.target.value = ''; await onFiles(f); } });
  const drop = h('div', { class: 'drop sm', onclick: () => input.click(),
    ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); }, ondragleave: () => drop.classList.remove('over'),
    ondrop: async (e) => { e.preventDefault(); drop.classList.remove('over'); await onFiles([...e.dataTransfer.files]); } },
    h('div', { class: 'big' }, '🎙'), h('b', {}, 'Add a ZIP or audio files'), h('p', {}, 'Name them like 001-Narrator.wav, 002-Rohan.wav. A script .json / .txt in the ZIP is read too.'), input);
  const rows = S.lines.map((l, i) => {
    const sp = S.speakers.find((x) => x.key === l.speaker.toLowerCase());
    return h('div', { class: 'item' }, h('span', { class: 'chip' }, i + 1), h('span', { class: 'dot', style: `background:${sp?.color || '#94a3b8'}` }),
      h('div', { class: 'sp', style: 'min-width:0' }, h('div', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, l.speaker), h('small', { class: 'sub', style: 'display:block;margin:0;font-size:11px' }, l.file)),
      h('span', { class: 'time' }, `${l.buffer.duration.toFixed(1)}s`),
      h('button', { class: 'ib', title: 'Remove this line', onclick: async () => { if (S.exporting) return; S.lines = S.lines.filter((x) => x.id !== l.id); await afterAudioChange(); } }, '✕'));
  });
  return h('div', { class: 'list' },
    musicCard(),
    h('p', { class: 'sub', style: 'font-size:12px;margin:0' }, 'Audio is optional. Add it when you have your voice lines — every voice then gets its own character.'),
    drop,
    S.lines.length ? h('details', { class: 'line-details', open: true }, h('summary', {}, 'Selected audio line'), lineBox) : null,
    S.lines.length ? h('div', { class: 'row' }, h('b', {}, `${S.lines.length} line${S.lines.length > 1 ? 's' : ''}`), h('span', { class: 'chip' }, `${S.lines.reduce((a, l) => a + l.buffer.duration, 0).toFixed(1)}s`), h('span', { class: 'sp' }),
      h('button', { class: 'btn sm', onclick: async () => { if (S.exporting || !confirm('Remove all audio lines?')) return; S.lines = []; await afterAudioChange(); } }, 'Clear all')) : null,
    ...rows);
}
/** outfits of a character = its skins except "default" (12toons rigs: Saree / Salvar / Business ...) */
const skinNames = (def) => (def?.rig?.skins || []).map((k) => k.name).filter((n) => n !== 'default' && !n.includes('/'));
function outfitModal(s) {
  const def = charOf(s), names = skinNames(def), cur = s.skins ?? def.skins ?? null;
  let close;
  const pick = async (v) => { s.skins = v; close(); const b = busy('Changing outfit…'); try { await applyLayers(); } finally { b.done(); } S.dirty = true; drawTabs(); };
  close = modal(`Outfit for ${s.name}`, h('div', { class: 'gridc' }, names.map((n) => h('button', { class: `cc ${cur?.length === 1 && cur[0] === n ? 'on' : ''}`, onclick: () => pick([n]) }, h('div', { class: 'th' }, h('span', {}, '👗')), h('b', {}, n === 'Buisness' ? 'Business' : n)))));
}
function tabChars() {
  // the Characters tab opens straight on the characters (page 1) and then their poses (page 2): no extra "Add character" step
  const picker = libraryCharacters().some((e) => e.template)
    ? characterPicker({ entries: libraryCharacters(), isOn: () => false, steps: true, onPick: (e) => { const sp = newManualSpeaker(); historyAction(async () => { if (await useCharacter(sp, `lib:${e.id}`)) await finishManualCharacter(sp); }); } })
    : libraryStatus() ? h('p', { class: 'sub', role: 'alert' }, libraryStatus()) : h('p', { class: 'sub' }, 'Loading characters…');
  return h('div', { class: 'list' }, picker);          // only the characters: no Prev/Next, no "More characters", no stage list (the Layers panel has it)
}
const CHARS_COLLAPSE_KEY = '12toons-chars-collapsed';
const charsCollapsed = () => { try { return localStorage.getItem(CHARS_COLLAPSE_KEY) === '1'; } catch { return false; } };
const setCharsCollapsed = (v) => { try { localStorage.setItem(CHARS_COLLAPSE_KEY, v ? '1' : '0'); } catch { /* optional */ } };

let tearHandlesEl;
const tearSpeaker = () => S.speakers.find(s => s.charId && s.key === S.tearFor) || S.speakers.find(s => s.charId && s.key === S.sel) || S.speakers.find(s => s.charId);
function updateTears(speaker, config) {
  speaker.tears = tearConfig(config);
  const layer = stage.layers.find(layer => layer.key === speaker.key);
  if (layer) layer.tears = speaker.tears;
  S.dirty = true;
}
function tabTears() {
  const chars = S.speakers.filter(speaker => speaker.charId), speaker = tearSpeaker();
  if (!speaker) return h('div', { class: 'card flat' }, h('h2', {}, 'Tears'), h('p', { class: 'sub' }, 'Add a character, then choose a tear style for their eyes.'), h('button', { class: 'btn pri', onclick: () => openTab('chars') }, 'Add a character'));
  const config = tearConfig(speaker.tears), side = S.tearEye || 'left', eye = config[side];
  const change = (key, value) => { const next = tearConfig(speaker.tears); next[key] = value; updateTears(speaker, next); };
  const changeEye = (key, value) => { const next = tearConfig(speaker.tears); next[side][key] = value; updateTears(speaker, next); };
  const slider = (label, key, min, max, step, value, set, format) => {
    const out = h('output', {}, format(value));
    return h('label', { class: 'tear-slider' }, h('span', {}, label, out), h('input', { type: 'range', 'aria-label': label, min, max, step, value, oninput: event => { const value = +event.target.value; set(key, value); out.textContent = format(value); } }));
  };
  const pick = async style => {
    const loading = busy('Loading tear style…');
    try {
      if (style) await stage.setTearSprite(await loadTearSprite());
      change('style', style);
      if (!style && !S.speakers.some(speaker => speaker.tears?.style)) await stage.setTearSprite(null);
      if (!style) S.tearPlacement = false;
      drawTabs();
    } catch (error) { toast(error.message); }
    finally { loading.done(); }
  };
  const detected = Object.keys(stage.layers.find(layer => layer.key === speaker.key)?.tearBind || {});
  return h('div', { class: 'list tears-panel' },
    h('label', { class: 'tear-character' }, 'Character', h('select', { 'aria-label': 'Tear character', onchange: event => { S.tearFor = event.target.value; S.sel = event.target.value; S.tearPlacement = false; drawTabs(); } }, chars.map(char => h('option', { value: char.key, selected: char.key === speaker.key }, char.name)))),
    h('p', { class: 'sub' }, 'Tears follow the character’s head. Pick a style, then adjust each eye.'),
    h('div', { class: 'tear-styles', 'aria-label': 'Tear styles' }, TEAR_STYLES.map(style => h('button', { class: `tear-style${config.style === style.id ? ' on' : ''}`, type: 'button', 'aria-pressed': String(config.style === style.id), 'aria-label': style.name, onclick: () => pick(style.id) },
      h('span', { class: `tear-style-preview tear-preview-${style.id}`, 'aria-hidden': 'true' }, style.id ? Array.from({length:style.id === 2 || style.id === 5 ? 2 : 1}, (_,i) => h('img', { src: TEAR_IMAGE_URL, alt: '', style: `--drop:${i}` })) : '—'), h('b', {}, style.name), h('small', {}, style.hint)))),
    !detected.length ? h('p', { class: 'sub' }, 'No visible eyes were detected in this pose. Choose a front or side pose to add tears.') : null,
    h('fieldset', { class: 'tear-settings', disabled: !config.style },
      h('legend', {}, 'Tear adjustment'),
      h('div', { class: 'seg' }, ['left', 'right'].map(eye => h('button', { class: side === eye ? 'on' : '', type: 'button', 'aria-pressed': String(side === eye), onclick: () => { S.tearEye = eye; drawTabs(); } }, eye === 'left' ? 'Left Eye' : 'Right Eye'))),
      h('label', { class: 'tog' }, h('input', { type: 'checkbox', checked: eye.enabled, onchange: event => { changeEye('enabled', event.target.checked); drawTabs(); } }), `Show tears · ${side} eye`),
      h('button', { class: `btn ${S.tearPlacement ? 'pri' : ''}`, type: 'button', 'aria-pressed': String(!!S.tearPlacement), onclick: () => { S.tearFor = speaker.key; S.tearPlacement = !S.tearPlacement; player.pause(); drawTabs(); } }, S.tearPlacement ? 'Done adjusting placement' : 'Adjust Tear Placement'),
      h('p', { class: 'tear-help' }, S.tearPlacement ? 'Drag the marker for the selected eye. Zoom in for finer placement.' : 'Left and right refer to the character’s eyes. A side pose may show only one eye.'),
      slider('Left / right', 'x', -300, 300, 1, eye.x, changeEye, value => `${Math.round(value)}%`),
      slider('Up / down', 'y', -300, 500, 1, eye.y, changeEye, value => `${Math.round(value)}%`),
      slider('Tear rotation', 'rotation', -180, 180, 1, eye.rotation, changeEye, value => `${value}°`),
      slider('Tear size', 'size', .2, 3, .05, eye.size, changeEye, value => `${Math.round(value*100)}%`),
      h('button', { class: 'btn sm', type: 'button', onclick: () => { const next = tearConfig(speaker.tears); next[side] = tearConfig()[side]; updateTears(speaker, next); drawTabs(); } }, 'Reset this eye'),
      slider('Tear speed', 'speed', .25, 3, .05, config.speed, change, value => `${value.toFixed(2)}×`),
      h('div', { class: 'tear-timing' }, h('label', {}, 'Start (s)', h('input', { type: 'number', 'aria-label': 'Tears start', min: 0, step: .1, value: config.start, onchange: event => { change('start', +event.target.value); drawTabs(); } })),
        h('label', {}, 'End (s)', h('input', { type: 'number', 'aria-label': 'Tears end', min: config.start+.05, step: .1, value: config.end ?? '', placeholder: 'Scene end', onchange: event => { change('end', event.target.value === '' ? null : +event.target.value); drawTabs(); } })))));
}
function updateTearHandles() {
  if (!tearHandlesEl) return;
  const speaker = tearSpeaker(), layer = stage.layers.find(layer => layer.key === speaker?.key);
  const show = S.tab === 'tears' && S.panelOpen && S.tearPlacement && !S.exporting && !player.playing && layer?.visible !== false && layer?.shown !== false;
  tearHandlesEl.hidden = !show;
  const camera = stage.r.cam;
  for (const side of ['left', 'right']) {
    const button = tearHandlesEl.querySelector(`[data-eye=${side}]`), frame = layer?.tearAnchors?.[side];
    button.hidden = !show || !frame || !camera || side !== (S.tearEye || 'left');
    if (button.hidden) continue;
    button.style.left = `${(frame.p.x-camera[0])*camera[2]/2*stage.out.clientWidth}px`;
    button.style.top = `${(frame.p.y-camera[1])*camera[3]/2*stage.out.clientHeight}px`;
    button.classList.toggle('active', (S.tearEye || 'left') === side);
  }
}
function tearHandle(side) {
  return h('button', { type: 'button', class: 'tear-eye-handle', 'data-eye': side, 'aria-label': `Move tears for ${side} eye`, hidden: true, onpointerdown: event => {
    event.preventDefault(); event.stopPropagation();
    const speaker = tearSpeaker(), layer = stage.layers.find(layer => layer.key === speaker?.key), frame = layer?.tearAnchors?.[side];
    if (!frame || !stage.r.cam || S.exporting) return;
    S.tearEye = side; const button = event.currentTarget, rect = stage.out.getBoundingClientRect(), camera = [...stage.r.cam];
    const ux = frame.u.x*camera[2]/2*rect.width, uy = frame.u.y*camera[3]/2*rect.height, vx = frame.v.x*camera[2]/2*rect.width, vy = frame.v.y*camera[3]/2*rect.height, det = ux*vy-uy*vx;
    if (Math.abs(det)<1e-8) return;
    const origin = {x:event.clientX,y:event.clientY}, config = tearConfig(speaker.tears), initial = {...config[side]};
    button.setPointerCapture(event.pointerId);
    const move = event => { const dx = event.clientX-origin.x, dy = event.clientY-origin.y, next = tearConfig(speaker.tears); next[side].x = initial.x+(dx*vy-dy*vx)/det*100; next[side].y = initial.y+(ux*dy-uy*dx)/det*100; updateTears(speaker,next); };
    const end = () => { button.removeEventListener('pointermove',move); button.removeEventListener('pointerup',end); button.removeEventListener('pointercancel',end); drawTabs(); };
    button.addEventListener('pointermove',move); button.addEventListener('pointerup',end); button.addEventListener('pointercancel',end);
  } }, side === 'left' ? 'L' : 'R');
}

function tabAnim() {
  const withChar = S.speakers.filter((s) => s.charId);
  if (!withChar.length) return h('p', { class: 'sub' }, 'No character on stage. Add one in the Characters tab.');
  if (!withChar.some((s) => s.key === S.animFor)) S.animFor = withChar[0].key;
  const L = lineById(S.lineSel), noAudio = !player.clips.length;
  const cur = () => { const s = sOf(S.animFor), l = lineById(S.lineSel); if (noAudio) { const o = s && S.solo[s.key]; return s ? { body: o?.body ?? defaultAnims(charOf(s)).idle, auto: !o?.body } : null; } return s && l ? resolveLine(l, s) : null; };
  const chips = () => h('div', { class: 'tabs' }, withChar.map((s) => h('button', { class: s.key === S.animFor ? 'on' : '', onclick: () => { S.animFor = s.key; drawTabs(); drawLineBox(); } }, h('span', { class: 'dot', style: `background:${s.color};display:inline-block;margin-right:6px` }), s.name)));
  const selectedRef = () => {
    const sp = sOf(S.animFor), f = S.mclip && findManual(S.mclip);
    if (f && sp && f.s?.key === sp.key && f.m.kind === 'body') return f.m.ref;          // the animation clip you tapped on the timeline (or just added) is the marked one
    const r = cur(); return r && !r.auto ? r.body : r?.body ?? null;
  };
  const idx = L ? player.clips.indexOf(L) + 1 : 0;
  return h('div', { class: 'animation-panel' },
    h('div', { class: 'animation-context' }, h('p', { class: 'hint', style: 'text-align:left;margin:0 0 6px' }, noAudio ? 'Choose an animation for this scene.' : L ? `Choosing for line ${idx} (${fmt(L.start)}–${fmt(L.end)}). Pick the audio line first on the timeline.` : 'Tap an audio line on the timeline first.')),
    h('details', { class: 'animation-options' }, h('summary', {}, 'Apply options'), h('label', { class: 'tog', style: 'margin-bottom:8px', title: 'Every tap places the animation on the timeline at the playhead, so you can stack as many as you like — the same one again too' }, h('input', { type: 'checkbox', checked: S.addMode, onchange: (e) => { S.addMode = e.target.checked; } }), '➕ Add on the timeline at the playhead (instead of replacing)'),
    noAudio ? null : h('label', { class: 'tog', style: 'margin-bottom:8px' }, h('input', { type: 'checkbox', checked: S.applyAll, onchange: (e) => { S.applyAll = e.target.checked; } }), 'Use for all lines of this character')),
    animBrowser({ getSpeaker: () => sOf(S.animFor), chips, onPick: pickAnimation, selectedRef }).el);
}

/* ---- AI director: script text -> who is on screen, which animation at which second, camera shot ---- */
const lineText = (id) => (S.script.get(id) || '').trim();
const lineBrief = (L) => (L ? { speaker: sOf(L.speaker)?.name || L.speaker, text: lineText(L.id), seconds: +(L.end - L.start).toFixed(1) } : null);
/** the animation library of a character as compact "id: name" lists (what the AI may choose from) */
function libraryFor(def) {
  const cats = categoriesFor(def.rig), byId = new Map(), animations = {}, expressions = [], hands = [], legs = [];
  for (const c of cats) for (const a of c.animations) {
    if (a.ref.source !== 'lib') continue;
    byId.set(String(a.ref.id), a.ref);
    if (c.overlay) (c.layer === 'hand' ? hands : c.layer === 'legs' ? legs : expressions).push([a.ref.id, a.name, a.length]); else (animations[c.name] ||= []).push([a.ref.id, a.name, a.length]);
  }
  return { byId, animations, expressions, hands, legs };
}
/** check the model's answer against the real characters / library and put it into the project */
/** L = {id, speaker, dur}; returns how many animation ids of the answer were unknown */
/** the AI says who walks from where to where: it becomes the character's own walk clip for this line, with one path (two places) on it */
function applyMoves(L, moves, libs) {
  let dropped = 0;
  for (const s of S.speakers.filter((x) => x.charId)) {          // an earlier AI walk of this line is replaced, never doubled
    const old = (S.manual[s.key] || []).filter((m) => m.ai === L.id);
    for (const m of old) { S.manual[s.key] = S.manual[s.key].filter((x) => x !== m); if (S.paths[s.key]?.clipId === m.id) { delete S.paths[s.key]; applyPath(s.key); } }
  }
  if (!moves || typeof moves !== 'object' || L.start == null) return 0;
  const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d), clean = (p, d) => ({ x: +num(p?.x, -0.3, 1.3, d.x).toFixed(3), y: +num(p?.y, 0, 1, d.y).toFixed(3) });
  for (const [key, mv] of Object.entries(moves)) {
    const s = S.speakers.find((x) => x.charId && x.key === String(key).toLowerCase()), ref = s && libs.get(s.key)?.byId.get(String(mv?.anim));
    if (!s || !ref) { dropped++; continue; }
    if (ref.layer && ref.layer !== 'body') { dropped++; continue; }
    const now = charNow(s.key), A = clean(mv.from, { x: now?.x ?? 0.3, y: now?.y ?? 0.1 }), B = clean(mv.to, { x: A.x + 0.3, y: A.y });
    if (Math.hypot(B.x - A.x, B.y - A.y) < 0.03) continue;
    const m = { id: uid(), kind: 'body', ref: { ...ref }, start: +L.start.toFixed(2), dur: Math.max(0.5, +L.dur.toFixed(2)), off: 0, ai: L.id };
    (S.manual[s.key] ||= []).push(m);
    if (typeof mv.flip === 'boolean') { s.flip = mv.flip; s._flipSet = true; const lay = stage.layers.find((x) => x.key === s.key); if (lay) lay.flip = s.flip; }
    S.paths[s.key] = { pts: [A, B], depth: DEPTH_DEFAULT, clipId: m.id, start: m.start, dur: m.dur, smooth: false, flipBase: !!s.flip, mul: now?.mul ?? 1 };
    applyPath(s.key);
  }
  return dropped;
}
function applyDirection(L, res, libs) {
  let dropped = 0;
  const onStage = S.speakers.filter((s) => s.charId);
  const keys = new Set(onStage.map((s) => s.key));
  const want = new Set((Array.isArray(res.in_frame) ? res.in_frame : []).map(String).filter((k) => keys.has(k)));
  const sp = onStage.find((s) => s.key === String(L.speaker).toLowerCase());
  if (sp) want.add(sp.key);
  if (!want.size && onStage[0]) want.add(onStage[0].key);
  const dur = L.dur;
  for (const s of onStage) {
    const o = castOf(L.id, s.key), lib = libs.get(s.key);
    o.in = want.has(s.key); delete o.body; delete o.seq; delete o.face; delete o.hand; delete o.legs;
    if (!o.in) continue;
    const raw = Array.isArray(res.actions?.[s.key]) ? res.actions[s.key] : [];
    const list = raw.map((g) => ({ at: Math.max(0, Math.min(dur - 0.3, +g.at || 0)), ref: lib.byId.get(String(g.anim)) })).filter((g) => { if (!g.ref) dropped++; return g.ref; }).sort((a, b) => a.at - b.at);
    if (list.length) { list[0].at = 0; o.seq = list.map((g) => ({ at: +g.at.toFixed(2), ref: { ...g.ref } })); }
    for (const [kind, field] of [['face', 'expression'], ['hand', 'hand'], ['legs', 'legs']]) {
      const ref = lib.byId.get(String(res[field]?.[s.key]));
      if (ref && (ref.layer || 'face') === kind) o[kind] = { ...ref };
    }
  }
  dropped += applyMoves(L, res.move, libs);
  const type = ['wide', 'medium', 'close'].includes(res.shot?.type) ? res.shot.type : 'wide';
  S.shots.set(L.id, { type, focus: want.has(res.shot?.focus) ? res.shot.focus : 'auto' });
  return dropped;
}
async function runDirector(lines) {
  const ai = S.ai;
  if (!ai.key) { toast('Please enter your OpenRouter API key first.'); return; }
  const onStage = S.speakers.filter((s) => s.charId && charOf(s));
  if (!onStage.length) { toast('Please place at least one character on the stage first.'); return; }
  const need = new Set();
  for (const L of lines) { const i = player.clips.indexOf(L); for (const c of [player.clips[i - 1], L, player.clips[i + 1]]) if (c && !lineText(c.id)) need.add(c); }
  if (need.size) { await runTranscribe([...need]); if ([...need].some((c) => !lineText(c.id))) return; }   // no script in the bundle: the AI listens to the audio first
  const libs = new Map(onStage.map((s) => [s.key, libraryFor(charOf(s))]));
  const first = libs.get(onStage[0].key);
  const characters = onStage.map((s) => ({ key: s.key, name: s.name }));
  const ctrl = new AbortController(), b = busy('AI is directing…', () => ctrl.abort());
  let prevDir = null, done = 0;
  try {
    for (const L of lines) {
      b.set(`AI is directing line ${player.clips.indexOf(L) + 1} (${++done}/${lines.length})…`, (done - 1) / lines.length);
      const i = player.clips.indexOf(L);
      const res = await direct(ai, {
        previous: lineBrief(player.clips[i - 1]), current: { index: i + 1, ...lineBrief(L) }, next: lineBrief(player.clips[i + 1]),
        characters, animations: first.animations, expressions: first.expressions, previous_direction: prevDir,
      }, ctrl.signal);
      applyDirection({ id: L.id, speaker: L.speaker, dur: L.end - L.start, start: L.start }, res, libs);
      prevDir = { shot: S.shots.get(L.id), in_frame: onStage.filter((s) => castOf(L.id, s.key).in).map((s) => s.key), actions: res.actions, move: res.move, reason: res.reason };
      await applyLayers(); drawLineBox(); drawTimeline();
    }
    toast('AI direction applied — press Play, or Undo (↶) to go back.');
  } catch (e) { if (e.name !== 'AbortError') { console.error(e); toast(`AI: ${e.message}`); } } finally { b.done(); }
}
async function runTranscribe(lines) {
  if (!S.ai.key) { toast('Please enter your OpenRouter API key first.'); return; }
  const ctrl = new AbortController(), b = busy('AI is writing the script…', () => ctrl.abort());
  let done = 0, next = 0, failed = null;
  const worker = async () => {
    while (next < lines.length && !ctrl.signal.aborted) {
      const L = lines[next++], full = S.lines.find((x) => x.id === L.id);
      try { S.script.set(L.id, await transcribe(S.ai, full.buffer, ctrl.signal)); } catch (e) { if (e.name !== 'AbortError') failed = e; ctrl.abort(); }
      b.set(`AI is writing the script… ${++done}/${lines.length}`, done / lines.length); S.dirty = true;
    }
  };
  try { await Promise.all([worker(), worker(), worker()]); } finally { b.done(); }
  if (failed) toast(`AI: ${failed.message}`);
  drawTabs();
}
/* ---- auto-direct with ANY AI: download a brief (.txt), give it to Claude / ChatGPT / Gemini, import the file it returns ---- */
const motionCache = new Map();
const lineList = () => S.lines.map((l) => { const key = l.speaker.toLowerCase(); return { id: l.id, speaker: key, name: S.speakers.find((s) => s.key === key)?.name || l.speaker, dur: l.buffer.duration, file: l.file, text: lineText(l.id) }; });
const download = (name, text) => { const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })), download: name }); document.body.append(a); a.click(); a.remove(); };
async function makeBriefFile() {
  const chars = S.speakers.filter((s) => s.charId && charOf(s));
  if (!chars.length) { toast('Please choose at least one character first.'); return; }
  const b = busy('Preparing the brief…');
  try {
    const libs = new Map(chars.map((s) => [s.key, libraryFor(charOf(s))]));
    const sig = (lib) => [...lib.byId.keys()].sort((x, y) => x - y).join(',');
    const groupsBy = new Map();
    for (const s of chars) { const k = sig(libs.get(s.key)); (groupsBy.get(k) || groupsBy.set(k, { lib: libs.get(s.key), users: [] }).get(k)).users.push(s.key); }
    const ids = [...new Set([...libs.values()].flatMap((l) => [...l.byId.values()].map((r) => r.id)))];
    const files = new Map([...libs.values()].flatMap((l) => [...l.byId.values()].map((r) => [r.id, r.file])));
    let done = 0;
    const queue = ids.filter((id) => !motionCache.has(id));
    const worker = async () => { while (queue.length) { const id = queue.shift(); try { motionCache.set(id, describeMotion(await fetchAnimation(files.get(id)))); } catch { motionCache.set(id, ''); } b.set('Reading how every animation moves…', ++done / Math.max(1, ids.length)); } };
    await Promise.all([worker(), worker(), worker(), worker()]);
    const fill = ([id, name, length]) => ({ id, name, length, motion: motionCache.get(id) });
    const groups = [...groupsBy.values()].map((g, i) => ({
      id: String.fromCharCode(65 + i), users: g.users,
      animations: Object.fromEntries(Object.entries(g.lib.animations).map(([cat, list]) => [cat, list.map(fill)])), expressions: g.lib.expressions.map(fill), hands: g.lib.hands.map(fill), legs: g.lib.legs.map(fill),
    }));
    const groupOf = (key) => groups.find((g) => g.users.includes(key)).id;
    const text = buildBrief({
      projectName: '12toons project',
      characters: chars.map((s) => ({ key: s.key, name: s.name, character: charOf(s).name, pose: charOf(s).pose, group: groupOf(s.key) })),
      groups, lines: lineList(),
    });
    download('12toons-brief.txt', text);
    toast('Brief downloaded — give this file to Claude / ChatGPT / Gemini, then import the file it sends back.');
  } catch (e) { console.error(e); toast(`Could not prepare the brief: ${e.message}`); } finally { b.done(); }
}
async function importDirectionFile(file) {
  const chars = S.speakers.filter((s) => s.charId && charOf(s));
  if (!chars.length) { toast('Please choose at least one character first.'); return; }
  let data;
  try { data = extractJson(await file.text()); } catch (e) { toast(e.message); return; }
  const entries = Array.isArray(data.lines) ? data.lines : Array.isArray(data) ? data : [];
  if (!entries.length) { toast('That file does not have a "lines" list.'); return; }
  const libs = new Map(chars.map((s) => [s.key, libraryFor(charOf(s))]));
  const list = lineList();
  let applied = 0, dropped = 0;
  for (const e of entries) {
    const l = list[(+e.line || 0) - 1];
    if (!l) continue;
    dropped += applyDirection({ id: l.id, speaker: l.speaker, dur: l.dur, start: lineById(l.id)?.start }, e, libs); applied++;
  }
  S.dirty = true;
  if (S.step === 3) { const b = busy('Applying the direction…'); try { await applyLayers(); drawLineBox(); drawTimeline(); } catch (e) { toast(`Could not apply it: ${e.message}`); } finally { b.done(); } }
  const notes = [...(data.animation_notes || []).map((n) => `Animation ${n.anim}: ${n.note}`), ...entries.filter((e) => e.note && /change|fix|problem|issue|wrong/i.test(e.note)).map((e) => `Line ${e.line}: ${e.note}`)];
  modal('Direction imported', h('div', { class: 'list' },
    h('p', {}, `Applied to ${applied} of ${list.length} lines.`),
    dropped ? h('p', { class: 'warn' }, `${dropped} animation id${dropped > 1 ? 's were' : ' was'} not in the library and skipped.`) : null,
    applied < list.length ? h('p', { class: 'sub' }, 'Lines the AI left out keep the automatic speaker / listener setup.') : null,
    notes.length ? h('div', {}, h('b', {}, 'Notes from the AI'), h('ul', { style: 'margin:6px 0 0 18px;font-size:13px' }, notes.map((n) => h('li', {}, n)))) : null,
    h('p', { class: 'sub' }, S.step === 3 ? 'Press Play to see it. Undo (↶) brings your old setup back.' : 'Open the studio to see it.')));
}
function autoDirectCard() {
  const file = h('input', { type: 'file', accept: '.json,.txt,application/json,text/plain', style: 'display:none', onchange: async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) await importDirectionFile(f); } });
  const withText = S.lines.filter((l) => lineText(l.id)).length;
  return h('div', { class: 'card flat adc' }, h('h2', {}, '✨ Auto-direct with any AI'),
    h('ol', { class: 'adc-steps' },
      h('li', {}, h('b', {}, 'Download'), ' the brief (instructions + characters + every animation + your script).'),
      h('li', {}, h('b', {}, 'Give'), ' that file to Claude, ChatGPT or Gemini. It decides every scene and sends a file back.'),
      h('li', {}, h('b', {}, 'Import'), ' that file here — it is applied to every dialogue.')),
    h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
      h('button', { class: 'btn pri', onclick: makeBriefFile }, '⬇ Download brief (.txt)'),
      h('button', { class: 'btn ok', onclick: () => file.click() }, '⬆ Import AI file'), file),
    h('p', { class: 'hint', style: 'text-align:left;margin:8px 0 0' }, `${withText}/${S.lines.length} lines have script text${withText < S.lines.length ? ' (the rest: the AI judges from the speaker and nearby lines)' : ''}.`));
}

function tabAi() {
  const ai = S.ai, set = (patch) => { Object.assign(ai, patch); saveAi(ai); };
  const dl = h('datalist', { id: 'ai-models' }, h('option', { value: ai.model }));
  const L = lineById(S.lineSel);
  const rows = player.clips.map((c, i) => h('div', { class: `ailine ${c.id === S.lineSel ? 'on' : ''}` },
    h('div', { class: 'row', style: 'margin-bottom:4px' }, h('span', { class: 'chip' }, i + 1), h('b', { style: 'font-size:13px' }, sOf(c.speaker)?.name || c.speaker), h('span', { class: 'sp' }), h('span', { class: 'time' }, `${(c.end - c.start).toFixed(1)}s`),
      h('button', { class: 'ib', title: 'Write this line with AI', onclick: async () => { await runTranscribe([c]); } }, '🎙')),
    h('textarea', { class: 'aitxt', rows: 2, placeholder: 'What is said in this line…', onfocus: () => selectLine(c.id, false), oninput: (e) => { S.script.set(c.id, e.target.value); S.dirty = true; } }, S.script.get(c.id) || '')));
  const missing = player.clips.filter((c) => !lineText(c.id));
  return h('div', { class: 'list' }, autoDirectCard(),
    h('details', { class: 'card flat' }, h('summary', { style: 'cursor:pointer;font-weight:600' }, 'Script text (used in the brief — edit only to fix)'),
      h('div', { class: 'ailines' }, rows)),
    h('details', { class: 'card flat' }, h('summary', { style: 'cursor:pointer;font-weight:700' }, 'Or direct inside the app with OpenRouter (needs an API key)'),
    h('div', { class: 'card flat' }, h('h2', {}, '1 · OpenRouter'),
      h('p', { class: 'sub', style: 'font-size:12px;margin:0 0 8px' }, 'Your key stays in this browser only and is sent only to openrouter.ai.'),
      h('input', { type: 'password', placeholder: 'OpenRouter API key (sk-or-…)', value: ai.key, autocomplete: 'off', onchange: (e) => set({ key: e.target.value.trim() }) }),
      h('input', { type: 'text', style: 'margin-top:8px', list: 'ai-models', placeholder: 'Model id', value: ai.model, onchange: (e) => set({ model: e.target.value.trim() || ai.model }) }), dl,
      h('button', { class: 'btn sm', style: 'margin-top:8px', onclick: async (e) => {
        const btn = e.currentTarget; btn.disabled = true;
        try { const ids = await listModels(); dl.replaceChildren(...ids.map((id) => h('option', { value: id }))); toast(`${ids.length} Gemini models found — tap the model field to pick the flash one.`); } catch (er) { toast(`Could not load models: ${er.message}`); }
        btn.disabled = false;
      } }, 'Find Gemini models')),
    h('div', { class: 'card flat' }, h('h2', {}, '2 · Direct with AI'),
      h('p', { class: 'sub', style: 'font-size:12px;margin:0 0 8px' }, `The AI picks who is on screen, which animation plays at which second and the camera shot, line by line (it sees the previous, current and next line). ${player.clips.length - missing.length}/${player.clips.length} lines already have script text${missing.length ? ' — for the rest it listens to the audio first' : ''}. Undo (↶) brings your old setup back.`),
      h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
        h('button', { class: 'btn pri', onclick: () => runDirector([...player.clips]) }, '✨ Direct all lines'),
        h('button', { class: 'btn', disabled: !L, onclick: () => runDirector([L]) }, 'Only this line')))));
}

/* ---- props & effects: the library admins publish (props, effects) plus the user's own pictures ---- */
const sizingProps = new Set();                    // props whose picture size is being read
/** paid-only library items (the default) are shown to everyone but only paid accounts and admins can add them; the server checks this too */
let planAsked = false;
const assetLocked = (asset) => lockedFor(asset, currentPlan().tier);
const lockHint = () => { toast(PAID_MESSAGE); };
function askPlan() { if (planAsked) return; planAsked = true; refreshPlan().then(() => { if (['props', 'effects', 'canvas'].includes(S.tab)) redrawPanel(); }).catch(() => {}); }
const lockBadge = () => h('span', { class: 'lock-badge' }, '🔒 Paid');
const sharedBlobs = new Map();                    // library asset id -> its file, so each file is downloaded once per tab
const libraryFilter = { prop: 'all', effect: 'all' };
/** pick up what admins published since this tab loaded (the list is cached for a few minutes; the button forces a fresh read) */
async function refreshShared(fresh = false) {
  try {
    const next = await listStudioAssets({ fresh });
    if (JSON.stringify(next.map((a) => [a.id, a.updatedAt])) !== JSON.stringify(S.sharedAssets.map((a) => [a.id, a.updatedAt]))) { S.sharedAssets = next; return true; }
  } catch (e) { if (fresh) toast(`Could not load the library: ${friendlyError(e)}`); }
  return false;
}
const coversFrame = (prop) => isEffect(prop) && (prop.w ?? 1) >= 0.99 && (prop.h ?? 1) >= 0.99;
async function libraryBlob(asset) {
  const known = sharedBlobs.get(asset.id) || S.props.find((prop) => prop.assetId === asset.id)?.blob;
  if (known) return known;
  const blob = await downloadStudioAsset(asset); sharedBlobs.set(asset.id, blob); return blob;
}
/** the pixel size of a picture, so a prop can be placed at its real size */
async function imageSize(blob) { const bitmap = await createImageBitmap(blob); const size = { w: bitmap.width, h: bitmap.height }; bitmap.close?.(); return size; }
async function putProp(prop) {
  await dbPut('props', prop); S.props.push(prop); S.selectedPropId = prop.id;
  await stage.setProps(S.props); S.dirty = true; drawTabs(); updateSel();
}
async function addLibraryProp(asset, hold = null) {
  if (!hold && S.props.some((p) => p.assetId === asset.id)) return;                       // the same picture is added once
  const loading = busy(asset.type === 'effect' ? 'Applying effect…' : 'Applying prop…');
  try {
    const blob = await libraryBlob(asset);
    let prop = propFromAsset(asset, blob, crypto.randomUUID());
    if (!isEffect(prop)) { const size = await imageSize(blob); prop = placeProp(prop, size.w, size.h, aspectOf(S.aspect)); }      // a prop keeps the size and shape of its picture
    if (hold && !isEffect(prop)) prop = { ...prop, rotation: -90, attach: { key: hold.key, hand: hold.hand } };              // a hand prop starts in the chosen hand of the selected character
    await putProp(prop);
  }
  catch (e) { toast(`Could not add the ${asset.type === 'effect' ? 'effect' : 'prop'}: ${friendlyError(e)}`); }
  finally { loading.done(); }
}
async function addOwnProps(files) {
  try {
    for (const f of files) {
      if (!f.type.startsWith('image/')) { toast('Please choose an image file only.'); continue; }
      const size = await imageSize(f);
      await putProp(placeProp({ id: crypto.randomUUID(), kind: 'prop', name: f.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'My prop', blob: f, x: .5, y: .66, w: .18, h: .18, rotation: 0, visible: true }, size.w, size.h, aspectOf(S.aspect)));
    }
  } catch (e) { toast(`Could not add the prop: ${friendlyError(e)}`); }
}
/** a search box for a tile grid: tiles whose name does not contain the text are hidden (the "+" tile stays) */
const filterTiles = (grid) => { const q = (grid.dataset.q || '').trim().toLowerCase(); for (const t of grid.querySelectorAll('.tile:not(.add)')) t.hidden = !!q && !(t.dataset.name || '').includes(q); };
const tileSearch = (grid, label) => h('input', { type: 'search', class: 'tile-search', placeholder: `Search ${label} by name…`, 'aria-label': `Search ${label} by name`, oninput: (e) => { grid.dataset.q = e.target.value; filterTiles(grid); } });
/** one picture tile of the Props / Effects / Background lists (same look as the animation cards): a picture with its name underneath; `add` makes the dashed "+" tile */
function tile({ src, icon: glyph = '🖼', name, on, locked, add, cover, title, onclick, onremove, onview, viewing, onhold }) {
  // onhold: pressing and holding the tile (half a second) opens its options instead of adding it
  let timer = 0, held = false;
  const cancel = () => { clearTimeout(timer); timer = 0; };
  const holdProps = onhold ? {
    onpointerdown: (e) => { held = false; cancel(); const x = e.clientX, y = e.clientY; timer = setTimeout(() => { held = true; onhold(); }, 550); e.currentTarget._at = { x, y }; },
    onpointermove: (e) => { const a = e.currentTarget._at; if (a && Math.hypot(e.clientX - a.x, e.clientY - a.y) > 10) cancel(); },
    onpointerup: cancel, onpointercancel: cancel, onpointerleave: cancel, oncontextmenu: (e) => { e.preventDefault(); cancel(); if (!held) { held = true; onhold(); } },
  } : {};
  return h('button', { type: 'button', 'data-name': String(name || '').toLowerCase(), class: `tile${add ? ' add' : ''}${on ? ' on' : ''}${locked ? ' locked' : ''}${cover ? ' cover' : ''}`, title: title || name, 'aria-disabled': locked ? 'true' : undefined, ...holdProps, onclick: (e) => { if (held) { held = false; e.preventDefault(); return; } onclick?.(e); } },
    locked ? lockBadge() : null,
    h('span', { class: 'tile-pic' }, add ? h('span', { class: 'tile-plus' }, '+') : src ? h('img', { src, alt: '', loading: 'lazy', decoding: 'async' }) : glyph),
    h('span', { class: 'tile-name' }, h('b', {}, name)),
    onview ? h('span', { class: `eye${viewing ? ' on' : ''}`, role: 'button', 'aria-label': viewing ? `Hide ${name}` : `Show ${name}`, title: viewing ? 'Showing: tap to hide' : 'Hidden: tap to show', onclick: (e) => { e.stopPropagation(); onview(); } }, icon(viewing ? 'eye' : 'eye-off')) : null,
    onremove ? h('span', { class: 'x', role: 'button', 'aria-label': `Delete ${name}`, title: 'Delete', onclick: (e) => { e.stopPropagation(); onremove(); } }, '✕') : null);
}
function libraryTab(kind) {
  if (!libraryTab.checked) { libraryTab.checked = true; refreshShared().then((changed) => { if (changed && (S.tab === 'props' || S.tab === 'effects')) redrawPanel(); }); }
  const effects = kind === 'effect', label = effects ? 'Effects' : 'Objects', glyph = effects ? '💫' : '🪵';
  const typed = S.sharedAssets.filter((asset) => asset.type === kind);
  const assets = kind === 'prop' ? typed.filter((asset) => !isHandAsset(asset)) : typed;          // hand props are listed in the toolbox of a selected character
  const handAssets = kind === 'prop' ? typed.filter(isHandAsset) : [];
  const holder = S.speakers.find((sp) => sp.charId && sp.key === S.sel);
  const categories = [...new Set(assets.map((asset) => asset.category || 'Other'))].sort();
  if (libraryFilter[kind] !== 'all' && !categories.includes(libraryFilter[kind])) libraryFilter[kind] = 'all';
  const shown = assets.filter((asset) => libraryFilter[kind] === 'all' || (asset.category || 'Other') === libraryFilter[kind]);
  const chip = (value, text) => h('button', { type: 'button', class: `btn sm ${libraryFilter[kind] === value ? 'pri' : ''}`, 'aria-pressed': String(libraryFilter[kind] === value), onclick: () => { libraryFilter[kind] = value; redrawPanel(); } }, text);
  askPlan();
  const ownFile = h('input', { type: 'file', accept: 'image/*', multiple: true, style: 'display:none', onchange: async (e) => { const files = [...e.target.files]; e.target.value = ''; await addOwnProps(files); } });
  // one picture is added once: tapping it again selects the copy that is already in the scene. Eye = show / hide it, ✕ = take it out of the scene
  const inScene = (asset) => S.props.find((p) => p.assetId === asset.id);
  const own = effects ? [] : S.props.filter((p) => !isEffect(p) && !p.assetId && p.blob);
  const pick = (p) => { S.selectedPropId = p.id; S.sel = null; S.dirty = true; drawTabs(); updateSel(); };
  const removeProp = async (p) => { await dbDel('props', p.id); S.props = S.props.filter((x) => x.id !== p.id); if (S.selectedPropId === p.id) S.selectedPropId = null; await stage.setProps(S.props); S.dirty = true; drawTabs(); updateSel(); drawTimeline(); };
  const toggleProp = (p) => { p.visible = p.visible === false; stage.setProps(S.props); S.dirty = true; dbPut('props', p); drawTabs(); };
  const controls = (p) => ({ on: p.id === S.selectedPropId, viewing: p.visible !== false, onview: () => toggleProp(p), onremove: () => removeProp(p) });
  const tileOf = (asset) => { const locked = assetLocked(asset), p = inScene(asset); return tile({ src: asset.thumb, icon: glyph, name: asset.name, locked, title: locked ? `Paid accounts only: ${asset.name}` : p ? `Already in the scene: tap to select it` : `${effects ? `${asset.sheet ? 'Animated' : 'Still'} · ${asset.blend || 'normal'} · ` : ''}Add to scene: ${asset.name}`,
    onclick: () => (locked ? lockHint() : p ? pick(p) : addLibraryProp(asset)), ...(p ? controls(p) : {}) }); };
  const ownTile = (p) => tile({ src: URL.createObjectURL(p.blob), name: p.name, title: `${p.name} (tap to select it)`, onclick: () => pick(p), ...controls(p) });
  const grid = h('div', { class: 'tile-grid' }, effects ? null : tile({ add: true, name: 'Add image', title: 'Add your own image from this device', onclick: () => ownFile.click() }), own.map(ownTile), shown.map(tileOf));
  const handCard = (asset) => { const locked = assetLocked(asset); return h('button', { class: `studio-shared-card lib-card hand-card${locked ? ' locked' : ''}`, type: 'button', 'aria-disabled': locked ? 'true' : undefined, title: locked ? `Paid accounts only: ${asset.name}` : `Put in ${holder?.name || 'the character'}'s hand: ${asset.name}`, onclick: () => (locked ? lockHint() : addLibraryProp(asset, { key: holder.key, hand: 'R' })) },
    locked ? lockBadge() : null,
    asset.thumb ? h('img', { src: asset.thumb, alt: '', loading: 'lazy', decoding: 'async' }) : h('span', {}, '🤚'), h('b', {}, asset.name), h('small', {}, locked ? 'Paid accounts only' : (asset.category || 'Hand prop'))); };
  const handBlock = !handAssets.length ? [] : [h('div', { class: 'card flat hand-props' }, h('h2', {}, '🤚 Props'),
    holder ? h('p', { class: 'sub studio-help' }, `Tap a prop to put it in ${holder.name}'s right hand.`)
      : h('p', { class: 'sub studio-help' }, 'Select a character on the stage to see the hand props. They go straight into that character\'s hand.'),
    holder ? h('div', { class: 'studio-shared-grid' }, handAssets.map(handCard)) : null)];
  return h('div', { class: 'list' },
    ...handBlock,
    h('div', { class: 'card flat' }, h('h2', {}, label),
      categories.length > 1 ? h('div', { class: 'studio-asset-tabs lib-chips' }, chip('all', 'All'), ...categories.map((name) => chip(name, name))) : null,
      tileSearch(grid, label.toLowerCase()), grid,
      !shown.length && !own.length ? h('p', { class: 'sub studio-library-empty' }, assets.length ? 'There is nothing in this category.' : `No shared ${label.toLowerCase()} have been published yet. They are added from the Add Assets tab in the admin panel.`) : null,
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, h('button', { class: 'btn sm', type: 'button', title: 'See what the admin has newly published', onclick: async () => { await refreshShared(true); redrawPanel(); } }, '↻ Check for new')), ownFile));
}

/** backgrounds made in the Background Generator (kept in the account's database): one click copies the picture into this project and uses it */
function generatedTiles(pick, grid) {
  const owner = projectContext()?.uid;
  if (!owner) return;
  listBgLibrary(owner).then((all) => {
    grid.append(...all.map((g) => {
      const url = URL.createObjectURL(g.thumb || g.blob);
      return tile({ src: url, name: g.name, cover: true, on: S.bgId === `gen-${g.id}`, title: `${g.name} · ${g.w} × ${g.h} (made in the Background Generator)`, onclick: async () => {
        try {
          let rec = S.myBgs.find((r) => r.id === `gen-${g.id}`);
          if (!rec) { rec = { id: `gen-${g.id}`, name: g.name, blob: g.blob }; await dbPut('backgrounds', rec); S.myBgs.push(rec); }
          await pick(rec);
        } catch (e) { toast(`Could not add the background: ${e.message}`); }
      } });
    })); filterTiles(grid);
  }).catch(() => { /* the other backgrounds still show */ });
}
function tabCanvas() {
  const seg = (items, cur, on) => h('div', { class: 'seg' }, items.map(([k, l]) => h('button', { class: String(cur()) === String(k) ? 'on' : '', onclick: (e) => { on(k); e.currentTarget.parentNode.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', String(items[i][0]) === String(k))); } }, l)));
  const file = h('input', { type: 'file', accept: 'image/*', multiple: true, style: 'display:none', onchange: async (e) => {
    let last = null;
    for (const f of e.target.files) { const rec = { id: `bg${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: f.name, blob: f }; await dbPut('backgrounds', rec); S.myBgs.push(rec); last = rec; }
    S.dirty = true; if (last) await addBgClip(last); else drawTabs();          // the new picture goes on the timeline as a 5 s clip
  } });
  const addBgClip = async (rec, preset = 0) => {
    if (S.bgReplace && await replaceBgWith(rec, preset)) return;
    const start = snapTo(Math.max(0, player.time)), c = { id: uid(), bgId: rec?.id ?? null, preset, start, dur: 5 };          // a background is always a 5 s clip at the playhead; the user stretches it as far as it should go
    S.bgClips.push(c); S.bgSel = c.id; await syncBgClips(); updateTotal(); drawTimeline(); drawTabs();
  };
  const pickBg = async (rec, preset) => {
    if (S.bgReplace && await replaceBgWith(rec, preset)) return;
    return addBgClip(rec, preset ?? stage.bg.preset);
  };
  askPlan();
  const shared = (type) => S.sharedAssets.filter((asset) => asset.type === type);
  const addSharedBackground = async (asset) => {
    try {
      const blob = await downloadStudioAsset(asset), id = `shared-${asset.id}`;
      let rec = S.myBgs.find((item) => item.id === id);
      if (!rec) { rec = { id, name: asset.name, blob }; await dbPut('backgrounds', rec); S.myBgs.push(rec); }
      await pickBg(rec);
    } catch (e) { toast(`Could not add the background: ${e.message}`); }
  };
  const sharedTile = (asset) => { const locked = assetLocked(asset); return tile({ src: asset.thumb, name: asset.name, cover: true, locked, title: locked ? `Paid accounts only: ${asset.name}` : `Shared library · tap to add: ${asset.name}`, onclick: () => (locked ? lockHint() : addSharedBackground(asset)) }); };
  const removeBg = async (r) => {
    if (S.scenes.some(scene => scene.id !== S.sceneId && (scene.doc?.bgId === r.id || scene.doc?.bgClips?.some((c) => c.bgId === r.id)))) { toast('This background is being used in another scene.'); return; }
    await dbDel('backgrounds', r.id); S.myBgs = S.myBgs.filter((x) => x.id !== r.id);
    const usedOnTimeline = S.bgClips.some((c) => c.bgId === r.id); if (usedOnTimeline) { S.bgClips = S.bgClips.filter((c) => c.bgId !== r.id); if (S.bgSel && !S.bgClips.some((c) => c.id === S.bgSel)) S.bgSel = null; await syncBgClips(); }          // its pieces on the timeline go with it
    if (S.bgId === r.id) { S.bgId = null; await stage.setBackgroundImage(null); S.dirty = true; }
    drawTabs();
    updateTotal(); drawTimeline(); S.dirty = true;
  };
  /** hold a background: effects for it (Night, Evening ...) and Delete */
  const applyBgFx = async (rec, fxId) => {
    const fx = bgEffectId(fxId), usable = (c) => c.bgId === rec.id;
    let c = S.bgClips.find((x) => x.id === S.bgSel && usable(x)) || S.bgClips.find((x) => usable(x) && player.time >= x.start && player.time < x.start + x.dur);
    if (!c) { await addBgClip(rec); c = S.bgClips.find((x) => x.id === S.bgSel && usable(x)) || S.bgClips.at(-1); }
    if (!c) return;
    if (fx) c.fx = fx; else delete c.fx;
    S.bgSel = c.id; await syncBgClips(); S.dirty = true; commitClips(); drawTabs();
  };
  const openBgOptions = (rec) => {
    const cur = S.bgClips.find((x) => x.id === S.bgSel && x.bgId === rec.id)?.fx || 'none';
    let close;
    const chips = BG_EFFECTS.map((e) => h('button', { type: 'button', class: `btn sm bg-fx${cur === e.id ? ' pri' : ''}`, 'data-fx': e.id, 'aria-pressed': String(cur === e.id), onclick: async () => { close(); await applyBgFx(rec, e.id); } }, h('i', { class: 'fx-dot', style: `background:${e.dot}` }), e.name));
    close = modal(rec.name.replace(/\.[^.]+$/, ''), h('div', {}, h('h3', { style: 'margin:0 0 8px' }, 'Effects'), h('div', { class: 'bg-fx-row' }, chips),
      h('div', { class: 'row', style: 'margin-top:14px' }, h('button', { type: 'button', class: 'btn sm danger bg-delete', onclick: async () => { close(); await removeBg(rec); } }, icon('trash'), ' Delete this background'))));
  };
  // one list: "+" first (opens the device's files), then the pictures this project already has, the generated ones and the admin's shared scenes
  const mine = h('div', { class: 'tile-grid' },
    tile({ add: true, name: 'Add image', title: 'Add your own image from this device', onclick: () => file.click() }),
    S.myBgs.map((r) => tile({ src: URL.createObjectURL(r.blob), name: r.name.replace(/\.[^.]+$/, ''), cover: true, on: S.bgId === r.id, title: `${r.name} · hold for effects and delete`, onclick: () => pickBg(r), onhold: () => openBgOptions(r) })),
    shared('background').map(sharedTile));
  generatedTiles(pickBg, mine);
  // plain colours: small round swatches, the last one opens the colour picker so the user can make any colour of their own
  const solidPng = (hex) => new Promise((resolve) => { const c = document.createElement('canvas'); c.width = 32; c.height = 18; const g = c.getContext('2d'); g.fillStyle = hex; g.fillRect(0, 0, 32, 18); c.toBlob(resolve, 'image/png'); });
  const sw = h('div', { class: 'bg-swatches' }, BACKGROUNDS.map((b, i) => h('button', { type: 'button', title: b.name, 'aria-label': b.name, class: `bg-swatch${stage.bg.preset === i && !S.bgId ? ' on' : ''}`, style: `background:linear-gradient(135deg,${b.a},${b.b})`, onclick: async () => { await addBgClip(null, i); } })),
    h('label', { class: 'bg-swatch custom', title: 'Make your own colour' }, h('input', { type: 'color', value: '#3b82f6', 'aria-label': 'Make your own colour', onchange: async (e) => {
      try { const hex = e.target.value, blob = await solidPng(hex), rec = { id: `bg${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: `Colour ${hex}`, blob }; await dbPut('backgrounds', rec); S.myBgs.push(rec); await pickBg(rec); }
      catch (er) { toast(`Could not make the colour: ${friendlyError(er)}`); }
    } }), '+'));
  // only what is needed: "+" and the backgrounds, then the plain colours. Every choice is a 5 s clip at the playhead.
  return h('div', { class: 'list' }, mine, file, h('div', { class: 'bg-colours' }, h('h2', { class: 'bg-h' }, 'Plain colours'), sw));
}

/** export size for the chosen orientation + quality */
function sizeFor() { const { w, h } = aspectOf(S.aspect), k = S.quality / Math.min(w, h); return { W: Math.round((w * k) / 2) * 2, H: Math.round((h * k) / 2) * 2 }; }
function tabExport() {
  const exportScenes = S.exportScope === 'all' ? docOf().scenes : [{ doc: sceneDoc() }];
  const multi = exportScenes.length > 1, hasAudio = exportScenes.some(scene => scene.doc.lines?.length), soundInVideo = hasAudio || exportScenes.some(scene => scene.doc.music && !scene.doc.music.muted);
  const duration = sequencePlan(exportScenes, sceneAudio).at(-1)?.end || player.total;
  const seg = (items, cur, on) => h('div', { class: 'seg' }, items.map(([k, l]) => h('button', { class: cur() === k ? 'on' : '', onclick: (e) => { on(k); e.currentTarget.parentNode.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', items[i][0] === k)); redrawPanel(); } }, l)));
  const q = seg([[360, 'Draft · 360p'], [480, 'Low · 480p'], [720, 'HD · 720p'], [1080, 'Full HD · 1080p'], [2160, '4K · 2160p']], () => S.quality, (v) => { S.quality = v; });
  const m = seg(multi ? [['fast', '⚡ Fast render']] : [['fast', '⚡ Fast render'], ['live', '⏺ Record live']], () => multi ? 'fast' : S.expMethod, (v) => { S.expMethod = v; });
  const fm = seg([['webm', 'WebM · smaller, sharper'], ['mp4', 'MP4 · plays everywhere']], () => S.format, (v) => { S.format = v; });
  const lv = seg([['std', 'Standard'], ['high', 'High'], ['max', 'Maximum']], () => S.level, (v) => { S.level = v; });
  const f = seg([[12, '12 fps · draft'], [15, '15 fps · fast'], [24, '24 fps'], [30, '30 fps · smooth']], () => S.fps, (v) => { S.fps = v; });
  const cScenes = h('div', { class: 'card flat' }, h('h2', {}, 'Scenes'), h('select', { 'aria-label': 'Export scenes', onchange: e => { S.exportScope = e.target.value; redrawPanel(); } }, h('option', { value: 'all', selected: S.exportScope === 'all' }, `All scenes (${S.scenes.length})`), h('option', { value: 'current', selected: S.exportScope === 'current' }, 'Current scene only')), h('p', { class: 'sub' }, 'All scenes join in tab order with Fast render, using the current scene’s aspect ratio. Live recording is available for the current scene.'));
  const cNoAudio = !hasAudio ? h('div', { class: 'card flat' }, h('p', { class: 'sub', style: 'font-size:12px;margin:0' }, `🔇 No audio added — this video will be ${duration.toFixed(1)} seconds long and silent. Add audio any time.`)) : null;
  const cMethod = h('div', { class: 'card flat' }, h('h2', {}, 'Method'), m,
      h('p', { class: 'sub', style: 'font-size:12px;margin:8px 0 0' }, multi || S.expMethod === 'fast'
        ? `Builds the video frame by frame on ${multi ? 1 : workerCount() || 1} CPU core${!multi && workerCount() > 1 ? 's at the same time' : ''}, as fast as your device can. The result plays at normal speed and is always complete.`
        : 'Plays the video once in real time and records the screen — takes as long as the video. Use it only if Fast render does not work on your device.'));
  const cQuality = h('div', { class: 'card flat' }, h('h2', {}, 'Quality'), q, S.quality >= 2160 ? h('p', { class: 'sub', style: 'font-size:12px;margin:8px 0 0' }, '4K needs a strong phone or computer and takes longer. Try 1080p first.') : null);
  const cFormat = h('div', { class: 'card flat' }, h('h2', {}, 'File format'), fm, h('p', { class: 'sub', style: 'font-size:12px;margin:8px 0 0' }, S.format === 'webm' ? 'WebM (VP9): same sharpness in about half the size. Plays in Chrome, Edge, Firefox, VLC and most editors; some phone galleries and WhatsApp may not open it.' : 'MP4 (H.264): opens everywhere — gallery, WhatsApp, editors — but the file is bigger for the same sharpness.'));
  const cLevel = h('div', { class: 'card flat' }, h('h2', {}, 'Video quality'), lv, (() => { const { W, H } = sizeFor(); const mbps = bitrateFor(W, H, S.level, S.format) / 1e6, mb = estimateMegabytes({ videoBps: mbps * 1e6, duration, audio: soundInVideo, ratio: sizeRatio(S.format) }); return h('p', { class: 'sub', style: 'font-size:12px;margin:8px 0 0' }, `${W}×${H} · about ${mbps.toFixed(1)} Mbps → roughly ${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB for this video. Higher = sharper picture and a bigger file.`); })());
  const cFps = h('div', { class: 'card flat' }, h('h2', {}, 'Smoothness'), f, h('p', { class: 'sub', style: 'font-size:12px;margin:8px 0 0' }, 'Fewer frames per second = faster export.'));
  const cDone = h('button', { class: 'btn ok', style: 'width:100%;padding:14px', disabled: !!bgExport || (!pickType() && !window.VideoEncoder), onclick: () => doExport() }, bgExport ? 'Exporting in the background…' : '⬇ Export video');
  const { W: outW, H: outH } = sizeFor(), preset = presetMatch(S);
  const mbps = bitrateFor(outW, outH, S.level, S.format) / 1e6, mb = estimateMegabytes({ videoBps: mbps * 1e6, duration, audio: soundInVideo, ratio: sizeRatio(S.format) });
  const live = !multi && S.expMethod === 'live', eta = estimateSeconds({ duration, pixels: outW * outH, fps: S.fps, live, last: lastSpeed(), cores: workerCount() || navigator.hardwareConcurrency || 2 });
  const group = (key, icon, title, ...body) => h('details', { class: 'exp-group', open: S.expOpen[key], ontoggle: e => { S.expOpen[key] = e.currentTarget.open; } }, h('summary', {}, h('span', { 'aria-hidden': 'true' }, icon), title), h('div', { class: 'exp-body' }, ...body));
  const stat = (label, value) => h('div', {}, label, h('b', {}, value));
  return h('div', { class: 'list' },
    group('quick', '⚡', 'Quick setup',
      h('div', { class: 'exp-summary' }, stat('Resolution', `${outW}×${outH}`), stat(`Length · ${exportScenes.length} scene${exportScenes.length > 1 ? 's' : ''}`, `${duration.toFixed(1)} s`), stat('Format', `${S.format.toUpperCase()} · ${S.fps} fps`), stat('Approx. size', `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`), stat('Approx. time', `about ${prettyTime(eta.seconds)}`)),
      h('p', { class: 'sub exp-eta', style: 'font-size:12px;margin:6px 0 0' }, BASIS_TEXT[eta.basis]),
      h('div', { class: 'exp-presets' }, EXPORT_PRESETS.map(p => h('button', { type: 'button', 'aria-pressed': String(preset === p.id), onclick: () => { Object.assign(S, { quality: p.quality, format: p.format, fps: p.fps, level: p.level }); redrawPanel(); } }, p.label, h('small', {}, p.note))))),
    group('out', '🎞', 'Scenes & method', cScenes, cNoAudio, cMethod),
    group('pic', '🖼', 'Picture', cQuality, cFps),
    group('file', '📦', 'File', cFormat, cLevel),
    cDone);
}
const redrawPanel = () => { const k = panelEl.scrollTop; drawTabs(); panelEl.scrollTop = k; };

async function togglePlay() {
  if (S.exporting || previewChanging || sceneChanging) return;
  if (player.playing) player.pause(); else await player.play();
  S.dirty = true;
}

/** length of the video an export would produce right now: every scene joined, or just the current one */
function exportLength() {
  const scenes = S.exportScope === 'all' ? docOf().scenes : [{ doc: sceneDoc() }];
  return { scenes: scenes.length, seconds: sequencePlan(scenes, sceneAudio).at(-1)?.end || player.total };
}
let exportChecking = false;
/** the Download button in the header: a small box to pick the quality and smoothness, see the estimated size, then Render (always MP4, so it opens everywhere) */
function openExportPopup() {
  if (bgExport) { toast('An export is already running. You can follow it in the box at the bottom left.'); return; }
  if (S.exporting || exportChecking || previewChanging || sceneChanging) return;
  S.format = 'mp4';
  const scenes = S.exportScope === 'all' ? docOf().scenes : [{ doc: sceneDoc() }];
  const duration = sequencePlan(scenes, sceneAudio).at(-1)?.end || player.total, sound = scenes.some((sc) => sc.doc.lines?.length) || scenes.some((sc) => sc.doc.music && !sc.doc.music.muted);
  const info = h('div', { class: 'exp-pop-info' });
  const chips = (items, cur, set) => { const box = h('div', { class: 'seg exp-pop-seg' }); const draw = () => box.replaceChildren(...items.map(([k, label]) => h('button', { type: 'button', class: cur() === k ? 'on' : '', 'aria-pressed': String(cur() === k), onclick: () => { set(k); draw(); refresh(); } }, label))); draw(); return box; };
  const refresh = () => {
    const { W, H } = sizeFor(), mbps = bitrateFor(W, H, S.level, 'mp4') / 1e6, mb = estimateMegabytes({ videoBps: mbps * 1e6, duration, audio: sound, ratio: sizeRatio('mp4') });
    const eta = estimateSeconds({ duration, pixels: W * H, fps: S.fps, live: false, last: lastSpeed(), cores: workerCount() || navigator.hardwareConcurrency || 2 });
    info.replaceChildren(h('div', {}, 'Estimated size', h('b', {}, `about ${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`)), h('div', {}, 'Picture', h('b', {}, `${W}×${H}`)), h('div', {}, 'Length', h('b', {}, `${duration.toFixed(1)} s`)), h('div', {}, 'Time to render', h('b', {}, `about ${prettyTime(eta.seconds)}`)));
  };
  const render = h('button', { type: 'button', class: 'btn ok exp-pop-go', disabled: !pickType() && !window.VideoEncoder, onclick: () => { close(); doExport(); } }, 'Render');
  const close = modal('Export video', h('div', { class: 'exp-pop' },
    h('h3', {}, 'Quality'), chips([[360, '360p'], [480, '480p'], [720, '720p'], [1080, '1080p'], [2160, '4K']], () => S.quality, (v) => { S.quality = v; }),
    h('h3', {}, 'Frames per second'), chips([[12, '12'], [15, '15'], [24, '24'], [30, '30']], () => S.fps, (v) => { S.fps = v; }),
    info, render));
  refresh();
}
/** everything the render workers need to draw the video (a snapshot of the scene), for a picture of W × H */
async function exportJob(W, H) {
  const layers = await buildLayerSpecs();
  const ids = [...new Set(layers.map((l) => l.charId))];
  const job = {
      aspect: S.aspect, short: S.quality, fps: S.fps, level: S.level, format: S.format, W, H, maxTex: S.quality >= 2160 ? 4096 : 2048,
      chars: ids.map((id) => { const d = S.characters.find((c) => c.id === id) || S.libDefs.get(id); return { id, ske: d.ske, tex: d.tex }; }),
      tearSprite: layers.some(layer => layer.tears?.style) ? await loadTearSprite() : null,
      bg: { preset: stage.bg.preset, image: S.bgId ? S.myBgs.find((r) => r.id === S.bgId)?.blob ?? null : null }, bgClips: bgClipJobs(), bgBlank: bgBlankOutside(), grade: gradeActive(S.grade) ? { ...S.grade } : null, gradeKeys: S.gradeKeys.map((k) => ({ t: k.t, grade: k.grade })), props: S.props.map((prop) => ({ ...prop })),
      layers, plan: shotPlan(), camKeys: stage.camKeys, voice: player.clips.map((c) => ({ speaker: c.speaker, start: c.start, end: c.end, visemes: c.visemes })),
    };
  return job;
}
/* ---- background export: the render workers get a snapshot of the scene, so the editor stays free while the video is made ---- */
let bgExport = null;
function exportPill() {
  const text = h('span', { class: 'ep-text' }, 'Preparing the export…'), fill = h('b', {}), bar = h('i', { class: 'ep-bar' }, fill);
  const cancel = h('button', { type: 'button', class: 'ep-cancel', onclick: () => { if (bgExport) { bgExport.stop = true; text.textContent = 'Stopping…'; } } }, 'Cancel');
  const el = h('div', { class: 'export-pill', role: 'status', 'aria-live': 'polite' }, h('div', { class: 'ep-row' }, icon('download'), text, cancel), bar);
  document.body.append(el);
  return { set(t, p) { text.textContent = t; fill.style.width = `${Math.round(Math.max(0, Math.min(1, p || 0)) * 100)}%`; }, done() { el.remove(); } };
}
const silentExport = () => !(player.clips.length || musicForExport().length);
async function backgroundExportPossible() {
  if (bgExport || S.expMethod !== 'fast' || (S.exportScope === 'all' && S.scenes.length > 1) || workerCount() < 1) return false;
  const { W, H } = sizeFor();
  return canExportOffline(W, H, S.fps, S.format, silentExport());
}
async function runBackgroundExport(grant) {
  const { W, H } = sizeFor(), clips = player.clips.map((c) => ({ ...c })), music = musicForExport().map((m) => ({ ...m })), total = player.total, exportAspect = S.aspect, fps = S.fps;
  const pill = exportPill(); bgExport = { stop: false };
  let exported = false, failed = null;
  try {
    const job = await exportJob(W, H), t0 = performance.now();
    const progress = (p) => { const sec = (performance.now() - t0) / 1000; pill.set(`Exporting ${Math.round(p * 100)}%${p > 0.03 ? ` · about ${Math.max(1, Math.round(sec / p - sec))} s left` : ''}`, p); };
    const { blob, ext, info } = await exportParallel({ job, clips, total, music, onProgress: progress, cancelled: () => bgExport.stop, workers: workerCount() });
    const took = (performance.now() - t0) / 1000;
    rememberSpeed({ duration: total, seconds: took, pixels: W * H, fps });
    rememberSize({ bytes: blob.size, duration: total, videoBps: bitrateFor(W, H, S.level, ext === 'mp4' ? 'mp4' : 'webm'), audio: clips.length > 0 || music.length > 0, format: ext === 'mp4' ? 'mp4' : 'webm' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `toon-${exportAspect.replace(':', 'x')}-${Date.now()}.${ext}` });
    document.body.append(a); a.click(); a.remove(); exported = true;
    toast(`Your video is ready (${took.toFixed(0)} s) · ${ext.toUpperCase()} · ${info}`);
  } catch (e) { if (e.message === 'cancelled') toast('Export was stopped.'); else failed = e; console.error(e); }
  finally { pill.done(); bgExport = null; finishExport(grant.grantId, exported); if (S.step === 3) { drawTabs(); } }
  if (failed) { toast('The video could not be made in the background, so it is being rendered with the editor locked instead.'); await doExport({ foreground: true }); }
}
async function doExport({ foreground = false } = {}) {
  if (bgExport) { toast('An export is already running. You can follow it in the box at the bottom left.'); return; }
  if (S.exporting || exportChecking || previewChanging || sceneChanging) return;
  // the server decides how long a video this account may export (free 2 min, paid 10 min) before any rendering starts
  exportChecking = true; let grant;
  try {
    const { seconds, scenes } = exportLength();
    grant = await authorizeExport({ seconds, scenes, scope: scenes > 1 ? 'all' : 'current' });
  } catch (error) {
    toast(error.message); if (error instanceof ExportLimitError) { openTab('export'); }
    return;
  } finally { exportChecking = false; }
  if (S.exporting || previewChanging || sceneChanging) return;
  if (!foreground && await backgroundExportPossible()) { await runBackgroundExport(grant); return; }
  let exported = false;
  setOverflow(false); S.exporting = true; requestStudioFrame(); player.pause(); player.seek(0); if (selEl) selEl.hidden = true; stage.fullView = false; syncCam();
  rememberScene();
  const originalScene = S.sceneId, exportAspect = S.aspect;
  const sequence = S.exportScope === 'all' && S.scenes.length > 1 ? sequencePlan(S.scenes, sceneAudio) : null;
  let exportScene = null;
  let stop = false, wl = null;
  const b = busy('Preparing…', () => { stop = true; });
  try { wl = await navigator.wakeLock?.request('screen'); } catch { /* optional */ }
  try {
    await stage.setTextureLimit(S.quality >= 2160 ? 4096 : 2048);
    await applyLayers();
    stage.setSize(S.aspect, S.quality);
    const offline = (sequence || S.expMethod === 'fast') && await canExportOffline(stage.W, stage.H, S.fps, S.format, sequence ? !sequence.some(scene => scene.doc.lines?.length) : !player.clips.length);
    if (sequence && !offline) throw Error('Exporting all scenes together needs Fast render and WebCodecs support. Choose Fast render, or export only the current scene.');
    if (S.expMethod === 'fast' && !offline) toast('Fast render is not supported on this device, so a live recording is being made instead.');
    let t0 = performance.now();
    const progress = (p) => {
      const sec = (performance.now() - t0) / 1000, x = p > 0.02 ? (p * player.total) / sec : 0;
      b.set(offline ? `Rendering ${Math.round(p * 100)}%${x ? ` · ${x.toFixed(1)}× faster than real time · ~${Math.max(1, Math.round(sec / p - sec))}s left` : ''}` : `Recording live ${Math.round(p * 100)}%`, p);
    };
    const single = () => exportOffline({ stage, clips: player.clips, plan: shotPlan(), total: player.total, music: musicForExport(), onProgress: progress, cancelled: () => stop, fps: S.fps, level: S.level, format: S.format });
    let res;
    if (sequence) {
      const total = sequence.at(-1).end;
      const clips = sequence.flatMap(scene => buildTimeline((scene.doc.lines || []).map(meta => sceneAudio.has(meta.id) ? { ...sceneAudio.get(meta.id), trimStart: meta.trimStart || 0, trimEnd: meta.trimEnd || 0, gapBefore: meta.gapBefore, ...mixOf(meta) } : null).filter(Boolean).map(line => ({ ...line, speaker: line.speaker.toLowerCase() }))).clips.map(clip => ({ ...clip, start: clip.start + scene.start, end: clip.end + scene.start })));
      for (const scene of sequence) if (scene.doc.music) await loadMusic(scene.doc.music.id);
      res = await exportOffline({ stage, clips, plan: [], total, music: musicForExport(sequence), fps: S.fps, level: S.level, format: S.format, cancelled: () => stop,
        onProgress: p => b.set(`Rendering all scenes ${Math.round(p * 100)}%`, p),
        beforeFrame: async time => {
          const scene = sequence.find(scene => time < scene.end) || sequence.at(-1);
          if (scene.id !== exportScene) {
            await activateScene(scene); exportScene = scene.id;
            stage.setSize(exportAspect, S.quality); stage.fullView = false;
          }
          return { time: time - scene.start, clips: player.clips, plan: shotPlan() };
        }
      });
    } else if (offline && workerCount() > 0) {
      try {
        const job = await exportJob(stage.W, stage.H);
        res = await exportParallel({ job, clips: player.clips, total: player.total, music: musicForExport(), onProgress: progress, cancelled: () => stop, workers: workerCount() });
      } catch (e) {
        if (e.message === 'cancelled') throw e;
        console.warn('parallel export failed, using one thread', e);
        toast('Parallel rendering is not possible here; rendering with a single thread instead.');
        t0 = performance.now(); res = await single();
      }
    } else res = offline ? await single() : await exportRealtime({ canvas: stage.out, stage, audioStream: player.rec.stream, player, onProgress: progress, level: S.level });
    const { blob, ext, info } = res;
    const took = (performance.now() - t0) / 1000;
    if (offline && !stop) rememberSize({ bytes: blob.size, duration: sequence ? sequence.at(-1).end : player.total, videoBps: bitrateFor(stage.W, stage.H, S.level, ext === 'mp4' ? 'mp4' : 'webm'), audio: !silentExport(), format: ext === 'mp4' ? 'mp4' : 'webm' });
    if (offline && !stop) rememberSpeed({ duration: sequence ? sequence.at(-1).end : player.total, seconds: took, pixels: stage.W * stage.H, fps: S.fps });          // the next estimate is based on this export
    const a = h('a', { href: URL.createObjectURL(blob), download: `toon-${exportAspect.replace(':', 'x')}-${Date.now()}.${ext}` });
    document.body.append(a); a.click(); a.remove();
    exported = true;
    toast(`Done in ${took.toFixed(0)}s (${((sequence ? sequence.at(-1).end : player.total) / took).toFixed(1)}× real time) · ${ext.toUpperCase()} · ${info}`);
  } catch (e) { toast(e.message === 'cancelled' ? 'Export was stopped.' : `Export failed: ${e.message}`); console.error(e); }
  if (sequence) { try { await activateScene(S.scenes.find(scene => scene.id === originalScene)); } catch (error) { toast(`Could not switch back to the scene: ${error.message}`); } }
  wl?.release?.().catch(() => {});
  try { await stage.setTextureLimit(PREVIEW_MODES[S.previewMode].maxTex); await applyLayers(); } catch (error) { toast(`Could not restore the preview textures: ${error.message}`); }
  finishExport(grant.grantId, exported);
  b.done(); S.exporting = false; if (sequence) render(); stage.setSize(S.aspect, S.preview); player.pause(); player.seek(0); fitEditor(); S.dirty = true;
}

/* ---------------- autosave, undo / redo, reset ---------------- */
const blobIds = new WeakMap(), blobReg = new Map();
function bid(b) { let id = blobIds.get(b); if (!id) { id = `b${Math.random().toString(36).slice(2, 9)}`; blobIds.set(b, id); blobReg.set(id, b); } return id; }
const hist = new EditHistory(100);
let historyPointerAt = 0;
// a finger that opened a file picker or a system menu may never send its "up"; a press with no movement for 1.5 s no longer blocks undo / redo or history capture
const pointerBusy = () => { if (historyPointer === null) return false; if (Date.now() - historyPointerAt > 1500) { historyPointer = null; return false; } return true; };
let historyDepth = 0, historyPointer = null, historyQueued = false, historyGroup = null;
let hdrUndo, hdrRedo, savedEl, lastSaved = '', saving = false, savedTimer;
const savedAudio = new Set();

/** the part of the project that undo / redo travels through */
function sceneDoc() {
  for (const line of S.lines) sceneAudio.set(line.id, line);
  return {
    locks: { ...(S.locks || {}) },
    music: S.music ? { id: S.music.id, name: S.music.name, ...musicSettings(S.music) } : null,
    lines: S.lines.map((l) => { const {id, order, file, speaker, trimStart, trimEnd, gapBefore} = l; return {id, order, file, speaker, trimStart: trimStart || 0, trimEnd: trimEnd || 0, ...(Number.isFinite(gapBefore) ? { gapBefore } : {}), ...mixOf(l)}; }),
    fits: Object.fromEntries(S.speakers.filter(s=>s.charId).map(s=>[s.charId,getFit(s.charId)])),
    speakers: S.speakers.map((s) => ({ skins: s.skins || null, manual: !!s.manual, key: s.key, name: s.name, narrator: !!s.narrator, color: s.color, charId: s.charId, flip: !!s.flip, _flipSet: !!s._flipSet, _chosen: !!s._chosen, visible: s.visible !== false, xf: s.xf || null, mask: s.mask ? { ...s.mask } : null, maskKeys: s.maskKeys || [], maskFollow: s.maskFollow || '', tears: s.tears ? tearConfig(s.tears) : null })),
    order: [...S.order], cast: clone(Object.fromEntries(S.cast)), shots: clone(Object.fromEntries(S.shots)), script: Object.fromEntries(S.script), solo: clone(S.solo), manual: clone(S.manual), charKeys: clone(S.charKeys), paths: clone(S.paths), grade: gradeActive(S.grade) ? clone(S.grade) : null, gradeKeys: clone(S.gradeKeys), camKeys: clone(S.camKeys), aspect: S.aspect, bgId: S.bgId, bgClips: clone(S.bgClips), bgPreset: stage?.bg.preset ?? 0,
    props: S.props.map((prop) => ({ ...prop, blob: bid(prop.blob) })),
  };
}
function docOf() {
  const current = sceneDoc();
  return clone({ version: 3, settings: { quality: S.quality, expMethod: S.expMethod, fps: S.fps, level: S.level, format: S.format }, backgrounds: S.myBgs.map(background => ({ ...background, blob: bid(background.blob) })), sceneId: S.sceneId, scenes: S.scenes.map(scene => ({ ...scene, doc: scene.id === S.sceneId ? current : scene.doc })) });
}
async function loadDoc(doc) {
  if (doc.settings) Object.assign(S, doc.settings);
  if (doc.backgrounds) S.myBgs = doc.backgrounds.map(background => ({ ...background, blob: blobReg.get(background.blob) })).filter(background => background.blob);
  if (Array.isArray(doc.scenes) && doc.scenes.length) {
    S.scenes = clone(doc.scenes);
    S.sceneId = S.scenes.some(scene => scene.id === doc.sceneId) ? doc.sceneId : S.scenes[0].id;
    await loadSceneDoc(S.scenes.find(scene => scene.id === S.sceneId).doc);
  } else {
    S.sceneId = uid();
    const legacy = { ...doc, lines: doc.lines || S.lines.map(({id,order,file,speaker}) => ({id,order,file,speaker})) };
    S.scenes = [{ id: S.sceneId, name: 'Scene 1', doc: legacy }];
    await loadSceneDoc(legacy);
  }
}
/** projects saved before a scene's length followed its animation: read the chosen animation's length from the catalog */
const defById = (id) => S.characters.find((c) => c.id === id) || S.libDefs.get(id);
function fillSoloLengths(doc) {
  if (!doc) return;
  for (const [key, o] of Object.entries(doc.solo || {})) {
    if (!o?.body || o.bodyLen > 0 || o.body.source === 'mode') continue;
    const charId = (doc.speakers || []).find((s) => s.key === key)?.charId, def = charId && defById(charId);
    if (!def?.rig) continue;
    const hit = categoriesFor(def.rig).filter((c) => !c.overlay).flatMap((c) => c.animations).find((a) => sameRef(a.ref, o.body));
    if (hit?.length > 0) o.bodyLen = +(+hit.length).toFixed(2);
  }
}
async function ensureDefs() {
  for (const speaker of S.speakers) {
    if (!speaker.charId) continue;
    try { await ensureCharacter(speaker.charId); }
    catch (error) { toast(`Could not load ${speaker.name}'s character: ${error.message}`); speaker.charId = null; }
  }
}
/** put a saved / undone document back into the app */
async function loadSceneDoc(doc) {
  doc = clone(doc);
  S.lines = (doc.lines || []).map(meta => sceneAudio.has(meta.id) ? { ...sceneAudio.get(meta.id), gapBefore: undefined, muted: false, solo: false, volume: 1, fadeIn: 0, fadeOut: 0, ...meta } : null).filter(Boolean);          // a setting that is not in the saved line is back to its default (it may still be set on the live copy)
  S.locks = { ...(doc.locks || {}) };
  S.music = doc.music ? { ...doc.music } : null; if (S.music) { const m = await loadMusic(S.music.id); if (!m) S.music = null; }          // a music file that is missing is simply left out
  for(const [id,fit] of Object.entries(doc.fits||{}))setFit(id,fit);
  S.speakers = doc.speakers.map((s) => ({ ...s }));
  S.order = [...doc.order];
  S.cast = new Map(Object.entries(JSON.parse(JSON.stringify(doc.cast || {}))));
  S.shots = new Map(Object.entries(doc.shots || {}));
  S.script = new Map(Object.entries(doc.script || {}));
  S.solo = JSON.parse(JSON.stringify(doc.solo || {}));
  S.manual = JSON.parse(JSON.stringify(doc.manual || {}));
  S.camKeys = JSON.parse(JSON.stringify(doc.camKeys || []));
  if (Array.isArray(doc.props)) S.props = doc.props.map((prop) => ({ ...prop, blob: blobReg.get(prop.blob) || S.props.find((item) => item.id === prop.id)?.blob })).filter((prop) => prop.blob);
  S.selectedPropId = null;
  await stage.setProps(S.props);
  S.charKeys = JSON.parse(JSON.stringify(doc.charKeys || {})); S.paths = JSON.parse(JSON.stringify(doc.paths || {})); stopPathDraw(); S.pathEdit = false; setGrade(doc.grade || {}, true); S.gradeKeys = JSON.parse(JSON.stringify(doc.gradeKeys || [])); S.gradeSel = null; if (stage) stage.gradeKeys = S.gradeKeys;
  if (S.mclip && !findManual(S.mclip)) S.mclip = null;
  if (S.camSel && !S.camKeys.some((k) => k.id === S.camSel)) S.camSel = null;
  syncCam(); syncChars();
  if (doc.aspect && doc.aspect !== S.aspect) { S.aspect = doc.aspect; stage.setSize(S.aspect, S.preview); }
  S.bgId = doc.bgId ?? null; stage.bg.preset = doc.bgPreset ?? 0;
  S.bgClips = JSON.parse(JSON.stringify(doc.bgClips || [])); S.bgSel = null; S.propSel = null;
  await stage.setBackgroundImage(S.myBgs.find((r) => r.id === S.bgId)?.blob ?? null);
  await syncBgClips();
  await ensureDefs();
  fillSoloLengths({ solo: S.solo, speakers: S.speakers });
  if (!S.speakers.some((s) => s.key === S.animFor && s.charId)) S.animFor = S.speakers.find((s) => s.charId)?.key ?? null;
  if (S.sel && !S.speakers.some((s) => s.key === S.sel && s.charId)) S.sel = null;
}
async function restoreProject() {
  const rec = (await dbAll('project')).find((r) => r.id === 'current');
  if (!rec?.doc) return false;
  const b = busy('Restoring your project…');
  try {
    for (const [id, blob] of Object.entries(rec.blobs || {})) { blobReg.set(id, blob); blobIds.set(blob, id); }
    const audio = new Map((await dbAll('audio')).map((r) => [r.id, r]));
    for (const m of rec.lines) {
      const a = audio.get(m.id);
      if (!a) continue;
      try { const buffer = await audioCtx.decodeAudioData(a.raw.slice(0)); S.lines.push({ ...m, raw: a.raw, buffer, visemes: analyse(buffer) }); sceneAudio.set(m.id, S.lines.at(-1)); savedAudio.add(m.id); } catch { /* skip broken audio */ }
    }
    Object.assign(S, { quality: rec.ui.v >= 2 ? (rec.ui.quality ?? S.quality) : Math.max(720, rec.ui.quality ?? 720), /* older saves defaulted to 480p on phones */ expMethod: rec.ui.expMethod ?? S.expMethod, fps: rec.ui.fps ?? S.fps, level: rec.ui.level ?? S.level, format: rec.ui.format ?? S.format, applyAll: !!rec.ui.applyAll, tab: rec.ui.tab ?? S.tab, lineSel: rec.ui.lineSel ?? null, animFor: rec.ui.animFor ?? null });
    await loadDoc(rec.doc);
    S.step = 3;
    await prepareStudio();
    b.done(); render();
    toast('Welcome back — your project was restored.');
    return true;
  } catch (e) { console.error(e); b.done(); return false; }
}

async function saveProject(doc, docStr) {
  const ui = { step: S.step, maxStep: S.maxStep, tab: S.tab, lineSel: S.lineSel, animFor: S.animFor, quality: S.quality, expMethod: S.expMethod, fps: S.fps, level: S.level, format: S.format, applyAll: S.applyAll, v: 2 };
  const lines = [...new Map(doc.scenes.flatMap(scene => scene.doc.lines || []).map(line => [line.id, line])).values()];
  const sig = JSON.stringify({ ui, lines }) + docStr;
  if (sig === lastSaved) return;
  for (const {id} of lines) { const l = sceneAudio.get(id); if (l && !savedAudio.has(l.id) && l.raw) { await dbPut('audio', { id: l.id, raw: l.raw }); savedAudio.add(l.id); } }
  const refs = new Set([...(doc.backgrounds || []).map(background => background.blob), ...doc.scenes.flatMap(scene => [...(scene.doc.props || []).map(prop => prop.blob)])]);
  const blobs = Object.fromEntries([...refs].filter(id => blobReg.has(id)).map(id => [id, blobReg.get(id)]));
  await dbPut('project', { id: 'current', doc, ui, lines, blobs, ts: Date.now() });
  for (const id of [...savedAudio]) if (!lines.some((l) => l.id === id)) { await dbDel('audio', id); savedAudio.delete(id); }
  lastSaved = sig; localSavedAt = Date.now();
  localSaveError = ''; updateSaveStatus({ text: navigator.onLine ? 'Saving' : 'Offline' });
}
async function tick({ sceneCommit = false } = {}) {
  if (!S.ready || hist.busy || saving || S.exporting || pointerBusy() || (historyDepth && !sceneCommit) || (sceneChanging && !sceneCommit) || $app.hidden) return;
  saving = true;
  try {
    const doc = docOf(), str = JSON.stringify(doc);
    captureHistory();
    await saveProject(doc, str);
  } catch (e) { localSaveError = e.message; updateSaveStatus(); console.warn('autosave failed', e); }
  saving = false;
}
function editGroup(event) {
  return ['input', 'change'].includes(event.type) && event.target.matches('textarea,input:not([type=checkbox]):not([type=radio]):not([type=file])') ? event.target : null;
}
function captureHistory(group = historyGroup) {
  if (!S.ready || !hist.cur || hist.busy || historyDepth || pointerBusy() || S.exporting || sceneChanging || previewChanging || $app.hidden) return;
  hist.record(docOf(), group); updateHistoryButtons();
}
function queueHistoryCapture(group) {
  if (group !== undefined) historyGroup = group;
  if (!S.ready || historyQueued) return;
  historyQueued = true;
  queueMicrotask(() => { historyQueued = false; captureHistory(); });
}
function historyAction(action, group = null) {
  if (!S.ready || hist.busy || S.exporting) return action();
  captureHistory(); historyDepth++; updateHistoryButtons();
  const done = () => { historyDepth--; updateHistoryButtons(); queueHistoryCapture(group); };
  try {
    const result = action();
    if (result?.then) return result.finally(done);
    done(); return result;
  } catch (error) { done(); throw error; }
}
const inStudio = target => !$app.hidden && (target.closest('#app,.modal,.scene-delete-dialog') || target === stage?.out);
for (const type of ['input', 'change', 'click', 'drop']) document.addEventListener(type, event => {
  if (inStudio(event.target) && !event.target.closest('[data-history-control]')) queueHistoryCapture(editGroup(event));
}, true);
document.addEventListener('pointerdown', event => {
  if (!inStudio(event.target) || hist.busy || S.exporting || event.target.closest('[data-history-control]')) return;
  captureHistory(); historyPointer = event.pointerId; historyPointerAt = Date.now();
}, true);
const endHistoryPointer = event => {
  if (event && event.pointerId !== historyPointer) return;
  queueMicrotask(() => { historyPointer = null; queueHistoryCapture(null); });
};
window.addEventListener('pointermove', () => { if (historyPointer !== null) historyPointerAt = Date.now(); }, { capture: true, passive: true });
window.addEventListener('pointerup', endHistoryPointer, true);
window.addEventListener('pointercancel', endHistoryPointer, true);
window.addEventListener('blur', () => endHistoryPointer());
function updateHistoryButtons() { if (hdrUndo) { hdrUndo.disabled = hist.busy || historyDepth > 0 || !hist.undo.length; hdrRedo.disabled = hist.busy || historyDepth > 0 || !hist.redo.length; if (tlUndo) { tlUndo.disabled = hdrUndo.disabled; tlRedo.disabled = hdrRedo.disabled; } } }
async function stepHistory(dir) {
  if (S.exporting || hist.busy || sceneChanging || previewChanging || sceneDialogOpen || historyDepth || pointerBusy()) return;
  captureHistory();
  const target = hist.destination(dir);
  if (!target) return;
  const original = docOf(), time = player.time;
  hist.busy = true; clearTimeout(tlTimer); clearTimeout(softTimer); updateHistoryButtons();
  const b = busy(dir < 0 ? 'Undo…' : 'Redo…');
  try {
    player.pause();
    await loadDoc(target);
    if (S.step === 3) await prepareStudio({ quiet: true });
    player.seek(original.sceneId === S.sceneId ? time : 0);
    hist.accept(dir, docOf());
    render();
  } catch (error) {
    try { await loadDoc(original); await prepareStudio({ quiet: true }); player.seek(time); render(); } catch (restoreError) { console.error(restoreError); }
    toast(`${dir < 0 ? 'Undo' : 'Redo'} failed: ${error.message}`);
  } finally { b.done(); hist.busy = false; updateHistoryButtons(); S.dirty = true; }
  await tick();
}
/** reloads the website (the project is saved first); the page opens again with the newest version of the site */
async function refreshSite() {
  if ((S.exporting || bgExport) && !confirm('A video is being made. Refreshing the page stops it. Refresh anyway?')) return;
  try { await tick({ sceneCommit: true }); } catch { /* the autosave keeps what it already saved */ }
  location.reload();
}
async function resetEverything() {
  if (!confirm('Reset this project? This removes its characters, clips and audio from this device. Other projects are preserved. This cannot be undone.')) return;
  S.ready = false; player?.pause();
  await resetAll();
  location.reload();
}
/** preview quality lives in the header, so it stays reachable while the canvas and timeline get the space */
function previewControl() {
  previewSelect = h('select', { 'aria-label': 'Preview quality', title: 'Preview quality: Low is faster and softer. Export quality is set separately.', onchange: e => changePreviewQuality(e.target.value) }, Object.entries(PREVIEW_MODES).map(([value, mode]) => h('option', { value, selected: value === S.previewMode }, mode.label)));
  return h('label', { class: 'preview-quality' }, icon('monitor'), previewSelect);
}
/** the project's ID (the short number support asks for), shown next to the save status; a click copies it */
function projectIdChip() {
  const id = projectContext()?.id; if (!id) return null;
  const chip = h('button', { type: 'button', class: 'project-id', title: 'Your project ID. Click to copy it.', 'aria-label': `Project ID ${id}. Click to copy.`, onclick: async (e) => {
    const button = e.currentTarget, now = button.dataset.id || String(id);          // (e.currentTarget is empty after the first await, so the button is kept here)
    try { await navigator.clipboard.writeText(now); toast('Project ID copied.'); button.classList.add('copied'); setTimeout(() => button.classList.remove('copied'), 1200); }
    catch { toast(`Your project ID is ${now}.`); }
  } }, h('span', { class: 'project-id-label' }, 'PROJECT ID: '), h('b', {}, String(id)));
  // if the ID was already taken by another account, the app gives this project a fresh one: show the new number straight away
  const changed = (e) => { if (!chip.isConnected) { removeEventListener('project-id-changed', changed); return; } if (String(e.detail?.oldId) !== chip.dataset.id) return; chip.dataset.id = String(e.detail.newId); chip.querySelector('b').textContent = String(e.detail.newId); chip.setAttribute('aria-label', `Project ID ${e.detail.newId}. Click to copy.`); };
  chip.dataset.id = String(id); addEventListener('project-id-changed', changed);
  return chip;
}
let closePopOutside = () => {};
function headerTools() {
  hdrUndo = h('button', { class: 'btn sm icon-btn history-button', 'data-history-control': true, 'aria-label': 'Undo', title: 'Undo (Ctrl+Z)', onclick: () => stepHistory(-1) }, icon('undo'));
  hdrRedo = h('button', { class: 'btn sm icon-btn history-button', 'data-history-control': true, 'aria-label': 'Redo', title: 'Redo (Ctrl+Y)', onclick: () => stepHistory(1) }, icon('redo'));
  savedEl = h('summary', { class: 'saved show', title: 'Save status' });
  saveBody = h('div', { class: 'save-popover' });
  saveDetails = h('details', { class: 'save-status' }, savedEl, saveBody);
  updateSaveStatus();
  queueMicrotask(updateHistoryButtons);
  exportBtn = h('button', { class: 'btn ok icon-btn export-btn', 'aria-label': 'Export', title: 'Export video', onclick: () => openExportPopup() }, icon('download'));
  // the ✕ asks first, in a small drop right under it (a project can be left by a stray tap otherwise)
  const closePop = h('div', { class: 'close-pop', role: 'dialog', 'aria-label': 'Close the studio?', hidden: true }, h('span', {}, 'Close the studio?'),
    h('button', { type: 'button', class: 'btn sm', onclick: () => { closePop.hidden = true; } }, 'Stay'), h('button', { type: 'button', class: 'btn sm pri close-yes', onclick: () => { closePop.hidden = true; goHome(); } }, 'Close'));
  const closeBtn = h('span', { class: 'close-wrap' }, h('button', { class: 'btn sm icon-btn close-studio', 'aria-label': 'Close studio', 'aria-haspopup': 'dialog', title: 'Close studio — back to your projects', onclick: () => { closePop.hidden = !closePop.hidden; } }, icon('x')), closePop);
  document.removeEventListener('pointerdown', closePopOutside, true); closePopOutside = (e) => { if (!closePop.hidden && !closeBtn.contains(e.target)) closePop.hidden = true; }; document.addEventListener('pointerdown', closePopOutside, true);
  return h('div', { class: 'hdr-tools' }, previewControl(), h('span', { class: 'sp' }), h('span', { class: 'studio-brand', title: '12toons', 'aria-label': '12toons' }, ...brandWordmark()), h('span', { class: 'sp' }), creditsBadge({ compact: true }), projectIdChip(), saveDetails, hdrUndo, hdrRedo,
    h('details', { class: 'studio-menu' }, h('summary', { class: 'btn sm icon-btn', 'aria-label': 'More studio actions', title: 'More' }, icon('more')), h('div', { class: 'studio-menu-panel' }, h('button', { class: 'btn sm refresh-site', type: 'button', onclick: refreshSite }, h('span', {}, icon('rotate')), ' Refresh the page'), h('button', { class: 'btn sm danger', onclick: resetEverything }, h('span', {}, icon('trash')), ' Reset this project…'))),
    exportBtn, closeBtn);
}
matchMedia('(min-width: 1000px)').addEventListener?.('change', () => { if (!$app.hidden && S.ready && tabsEl) { drawTabs(); S.dirty = true; } });
window.addEventListener('keydown', (e) => {
  if ($app.hidden || !(e.ctrlKey || e.metaKey) || e.target.closest('input,select,textarea,[contenteditable=true],dialog[open],.modal')) return;
  const k = e.key.toLowerCase();
  if (k === 'c' && S.step === 3 && !window.getSelection?.().toString() && (S.mclip || S.bgSel || S.propSel)) { e.preventDefault(); copySelected(); } else if (k === 'v' && S.step === 3 && S.clipboard) { e.preventDefault(); pasteClip(); }
  else if (k === 'z' && !e.shiftKey) { e.preventDefault(); stepHistory(-1); } else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); stepHistory(1); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) tick(); else { last = performance.now(); S.dirty = true; } });

/* ---------------- main loop ---------------- */
let last = performance.now(), frameId = 0, renderCount = 0, dirty = true, lastPreviewFrame = -Infinity;
function requestStudioFrame() {
  if (!frameId && player && !$app.hidden && (!document.hidden || S.exporting)) frameId = requestAnimationFrame(loop);
}
Object.defineProperty(S, 'dirty', { get: () => dirty, set: value => { dirty = value; if (value) { requestStudioFrame(); queueHistoryCapture(); } } });
function loop(now) {
  frameId = 0;
  if ($app.hidden || previewChanging || document.hidden && !S.exporting) return;
  if (player.playing || S.exporting) requestStudioFrame();
  if (player.playing && !previewFrameDue(now, lastPreviewFrame, S.previewMode, S.exporting)) return;
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (S.step !== 3 || !stage.layers) return;
  if (sceneChanging) return;
  if (S.exporting && !player.playing) return; // offline export drives the stage itself
  if (player.playing && player.time >= player.total && !S.exporting) { player.pause(); const next = S.scenes[S.scenes.findIndex(scene => scene.id === S.sceneId) + 1]; if (next && !sceneChanging) { switchScene(next.id, { play: true }); return; } if (S.loop) { if (S.scenes.length > 1 && S.sceneId !== S.scenes[0].id) { switchScene(S.scenes[0].id, { play: true }); return; } player.seek(0); player.play(); } S.dirty = true; }
  syncFullView();
  if (!player.playing && !S.dirty) return;
  S.dirty = false;
  const t = player.time;
  try { stage.render(t, player.playing ? dt : 0, player.clips, shotPlan()); renderCount++; lastPreviewFrame = now; } catch (e) { console.error(e); }
  if (player.playing) followLine();
  updateSel(); updateCamBox(); updateTearHandles();
  if (S.tab === 'grade' && S.gradeKeys.length && Math.abs(player.time - gradeSeen) > 0.02) { gradeSeen = player.time; refreshGradeFields(); }
  if (headEl) {
    const x = t * S.pps;
    headEl.style.left = `${x}px`;
    if (player.playing && tlScroll && (x < tlScroll.scrollLeft + 10 || x > tlScroll.scrollLeft + tlScroll.clientWidth - 40)) tlScroll.scrollLeft = Math.max(0, x - 40);
  }
  if (timeEl) timeEl.textContent = `${fmt(t)} / ${fmt(player.total)}`;
  refreshLayerAnim(false);
  if (playBtn && playBtn.dataset.state !== String(player.playing)) { playBtn.dataset.state = String(player.playing); playBtn.replaceChildren(icon(player.playing ? 'pause' : 'play')); playBtn.setAttribute('aria-label', player.playing ? 'Pause' : 'Play'); playBtn.dataset.tip = player.playing ? 'Pause (Space)' : 'Play (Space)'; }
}
window.addEventListener('keydown', (e) => { if (!$app.hidden && S.step === 3 && e.code === 'Space' && !e.target.closest('button,input,select,textarea,summary,a,[contenteditable=true]')) { e.preventDefault(); togglePlay(); } });

if (location.search.includes("debug")) window.__toon = { S, applyMoves, addClip, splitSelected, rateOf, applyLayers, commitClips, sceneDoc, loadSceneDoc, musicAudio, openTab, openCharTool, saveXf, startPathShadow, refreshSite, drawClipBar, drawCharBar, hideSelBar, commitClips, updateSaveStatus, fillSoloLengths, sharedBlobs, drawTimeline, sceneLen, prepareStudio, syncCam, get stage() { return stage; }, get player() { return player; }, get metrics() { return { renderCount, framePending: !!frameId, loadedRigs: stage?.assets.size, cachedDefinitions: S.libDefs.size }; } };

/* ---------------- entry points used by the 12toons shell ---------------- */
let booted = false, homeFn = null;
export const setHome = (fn) => { homeFn = fn; };
async function goHome() { if (S.exporting) { toast('Please wait for the export to finish.'); return; } player?.pause(); try { await tick({ sceneCommit: true }); } catch { /* best effort */ } homeFn?.(); }
export async function openStudio() {
  studioTheme.enter();
  $app.hidden = false;
  if (!booted) { booted = true; await boot(); } else { S.characters = (await loadCharacters()).filter(c => c.ske || c.base); await ensureDefs(); drawTabs(); S.dirty = true; }       // characters may have been saved in the Character Editor meanwhile
  startAutoSync();
  S.scenes.forEach((scene) => fillSoloLengths(scene.doc));
  S.ready = true; S.dirty = true; fitEditor(); dockShow('rail'); dockShow('panel');
  const box = document.getElementById('stagebox'); if (box) stageObserver?.observe(box);
}
export async function closeStudio() {
  while(saving)await new Promise(resolve=>setTimeout(resolve,20));
  await tick({ sceneCommit: true }); player?.pause(); stopAll(); pruneTimelineThumbnails(); stageObserver?.disconnect(); cancelAnimationFrame(frameId); frameId = 0; studioTheme.leave(); $app.hidden = true; S.ready = false;
}
onSyncStatus(state => { if (!state.projectId || state.projectId === projectContext()?.id) updateSaveStatus(state); });

