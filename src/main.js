import { TEAR_STYLES, TEAR_IMAGE_URL, tearConfig, loadTearSprite } from './tears.js';
import { EditHistory } from './edit-history.js';
import { PREVIEW_MODES, readPreviewMode, savePreviewMode, previewFrameDue } from './preview-quality.js';
import './style.css';
import './studio.css';
import './timeline.css';
import { timelineIcon, pruneTimelineThumbnails } from './timeline-icons.js';
import { icon, watchIcons } from './icons.js';
import { installTips } from './tips.js';
import './studio-icons.css';
import { syncPresentation } from './sync-feedback.js';
import { brandWordmark } from './dom.js';
import { ingest, isNarrator } from './ingest.js';
import { analyse } from './lipsync.js';
import { Stage, ASPECTS, BACKGROUNDS, aspectOf } from './db/stage.js';
import { Player, buildTimeline } from './player.js';
import { characterPicker } from './charpick.js';
import { exportOffline, exportParallel, workerCount, exportRealtime, canExportOffline, pickType, bitrateFor } from './exporter.js';
import { loadCharacters, saveCharacter, deleteCharacter, all as dbAll, put as dbPut, del as dbDel, get as dbGet, resetAll, context as projectContext } from './store.js';
import { startAutoSync, cloudReady, listCharactersCloud, loadCharacterCloud } from './cloud.js';
import { describeMotion, buildBrief, extractJson } from './brief.js';
import { loadAi, saveAi, listModels, transcribe, direct } from './ai.js';
import { loadCatalog, hydrateCharacter, categoriesFor, fetchAnimation, url as assetUrl, libraryCharacters, libraryStatus, fetchLibraryCharacter, cdn, modePools, modeEntries, MODE_REFS } from './catalog.js';
import { getFit, setFit } from './universal.js';
import { onSyncStatus, syncStatus, syncCurrent } from './project-sync.js';
import { listStudioAssets, downloadStudioAsset } from './studio-assets.js';

import { emptyScene, sequencePlan, uniqueSceneName } from './scenes.js';
import { authorizeExport, finishExport, ExportLimitError } from './export-plan.js';
import { propFromAsset, isEffect, isHeld } from '../shared/studio-effects.js';
import { friendlyError } from '../shared/hinglish-errors.js';
import { DEFAULT_GRADE, GRADE_CONTROLS, GRADE_PRESETS, cleanGrade, gradeActive, gradeAt, presetGrade, presetOf } from '../shared/color-grade.js';
import { thin, pathLength, pathKeys, simplify, insertAt } from '../shared/motion-path.js';
import { resizeClip, contentLength, snap as snapTo, MIN_CLIP } from '../shared/timeline-edit.js';
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
const toast = (msg) => { const t = h('div', { class: 'toast' }, msg); document.body.append(t); setTimeout(() => t.remove(), 4500); };
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
  // no logo / title row: the studio keeps its space for the canvas and timeline. Quality, save state, undo / redo, export — then the X that leaves the studio.
  return h('header', { class: 'topbar studio-bar' }, headerTools());
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
    libraryCharacters().some((e) => e.template) ? characterPicker({ entries: libraryCharacters(), isOn: (e) => s.charId === `lib:${e.id}`, onPick: (e) => pick(`lib:${e.id}`) }) : libraryStatus() ? h('p', { class: 'sub', role: 'alert' }, libraryStatus()) : null,
    S.characters.length ? [h('h2', { style: 'margin:16px 0 8px' }, 'Your characters'), h('div', { class: 'gridc' }, S.characters.map((c) => card(c.thumb || null, c.name, 'from your device', () => pick(c.id), s.charId === c.id)))] : null,
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
    const windowEl = h('div', { class: 'animation-window', style: `height:${list.length * 64}px` });
    viewport.append(windowEl);
    let start = -1, end = -1;
    const paint = () => {
      const nextStart = Math.max(0, Math.floor(viewport.scrollTop / 64) - 4);
      const nextEnd = Math.min(list.length, nextStart + Math.ceil((viewport.clientHeight || 640) / 64) + 9);
      if (nextStart === start && nextEnd === end) return;
      start = nextStart; end = nextEnd;
      windowEl.replaceChildren(...list.slice(start, end).map((a, offset) => {
        const chosen = sameRef(selectedRef(), a.ref);
        const apply = h('button', { class: 'animation-apply', 'aria-pressed': String(!!chosen), title: `Apply ${a.name}`, onclick: async () => {
          apply.disabled = true;
          try { scrollTop = viewport.scrollTop; await onPick(s, a.ref, !!a.cat.overlay, a.length); if (root.isConnected) draw(); else { observer?.disconnect(); browserObservers.delete(observer); } }
          catch (error) { toast(`Could not apply the animation: ${error.message}`); apply.disabled = false; }
        } }, h('span', { class: 'animation-thumb', 'aria-hidden': 'true' }, a.poster ? h('img', { src: assetUrl(a.poster), alt: '', loading: 'lazy', decoding: 'async' }) : '▶'),
        h('span', { class: 'animation-copy' }, h('b', {}, a.name), h('small', {}, `${a.cat.layer || a.cat.name}${a.length ? ` · ${Number(a.length).toFixed(1)} s` : ''}`)), h('span', { class: 'animation-check', 'aria-hidden': 'true' }, chosen ? '✓' : '+'));
        const row = h('div', { class: `animation-row${chosen ? ' on' : ''}`, style: `top:${(start + offset) * 64}px` }, apply);
        if (!a.cat.overlay && a.ref.source !== 'mode') {
          const thumb = () => row.querySelector('.animation-thumb');
          row.addEventListener('pointerenter', () => thumbPlay.start(thumb(), def, a)); row.addEventListener('pointerleave', thumbPlay.stop);
          apply.addEventListener('focus', () => thumbPlay.start(thumb(), def, a)); apply.addEventListener('blur', thumbPlay.stop);
        }
        if (a.preview) row.append(h('button', { class: 'ib', title: `Preview ${a.name}`, onclick: () => {
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
let clipBar, camEl, camHandles = {}, emptyEl, headEl, timeEl, playBtn, panelEl, tabsEl, selEl, propSelEl, selBar, selToolsEl, wrapEl, exportBtn, hintEl, tlScroll, tlInner, tlLabels, tlBox, lineBox, handleEls = {};

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
    idle: pools.hands.length || pools.idle.length ? MODE_REFS.listener : null,        // everybody else: standing, hands held, a little life
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
      else { refs.push(m.ref); clips.push({ id: `m:${m.id}`, kind, name: animKey(m.ref), start: m.start, dur: m.end - m.start, off: m.off || 0, manual: true }); }
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

async function prepareStudio({ quiet = false } = {}) {
  const b = quiet ? { done() {} } : busy('Setting up characters & lip-sync…');
  try {
    for (const s of S.speakers) { const d = charOf(s); if (d) await stage.loadCharacter(d); }
    const tl = buildTimeline(S.lines.map((l) => ({ id: l.id, speaker: l.speaker.toLowerCase(), file: l.file, buffer: l.buffer, visemes: l.visemes, trimStart: l.trimStart || 0, trimEnd: l.trimEnd || 0 })));
    if (!tl.clips.length) tl.total = sceneLen();       // an empty scene is 8 seconds long (longer when clips or camera keys are placed later)
    player.setTimeline(tl);
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
const floatingOk = () => innerWidth > 860;
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
  const pill = pills[name] = h('button', { type: 'button', class: 'dock-pill', title: name === 'rail' ? 'Tool menu kholein' : 'Side panel kholein', 'aria-label': name === 'rail' ? 'Tool menu kholein' : 'Side panel kholein', onclick: () => dockShow(name) }, name === 'rail' ? '🧰' : '🗂');
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
const timelineHandle = () => resizeHandle('resize-tl', 'Timeline', (ev, start) => { S.layout.tlH = clampTimeline(start.tlH + (start.y - ev.clientY), innerHeight); applyLayout(wsEl(), S.layout); }, () => setLayout({ tlH: 0 }));
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
    Escape: S.layout.focus ? toggleFocus : null,
  };
  const run = actions[key];
  if (run && !(e.shiftKey && key.length === 1 && key !== '?' && key !== '[' && key !== ']')) { e.preventDefault(); run(); }
});

const TABS = [['audio', 'Audio', 'mic'], ['chars', 'Characters', 'users'], ['anim', 'Animations', 'film'], ['tears', 'Tears', 'droplet'], ['motion', 'Move', 'move'], ['grade', 'Colour', 'palette'], ['camera', 'Camera', 'video'], ['mask', 'Mask', 'mask'], ['ai', 'AI', 'sparkles'], ['canvas', 'Background', 'image'], ['props', 'Props', 'package'], ['effects', 'Effects', 'zap'], ['export', 'Export', 'download']];
function viewStudio() {
  playBtn = h('button', { class: 'btn pri icon-btn play-btn', title: 'Play (Space)', 'aria-label': 'Play', onclick: togglePlay }, icon('play'));
  timeEl = h('span', { class: 'time' }, '0:00.0');
  headEl = h('div', { class: 'phead' });
  tlLabels = h('div', { class: 'tl-labels' });
  tlInner = h('div', { class: 'tl-inner' });
  tlScroll = h('div', { class: 'tl-scroll' }, tlInner);
  tlBox = h('div', { class: 'tl2' }, tlLabels, tlScroll);
  lineBox = h('div', { class: 'linebox' });
  tabsEl = h('div', { class: 'tabs big' });
  panelEl = h('div', { class: 'panel' });
  dockWire(tabsEl, 'rail'); dockWire(panelEl, 'panel'); panelEl.addEventListener('pointerup', rememberPanelSize);
  const zoom = (f) => { const left = tlScroll.scrollLeft / S.pps; S.pps = Math.min(300, Math.max(4, S.pps * f)); drawTimeline(); tlScroll.scrollLeft = left * S.pps; };
  const fit = fitTimeline;
  const tools = h('div', { class: 'tltools' }, h('b', { class: 'timeline-title' }, 'Timeline'),
    h('button', { class: 'btn sm icon-btn', title: 'Zoom out timeline', 'aria-label': 'Zoom out timeline', onclick: () => zoom(1 / 1.5) }, icon('zoom-out')), h('button', { class: 'btn sm icon-btn', title: 'Zoom in timeline', 'aria-label': 'Zoom in timeline', onclick: () => zoom(1.5) }, icon('zoom-in')),
    h('button', { class: 'btn sm icon-btn', title: 'Fit whole timeline', 'aria-label': 'Fit whole timeline', onclick: fit }, icon('maximize')), h('span', { class: 'sp' }), h('span', { class: 'hint', style: 'margin:0' }, 'Select a clip to edit'));
  drawTimeline(); drawLineBox(); drawTabs();
  setTimeout(fit, 0);
  return h('div', { class: 'workbench' },
    h('div', { class: 'studio' },
      h('div', { class: 'prev' }, h('div', { class: 'stagehost' }, h('div', { class: 'stagebox', id: 'stagebox' }), emptyEl = emptyCard()),
        h('div', { class: 'controls' }, playBtn, h('button', { class: 'btn icon-btn', title: 'Back to start', 'aria-label': 'Back to start', onclick: () => { player.seek(0); selectLine(player.clips[0]?.id, false); S.dirty = true; } }, icon('skip-back')), timeEl, h('span', { class: 'sp' }),
          h('div', { class: 'editor-zoom' }, h('button', { class: 'btn sm icon-btn', title: 'Zoom out in editor', 'aria-label': 'Zoom out in editor', onclick: () => setEditorZoom(S.editorZoom / 1.25) }, icon('zoom-out')), h('button', { class: 'btn sm icon-btn', title: 'Fit scene in editor', 'aria-label': 'Fit scene in editor', onclick: () => setEditorZoom(1) }, icon('maximize')), zoomLabel = h('output', { 'aria-label': 'Editor zoom' }, '100%'), h('button', { class: 'btn sm icon-btn', title: 'Zoom in editor', 'aria-label': 'Zoom in editor', onclick: () => setEditorZoom(S.editorZoom * 1.25) }, icon('zoom-in'))), layoutTools()),
        selBar = h('div', { class: 'selbar', hidden: true })),
      h('div', { class: 'tlwrap' }, sceneTabs(), tools, clipBar = h('div', { class: 'clipbar', hidden: true }), tlBox, h('details', { class: 'line-details' }, h('summary', {}, 'Selected audio line'), lineBox)),
      h('div', { class: 'side' }, tabsEl, panelEl), dockEdge('left'), dockEdge('right'), dockPill('rail'), dockPill('panel'), panelHandle(), timelineHandle()));
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
  popup.style.left = `${Math.max(8, Math.min(left, innerWidth - popup.offsetWidth - 8))}px`;
  popup.style.top = `${Math.max(8, Math.min(top, innerHeight - popup.offsetHeight - 8))}px`;
}
document.addEventListener('pointerdown', event => {
  for (const group of document.querySelectorAll('#app .upload-tools[open]')) {
    if (!group.contains(event.target)) group.open = false;
  }
});
window.addEventListener('resize', () => {
  for (const group of document.querySelectorAll('#app .upload-tools[open]')) group.open = false;
});

function drawTabs() {
  updatePathView();
  stopAll();
  tabsEl.className = `tabs big${S.panelOpen ? '' : ' shut'}`;
  const advanced = new Set(['motion', 'camera', 'mask', 'ai']);
  const button = ([key, label, ic], openOnly = false) => h('button', { type: 'button', class: S.tab === key && S.panelOpen ? 'on' : '', 'aria-pressed': String(S.tab === key && S.panelOpen), title: label, onclick: () => {
    if (S.tab === key && !openOnly) S.panelOpen = !S.panelOpen; else { S.tab = key; S.panelOpen = true; }
    drawTabs(); S.dirty = true; if (S.panelOpen) dockShow('panel');
  } }, h('span', { class: 'ti', 'aria-hidden': 'true' }, icon(ic)), h('span', { class: 'sr' }, label));
  const byKey = Object.fromEntries(TABS.map(t => [t[0], t]));
  const rail = (label, keys) => [h('div', { class: 'rail-label' }, label), ...keys.map(k => button(byKey[k]))];
  const adv = (label, keys) => [h('div', { class: 'adv-label' }, label), ...keys.map(k => button(byKey[k]))];
  const more = h('details', {
    class: `advanced-tools${advanced.has(S.tab) ? ' has-active' : ''}`,
    ontoggle: event => {
      const group = event.currentTarget;
      if (group.open) { upload.open = false; placeToolbarGroup(group); }
    },
  },
    h('summary', { title: 'Advanced tools' }, h('span', { class: 'ti', 'aria-hidden': 'true' }, icon('settings')), h('span', { class: 'sr' }, 'Advanced')),
    h('div', { class: 'advanced-tools-list' }, ...adv('Direct', ['motion', 'camera', 'mask']), ...adv('Smart', ['ai'])));
  const uploads = new Set(['audio', 'canvas', 'props']);
  const upload = h('details', {
    class: `upload-tools${uploads.has(S.tab) && S.panelOpen ? ' has-active' : ''}`,
    ontoggle: event => {
      const group = event.currentTarget;
      if (group.open) { more.open = false; placeToolbarGroup(group); }
    },
    onkeydown: event => {
      if (event.key === 'Escape' && event.currentTarget.open) {
        event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false;
        event.currentTarget.querySelector('summary').focus();
      }
    },
  }, h('summary', { title: 'Upload', 'aria-label': 'Upload' }, h('span', { class: 'ti', 'aria-hidden': 'true' }, icon('upload')), h('span', { class: 'sr' }, 'Upload')),
  h('div', { class: 'advanced-tools-list upload-tools-list' }, ...['audio', 'canvas', 'props'].map(key => button(byKey[key], true))));
  tabsEl.replaceChildren(h('div', { class: 'rail-label' }, 'Create'), upload,
    ...['chars', 'anim', 'tears', 'effects', 'grade'].map(key => button(byKey[key])), ...rail('Output', ['export']), more);
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
function selectLine(id, seek = true) {
  if (!id) return;
  S.lineSel = id;
  const L = lineById(id);
  if (seek && L) { player.seek(L.start + 0.01); }
  drawTimeline(); drawLineBox(); S.dirty = true;
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
  const step = pps >= 90 ? 1 : pps >= 40 ? 2 : pps >= 18 ? 5 : pps >= 8 ? 10 : 20;
  const ticks = [];
  for (let t = 0; t <= total; t += step) ticks.push(h('span', { class: 'tick', style: `left:${t * pps}px` }, `${Math.floor(t / 60) ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` : `${t}s`}`));
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
    const el = h('div', { class: `tclip voice ${c.id === S.lineSel ? 'sel' : ''} ${trimmed ? 'trimmed' : ''}`, title: 'Drag the edge to resize the audio · double-click to remove the trim', style: `left:${c.start * pps}px;width:${Math.max(8, (c.end - c.start) * pps)}px;background:${sp?.color || '#888'}`, onclick: () => !S.exporting && selectLine(c.id) },
      lz, h('span', { class: 'tn' }, `${i + 1} · ${sp?.name || ''}${fileLabel(c.id) ? ` · ${fileLabel(c.id)}` : ''}`), rz);
    el.addEventListener('pointerdown', (e) => { if (e.target === lz || e.target === rz) dragVoice(e, c, e.target === rz ? 'right' : 'left', el); });
    el.addEventListener('dblclick', async () => { const line = S.lines.find((l) => l.id === c.id); if (!line || S.exporting || !(line.trimStart || line.trimEnd)) return; line.trimStart = 0; line.trimEnd = 0; await retimeAudio(); drawTimeline(); });
    lane.append(el);
  });
  // no audio yet: show only the ruler and the animation lanes (audio can still be added in the Audio tab)
  const hasAudio = player.clips.length > 0;
  const labels = [h('div', { class: 'rl ruler', style: `height:${RULER}px` }, 'Layers'), ...(hasAudio ? [h('div', { class: 'rl audio', style: 'height:52px' }, timelineIcon(null, 'audio'), h('span', { class: 'lt' }, 'Audio'))] : [])], lanes = [ruler, ...(hasAudio ? [lane] : [])];
  // the scene background, named like the audio and animation clips
  const bgName = S.bgId ? (S.myBgs.find((r) => r.id === S.bgId)?.name || 'Background image').replace(/\.[^.]+$/, '') : (BACKGROUNDS[stage.bg.preset] || BACKGROUNDS[0]).name;
  if (S.bgId || stage.bg.preset !== 0 || S.bgClips.length) {
    labels.push(h('div', { class: 'rl audio', style: 'height:38px', onclick: () => openTab('canvas') }, timelineIcon(background?.blob, 'background'), h('span', { class: 'lt' }, 'Background'),
      h('button', { type: 'button', class: 'rx delete-layer', title: 'Delete background layer', 'aria-label': 'Delete background layer', disabled: S.exporting, onclick: event => { event.stopPropagation(); return removeBackgroundLayer(); } }, '🗑')));
    const bgLane = h('div', { class: 'lane2 bg', style: 'height:38px' },
      S.bgId || stage.bg.preset !== 0 ? h('div', { class: 'tclip bg base', title: `Background · ${bgName} (whole scene)`, onclick: () => openTab('canvas'), style: `left:0;width:${Math.max(40, total * pps)}px` }, h('span', { class: 'tn' }, `Background · ${bgName}`)) : null);
    for (const c of S.bgClips) {
      const nm = (c.bgId ? (S.myBgs.find((r) => r.id === c.bgId)?.name || 'Background image').replace(/\.[^.]+$/, '') : (BACKGROUNDS[c.preset] || BACKGROUNDS[0]).name), lz = h('i', { class: 'lz' }), rz = h('i', { class: 'rz' });
      const el = h('div', { class: `tclip bg mine ${c.id === S.bgSel ? 'sel' : ''}`, title: `${nm} — drag to move, drag an edge to resize`, style: `left:${c.start * pps}px;width:${Math.max(6, c.dur * pps)}px` }, lz, h('span', { class: 'tn' }, `🖼 ${nm}`), rz);
      el.addEventListener('pointerdown', (e) => dragBgClip(e, c, e.target === rz ? 'right' : e.target === lz ? 'left' : 'move', el));
      bgLane.append(el);
    }
    lanes.push(bgLane);
  }
  // props and effects: one row each, visible from start to end
  for (const prop of S.props.filter((p) => p.visible !== false)) {
    const start = prop.start || 0, end = prop.end ?? total, lz = h('i', { class: 'lz' }), rz = h('i', { class: 'rz' });
    const el = h('div', { class: `tclip prop ${isEffect(prop) ? 'fx' : ''} mine ${prop.id === S.propSel ? 'sel' : ''}`, title: `${prop.name} — drag to move, drag an edge to resize`, style: `left:${start * pps}px;width:${Math.max(6, (end - start) * pps)}px` }, lz, h('span', { class: 'tn' }, `${isEffect(prop) ? '✨' : '🧸'} ${prop.name}`), rz);
    el.addEventListener('pointerdown', (e) => dragPropRange(e, prop, e.target === rz ? 'right' : e.target === lz ? 'left' : 'move', el));
    labels.push(h('div', { class: 'rl char', style: 'height:30px' }, h('span', { class: 'lt face' }, isEffect(prop) ? 'Effect' : 'Prop')));
    lanes.push(h('div', { class: 'lane2 prop', style: 'height:30px' }, el));
  }
  laneClips.clear();
  const KIND_ICON = { body: '🎬', hand: '✋', legs: '🦵', face: '🙂' }, LH = 46;
  for (const s of S.order.map(sOf).filter((x) => x?.charId && charOf(x))) {
    const plan = layerPlan(s), kinds = ['body', ...LAYER_KINDS.filter((k) => plan.clips.some((c) => c.kind === k) || (S.manual[s.key] || []).some((m) => m.kind === k))], nameOf = new Map(plan.refs.map((r) => [animKey(r), r.name]));
    kinds.forEach((kind, i) => {
      const ln = h('div', { class: 'lane2 char', style: `height:${LH}px;--track-color:${s.color}` });
      for (const c of plan.clips.filter((x) => x.kind === kind && !x.manual)) {
        const name = (nameOf.get(c.name) || c.name).replace(/^Listener · /, '');
        const ref = plan.refs.find((r) => animKey(r) === c.name), soloBody = c.id.startsWith('solo:body') && S.solo[s.key]?.bodyLen > 0;
        const pickable = !!ref && (soloBody || !c.id.startsWith('solo:')), lz = pickable && h('i', { class: 'lz' }), rz = pickable && h('i', { class: 'rz' });
        const el = h('div', { class: `tclip ${kind} auto`, title: `${s.name} · ${name}${pickable ? ' — drag to move, drag an edge to resize' : ' (automatic)'}`, style: `left:${c.start * pps}px;width:${Math.max(6, c.dur * pps)}px` }, lz || null, h('span', { class: 'tn' }, `${s.name} · ${name}`), rz || null);
        el.addEventListener('click', () => { const L = lineAt(c.start + 0.01); if (L && player.clips.length) selectLine(L.id); });
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
        const el = h('div', { 'data-mid': m.id, class: `tclip ${kind} mine ${m.id === S.mclip ? 'sel' : ''}`, title: `${s.name} · ${name} — drag to move, drag an edge to resize`, style: `left:${m.start * pps}px;width:${Math.max(6, m.dur * pps)}px` }, lz, h('span', { class: 'tn' }, `${s.name} · ${name}`), rz);
        el.addEventListener('pointerdown', (e) => dragClip(e, m, e.target === rz ? 'right' : e.target === lz ? 'left' : 'move', el));
        ln.append(el);
      }
      labels.push(h('div', { class: 'rl char', style: `height:${LH}px;--track-color:${s.color};cursor:pointer`, onclick: () => selectChar(s.key) }, i === 0 ? [timelineIcon(portrait(s)), h('span', { class: 'lt-wrap' }, h('span', { class: 'lt', title: s.name }, s.name), h('small', { class: 'lanim', 'data-anim': `${s.key}|body` }, '')), h('button', { class: 'rx add', title: `Add an animation for ${s.name} at the playhead`, onclick: () => clipPicker(s) }, '＋'), h('button', { type: 'button', class: 'rx delete-layer', title: `Delete ${s.name} from scene`, 'aria-label': `Delete ${s.name} from scene`, disabled: S.exporting, onclick: () => removeCharacterFrom(s) }, '🗑')] : h('span', { class: 'lt-wrap' }, h('span', { class: 'lt face' }, `${KIND_ICON[kind]} ${kind}`), h('small', { class: 'lanim', 'data-anim': `${s.key}|${kind}` }, ''))));
      laneClips.set(`${s.key}|${kind}`, [...plan.clips.filter((x) => x.kind === kind).map((c) => ({ start: c.start, end: c.start + c.dur, name: (nameOf.get(c.name) || c.name).replace(/^Listener · /, '') })), ...(S.manual[s.key] || []).filter((x) => x.kind === kind).map((m) => ({ start: m.start, end: m.start + m.dur, name: m.ref.name.replace(/^Listener · /, '') }))]);
      lanes.push(ln);
    });
    const cks = S.charKeys[s.key];
    if (cks?.length) {
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
const bgClipJobs = () => S.bgClips.map((c) => ({ start: c.start, dur: c.dur, preset: c.preset ?? 0, blob: c.bgId ? S.myBgs.find((r) => r.id === c.bgId)?.blob ?? null : null }));
const syncBgClips = async () => { await stage.setBackgroundClips(bgClipJobs()); S.dirty = true; };
function updateTotal() {
  if (player.clips.length) return;
  const len = sceneLen();
  if (Math.abs(len - player.total) > 0.01) { player.total = len; fitTimeline(); }
}
const snap = (v) => Math.round(v * 20) / 20;
function commitClips(redraw = true) { updateTotal(); refreshPresence(); if (redraw) { drawTimeline(); } else drawClipBar(); }
async function addClip(s, ref, overlay, length) {
  const kind = ref.layer || (overlay ? 'face' : 'body'), dur = Math.max(0.3, +(length || 3).toFixed(2));
  const start = Math.max(0, snap(Math.min(player.time, Math.max(0, player.total - 0.3))));
  const m = { id: uid(), kind, ref: { ...ref }, start, dur, off: 0 };
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
function dragItem(e, mode, el, io) {
  if (S.exporting) return;
  e.preventDefault(); e.stopPropagation();
  io.select?.();
  const x0 = e.clientX, from = io.get(), pps = S.pps; let moved = false, raf = 0;
  el.setPointerCapture?.(e.pointerId);
  const mv = (ev) => {
    if (Math.abs(ev.clientX - x0) > 2) moved = true;
    const r = resizeClip({ mode, ...from, delta: (ev.clientX - x0) / pps, min: io.min ?? MIN_CLIP, room: io.room ?? from.off ?? 0 });
    io.set(r);
    el.style.left = `${r.start * pps}px`; el.style.width = `${Math.max(6, r.dur * pps)}px`;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; refreshPresence(); });
  };
  const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); if (!moved) { drawClipBar(); return; } const done = io.after?.(); if (done?.then) done.then(() => commitClips()); else commitClips(); };
  el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}
/** drag the head or tail of a voice line to cut it shorter (or bring back what was cut); later lines slide up, the scene gets shorter */
function dragVoice(e, c, mode, el) {
  const line = S.lines.find((l) => l.id === c.id);
  if (!line) return;
  const whole = c.end - c.start, from = { start: c.start, dur: whole, off: line.trimStart || 0 };
  let result = from;
  dragItem(e, mode, el, {
    min: 0.2, room: line.trimStart || 0,
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
const selectOnly = (kind, id) => { S.mclip = kind === 'clip' ? id : null; S.bgSel = kind === 'bg' ? id : null; S.propSel = kind === 'prop' ? id : null; document.querySelectorAll('.tclip.sel:not(.voice)').forEach((x) => x.classList.remove('sel')); drawClipBar(); };
function dragClip(e, m, mode, el) {
  dragItem(e, mode === 'size' ? 'right' : mode, el, {
    get: () => ({ start: m.start, dur: m.dur, off: m.off || 0 }),
    set: (r) => { m.start = r.start; m.dur = r.dur; m.off = r.off; },
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
function dragBgClip(e, c, mode, el) {
  dragItem(e, mode, el, {
    room: Infinity, off: 0,
    get: () => ({ start: c.start, dur: c.dur, off: 0 }),
    set: (r) => { c.start = r.start; c.dur = r.dur; },
    select: () => { selectOnly('bg', c.id); el.classList.add('sel'); },
    after: () => { syncBgClips(); },
  });
}
/** a prop / effect is visible from start to end; with no end it stays to the end of the scene */
function dragPropRange(e, prop, mode, el) {
  dragItem(e, mode, el, {
    room: Infinity,
    get: () => { const start = prop.start || 0; return { start, dur: Math.max(MIN_CLIP, (prop.end ?? player.total) - start), off: 0 }; },
    set: (r) => { prop.start = r.start; prop.end = +(r.start + r.dur).toFixed(2); },
    select: () => { selectOnly('prop', prop.id); el.classList.add('sel'); },
    after: () => { stage.setProps(S.props); S.dirty = true; dbPut('props', prop); },
  });
}
function drawClipBar() {
  if (!clipBar) return;
  const bc = S.bgSel && S.bgClips.find((x) => x.id === S.bgSel), pr = !bc && S.propSel && S.props.find((x) => x.id === S.propSel);
  if (bc || pr) return rangeBar(bc, pr);
  const f = S.mclip && findManual(S.mclip);
  if (!f) { clipBar.hidden = true; return; }
  const { s, m, list } = f;
  const num = (label, get, set) => h('label', { class: 'cb-n' }, label, h('input', { type: 'number', step: 0.05, min: 0, value: get().toFixed(2), onchange: (e) => { set(+e.target.value || 0); setTimeout(commitClips, 0); } }));
  const btn = (txt, fn, title) => h('button', { class: 'btn sm', title, onclick: fn }, txt);
  clipBar.hidden = false;
  clipBar.replaceChildren(
    h('span', { class: 'dot', style: `background:${s?.color || '#888'}` }), h('b', { class: 'cb-name' }, m.ref.name), h('small', {}, `${s?.name || ''} · ${m.kind}`),
    num('Start s', () => m.start, (v) => { m.start = Math.max(0, snap(v)); }), num('Length s', () => m.dur, (v) => { m.dur = Math.max(0.2, v); }),
    btn('📋 Copy', copySelected, 'Ctrl+C'), btn('📌 Paste', pasteClip, 'Ctrl+V — at the playhead'),
    btn('⧉ Duplicate', () => { const c = { ...m, id: uid(), ref: { ...m.ref }, start: snap(m.start + m.dur) }; list.push(c); S.mclip = c.id; commitClips(); }, 'Same animation again, right after this one'),
    btn('✂ Split', () => { const t = player.time; if (t <= m.start + 0.1 || t >= m.start + m.dur - 0.1) { toast('Please move the playhead inside this clip first.'); return; } const c = { ...m, id: uid(), ref: { ...m.ref }, start: snap(t), dur: m.start + m.dur - snap(t), off: (m.off || 0) + (snap(t) - m.start) }; m.dur = snap(t) - m.start; list.push(c); S.mclip = c.id; commitClips(); }, 'Cut this clip at the playhead'),
    btn('⇄ Replace', () => clipPicker(s, async (ref, overlay, length) => { m.ref = { ...ref }; m.kind = ref.layer || (overlay ? 'face' : 'body'); if (length) m.dur = Math.max(0.3, +length.toFixed(2)); const b = busy('Applying…'); try { await applyLayers(); } catch (er) { toast(er.message); } finally { b.done(); } commitClips(); }), 'Pick another animation for this clip'),
    btn('🗑 Delete', () => { list.splice(list.indexOf(m), 1); S.mclip = null; commitClips(); }),
    btn('✕', () => { S.mclip = null; drawTimeline(); }, 'Close'));
}

/** copy the selected timeline item (animation clip, background clip, prop / effect); paste puts a copy at the playhead */
function copySelected() {
  const f = S.mclip && findManual(S.mclip), bc = S.bgSel && S.bgClips.find((x) => x.id === S.bgSel), pr = S.propSel && S.props.find((x) => x.id === S.propSel);
  if (f) S.clipboard = { type: 'clip', key: f.s?.key, data: clone(f.m) };
  else if (bc) S.clipboard = { type: 'bg', data: clone(bc) };
  else if (pr) S.clipboard = { type: 'prop', data: { ...pr } };
  else { toast('Please choose a clip on the timeline first, then copy it.'); return false; }
  toast('Clip copied. Place the playhead where you want it and press Ctrl+V to paste.'); drawClipBar(); return true;
}
async function pasteClip() {
  const cb = S.clipboard;
  if (!cb) { toast('Please copy a clip first.'); return; }
  const at = snapTo(player.time);
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
  const btn = (txt, fn, title) => h('button', { class: 'btn sm', title, onclick: fn }, txt);
  const name = bc ? (bc.bgId ? S.myBgs.find((r) => r.id === bc.bgId)?.name || 'Background image' : (BACKGROUNDS[bc.preset] || BACKGROUNDS[0]).name) : pr.name;
  clipBar.hidden = false;
  clipBar.replaceChildren(h('b', { class: 'cb-name' }, name), h('small', {}, bc ? 'Background' : isEffect(pr) ? 'Effect' : 'Prop'),
    bc ? num('Start s', () => bc.start, (v) => { bc.start = Math.max(0, snapTo(v)); }) : num('Start s', () => pr.start || 0, (v) => { pr.start = Math.max(0, snapTo(v)); }),
    bc ? num('Length s', () => bc.dur, (v) => { bc.dur = Math.max(MIN_CLIP, v); }) : num('Length s', () => (pr.end ?? player.total) - (pr.start || 0), (v) => { pr.end = +((pr.start || 0) + Math.max(MIN_CLIP, v)).toFixed(2); }),
    btn('📋 Copy', copySelected, 'Ctrl+C'), btn('📌 Paste', pasteClip, 'Ctrl+V — at the playhead'),
    bc ? btn('🗑 Delete', () => { S.bgClips = S.bgClips.filter((x) => x !== bc); S.bgSel = null; syncBgClips(); commitClips(); }) : btn('↔ Whole scene', () => { delete pr.start; delete pr.end; stage.setProps(S.props); dbPut('props', pr); S.dirty = true; commitClips(); }, 'Remove start / end: show through the whole scene'),
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
  updatePathView();
  return h('div', { class: 'list' },
    h('div', { class: 'tabs' }, chars.map((c) => h('button', { class: c.key === s.key ? 'on' : '', onclick: () => { S.motionFor = c.key; S.sel = c.key; updateSel(); drawTabs(); } }, h('span', { class: 'dot', style: `background:${c.color};display:inline-block;margin-right:6px` }), c.name))),
    pathCard(s),
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
let pathSvg = null, pathDots = [], pathSig = '';
const removePathView = () => { pathSvg?.remove(); pathSvg = null; pathDots.forEach((d) => d.remove()); pathDots = []; pathSig = ''; };
/** the saved path of the character in the Move tab, drawn over the stage (start = green dot, end = red dot); in edit mode its points can be dragged */
function updatePathView(force = true) {
  const path = S.tab === 'motion' && !S.pathDraw && S.motionFor ? S.paths[S.motionFor] : null;
  if (!path?.pts?.length || !wrapEl || S.exporting) { removePathView(); return; }
  const v = viewOf(), sig = `${S.motionFor}|${S.pathEdit}|${path.pts.length}|${v.x.toFixed(1)},${v.y.toFixed(1)},${v.w.toFixed(1)}|${path.pts[0].x}${path.pts.at(-1).y}`;
  if (!force && sig === pathSig && pathSvg?.isConnected) return;
  pathSig = sig;
  if (!pathSvg || !pathSvg.isConnected) {
    pathSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    pathSvg.setAttribute('class', 'pathview'); pathSvg.setAttribute('viewBox', '0 0 100 100'); pathSvg.setAttribute('preserveAspectRatio', 'none'); pathSvg.setAttribute('aria-hidden', 'true');
    wrapEl.append(pathSvg);
  }
  const a = toScreen(path.pts[0]), b = toScreen(path.pts.at(-1));
  pathSvg.setAttribute('class', `pathview${S.pathEdit ? ' editing' : ''}`);
  pathSvg.innerHTML = `<polyline points="${penLine(path.pts)}"/><circle class="s" cx="${a.x * 100}" cy="${a.y * 100}" r="1.1"/><circle class="e" cx="${b.x * 100}" cy="${b.y * 100}" r="1.1"/>`;
  pathDots.forEach((d) => d.remove()); pathDots = [];
  if (!S.pathEdit) return;
  const poly = pathSvg.querySelector('polyline');
  poly.addEventListener('dblclick', (e) => {                    // double-click the line: a new point appears there
    const r = stage.out.getBoundingClientRect(), p = fromScreen((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height), hit = insertAt(path.pts, p);
    path.pts.splice(hit.index, 0, hit.point); applyPath(S.motionFor); updatePathView();
  });
  path.pts.forEach((pt, i) => {
    const q = toScreen(pt), dot = h('i', { class: 'pathpt', title: 'Kheenchein · double-click = point hatao', style: `left:${q.x * 100}%;top:${q.y * 100}%` });
    dot.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation(); dot.setPointerCapture(e.pointerId);
      const mv = (ev) => { const r = stage.out.getBoundingClientRect(); path.pts[i] = fromScreen((ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height); dot.style.left = `${toScreen(path.pts[i]).x * 100}%`; dot.style.top = `${toScreen(path.pts[i]).y * 100}%`; pathSvg.querySelector('polyline').setAttribute('points', penLine(path.pts)); };
      const up = () => { dot.removeEventListener('pointermove', mv); dot.removeEventListener('pointerup', up); applyPath(S.motionFor); updatePathView(); };
      dot.addEventListener('pointermove', mv); dot.addEventListener('pointerup', up);
    });
    dot.addEventListener('dblclick', (e) => { e.stopPropagation(); if (path.pts.length <= 2) { toast('A path needs at least 2 points.'); return; } path.pts.splice(i, 1); applyPath(S.motionFor); updatePathView(); });
    pathDots.push(dot); wrapEl.append(dot);
  });
}
function stopPathDraw() { S.pathDraw?.cleanup(); S.pathDraw = null; }
/** pen tool: press on the stage and draw the way the character should walk; letting go finishes the line */
function startPathDraw(s) {
  if (S.exporting || !wrapEl) return;
  stopPathDraw(); removePathView(); S.pathEdit = false; player.pause();
  const layer = h('div', { class: 'pathdraw', title: 'Draw a line with the pen' }), svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('preserveAspectRatio', 'none'); svg.innerHTML = '<polyline points=""/>';
  layer.append(svg, h('span', { class: 'pathhint' }, `✏️ Draw a line for ${s.name} · Esc = cancel`));
  wrapEl.append(layer);
  const line = svg.querySelector('polyline'); let pts = null;
  const at = (e) => { const r = stage.out.getBoundingClientRect(), p = fromScreen((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); return { x: Math.min(1.2, Math.max(-0.2, p.x)), y: Math.min(1.2, Math.max(-0.2, p.y)) }; };
  const down = (e) => { e.preventDefault(); e.stopPropagation(); layer.setPointerCapture(e.pointerId); pts = [at(e)]; };
  const move = (e) => { if (!pts) return; pts.push(at(e)); line.setAttribute('points', penLine(pts)); };
  const up = () => {
    if (!pts) return;
    const clean = thin(pts, 0.006), now = charNow(s.key);
    if (clean.length < 2 || pathLength(clean) < 0.03) { pts = null; line.setAttribute('points', ''); toast('The line is too short. Please draw a slightly longer line.'); return; }
    const old = S.paths[s.key];
    S.paths[s.key] = { pts: clean, start: old?.start ?? +player.time.toFixed(2), dur: old?.dur ?? Math.max(1, +(pathLength(clean) * 8).toFixed(1)), face: old?.face ?? true, smooth: old?.smooth ?? false, flipBase: !!now?.flip, mul: now?.mul ?? 1 };
    stopPathDraw(); applyPath(s.key); player.seek(Math.min(player.total, S.paths[s.key].start)); drawTabs();
  };
  const key = (e) => { if (e.key === 'Escape') { stopPathDraw(); drawTabs(); } };
  layer.addEventListener('pointerdown', down); layer.addEventListener('pointermove', move); layer.addEventListener('pointerup', up); window.addEventListener('keydown', key);
  S.pathDraw = { key: s.key, cleanup: () => { layer.remove(); window.removeEventListener('keydown', key); } };
  drawTabs();
}
function pathCard(s) {
  const path = S.paths[s.key], num = (label, get, set) => h('label', { class: 'cs-sl' }, h('span', {}, label), h('input', { type: 'number', step: 0.1, min: 0, value: get().toFixed(1), onchange: (e) => { set(Math.max(0, +e.target.value || 0)); applyPath(s.key); drawTabs(); } }));
  const tog = (label, key) => h('label', { class: 'tog' }, h('input', { type: 'checkbox', checked: !!path[key], onchange: (e) => { path[key] = e.target.checked; applyPath(s.key); } }), label);
  return h('div', { class: 'card flat path-card' }, h('h2', {}, `✏️ Path · ${s.name}`),
    h('p', { class: 'sub', style: 'font-size:12px;margin:0 0 8px' }, path ? `The character follows this line (from ${fmt(path.start)} to ${fmt(path.start + path.dur)}).` : 'Draw a line on the stage with the pen; the character will follow that path.'),
    S.pathDraw ? h('button', { class: 'btn', onclick: () => { stopPathDraw(); drawTabs(); } }, '✕ Cancel') : h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, h('button', { class: 'btn ok', onclick: () => startPathDraw(s) }, path ? '✏️ Redraw' : '✏️ Draw a path with the pen'),
      path ? h('button', { class: `btn${S.pathEdit ? ' pri' : ''}`, onclick: () => { S.pathEdit = !S.pathEdit; if (S.pathEdit) path.pts = simplify(path.pts, 14); applyPath(s.key); drawTabs(); } }, S.pathEdit ? '✔ Points done' : '✎ Edit points') : null,
      path ? h('button', { class: 'btn', onclick: () => { delete S.paths[s.key]; S.pathEdit = false; applyPath(s.key); drawTabs(); } }, '🗑 Remove path') : null),
    path && S.pathEdit ? h('p', { class: 'sub', style: 'font-size:12px;margin:6px 0 0' }, 'Drag the yellow dots to change the path. Double-click the line to add a point, double-click a point to remove it.') : null,
    path && !S.pathDraw ? [num('Start (s)', () => path.start, (v) => { path.start = +v.toFixed(2); }), num('Duration (s)', () => path.dur, (v) => { path.dur = Math.max(0.5, +v.toFixed(2)); }),
      tog('↔ Turn to face the direction of travel', 'face'), tog('🐢 Slow at start / end', 'smooth')] : null);
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
  if (L && L.id !== S.lineSel) { S.lineSel = L.id; drawTimeline(); drawLineBox(); if (S.tab === 'anim' && S.panelOpen) drawTabs(); }
}

/* ---- layers of the selected audio line ---- */
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
  lineBox.replaceChildren(head, shotRow, chars.length ? h('div', { class: 'lrows' }, rows) : h('p', { class: 'sub', style: 'margin:6px 0 0' }, 'No characters on stage yet. Add one in the Characters tab.'),
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

let localSaveError = '', saveDetails, saveBody;
function updateSaveStatus(state = syncStatus) {
  if (state.projectId && state.projectId !== projectContext()?.id) state = { text: 'Saved locally' };
  if (!savedEl || !saveBody) return;
  const feedback = localSaveError ? { label: 'Local save failed', tone: 'error' } : syncPresentation(state);
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
  propSelEl = h('div', { class: 'prop-sel', hidden: true, 'aria-label': 'Selected prop; drag to move' });
  handleEls = Object.fromEntries(['tl', 'tr', 'bl', 'br'].map((c) => [c, h('i', { class: `hd h-${c}`, 'data-c': c, hidden: true })]));
  tearHandlesEl = h('div', { class: 'tear-handles', hidden: true }, tearHandle('left'), tearHandle('right'));
  selToolsEl = h('div', { class: 'sel-tools', hidden: true });
  wrapEl = h('div', { class: 'stagewrap' }, stage.out, selEl, propSelEl, ...Object.values(handleEls), tearHandlesEl, selToolsEl);
  stageObserver?.disconnect();
  const box = document.getElementById('stagebox'); box.replaceChildren(wrapEl);
  stageObserver = new ResizeObserver(fitEditor); stageObserver.observe(box); fitEditor();
  mountCamBox();
  let drag = null;
  const pt = (e) => { const r = stage.out.getBoundingClientRect(), k = stage.W / r.width; return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k }; };
  const layer = () => stage.layers.find((l) => l.key === S.sel);
  wrapEl.addEventListener('pointerdown', (e) => {
    if (S.exporting) return;
    if (e.target.closest('.sel-tools')) return;   // the floating character-tools toolbar sits over the canvas; its own buttons handle their clicks
    if (camPointerDown(e)) return;
    if (syncFullView()) return;
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
      drag = { mode: 'scale', A: { x: corners[opp][0], y: corners[opp][1] }, C: { x: c[0], y: c[1] }, a0: { ...l.anchor }, mul0: l.mul ?? 1 };
    } else {
      l = stage.camZoom <= 1.02 ? stage.hitLayers(p)[0] : null;      // the character really under the mouse (its drawn shape), not just the biggest box
      S.sel = l?.key ?? null;
      if (l) drag = { mode: 'move', p0: p, a0: { ...l.anchor } };
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
      const r = Math.min(8, Math.max(0.15, ((p.x - drag.A.x) * vx + (p.y - drag.A.y) * vy) / (vx * vx + vy * vy)));
      l.mul = drag.mul0 * r;
      a = { x: drag.A.x + (drag.a0.x - drag.A.x) * r, y: drag.A.y + (drag.a0.y - drag.A.y) * r };
    }
    l.axf = a.x / W; l.ayf = (H - a.y) / H;
    saveXf(l); stage.layout(); updateSel(); S.dirty = true;
  });
  const end = async () => { if (camPointerUp()) return; if (drag?.mode === 'prop') { try { await dbPut('props', drag.prop); drawTabs(); } catch (e) { toast(`Could not save the prop's position: ${e.message}`); } } if (drag && S.tab === 'motion') drawTabs(); drag = null; };
  wrapEl.addEventListener('pointerup', end); wrapEl.addEventListener('pointercancel', end);
  S.dirty = true; updateSel();
}
function saveXf(l) {
  if (S.charKeys[l.key]?.length) { writeCharKey(l); return; }          // with keyframes, moving / resizing edits the keyframe at the playhead
  const s = S.speakers.find((x) => x.key === l.key); if (s) s.xf = { mul: l.mul ?? 1, axf: l.axf, ayf: l.ayf };
}
function updateSel() {
  if (emptyEl) emptyEl.hidden = S.lines.length > 0 || S.speakers.some((x) => x.charId);
  if (!selEl) return;
  const fullView = syncFullView();
  const prop = S.props.find((item) => item.id === S.selectedPropId);
  if (prop && !isHeld(prop) && S.step === 3 && !fullView && stage.camZoom <= 1.02 && !player.playing) {      // a held prop has no box: it moves with the hand
    selEl.hidden = true; Object.values(handleEls).forEach((e) => { e.hidden = true; });
    if (selBar) selBar.hidden = true;
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
  if (!l || l.shown === false || S.step !== 3 || fullView) { hideBox(); if (selBar) selBar.hidden = true; return; }
  if (S.tab === 'tears' && S.tearPlacement) { hideBox(); if (selBar) selBar.hidden = true; return; }
  if (selBar.dataset.key !== l.key) drawSelBar(l);
  selBar.hidden = false;
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
const SEL_TOOLS = [['anim', 'Animations', 'film'], ['tears', 'Tears', 'droplet'], ['mask', 'Mask', 'mask'], ['motion', 'Move', 'move']];
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
  S.sel = key; S.selectedPropId = null; S.animFor = key;
  const l = stage.layers.find((x) => x.key === key);
  if (l && l.shown === false && l.present?.length) { const t = Math.min(...l.present.map((x) => x.start)); if (Number.isFinite(t)) { player.seek(t); toast(`${sOf(key)?.name || 'Character'} was not in frame at this time, so the playhead was moved to its earlier shot.`); } }
  updateSel(); drawLineBox(); S.dirty = true;
}
function drawSelBar(l) {
  const s = S.speakers.find((x) => x.key === l.key);
  selBar.dataset.key = l.key; selBar.hidden = false;
  selBar.replaceChildren(
    h('span', { class: 'dot', style: `background:${s.color}` }), h('input', { class: 'character-name', 'aria-label': 'Selected character name', value: s.name, maxlength: 80, onchange: e => { const name = e.target.value.trim(); if (!name) { e.target.value = s.name; return; } s.name = name; drawTabs(); drawLineBox(); drawTimeline(); S.dirty = true; } }),
    h('span', { class: 'pct' }, `${Math.round((l.mul ?? 1) * 100)}%`),
    h('input', { type: 'range', min: 20, max: 800, value: Math.round((l.mul ?? 1) * 100), 'aria-label': 'Size', oninput: (e) => {
      const m = e.target.value / 100, cur = stage.layers.find((x) => x.key === l.key);
      cur.axf ??= cur.anchor.x / stage.W; cur.ayf ??= (stage.H - cur.anchor.y) / stage.H; // keep feet where they are
      cur.mul = m; saveXf(cur); stage.layout(); updateSel(); S.dirty = true;
    } }),
    h('button', { class: 'btn sm icon-btn', title: 'Mirror', 'aria-label': 'Mirror', onclick: () => { s.flip = !s.flip; s._flipSet = true; const cur = stage.layers.find((x) => x.key === l.key); cur.flip = s.flip; if (S.charKeys[l.key]?.length) writeCharKey(cur); stage.layout(); updateSel(); S.dirty = true; } }, icon('flip')),
    h('button', { type: 'button', class: 'btn sm delete-character', title: 'Delete selected character', 'aria-label': 'Delete selected character', disabled: S.exporting, onclick: () => removeCharacterFrom(s) }, '🗑 Delete'),
    h('button', { class: 'btn sm icon-btn', title: 'Hide the box', 'aria-label': 'Hide the box', onclick: () => { S.sel = null; selBar.dataset.key = ''; updateSel(); S.dirty = true; } }, icon('x')),
    h('button', { class: 'btn sm icon-btn', title: 'Reset size & position', 'aria-label': 'Reset size and position', onclick: () => { s.xf = null; const cur = stage.layers.find((x) => x.key === l.key); cur.mul = 1; cur.axf = cur.ayf = null; stage.layout(); updateSel(); S.dirty = true; } }, icon('rotate')));
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
function emptyCard() {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-in' },
    h('b', {}, 'Start your scene'),
    h('p', {}, 'Add audio lines, characters and a background — in any order. Audio is optional.'),
    h('div', { class: 'row', style: 'justify-content:center;gap:8px' },
      h('button', { class: 'btn pri', onclick: () => openTab('audio') }, '🎙 Add audio'),
      h('button', { class: 'btn ok', onclick: addManualCharacter }, '🎭 Add character'),
      h('button', { class: 'btn', onclick: () => openTab('canvas') }, '🖼 Background'))));
}
/** a character that does not belong to any voice (works without audio) */
function addManualCharacter() {
  const n = S.speakers.filter((s) => s.manual).length + 1;
  let key = `actor${n}`; while (S.speakers.some((s) => s.key === key)) key += 'x';
  const s = { key, name: `Character ${n}`, narrator: false, color: COLORS[S.speakers.length % COLORS.length], charId: null, flip: false, visible: true, manual: true };
  chooseCharacter(s, async () => {
    if (!s.charId) { S.speakers = S.speakers.filter((x) => x !== s); S.order = S.order.filter((k) => k !== key); drawTabs(); return; }
    S.speakers.push(s); S.order.push(key);
    const b = busy('Loading character…');
    try { const d = charOf(s); if (d) await stage.loadCharacter(d); S.speakers.filter((x) => x.charId).forEach((x, i) => { if (!x._flipSet) x.flip = i % 2 === 1; }); await applyLayers(); } catch (e) { toast(e.message); }
    b.done(); S.animFor = key; drawTimeline(); drawLineBox(); drawTabs(); S.dirty = true;
  });
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
    h('p', { class: 'sub', style: 'font-size:12px;margin:0' }, 'Audio is optional. Add it when you have your voice lines — every voice then gets its own character.'),
    drop,
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
  const onStage = S.order.map(sOf).filter((s) => s?.charId);
  const rows = onStage.map((s, i) => {
    const c = charOf(s), entry = libraryCharacters().find((e) => `lib:${e.id}` === s.charId);
    const mv = (d) => { const j = S.order.indexOf(onStage[i + d].key), me = S.order.indexOf(s.key); [S.order[me], S.order[j]] = [S.order[j], S.order[me]]; stage.reorder([...S.order].reverse()); S.dirty = true; drawTabs(); drawTimeline(); };
    return h('div', { class: 'layer' }, h('span', { class: 'th xs' }, entry ? h('img', { src: cdn(entry.thumbnail), alt: '' }) : c.thumb ? h('img', { src: c.thumb, alt: '' }) : '🎭'),
      h('div', { class: 't', style: 'cursor:pointer', onclick: () => selectChar(s.key) }, s.name, h('small', {}, c.name)),
      skinNames(c).length > 1 ? h('button', { class: 'ib', title: 'Outfit', onclick: () => outfitModal(s) }, '👗') : null,
      h('button', { class: 'ib', title: 'Change character', onclick: () => addCharacterTo(s) }, '⇄'),
      h('button', { class: 'ib', title: 'Bring forward', disabled: i === 0, onclick: () => mv(-1) }, '↑'),
      h('button', { class: 'ib', title: 'Send back', disabled: i === onStage.length - 1, onclick: () => mv(1) }, '↓'),
      h('button', { class: 'ib', title: 'Show / hide', onclick: (e) => { s.visible = !s.visible; const l = stage.layers.find((x) => x.key === s.key); if (l) l.visible = s.visible; e.currentTarget.textContent = s.visible ? '👁' : '—'; S.dirty = true; } }, s.visible ? '👁' : '—'),
      h('button', { class: 'ib', title: 'Remove from stage', onclick: () => removeCharacterFrom(s) }, '🗑'));
  });
  const without = S.speakers.filter((s) => !s.charId).map((s) => h('div', { class: 'layer' }, h('span', { class: 'dot', style: `background:${s.color}` }), h('div', { class: 't' }, s.name, h('small', {}, s.manual ? 'No character yet' : 'Voice without a character')),
    h('button', { class: 'btn sm', onclick: () => addCharacterTo(s) }, '＋ Pick character'),
    s.manual ? h('button', { class: 'ib', title: 'Remove', onclick: () => { S.speakers = S.speakers.filter((x) => x !== s); S.order = S.order.filter((k) => k !== s.key); drawTabs(); } }, '✕') : null));
  const n = rows.length + without.length, collapsed = charsCollapsed();
  const emptyShown = !(S.lines.length > 0 || S.speakers.some((x) => x.charId));      // the empty-stage "Add character" button is also on screen right now
  const toggle = h('button', { type: 'button', class: 'btn sm icon-btn chars-collapse', title: collapsed ? 'Expand the character list' : 'Collapse the character list', 'aria-label': collapsed ? 'Expand the character list' : 'Collapse the character list', 'aria-expanded': String(!collapsed), onclick: () => { setCharsCollapsed(!collapsed); drawTabs(); } }, icon(collapsed ? 'arrow-down' : 'arrow-up'));
  return h('div', { class: 'list' }, h('button', { class: 'btn ok', 'aria-label': emptyShown ? 'Add a character to the stage' : undefined, onclick: addManualCharacter }, '＋ Add character'),
    h('div', { class: 'chars-head' }, h('p', { class: 'sub', style: 'font-size:12px;margin:0;flex:1' }, `Characters on stage (${n}) — top = in front.`), n ? toggle : null),
    ...(collapsed ? [] : [...rows, ...without]));
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
  const selectedRef = () => { const r = cur(); return r && !r.auto ? r.body : r?.body ?? null; };
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
      applyDirection({ id: L.id, speaker: L.speaker, dur: L.end - L.start }, res, libs);
      prevDir = { shot: S.shots.get(L.id), in_frame: onStage.filter((s) => castOf(L.id, s.key).in).map((s) => s.key), actions: res.actions, reason: res.reason };
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
    dropped += applyDirection({ id: l.id, speaker: l.speaker, dur: l.dur }, e, libs); applied++;
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
async function putProp(prop) {
  await dbPut('props', prop); S.props.push(prop); S.selectedPropId = prop.id;
  await stage.setProps(S.props); S.dirty = true; drawTabs(); updateSel();
}
async function addLibraryProp(asset) {
  const loading = busy(asset.type === 'effect' ? 'Applying effect…' : 'Applying prop…');
  try { await putProp(propFromAsset(asset, await libraryBlob(asset), crypto.randomUUID())); }
  catch (e) { toast(`Could not add the ${asset.type === 'effect' ? 'effect' : 'prop'}: ${friendlyError(e)}`); }
  finally { loading.done(); }
}
async function addOwnProps(files) {
  try {
    for (const f of files) {
      if (!f.type.startsWith('image/')) { toast('Please choose an image file only.'); continue; }
      await putProp({ id: crypto.randomUUID(), kind: 'prop', name: f.name.replace(/\.[^.]+$/, '').slice(0, 60) || 'My prop', blob: f, x: .5, y: .66, w: .18, h: .18, rotation: 0, visible: true });
    }
  } catch (e) { toast(`Could not add the prop: ${friendlyError(e)}`); }
}
function libraryTab(kind) {
  if (!libraryTab.checked) { libraryTab.checked = true; refreshShared().then((changed) => { if (changed && (S.tab === 'props' || S.tab === 'effects')) redrawPanel(); }); }
  const effects = kind === 'effect', label = effects ? 'Effects' : 'Props', icon = effects ? '💫' : '🧸';
  const assets = S.sharedAssets.filter((asset) => asset.type === kind);
  const categories = [...new Set(assets.map((asset) => asset.category || 'Other'))].sort();
  if (libraryFilter[kind] !== 'all' && !categories.includes(libraryFilter[kind])) libraryFilter[kind] = 'all';
  const shown = assets.filter((asset) => libraryFilter[kind] === 'all' || (asset.category || 'Other') === libraryFilter[kind]);
  const chip = (value, text) => h('button', { type: 'button', class: `btn sm ${libraryFilter[kind] === value ? 'pri' : ''}`, 'aria-pressed': String(libraryFilter[kind] === value), onclick: () => { libraryFilter[kind] = value; redrawPanel(); } }, text);
  const card = (asset) => h('button', { class: 'studio-shared-card lib-card', type: 'button', title: `Add to scene: ${asset.name}`, onclick: () => addLibraryProp(asset) },
    asset.thumb ? h('img', { src: asset.thumb, alt: '', loading: 'lazy', decoding: 'async' }) : h('span', {}, icon), h('b', {}, asset.name),
    h('small', {}, effects ? `${asset.sheet ? 'Animated' : 'Still'} · ${asset.blend || 'normal'}` : (asset.category || 'Shared library')));
  const ownFile = h('input', { type: 'file', accept: 'image/*', multiple: true, style: 'display:none', onchange: async (e) => { const files = [...e.target.files]; e.target.value = ''; await addOwnProps(files); } });
  const onStage = S.props.filter((prop) => (isEffect(prop) ? 'effect' : 'prop') === kind);
  const selected = onStage.find((prop) => prop.id === S.selectedPropId);
  const change = (apply) => { apply(); stage.setProps(S.props); updateSel(); S.dirty = true; dbPut('props', selected); };
  const edit = (key, value) => change(() => { if (value === undefined) delete selected[key]; else selected[key] = value; });
  const percent = (value) => `${Math.round(value * 100)}%`;
  const range = (key, text, min, max, step, fallback, format = percent, set = (value) => edit(key, value)) => {
    const value = selected[key] ?? fallback, out = h('b', {}, format(value));
    return h('label', { class: 'studio-prop-range' }, h('span', {}, text, out), h('input', { type: 'range', min, max, step, value, oninput: (e) => { set(Number(e.target.value)); out.textContent = format(Number(e.target.value)); } }));
  };
  const seconds = (key, text) => h('label', { class: 'prop-time' }, h('span', {}, text), h('input', { type: 'number', min: 0, step: 0.1, placeholder: 'whole scene', value: selected[key] ?? '', 'aria-label': text, onchange: (e) => edit(key, e.target.value === '' ? undefined : Math.max(0, Number(e.target.value))) }));
  const held = !effects && selected && isHeld(selected), freeform = !(effects && coversFrame(selected || {}));
  const actors = S.speakers.filter((speaker) => speaker.charId);
  const holdWith = (hand) => change(() => { if (!hand) { delete selected.attach; if (selected.rotation === -90) selected.rotation = 0; return; } if (!isHeld(selected) && !selected.rotation) selected.rotation = -90; selected.attach = { key: selected.attach?.key && actors.some((a) => a.key === selected.attach.key) ? selected.attach.key : actors[0].key, hand }; });
  const holdBlock = effects || !selected ? [] : [h('div', { class: 'card flat prop-hold' }, h('h4', {}, '🤚 Hold in hand'),
    h('div', { class: 'seg', role: 'group', 'aria-label': 'Where the prop stays' }, [[null, 'On stage'], ['L', 'Left hand'], ['R', 'Right hand']].map(([hand, text]) => h('button', { type: 'button', disabled: !!hand && !actors.length, class: (hand ? selected.attach?.hand === hand && held : !held) ? 'on' : '', onclick: () => { holdWith(hand); redrawPanel(); } }, text))),
    !actors.length ? h('p', { class: 'sub', style: 'font-size:12px;margin:6px 0 0' }, 'Place a character first, then the prop will attach to its hand.') : null,
    held && actors.length > 1 ? h('label', { class: 'prop-time' }, h('span', {}, 'In which character\'s hand'), h('select', { 'aria-label': 'Character', onchange: (e) => change(() => { selected.attach = { ...selected.attach, key: e.target.value }; }) }, actors.map((a) => h('option', { value: a.key, selected: a.key === selected.attach.key }, a.name)))) : null,
    ...(held ? [range('grip.x', 'Pakad point · left / right', 0, 1, 0.01, selected.grip?.x ?? .5, percent, (v) => change(() => { selected.grip = { ...(selected.grip || { x: .5, y: .5 }), x: v }; })), range('grip.y', 'Pakad point · up / down', 0, 1, 0.01, selected.grip?.y ?? .5, percent, (v) => change(() => { selected.grip = { ...(selected.grip || { x: .5, y: .5 }), y: v }; })),
      h('label', { class: 'tog' }, h('input', { type: 'checkbox', checked: selected.follow !== false, onchange: (e) => edit('follow', e.target.checked ? undefined : false) }), 'Rotate with the hand')] : []))];
  const editor = !selected ? null : h('div', { class: 'card flat studio-prop-editor' }, h('h3', {}, selected.name),
    range('opacity', 'Opacity', 0.05, 1, 0.01, 1),
    ...(effects ? [h('div', { class: 'seg', role: 'group', 'aria-label': 'Blend mode' }, [['normal', 'Normal'], ['add', 'Glow'], ['screen', 'Screen']].map(([value, text]) => h('button', { type: 'button', class: (selected.blend || 'normal') === value ? 'on' : '', onclick: () => { edit('blend', value); redrawPanel(); } }, text))),
      freeform ? h('button', { class: 'btn sm', type: 'button', onclick: () => { change(() => Object.assign(selected, { x: .5, y: .5, w: 1, h: 1, rotation: 0 })); redrawPanel(); } }, 'Stretch to fill the frame') : null] : []),
    ...holdBlock,
    ...(freeform ? [...(held ? [] : [range('x', 'Position · left / right', 0, 1, 0.01, .5), range('y', 'Position · top / bottom', 0, 1, 0.01, .66)]), range('w', 'Width', 0.04, effects ? 1 : 0.8, 0.01, .18), range('h', 'Height', 0.04, effects ? 1 : 0.8, 0.01, .18), range('rotation', 'Rotation', -180, 180, 1, 0, (v) => `${Math.round(v)}°`)] : []),
    ...(selected.sheet ? [range('sheet', 'Animation speed', 1, 60, 1, selected.sheet.fps, (v) => `${Math.round(v)} fps`, (v) => change(() => { selected.sheet = { ...selected.sheet, fps: v }; }))] : []),
    ...(effects ? [] : [h('label', { class: 'tog' }, h('input', { type: 'checkbox', checked: selected.behind === true, onchange: (e) => edit('behind', e.target.checked ? true : undefined) }), 'Place behind the character')]),
    h('div', { class: 'prop-times' }, seconds('start', 'Dikhe: shuru (s)'), seconds('end', 'Dikhe: khatam (s)')),
    h('button', { class: 'btn sm', type: 'button', style: 'color:#b91c1c;border-color:#fecaca', onclick: async () => { await dbDel('props', selected.id); S.props = S.props.filter((p) => p.id !== selected.id); S.selectedPropId = null; await stage.setProps(S.props); S.dirty = true; drawTabs(); updateSel(); } }, `Remove ${effects ? 'effect' : 'prop'}`));
  return h('div', { class: 'list' },
    h('div', { class: 'card flat' }, h('h2', {}, label),
      h('p', { class: 'sub studio-help' }, effects ? 'Tap an effect to apply it to the whole scene (rain, sparkle, light…). Change the look with opacity and blend, and optionally show it for only a few seconds.' : 'Tap a prop to place it in the scene. Drag it on the stage to move it; change its size, rotation and when it shows from here.'),
      categories.length > 1 ? h('div', { class: 'studio-asset-tabs lib-chips' }, chip('all', 'All'), ...categories.map((name) => chip(name, name))) : null,
      shown.length ? h('div', { class: 'studio-shared-grid' }, shown.map(card)) : h('p', { class: 'sub studio-library-empty' }, assets.length ? 'There is nothing in this category.' : `No shared ${label.toLowerCase()} have been published yet. They are added from the "Props & Effects" tab in the admin panel.`),
      h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' }, effects ? null : h('button', { class: 'btn sm', type: 'button', onclick: () => ownFile.click() }, '＋ Upload your own image'), h('button', { class: 'btn sm', type: 'button', title: 'See what the admin has newly published', onclick: async () => { await refreshShared(true); redrawPanel(); } }, '↻ Check for new')), ownFile),
    onStage.length ? h('div', { class: 'card flat' }, h('h3', {}, `In scene (${onStage.length})`), h('div', { class: 'lib-onstage' }, onStage.map((prop) => h('div', { class: `lib-row${prop.id === S.selectedPropId ? ' on' : ''}` },
      h('button', { type: 'button', class: 'lib-pick', onclick: () => { S.selectedPropId = prop.id; S.sel = null; redrawPanel(); updateSel(); S.dirty = true; } }, h('span', {}, icon), h('b', {}, prop.name)),
      h('button', { type: 'button', class: 'ib', title: prop.visible === false ? 'Dikhayein' : 'Chhupayein', 'aria-pressed': String(prop.visible !== false), onclick: () => { prop.visible = prop.visible === false; stage.setProps(S.props); S.dirty = true; dbPut('props', prop); redrawPanel(); } }, prop.visible === false ? '🚫' : '👁'))))) : null,
    editor);
}

function tabCanvas() {
  const seg = (items, cur, on) => h('div', { class: 'seg' }, items.map(([k, l]) => h('button', { class: String(cur()) === String(k) ? 'on' : '', onclick: (e) => { on(k); e.currentTarget.parentNode.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', String(items[i][0]) === String(k))); } }, l)));
  const file = h('input', { type: 'file', accept: 'image/*', multiple: true, style: 'display:none', onchange: async (e) => {
    for (const f of e.target.files) { const rec = { id: `bg${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: f.name, blob: f }; await dbPut('backgrounds', rec); S.myBgs.push(rec); S.bgId = rec.id; await stage.setBackgroundImage(f); }
    S.dirty = true; drawTabs();
  } });
  const addBgClip = async (rec, preset = 0) => {
    const start = snapTo(Math.min(player.time, Math.max(0, player.total - 1))), c = { id: uid(), bgId: rec?.id ?? null, preset, start, dur: Math.max(1, Math.min(3, snapTo(player.total - start))) };
    S.bgClips.push(c); S.bgSel = c.id; await syncBgClips(); updateTotal(); drawTimeline(); drawTabs();
  };
  const pickBg = async (rec, preset) => {
    if (S.bgAtTime) return addBgClip(rec, preset ?? stage.bg.preset); S.bgId = rec?.id ?? null; await stage.setBackgroundImage(rec?.blob ?? null); S.dirty = true; drawTabs(); };
  const shared = (type) => S.sharedAssets.filter((asset) => asset.type === type);
  const addSharedBackground = async (asset) => {
    try {
      const blob = await downloadStudioAsset(asset), id = `shared-${asset.id}`;
      let rec = S.myBgs.find((item) => item.id === id);
      if (!rec) { rec = { id, name: asset.name, blob }; await dbPut('backgrounds', rec); S.myBgs.push(rec); }
      await pickBg(rec);
    } catch (e) { toast(`Could not add the background: ${e.message}`); }
  };
  const sharedGrid = (type, choose) => shared(type).length ? h('div', { class: 'studio-shared-grid' }, shared(type).map((asset) => h('button', { class: 'studio-shared-card', type: 'button', onclick: () => choose(asset) }, h('span', {}, type === 'background' ? '🖼' : '🧸'), h('b', {}, asset.name), h('small', {}, 'Shared library · tap to add')))) : h('p', { class: 'sub studio-library-empty' }, 'No shared items have been added by the admin yet.');
  const mine = h('div', { class: 'bggrid' },
    h('button', { class: 'bgc add', onclick: () => file.click() }, h('span', {}, '+'), h('small', {}, 'Add images')),
    S.myBgs.map((r) => h('button', { class: `bgc ${S.bgId === r.id ? 'on' : ''}`, onclick: () => pickBg(r) },
      h('img', { src: URL.createObjectURL(r.blob), alt: r.name, loading: 'lazy' }),
      h('span', { class: 'x', title: 'Delete', onclick: async (e) => { e.stopPropagation(); if (S.scenes.some(scene => scene.id !== S.sceneId && scene.doc?.bgId === r.id)) { toast('This background is being used in another scene.'); return; } await dbDel('backgrounds', r.id); S.myBgs = S.myBgs.filter((x) => x.id !== r.id); if (S.bgId === r.id) await pickBg(null); else drawTabs(); } }, '✕'))));
  const sw = h('div', { class: 'sw' }, BACKGROUNDS.map((b, i) => h('button', { title: b.name, class: stage.bg.preset === i && !S.bgId ? 'on' : '', style: `background:linear-gradient(135deg,${b.a},${b.b})`, onclick: async () => { if (S.bgAtTime) return addBgClip(null, i); stage.bg.preset = i; await pickBg(null); } })));
  return h('div', { class: 'list' },
    h('div', { class: 'card flat' }, h('h2', {}, 'Where should the background be applied?'), seg([[0, 'Whole scene'], [1, 'On the timeline (from the playhead)']], () => (S.bgAtTime ? 1 : 0), (k) => { S.bgAtTime = String(k) === '1'; drawTabs(); }),
      h('p', { class: 'sub', style: 'font-size:12px;margin:8px 0 0' }, S.bgAtTime ? `The background you choose will be added to the timeline at the playhead (${fmt(player.time)}). Add as many as you like, and drag the edges to resize.` : 'The background you choose will stay behind for the whole scene.')),
    h('div', { class: 'card flat' }, h('h2', {}, 'Backgrounds'), h('p', { class: 'sub', style: 'font-size:12px;margin:0 0 8px' }, 'Choose an admin shared scene or add your own image. Backgrounds sit behind characters and props.'), sharedGrid('background', addSharedBackground), mine, file),
    h('div', { class: 'card flat' }, h('h2', {}, 'Plain colours'), sw));
}

/** export size for the chosen orientation + quality */
function sizeFor() { const { w, h } = aspectOf(S.aspect), k = S.quality / Math.min(w, h); return { W: Math.round((w * k) / 2) * 2, H: Math.round((h * k) / 2) * 2 }; }
function tabExport() {
  const exportScenes = S.exportScope === 'all' ? docOf().scenes : [{ doc: sceneDoc() }];
  const multi = exportScenes.length > 1, hasAudio = exportScenes.some(scene => scene.doc.lines?.length);
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
  const cLevel = h('div', { class: 'card flat' }, h('h2', {}, 'Video quality'), lv, (() => { const { W, H } = sizeFor(); const mbps = bitrateFor(W, H, S.level, S.format) / 1e6, mb = (mbps * duration) / 8; return h('p', { class: 'sub', style: 'font-size:12px;margin:8px 0 0' }, `${W}×${H} · about ${mbps.toFixed(1)} Mbps → roughly ${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB for this video. Higher = sharper picture and a bigger file.`); })());
  const cFps = h('div', { class: 'card flat' }, h('h2', {}, 'Smoothness'), f, h('p', { class: 'sub', style: 'font-size:12px;margin:8px 0 0' }, 'Fewer frames per second = faster export.'));
  const cDone = h('button', { class: 'btn ok', style: 'width:100%;padding:14px', disabled: !pickType() && !window.VideoEncoder, onclick: doExport }, '⬇ Export video');
  const { W: outW, H: outH } = sizeFor(), preset = presetMatch(S);
  const mbps = bitrateFor(outW, outH, S.level, S.format) / 1e6, mb = (mbps * duration) / 8;
  const group = (key, icon, title, ...body) => h('details', { class: 'exp-group', open: S.expOpen[key], ontoggle: e => { S.expOpen[key] = e.currentTarget.open; } }, h('summary', {}, h('span', { 'aria-hidden': 'true' }, icon), title), h('div', { class: 'exp-body' }, ...body));
  const stat = (label, value) => h('div', {}, label, h('b', {}, value));
  return h('div', { class: 'list' },
    group('quick', '⚡', 'Quick setup',
      h('div', { class: 'exp-summary' }, stat('Resolution', `${outW}×${outH}`), stat(`Length · ${exportScenes.length} scene${exportScenes.length > 1 ? 's' : ''}`, `${duration.toFixed(1)} s`), stat('Format', `${S.format.toUpperCase()} · ${S.fps} fps`), stat('Approx. size', `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`)),
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
async function doExport() {
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
  let exported = false;
  S.exporting = true; requestStudioFrame(); player.pause(); player.seek(0); if (selEl) selEl.hidden = true; stage.fullView = false; syncCam();
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
    const single = () => exportOffline({ stage, clips: player.clips, plan: shotPlan(), total: player.total, onProgress: progress, cancelled: () => stop, fps: S.fps, level: S.level, format: S.format });
    let res;
    if (sequence) {
      const total = sequence.at(-1).end;
      const clips = sequence.flatMap(scene => buildTimeline((scene.doc.lines || []).map(meta => sceneAudio.has(meta.id) ? { ...sceneAudio.get(meta.id), trimStart: meta.trimStart || 0, trimEnd: meta.trimEnd || 0 } : null).filter(Boolean).map(line => ({ ...line, speaker: line.speaker.toLowerCase() }))).clips.map(clip => ({ ...clip, start: clip.start + scene.start, end: clip.end + scene.start })));
      res = await exportOffline({ stage, clips, plan: [], total, fps: S.fps, level: S.level, format: S.format, cancelled: () => stop,
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
        const layers = await buildLayerSpecs();
        const ids = [...new Set(layers.map((l) => l.charId))];
        const job = {
          aspect: S.aspect, short: S.quality, fps: S.fps, level: S.level, format: S.format, W: stage.W, H: stage.H, maxTex: S.quality >= 2160 ? 4096 : 2048,
          chars: ids.map((id) => { const d = S.characters.find((c) => c.id === id) || S.libDefs.get(id); return { id, ske: d.ske, tex: d.tex }; }),
          tearSprite: layers.some(layer => layer.tears?.style) ? await loadTearSprite() : null,
          bg: { preset: stage.bg.preset, image: S.bgId ? S.myBgs.find((r) => r.id === S.bgId)?.blob ?? null : null }, bgClips: bgClipJobs(), grade: gradeActive(S.grade) ? { ...S.grade } : null, gradeKeys: S.gradeKeys.map((k) => ({ t: k.t, grade: k.grade })), props: S.props.map((prop) => ({ ...prop })),
          layers, plan: shotPlan(), camKeys: stage.camKeys, voice: player.clips.map((c) => ({ speaker: c.speaker, start: c.start, end: c.end, visemes: c.visemes })),
        };
        res = await exportParallel({ job, clips: player.clips, total: player.total, onProgress: progress, cancelled: () => stop, workers: workerCount() });
      } catch (e) {
        if (e.message === 'cancelled') throw e;
        console.warn('parallel export failed, using one thread', e);
        toast('Parallel rendering is not possible here; rendering with a single thread instead.');
        t0 = performance.now(); res = await single();
      }
    } else res = offline ? await single() : await exportRealtime({ canvas: stage.out, stage, audioStream: player.rec.stream, player, onProgress: progress, level: S.level });
    const { blob, ext, info } = res;
    const took = (performance.now() - t0) / 1000;
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
let historyDepth = 0, historyPointer = null, historyQueued = false, historyGroup = null;
let hdrUndo, hdrRedo, savedEl, lastSaved = '', saving = false, savedTimer;
const savedAudio = new Set();

/** the part of the project that undo / redo travels through */
function sceneDoc() {
  for (const line of S.lines) sceneAudio.set(line.id, line);
  return {
    lines: S.lines.map(({id, order, file, speaker, trimStart, trimEnd}) => ({id, order, file, speaker, trimStart: trimStart || 0, trimEnd: trimEnd || 0})),
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
  S.lines = (doc.lines || []).map(meta => sceneAudio.has(meta.id) ? { ...sceneAudio.get(meta.id), ...meta } : null).filter(Boolean);
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
  lastSaved = sig;
  localSaveError = ''; updateSaveStatus({ text: navigator.onLine ? 'Saving' : 'Offline' });
}
async function tick({ sceneCommit = false } = {}) {
  if (!S.ready || hist.busy || saving || S.exporting || historyPointer !== null || (historyDepth && !sceneCommit) || (sceneChanging && !sceneCommit) || $app.hidden) return;
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
  if (!S.ready || !hist.cur || hist.busy || historyDepth || historyPointer !== null || S.exporting || sceneChanging || previewChanging || $app.hidden) return;
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
  captureHistory(); historyPointer = event.pointerId;
}, true);
const endHistoryPointer = event => {
  if (event && event.pointerId !== historyPointer) return;
  queueMicrotask(() => { historyPointer = null; queueHistoryCapture(null); });
};
window.addEventListener('pointerup', endHistoryPointer, true);
window.addEventListener('pointercancel', endHistoryPointer, true);
window.addEventListener('blur', () => endHistoryPointer());
function updateHistoryButtons() { if (hdrUndo) { hdrUndo.disabled = hist.busy || historyDepth > 0 || !hist.undo.length; hdrRedo.disabled = hist.busy || historyDepth > 0 || !hist.redo.length; } }
async function stepHistory(dir) {
  if (S.exporting || hist.busy || sceneChanging || previewChanging || sceneDialogOpen || historyDepth || historyPointer !== null) return;
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
function headerTools() {
  hdrUndo = h('button', { class: 'btn sm icon-btn history-button', 'data-history-control': true, 'aria-label': 'Undo', title: 'Undo (Ctrl+Z)', onclick: () => stepHistory(-1) }, icon('undo'));
  hdrRedo = h('button', { class: 'btn sm icon-btn history-button', 'data-history-control': true, 'aria-label': 'Redo', title: 'Redo (Ctrl+Y)', onclick: () => stepHistory(1) }, icon('redo'));
  savedEl = h('summary', { class: 'saved show', title: 'Save status' });
  saveBody = h('div', { class: 'save-popover' });
  saveDetails = h('details', { class: 'save-status' }, savedEl, saveBody);
  updateSaveStatus();
  queueMicrotask(updateHistoryButtons);
  exportBtn = h('button', { class: 'btn ok icon-btn export-btn', 'aria-label': 'Export', title: 'Export video', onclick: doExport }, icon('download'));
  const closeBtn = h('button', { class: 'btn sm icon-btn close-studio', 'aria-label': 'Close studio', title: 'Close studio — back to your projects', onclick: goHome }, icon('x'));
  return h('div', { class: 'hdr-tools' }, previewControl(), h('span', { class: 'sp' }), saveDetails, hdrUndo, hdrRedo,
    h('details', { class: 'studio-menu' }, h('summary', { class: 'btn sm icon-btn', 'aria-label': 'More studio actions', title: 'More' }, icon('more')), h('div', { class: 'studio-menu-panel' }, h('button', { class: 'btn sm danger', onclick: resetEverything }, h('span', {}, icon('trash')), ' Reset this project…'))),
    exportBtn, closeBtn);
}
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
  updateSel(); updateCamBox(); updateTearHandles(); if (S.tab === 'motion') updatePathView(false);
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

if (location.search.includes("debug")) window.__toon = { S, fillSoloLengths, sharedBlobs, drawTimeline, sceneLen, prepareStudio, syncCam, get stage() { return stage; }, get player() { return player; }, get metrics() { return { renderCount, framePending: !!frameId, loadedRigs: stage?.assets.size, cachedDefinitions: S.libDefs.size }; } };

/* ---------------- entry points used by the 12toons shell ---------------- */
let booted = false, homeFn = null;
export const setHome = (fn) => { homeFn = fn; };
async function goHome() { if (S.exporting) { toast('Please wait for the export to finish.'); return; } player?.pause(); try { await tick({ sceneCommit: true }); } catch { /* best effort */ } homeFn?.(); }
export async function openStudio() {
  studioTheme.enter();
  $app.hidden = false;
  if (!booted) { booted = true; await boot(); } else { S.characters = (await loadCharacters()).filter(c => c.ske || c.base); await ensureDefs(); drawTabs(); S.dirty = true; }       // characters may have been saved in the Character Studio meanwhile
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

