import './style.css';
import { ingest, isNarrator } from './ingest.js';
import { analyse } from './lipsync.js';
import { Stage, ASPECTS, BACKGROUNDS, aspectOf } from './db/stage.js';
import { Player, buildTimeline } from './player.js';
import { characterPicker } from './charpick.js';
import { exportOffline, exportParallel, workerCount, exportRealtime, canExportOffline, pickType, bitrateFor } from './exporter.js';
import { loadCharacters, saveCharacter, deleteCharacter, all as dbAll, put as dbPut, del as dbDel, resetAll } from './store.js';
import { pushAll, r2Configured, syncState, startAutoSync, cloudReady, listCharactersCloud, loadCharacterCloud } from './cloud.js';
import { describeMotion, buildBrief, extractJson } from './brief.js';
import { loadAi, saveAi, listModels, transcribe, direct } from './ai.js';
import { loadCatalog, hydrateAll, categoriesFor, fetchAnimation, url as assetUrl, loadCustom, addCustom, removeCustom, libraryCharacters, fetchLibraryCharacter, cdn, modePools, modeEntries, MODE_REFS } from './catalog.js';
import { getFit, setFit } from './universal.js';
import { onSyncStatus, syncStatus } from './project-sync.js';
import { listStudioAssets, downloadStudioAsset } from './studio-assets.js';

const COLORS = ['#7c5cff', '#35d0ba', '#ffb454', '#ff6b9a', '#5bb8ff', '#b6e354'];
const S = {
  step: 3, characters: [], customAnims: [], libDefs: new Map(), swaps: new Map(), myBgs: [], props: [], sharedAssets: [], bgId: null, selectedPropId: null, canvasMode: 'backgrounds', lines: [], speakers: [], order: [],
  ready: false, pps: 30, lineSel: null, script: new Map(), solo: {}, ai: loadAi(), cast: new Map(), shots: new Map(), applyAll: false, panelOpen: false,
  aspect: '16:9', preview: 720, exporting: false, dirty: true, maxStep: 1, tab: 'audio', animFor: null, sel: null,
  quality: 720, expMethod: 'fast', fps: 30, level: 'high', format: 'webm',
  manual: {}, mclip: null, addMode: false,            // animations the user placed on the timeline: { <character key>: [{id, kind, ref, start, dur, off}] }
  charKeys: {}, ckSel: null, motionFor: null,          // movement keyframes per character: { <character key>: [{id, t, x, y, mul, flip, ease}] }
  camKeys: [], camSel: null, camPeek: false,           // camera keyframes: [{id, t, cx, cy, zoom, ease}]
};
const uid = () => Math.random().toString(36).slice(2, 9);
const clone = (o) => JSON.parse(JSON.stringify(o));   // undo / redo snapshots must not share objects with the live state
let audioCtx, stage, player;
const $app = document.getElementById('app');

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
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

function modal(title, body) {
  const close = () => el.remove();
  const el = h('div', { class: 'modal', onclick: (e) => e.target === el && close() },
    h('div', { class: 'sheet' }, h('div', { class: 'row', style: 'margin-bottom:12px' }, h('h2', { style: 'margin:0' }, title), h('span', { class: 'sp' }), h('button', { class: 'btn sm', onclick: close }, '✕')), body));
  document.body.append(el);
  return close;
}

async function boot() {
  let swaps;
  [S.characters, S.customAnims, S.myBgs, S.props, swaps] = await Promise.all([loadCharacters().then((l) => l.filter((c) => c.ske || c.base)), loadCustom(), dbAll('backgrounds'), dbAll('props'), dbAll('swaps')]);
  await loadCatalog();
  S.sharedAssets = await listStudioAssets().catch((e) => { console.warn('Shared studio library unavailable:', e.message); return []; });
  S.characters = await hydrateAll(S.characters);            // saved characters are small records: skeleton + untouched pictures come from their template
  swaps.forEach((r) => { S.swaps.set(r.id, r.pages); Object.values(r.pages).forEach(bid); });
  S.props.forEach((p) => p.blob && bid(p.blob));
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  stage = new Stage();
  stage.setSize(S.aspect, S.preview);
  await stage.setProps(S.props);
  player = new Player(audioCtx);
  requestAnimationFrame(loop);
  const restored = await restoreProject();
  S.ready = true;
  hist.cur = docOf(); hist.curStr = JSON.stringify(hist.cur);
  setInterval(() => { if (!document.hidden) tick(); }, 1000);
  if (!restored) { await prepareStudio(); render(); }
}

/* ---------------- the workbench ---------------- */
function render() {
  $app.replaceChildren(h('div', { class: 'wrap s3 ws' }, topBar(), viewStudio()));
  mountStage();
}
function topBar() {
  return h('header', { class: 'topbar' },
    h('button', { class: 'logo logo-btn', title: 'Back to 12toons home', onclick: goHome }, h('b', {}, '12'), 'toons'),
    h('span', { class: 'proj' }, 'Studio'), h('span', { class: 'sp' }), headerTools());
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
      } catch { toast(`Could not decode ${a.file}`); }
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
    if (!characters.length && !audio.length) toast('No audio or character bundle found in those files.');
  } catch (e) { toast(`Failed to read: ${e.message}`); }
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
  return def.anims?.length ? { source: 'local', name: def.anims[0] } : null;
}
const animKey = (r) => (r.source === 'lib' ? `a${r.id}` : r.source === 'custom' ? `c${r.id}` : r.name);
async function animJson(def, r) {
  if (r.source === 'lib') return fetchAnimation(r.file);
  if (r.source === 'custom') return S.customAnims.find((c) => c.id === r.id)?.json;
  if (r.source === 'rig') return fetchAnimation(r.file || `${def.rig.animDir}${r.name.replace(/\//g, '_')}.json`);
  return def.localAnims?.[r.name];
}
const sameRef = (a, b) => a && b && a.source === b.source && (a.source === 'local' ? a.name === b.name : a.id === b.id);

/* ---- character chooser (characters are downloaded from their links; animations, expressions and image swap live in the studio) ---- */
async function useCharacter(s, id) {
  let def = S.characters.find((c) => c.id === id) || S.libDefs.get(id);
  if (!def && id) {
    const entry = libraryCharacters().find((e) => `lib:${e.id}` === id);
    if (!entry) { toast('This character template is no longer available. Choose another character.'); return false; }
    const b = busy(`Downloading ${entry.name}…`);
    try { def = await fetchLibraryCharacter(entry); S.libDefs.set(id, def); } catch (e) { b.done(); toast(`Could not download character: ${e.message}`); return false; }
    b.done();
  }
  s.charId = id; s._chosen = true;
  S.speakers.filter((x) => x.charId).forEach((x, i) => { if (!x._flipSet) x.flip = i % 2 === 1; });
  return true;
}
function chooseCharacter(s, after) {
  let close;
  const card = (img, title, sub, on, sel) => h('button', { class: `cc ${sel ? 'on' : ''}`, onclick: on },
    h('div', { class: 'th' }, img ? h('img', { src: img, alt: '', loading: 'lazy' }) : h('span', {}, '🚫')), h('b', {}, title), sub && h('small', {}, sub));
  const cloudBox = h('div');
  const pick = async (id) => { if (await useCharacter(s, id)) { close(); after(); } };
  close = modal(`Character for ${s.name}`, h('div', {},
    h('div', { class: 'gridc' }, card(null, 'No character', 'Voice only', () => pick(null), !s.charId)),
    h('h2', { style: 'margin:16px 0 8px' }, 'Characters'),
    libraryCharacters().some((e) => e.autodraft) ? characterPicker({ entries: libraryCharacters(), isOn: (e) => s.charId === `lib:${e.id}`, onPick: (e) => pick(`lib:${e.id}`) }) : null,
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

/* ---- animation browser (same layout as the platform: category dropdown, search, 2-column cards) ---- */
/* previews play on their own while visible (at most 6 at once, so phones stay smooth) */
const playing = [];
let previewIO;
function stopAll() { previewIO?.disconnect(); while (playing.length) playing.pop().remove(); previewIO = null; }
function watch(th) {
  previewIO ??= new IntersectionObserver((es) => es.forEach((e) => {
    const box = e.target, v = box.querySelector('video');
    if (e.isIntersecting && !v) {
      const vid = h('video', { src: box.dataset.src, muted: true, loop: true, playsinline: true, autoplay: true, preload: 'auto' });
      vid.muted = true; box.append(vid); playing.push(vid);
      vid.play().catch(() => {});
      while (playing.length > 6) { const old = playing.shift(); old.remove(); }
    } else if (!e.isIntersecting && v) { v.remove(); const i = playing.indexOf(v); if (i >= 0) playing.splice(i, 1); }
  }), { threshold: 0.5 });
  previewIO.observe(th);
}

function animBrowser({ getSpeaker, chips, onPick, selectedRef }) {
  const root = h('div', { class: 'ab' });
  let cat = null, q = '';
  const draw = () => {
    stopAll();
    const s = getSpeaker(), def = s && charOf(s);
    if (!def) { root.replaceChildren(h('p', { class: 'sub' }, 'Pick a character first — animations are applied to characters.')); return; }
    const zip = def.anims?.length ? [{ key: 'zip', name: 'From character ZIP', animations: def.anims.map((n) => ({ ref: { source: 'local', name: n }, name: n.replace(/_/g, ' ') })) }] : [];
    const custom = { key: 'custom', name: 'Custom', custom: true, animations: S.customAnims.map((c) => ({ ref: { source: 'custom', id: c.id, name: c.name }, name: c.name, custom: true })) };
    const modes = modeEntries(def.rig);
    const cats = [...zip, ...(modes.animations.length ? [modes] : []), ...categoriesFor(def.rig), custom];
    const cur0 = selectedRef();
    if (!cat || !cats.some((c) => c.key === cat)) cat = (cats.find((c) => cur0 && c.animations.some((a) => sameRef(a.ref, cur0))) || cats.find((c) => !c.overlay) || cats[0]).key;
    const cur = cats.find((c) => c.key === cat);
    const list = q.trim() ? cats.flatMap((c) => c.animations.map((a) => ({ ...a, cat: c }))).filter((a) => a.name.toLowerCase().includes(q.trim().toLowerCase())) : cur.animations.map((a) => ({ ...a, cat: cur }));

    const file = h('input', { type: 'file', accept: '.json,application/json', multiple: true, style: 'display:none', onchange: async (e) => {
      for (const f of e.target.files) { try { S.customAnims.push(await addCustom(f)); cat = 'custom'; } catch (err) { toast(`${f.name}: ${err.message}`); } }
      draw();
    } });
    const grid = h('div', { class: 'agrid' },
      h('button', { class: 'acard add', onclick: () => file.click() }, h('span', {}, '+'), h('b', {}, 'Add New'), h('small', {}, 'animation .json'), file),
      list.map((a) => {
        const sel = sameRef(cur0, a.ref);
        const th = h('div', { class: `ath${a.poster?.startsWith('autodraft/') ? ' dark' : ''}` }, a.poster ? h('img', { src: assetUrl(a.poster), alt: '', loading: 'lazy' }) : h('span', {}, a.custom ? '🎞' : '🎬'));
        if (a.preview) { th.dataset.src = assetUrl(a.preview); watch(th); }
        return h('button', { class: `acard ${sel ? 'on' : ''}`, onclick: async () => { await onPick(s, a.ref, !!a.cat.overlay, a.length); draw(); } }, th, a.length && h('span', { class: 'dur' }, `${(+a.length).toFixed(2)} s`), h('span', { class: 'nm2' }, a.name, a.cat.layer ? ` · ${a.cat.layer}` : a.cat.overlay ? ' · face' : ''),
          a.custom && h('span', { class: 'x', title: 'Delete', onclick: async (e) => { e.stopPropagation(); await removeCustom(a.ref.id); S.customAnims = S.customAnims.filter((c) => c.id !== a.ref.id); draw(); } }, '✕'));
      }));
    root.replaceChildren(
      ...(chips ? [chips(draw)] : []),
      h('select', { onchange: (e) => { cat = e.target.value; q = ''; draw(); } }, cats.map((c) => h('option', { value: c.key, selected: c.key === cat }, `${c.name} (${c.animations.length})`))),
      h('input', { type: 'text', class: 'search', placeholder: '🔍  Search animations', value: q, oninput: (e) => { q = e.target.value; const pos = e.target.selectionStart; draw(); const i = root.querySelector('.search'); i.focus(); i.setSelectionRange(pos, pos); } }),
      grid);
  };
  draw();
  return { el: root, draw };
}

/* ---------------- step 3: studio ---------------- */
let clipBar, camEl, camHandles = {}, emptyEl, headEl, timeEl, playBtn, panelEl, tabsEl, selEl, propSelEl, selBar, wrapEl, exportBtn, hintEl, tlScroll, tlInner, tlLabels, tlBox, lineBox, handleEls = {};

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

async function prepareStudio() {
  const b = busy('Setting up characters & lip-sync…');
  try {
    for (const s of S.speakers) { const d = charOf(s); if (d) await stage.loadCharacter(d); }
    const tl = buildTimeline(S.lines.map((l) => ({ id: l.id, speaker: l.speaker.toLowerCase(), file: l.file, buffer: l.buffer, visemes: l.visemes })));
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
      try { anims[name] = await animJson(def, ref); } catch (e) { toast(`Animation "${ref.name}" could not be loaded: ${e.message}`); }
    }
    const swap = S.swaps.get(`${s.charId}::${s.key}`) || null;
    // gestures that only move the arms get the idle animation underneath, so head / chest keep moving
    const idleKey = plan.idleRef ? animKey(plan.idleRef) : null, drives = (j) => (j?.bone || []).some((b) => /^(head|pelvis|neck|torso\d*)$/i.test(b.name));
    const clips = plan.clips.filter((c) => anims[c.name]).map((c) => ({ ...c, base: c.kind === 'body' && idleKey && anims[idleKey] && c.name !== idleKey && !drives(anims[c.name]) ? idleKey : undefined }));
    layers.push({ fit: getFit(s.charId), skins: s.skins ?? def.skins ?? null, key: s.key, charId: s.charId, swap, anims, clips, present: plan.present, flip: s.flip, xf: s.xf ? { ...s.xf } : null, mask: s.mask ? { ...s.mask } : null, maskKeys: s.maskKeys || [], maskFollow: s.maskFollow || '', slot: withChar.indexOf(s), visible: s.visible, keys: (S.charKeys[s.key] || []).map((k) => ({ t: k.t, x: k.x, y: k.y, mul: k.mul, flip: !!k.flip, ease: k.ease })) });
  }
  return layers.reverse(); // front-first -> back-first
}
/** (re)builds the characters on the stage (needed when animations or images change) */
async function applyLayers() {
  const layers = await buildLayerSpecs();
  for (const l of layers) for (const blob of Object.values(l.swap || {})) await stage.loadSwap(blob);
  const bad = stage.setLayers(layers);
  if (bad.length) toast(`Some animations don't fit that character and were skipped (${bad.map((k) => sOf(k)?.name).join(', ')})`);
  S.dirty = true;
}
/** cheap update when only the "in frame" switches changed */
function refreshPresence() {
  for (const s of S.speakers) if (s.charId) { const p = layerPlan(s); stage.setClips(s.key, p.clips, p.present); }
  S.dirty = true;
}

/* ---- swap a character's image (same layout as the original, any size) ---- */
function swapModal(s) {
  const def = charOf(s), key = `${s.charId}::${s.key}`;
  const pages = stage.pageNames(def), origOf = (pg) => (def.tex.find((t) => t.json.imagePath === pg) || def.tex[0]).image;
  let close;
  const body = h('div');
  const save = async (pagesMap) => {
    if (pagesMap && Object.keys(pagesMap).length) { S.swaps.set(key, pagesMap); await dbPut('swaps', { id: key, pages: pagesMap }); } else { S.swaps.delete(key); await dbDel('swaps', key); }
    const b = busy('Applying image…'); try { await applyLayers(); } catch (e) { console.error(e); toast(`Could not apply image: ${e.message}`); } finally { b.done(); } draw();
  };
  const draw = () => {
    const cur = S.swaps.get(key) || {};
    body.replaceChildren(
      h('p', { class: 'sub', style: 'font-size:13px' }, 'Download the original image, edit it (keep the same layout — any size works), then swap it back in. The change applies only to this voice.'),
      ...pages.map((pg) => {
        const orig = origOf(pg), input = h('input', { type: 'file', accept: 'image/*', style: 'display:none', onchange: async (e) => { const f = e.target.files[0]; if (f) await save({ ...cur, [pg]: f }); } });
        return h('div', { class: 'item', style: 'align-items:flex-start' },
          h('div', { class: 'th sm', style: 'width:84px;height:84px;flex:none' }, h('img', { src: URL.createObjectURL(cur[pg] || orig), alt: '' })),
          h('div', { class: 'sp' }, h('b', {}, pages.length > 1 ? `Image ${pages.indexOf(pg) + 1}` : 'Character image'), h('div', { class: 'chip', style: 'margin:4px 0 8px' }, cur[pg] ? 'swapped' : 'original'),
            h('div', { class: 'row', style: 'gap:6px' },
              h('a', { class: 'btn sm', href: URL.createObjectURL(orig), download: pg }, '⬇ Original'),
              h('button', { class: 'btn sm pri', onclick: () => input.click() }, '🖼 Swap image…'),
              cur[pg] && h('button', { class: 'btn sm', onclick: () => { const n = { ...cur }; delete n[pg]; save(n); } }, 'Restore'), input)));
      }));
  };
  draw();
  close = modal(`Swap image · ${s.name}`, h('div', {}, body, h('div', { class: 'foot', style: 'margin-top:14px' }, h('span'), h('button', { class: 'btn pri', onclick: () => close() }, 'Done'))));
}

const TABS = [['audio', 'Audio', '🎙'], ['chars', 'Characters', '🎭'], ['anim', 'Animations', '🎬'], ['motion', 'Move', '🏃'], ['camera', 'Camera', '🎥'], ['mask', 'Mask', '◩'], ['ai', 'AI', '✨'], ['canvas', 'Background', '🖼'], ['export', 'Export', '⬇']];
function viewStudio() {
  playBtn = h('button', { class: 'btn pri', onclick: togglePlay }, '▶ Play');
  timeEl = h('span', { class: 'time' }, '0:00.0');
  headEl = h('div', { class: 'phead' });
  tlLabels = h('div', { class: 'tl-labels' });
  tlInner = h('div', { class: 'tl-inner' });
  tlScroll = h('div', { class: 'tl-scroll' }, tlInner);
  tlBox = h('div', { class: 'tl2' }, tlLabels, tlScroll);
  lineBox = h('div', { class: 'linebox' });
  tabsEl = h('div', { class: 'tabs big' });
  panelEl = h('div', { class: 'panel' });
  const zoom = (f) => { const left = tlScroll.scrollLeft / S.pps; S.pps = Math.min(300, Math.max(4, S.pps * f)); drawTimeline(); tlScroll.scrollLeft = left * S.pps; };
  const fit = fitTimeline;
  const tools = h('div', { class: 'tltools' },
    h('button', { class: 'btn sm', title: 'Zoom out', onclick: () => zoom(1 / 1.5) }, '🔍−'), h('button', { class: 'btn sm', title: 'Zoom in', onclick: () => zoom(1.5) }, '🔍+'),
    h('button', { class: 'btn sm', onclick: fit }, 'Fit'), h('span', { class: 'sp' }), h('span', { class: 'hint', style: 'margin:0' }, 'Tap an audio line ↓'));
  drawTimeline(); drawLineBox(); drawTabs();
  setTimeout(fit, 0);
  return h('div', {},
    h('div', { class: 'studio' },
      h('div', { class: 'prev' }, h('div', { class: 'stagehost' }, h('div', { class: 'stagebox', id: 'stagebox' }), emptyEl = emptyCard()),
        h('div', { class: 'controls' }, playBtn, h('button', { class: 'btn', title: 'Back to start', onclick: () => { player.seek(0); selectLine(player.clips[0]?.id, false); S.dirty = true; } }, '⏮'), timeEl, h('span', { class: 'sp' }),
          ),
        hintEl = h('p', { class: 'hint' }, '👆 Tap a character or prop to select it · drag to move'),
        selBar = h('div', { class: 'selbar', hidden: true })),
      h('div', { class: 'tlwrap' }, tools, clipBar = h('div', { class: 'clipbar', hidden: true }), tlBox, lineBox),
      h('div', { class: 'side' }, tabsEl, panelEl)));
}
function drawTabs() {
  tabsEl.className = `tabs big${S.panelOpen ? '' : ' shut'}`;
  tabsEl.replaceChildren(...TABS.map(([k, l, i]) => h('button', { class: S.tab === k ? 'on' : '', onclick: () => {
    if (S.tab === k) S.panelOpen = !S.panelOpen; else { S.tab = k; S.panelOpen = true; }
    drawTabs();
  } }, h('span', { class: 'ti' }, i), h('span', {}, l))));
  panelEl.className = `panel${S.panelOpen ? ' open' : ''}`;
  panelEl.replaceChildren(h('div', { class: 'sheet-close' }, h('b', {}, TABS.find((t) => t[0] === S.tab)[1]), h('button', { class: 'btn sm', onclick: () => { S.panelOpen = false; drawTabs(); } }, '▾ Close')), { audio: tabAudio, chars: tabChars, anim: tabAnim, motion: tabMotion, camera: tabCamera, mask: tabMask, ai: tabAi, canvas: tabCanvas, export: tabExport }[S.tab]());
}

/* ---- timeline: ruler + the audio lines (the main track) ---- */
const RULER = 24;
function selectLine(id, seek = true) {
  if (!id) return;
  S.lineSel = id;
  const L = lineById(id);
  if (seek && L) { player.seek(L.start + 0.01); }
  drawTimeline(); drawLineBox(); S.dirty = true;
  if (S.tab === 'anim' && S.panelOpen) drawTabs();
}
function drawTimeline() {
  if (!tlInner) return;
  const total = player.total || 1, pps = S.pps;
  const step = pps >= 90 ? 1 : pps >= 40 ? 2 : pps >= 18 ? 5 : pps >= 8 ? 10 : 20;
  const ticks = [];
  for (let t = 0; t <= total; t += step) ticks.push(h('span', { class: 'tick', style: `left:${t * pps}px` }, `${Math.floor(t / 60) ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` : `${t}s`}`));
  const ruler = h('div', { class: 'ruler', style: `height:${RULER}px` }, ticks);
  let scrubbing = false;
  const scrub = (e) => { player.seek(Math.min(total, Math.max(0, (e.clientX - tlInner.getBoundingClientRect().left) / pps))); S.dirty = true; followLine(); };
  ruler.addEventListener('pointerdown', (e) => { if (S.exporting) return; scrubbing = true; ruler.setPointerCapture(e.pointerId); scrub(e); });
  ruler.addEventListener('pointermove', (e) => scrubbing && scrub(e));
  ruler.addEventListener('pointerup', () => { scrubbing = false; });
  const lane = h('div', { class: 'lane2 audio', style: 'height:40px' });
  player.clips.forEach((c, i) => {
    const sp = sOf(c.speaker);
    lane.append(h('div', { class: `tclip voice ${c.id === S.lineSel ? 'sel' : ''}`, style: `left:${c.start * pps}px;width:${Math.max(8, (c.end - c.start) * pps)}px;background:${sp?.color || '#888'}`, onclick: () => !S.exporting && selectLine(c.id) },
      h('span', { class: 'tn' }, `${i + 1} · ${sp?.name || ''}`)));
  });
  if (!player.clips.length) lane.append(h('div', { class: 'tclip empty', style: 'left:0;right:0', onclick: () => openTab('audio') }, '＋ Add audio (optional)'));
  const labels = [h('div', { class: 'rl ruler', style: `height:${RULER}px` }, 'Time'), h('div', { class: 'rl audio', style: 'height:40px' }, '🔊 Audio')], lanes = [ruler, lane];
  const KIND_ICON = { body: '🎬', hand: '✋', legs: '🦵', face: '🙂' }, LH = 34;
  for (const s of S.order.map(sOf).filter((x) => x?.charId && charOf(x))) {
    const plan = layerPlan(s), kinds = ['body', ...LAYER_KINDS.filter((k) => plan.clips.some((c) => c.kind === k) || (S.manual[s.key] || []).some((m) => m.kind === k))], nameOf = new Map(plan.refs.map((r) => [animKey(r), r.name]));
    kinds.forEach((kind, i) => {
      const ln = h('div', { class: 'lane2 char', style: `height:${LH}px` });
      for (const c of plan.clips.filter((x) => x.kind === kind && !x.manual)) {
        const name = (nameOf.get(c.name) || c.name).replace(/^Listener · /, '');
        const el = h('div', { class: `tclip ${kind} auto`, title: `${name} (automatic)`, style: `left:${c.start * pps}px;width:${Math.max(6, c.dur * pps)}px` }, h('span', { class: 'tn' }, name));
        el.addEventListener('click', () => { const L = lineAt(c.start + 0.01); if (L && player.clips.length) selectLine(L.id); });
        ln.append(el);
      }
      for (const m of (S.manual[s.key] || []).filter((x) => x.kind === kind)) {
        const name = m.ref.name.replace(/^Listener · /, ''), rz = h('i', { class: 'rz' });
        const el = h('div', { class: `tclip ${kind} mine ${m.id === S.mclip ? 'sel' : ''}`, title: `${name} — drag to move, drag the right edge to stretch`, style: `left:${m.start * pps}px;width:${Math.max(6, m.dur * pps)}px` }, h('span', { class: 'tn' }, name), rz);
        el.addEventListener('pointerdown', (e) => dragClip(e, m, e.target === rz ? 'size' : 'move', el));
        ln.append(el);
      }
      labels.push(h('div', { class: 'rl char', style: `height:${LH}px` }, i === 0 ? [h('span', { class: 'dot', style: `background:${s.color}` }), h('span', { class: 'lt' }, s.name), h('button', { class: 'rx add', title: `Add an animation for ${s.name} at the playhead`, onclick: () => clipPicker(s) }, '＋')] : h('span', { class: 'lt face' }, `${KIND_ICON[kind]} ${kind}`)));
      lanes.push(ln);
    });
    const cks = S.charKeys[s.key];
    if (cks?.length) {
      const kl = h('div', { class: 'lane2 cam move', style: 'height:24px' });
      for (const k of cks.slice().sort((a, b) => a.t - b.t)) {
        const d = h('i', { class: `kf mv ${k.id === S.ckSel ? 'sel' : ''}`, title: `${s.name} · ${k.t.toFixed(2)}s`, style: `left:${k.t * pps}px;background:${s.color}` });
        d.addEventListener('pointerdown', (e) => dragCharKey(e, s, k, d)); kl.append(d);
      }
      labels.push(h('div', { class: 'rl char', style: 'height:24px' }, h('span', { class: 'lt face' }, '◆ move'))); lanes.push(kl);
    }
  }
  // camera keyframes
  const cl = h('div', { class: 'lane2 cam', style: 'height:30px' });
  if (!S.camKeys.length) cl.append(h('span', { class: 'camhint' }, 'automatic shots · open the Camera tab to add keyframes'));
  for (const k of [...S.camKeys].sort((a, b) => a.t - b.t)) {
    const d = h('i', { class: `kf ${k.id === S.camSel ? 'sel' : ''}`, title: `${k.t.toFixed(2)}s · ${k.zoom.toFixed(2)}×`, style: `left:${k.t * pps}px` });
    d.addEventListener('pointerdown', (e) => dragKey(e, k, d));
    cl.append(d);
  }
  labels.push(h('div', { class: 'rl audio', style: 'height:30px', onclick: () => openTab('camera') }, '🎥 Camera')); lanes.push(cl);
  tlLabels.replaceChildren(...labels);
  tlInner.style.width = `${Math.ceil(total * pps) + 60}px`;
  tlInner.replaceChildren(...lanes, headEl);
  drawClipBar();
  headEl.style.left = `${player.time * pps}px`;
}

/* ---------- the user's own animation clips on the timeline ---------- */
const findManual = (id) => { for (const [k, list] of Object.entries(S.manual)) { const m = list.find((x) => x.id === id); if (m) return { s: sOf(k), m, list }; } return null; };
/** an empty scene is 8 s; clips / camera keys placed later stretch it. With audio the voice decides the length. */
function sceneLen() {
  let end = 8;
  for (const l of Object.values(S.manual)) for (const m of l) end = Math.max(end, m.start + m.dur);
  for (const k of S.camKeys) end = Math.max(end, k.t + 0.5);
  for (const l of Object.values(S.charKeys)) for (const k of l) end = Math.max(end, k.t + 0.5);
  return Math.ceil(end * 10) / 10;
}
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
  close = modal(`Add an animation · ${s.name}`, h('div', {}, h('p', { class: 'sub', style: 'font-size:12px;margin:0 0 8px' }, onPick ? 'Pick the animation that replaces this clip.' : `It is placed at the playhead (${fmt(player.time)}). Add the same animation as many times as you like.`), ab.el));
}
function dragClip(e, m, mode, el) {
  if (S.exporting) return;
  e.preventDefault(); e.stopPropagation();
  S.mclip = m.id; drawClipBar();
  document.querySelectorAll('.tclip.mine.sel').forEach((x) => x.classList.remove('sel')); el.classList.add('sel');
  const x0 = e.clientX, s0 = m.start, d0 = m.dur, pps = S.pps; let moved = false, raf = 0;
  el.setPointerCapture(e.pointerId);
  const mv = (ev) => {
    const dx = (ev.clientX - x0) / pps;
    if (Math.abs(ev.clientX - x0) > 2) moved = true;
    if (mode === 'move') m.start = Math.max(0, snap(s0 + dx)); else m.dur = Math.max(0.2, snap(d0 + dx));
    el.style.left = `${m.start * pps}px`; el.style.width = `${Math.max(6, m.dur * pps)}px`;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; refreshPresence(); });
  };
  const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); if (moved) commitClips(); else drawClipBar(); };
  el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}
function drawClipBar() {
  if (!clipBar) return;
  const f = S.mclip && findManual(S.mclip);
  if (!f) { clipBar.hidden = true; return; }
  const { s, m, list } = f;
  const num = (label, get, set) => h('label', { class: 'cb-n' }, label, h('input', { type: 'number', step: 0.05, min: 0, value: get().toFixed(2), onchange: (e) => { set(+e.target.value || 0); setTimeout(commitClips, 0); } }));
  const btn = (txt, fn, title) => h('button', { class: 'btn sm', title, onclick: fn }, txt);
  clipBar.hidden = false;
  clipBar.replaceChildren(
    h('span', { class: 'dot', style: `background:${s?.color || '#888'}` }), h('b', { class: 'cb-name' }, m.ref.name), h('small', {}, `${s?.name || ''} · ${m.kind}`),
    num('Start s', () => m.start, (v) => { m.start = Math.max(0, snap(v)); }), num('Length s', () => m.dur, (v) => { m.dur = Math.max(0.2, v); }),
    btn('⧉ Duplicate', () => { const c = { ...m, id: uid(), ref: { ...m.ref }, start: snap(m.start + m.dur) }; list.push(c); S.mclip = c.id; commitClips(); }, 'Same animation again, right after this one'),
    btn('✂ Split', () => { const t = player.time; if (t <= m.start + 0.1 || t >= m.start + m.dur - 0.1) { toast('Move the playhead inside this clip first.'); return; } const c = { ...m, id: uid(), ref: { ...m.ref }, start: snap(t), dur: m.start + m.dur - snap(t), off: (m.off || 0) + (snap(t) - m.start) }; m.dur = snap(t) - m.start; list.push(c); S.mclip = c.id; commitClips(); }, 'Cut this clip at the playhead'),
    btn('⇄ Replace', () => clipPicker(s, async (ref, overlay, length) => { m.ref = { ...ref }; m.kind = ref.layer || (overlay ? 'face' : 'body'); if (length) m.dur = Math.max(0.3, +length.toFixed(2)); const b = busy('Applying…'); try { await applyLayers(); } catch (er) { toast(er.message); } finally { b.done(); } commitClips(); }), 'Pick another animation for this clip'),
    btn('🗑 Delete', () => { list.splice(list.indexOf(m), 1); S.mclip = null; commitClips(); }),
    btn('✕', () => { S.mclip = null; drawTimeline(); }, 'Close'));
}

/* ---------- movement keyframes of a character (position, size, facing) ---------- */
let tlTimer = 0;
const scheduleTl = () => { clearTimeout(tlTimer); tlTimer = setTimeout(() => { drawTimeline(); if (S.tab === 'motion') drawTabs(); }, 220); };
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
  const sl = (label, get, set, min, max, step, show) => { const out = h('span', { class: 'v' }, show(get())), input = h('input', { type: 'range', min, max, step, value: get() }); input.addEventListener('input', () => { set(+input.value); out.textContent = show(+input.value); apply(); }); return h('label', { class: 'cs-sl' }, h('span', {}, label), input, out); };
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
  const show = stage.fullView && S.step === 3 && !S.exporting;
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
  const custom = h('input', { type: 'text', placeholder: 'w:h  e.g. 2:1', value: ASPECTS[S.aspect] ? '' : S.aspect, class: 'cb-ratio', onchange: (e) => { const v = e.target.value.trim(); if (aspectOf(v).label.startsWith('Custom')) setAspect(v); else toast('Use a ratio like 2:1 or 5:4 (not wider than 8:1).'); } });
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
  selected.mask ||= { enabled: false, shape: 'rect', x: 0.25, y: 0.15, w: 0.5, h: 0.7, invert: false };
  const mask = selected.mask;
  const update = (key, value) => { mask[key] = value; const layer = stage.layers.find((x) => x.key === selected.key); if (layer) layer.mask = { ...mask }; if (typeof place === 'function') place(); S.dirty = true; };
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
      mask.shape==='polygon' ? h('label',{class:'cs-sl'},h('span',{},'Points as x,y percentages; separate with semicolons'),h('input',{type:'text',value:(mask.points||[{x:0,y:0},{x:1,y:0},{x:.8,y:1},{x:.2,y:1}]).map(p=>`${Math.round(p.x*100)},${Math.round(p.y*100)}`).join(';'),onchange:e=>{const pts=e.target.value.split(';').map(v=>v.split(',').map(Number)).filter(v=>v.length===2&&v.every(Number.isFinite)).slice(0,8);if(pts.length<3){toast('Enter at least three valid x,y points.');return}mask.points=pts.map(([x,y])=>({x:Math.max(0,Math.min(100,x))/100,y:Math.max(0,Math.min(100,y))/100}));update('points',mask.points)}})) : null,
      h('label', { class: 'row', style: 'gap:8px;justify-content:flex-start;margin:10px 0' }, h('input', { type: 'checkbox', checked: mask.invert, onchange: (e) => update('invert', e.target.checked) }), h('span', {}, 'Invert · hide inside the shape')),
      range('x', 'Left position'), range('y', 'Top position'), range('w', 'Width'), range('h', 'Height'),
      h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap;margin-top:8px' }, h('button', { class: 'btn sm ok', onclick: () => { selected.maskKeys ||= []; const key = { t: player.time, x: mask.x, y: mask.y, w: mask.w, h: mask.h }; const i = selected.maskKeys.findIndex((k) => Math.abs(k.t - key.t) < 0.02); if (i >= 0) selected.maskKeys[i] = key; else selected.maskKeys.push(key); selected.maskKeys.sort((a,b)=>a.t-b.t); const layer=stage.layers.find(x=>x.key===selected.key); if(layer) layer.maskKeys=selected.maskKeys; S.dirty=true; drawTimeline(); drawTabs(); } }, '＋ Mask key at playhead'),
        h('label', { class: 'sub', style: 'font-size:12px' }, 'Follow bone ', h('select', { onchange: (e) => { selected.maskFollow=e.target.value; const layer=stage.layers.find(x=>x.key===selected.key); if(layer) layer.maskFollow=selected.maskFollow; S.dirty=true; } }, h('option', { value: '' }, 'Off'), ...['head','neck','hand_l','hand_r','root'].map(n=>h('option',{value:n,selected:selected.maskFollow===n},n))))),
      selected.maskKeys?.length ? h('div',{class:'mask-key-list'},...selected.maskKeys.map((k,i)=>h('button',{class:'btn sm',onclick:()=>{player.seek(k.t);S.dirty=true;drawTimeline();}},`Mask ${i+1} · ${k.t.toFixed(2)}s`))) : null,
      h('button', { class: 'btn sm', onclick: () => { Object.assign(mask, { x: 0.25, y: 0.15, w: 0.5, h: 0.7 }); update('x', mask.x); drawTabs(); } }, 'Reset mask area')),
    h('div', { class: 'card flat' }, h('b', {}, `Target: ${selected.name}`), h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;margin-top:8px' }, ...chars.map((s) => h('button', { class: `btn sm ${s.key === selected.key ? 'pri' : ''}`, onclick: () => { S.sel = s.key; drawTabs(); } }, s.name)))));
}
function setAspect(a) {
  S.aspect = a; stage.setSize(a, S.preview); S.dirty = true; syncCam(); updateSel(); drawTabs();
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
      h('button', { class: 'ib', title: 'Swap this character\'s image', onclick: () => swapModal(s) }, '🖼'),
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
    (S.solo[s.key] ||= {})[kind || 'body'] = ref;
  } else {
    if (!L) { toast('Tap an audio line first.'); return; }
    const lines = S.applyAll ? player.clips : [L];
    for (const l of lines) { const o = castOf(l.id, s.key); o.in = o.in; if (kind) o[kind] = ref; else { o.body = ref; delete o.seq; } }
  }
  const b = busy('Applying animation…');
  try { await applyLayers(); } catch (e) { console.error(e); toast(`Could not apply animation: ${e.message}`); } finally { b.done(); }
  drawLineBox();
}

/* ---- on-canvas handles: drag to move, corner squares to resize ---- */
function mountStage() {
  selEl = h('div', { class: 'selbox', hidden: true });
  propSelEl = h('div', { class: 'prop-sel', hidden: true, 'aria-label': 'Selected prop; drag to move' });
  handleEls = Object.fromEntries(['tl', 'tr', 'bl', 'br'].map((c) => [c, h('i', { class: `hd h-${c}`, 'data-c': c, hidden: true })]));
  wrapEl = h('div', { class: 'stagewrap' }, stage.out, selEl, propSelEl, ...Object.values(handleEls));
  document.getElementById('stagebox').replaceChildren(wrapEl);
  mountCamBox();
  let drag = null;
  const pt = (e) => { const r = stage.out.getBoundingClientRect(), k = stage.W / r.width; return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k }; };
  const layer = () => stage.layers.find((l) => l.key === S.sel);
  wrapEl.addEventListener('pointerdown', (e) => {
    if (S.exporting) return;
    if (camPointerDown(e)) return;
    if (stage.fullView) return;
    const p = pt(e), hd = e.target.dataset?.c;
    if (stage.camZoom <= 1.02 && !hd) {
      const prop = [...S.props].reverse().find((x) => x.visible !== false && Math.abs(p.x - x.x * stage.W) <= (x.w || .18) * stage.W / 2 && Math.abs(p.y - x.y * stage.H) <= (x.h || .18) * stage.H / 2);
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
      l = [...stage.layers].reverse().find((x) => stage.camZoom <= 1.02 && x.visible !== false && x.shown !== false && p.x >= x.box.x0 && p.x <= x.box.x1 && p.y >= x.box.y0 && p.y <= x.box.y1);
      S.sel = l?.key ?? null;
      if (l) drag = { mode: 'move', p0: p, a0: { ...l.anchor } };
      updateSel(); S.dirty = true;
    }
    if (drag) wrapEl.setPointerCapture(e.pointerId);
  });
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
  const end = async () => { if (camPointerUp()) return; if (drag?.mode === 'prop') { try { await dbPut('props', drag.prop); drawTabs(); } catch (e) { toast(`Could not save prop position: ${e.message}`); } } drag = null; };
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
  const prop = S.props.find((item) => item.id === S.selectedPropId);
  if (prop && S.step === 3 && !stage.fullView && stage.camZoom <= 1.02 && !player.playing) {
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
  const hideBox = () => { selEl.hidden = true; Object.values(handleEls).forEach((e) => { e.hidden = true; }); };
  if (!l || l.shown === false || S.step !== 3 || stage.fullView) { hideBox(); if (selBar) selBar.hidden = true; return; }
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
}
function drawSelBar(l) {
  const s = S.speakers.find((x) => x.key === l.key);
  selBar.dataset.key = l.key; selBar.hidden = false;
  selBar.replaceChildren(
    h('span', { class: 'dot', style: `background:${s.color}` }), h('b', {}, s.name),
    h('span', { class: 'pct' }, `${Math.round((l.mul ?? 1) * 100)}%`),
    h('input', { type: 'range', min: 20, max: 800, value: Math.round((l.mul ?? 1) * 100), 'aria-label': 'Size', oninput: (e) => {
      const m = e.target.value / 100, cur = stage.layers.find((x) => x.key === l.key);
      cur.axf ??= cur.anchor.x / stage.W; cur.ayf ??= (stage.H - cur.anchor.y) / stage.H; // keep feet where they are
      cur.mul = m; saveXf(cur); stage.layout(); updateSel(); S.dirty = true;
    } }),
    h('button', { class: 'btn sm', title: 'Swap image', onclick: () => swapModal(s) }, '🖼'),
    h('button', { class: 'btn sm', title: 'Mirror', onclick: () => { s.flip = !s.flip; s._flipSet = true; const cur = stage.layers.find((x) => x.key === l.key); cur.flip = s.flip; if (S.charKeys[l.key]?.length) writeCharKey(cur); stage.layout(); updateSel(); S.dirty = true; } }, '⇋'),
    h('button', { class: 'btn sm', title: 'Hide the box', onclick: () => { S.sel = null; selBar.dataset.key = ''; updateSel(); S.dirty = true; } }, '✕'),
    h('button', { class: 'btn sm', title: 'Reset size & position', onclick: () => { s.xf = null; const cur = stage.layers.find((x) => x.key === l.key); cur.mul = 1; cur.axf = cur.ayf = null; stage.layout(); updateSel(); S.dirty = true; } }, 'Reset'));
}
window.addEventListener('resize', () => updateSel());

async function removeCharacterFrom(s) {
  if (!confirm(`Remove ${s.name}'s character and its animations from the stage?`)) return;
  s.charId = null;
  if (S.sel === s.key) S.sel = null;
  S.animFor = S.speakers.find((x) => x.charId)?.key ?? null;
  const b = busy('Updating…'); await applyLayers(); b.done();
  drawTimeline(); drawLineBox(); drawTabs(); updateSel(); S.dirty = true;
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
const openTab = (k) => { S.tab = k; S.panelOpen = true; drawTabs(); };
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
  S.speakers.push(s); S.order.push(key);
  chooseCharacter(s, async () => {
    if (!s.charId) { S.speakers = S.speakers.filter((x) => x !== s); S.order = S.order.filter((k) => k !== key); drawTabs(); return; }
    const b = busy('Loading character…');
    try { const d = charOf(s); if (d) await stage.loadCharacter(d); S.speakers.filter((x) => x.charId).forEach((x, i) => { if (!x._flipSet) x.flip = i % 2 === 1; }); await applyLayers(); } catch (e) { toast(e.message); }
    b.done(); S.animFor = key; drawTimeline(); drawLineBox(); drawTabs(); S.dirty = true;
  });
}
function tabAudio() {
  const input = h('input', { type: 'file', multiple: true, accept: '.zip,.json,.txt,audio/*', style: 'display:none', onchange: (e) => { const f = [...e.target.files]; e.target.value = ''; onFiles(f); } });
  const drop = h('div', { class: 'drop sm', onclick: () => input.click(),
    ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); }, ondragleave: () => drop.classList.remove('over'),
    ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); onFiles([...e.dataTransfer.files]); } },
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
/** outfits of a character = its skins except "default" (Autodraft rigs: Saree / Salvar / Business ...) */
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
      h('div', { class: 't', style: 'cursor:pointer', onclick: () => { S.animFor = s.key; S.sel = s.key; updateSel(); drawLineBox(); S.dirty = true; } }, s.name, h('small', {}, c.name)),
      skinNames(c).length > 1 ? h('button', { class: 'ib', title: 'Outfit', onclick: () => outfitModal(s) }, '👗') : null,
      h('button', { class: 'ib', title: 'Swap image', onclick: () => swapModal(s) }, '🖼'),
      h('button', { class: 'ib', title: 'Change character', onclick: () => addCharacterTo(s) }, '⇄'),
      h('button', { class: 'ib', title: 'Bring forward', disabled: i === 0, onclick: () => mv(-1) }, '↑'),
      h('button', { class: 'ib', title: 'Send back', disabled: i === onStage.length - 1, onclick: () => mv(1) }, '↓'),
      h('button', { class: 'ib', title: 'Show / hide', onclick: (e) => { s.visible = !s.visible; const l = stage.layers.find((x) => x.key === s.key); if (l) l.visible = s.visible; e.currentTarget.textContent = s.visible ? '👁' : '—'; S.dirty = true; } }, s.visible ? '👁' : '—'),
      h('button', { class: 'ib', title: 'Remove from stage', onclick: () => removeCharacterFrom(s) }, '🗑'));
  });
  const without = S.speakers.filter((s) => !s.charId).map((s) => h('div', { class: 'layer' }, h('span', { class: 'dot', style: `background:${s.color}` }), h('div', { class: 't' }, s.name, h('small', {}, s.manual ? 'No character yet' : 'Voice without a character')),
    h('button', { class: 'btn sm', onclick: () => addCharacterTo(s) }, '＋ Pick character'),
    s.manual ? h('button', { class: 'ib', title: 'Remove', onclick: () => { S.speakers = S.speakers.filter((x) => x !== s); S.order = S.order.filter((k) => k !== s.key); drawTabs(); } }, '✕') : null));
  return h('div', { class: 'list' }, h('button', { class: 'btn ok', onclick: addManualCharacter }, '＋ Add character'),
    h('p', { class: 'sub', style: 'font-size:12px;margin:0' }, 'Characters on stage (top = in front). Every voice you add as audio shows up here too. 🖼 swaps the character image, 🗑 removes it.'), rows, without);
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
  return h('div', {},
    h('p', { class: 'hint', style: 'text-align:left;margin:0 0 6px' }, noAudio ? 'No audio yet — the animation you pick plays for the whole scene. (Add audio any time to give every line its own.)' : L ? `Choosing for line ${idx} (${fmt(L.start)}–${fmt(L.end)}). Pick the audio line first on the timeline.` : 'Tap an audio line on the timeline first.'),
    h('label', { class: 'tog', style: 'margin-bottom:8px', title: 'Every tap places the animation on the timeline at the playhead, so you can stack as many as you like — the same one again too' }, h('input', { type: 'checkbox', checked: S.addMode, onchange: (e) => { S.addMode = e.target.checked; } }), '➕ Add on the timeline at the playhead (instead of replacing)'),
    noAudio ? null : h('label', { class: 'tog', style: 'margin-bottom:8px' }, h('input', { type: 'checkbox', checked: S.applyAll, onchange: (e) => { S.applyAll = e.target.checked; } }), 'Use for all lines of this character'),
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
    byId.set(a.ref.id, a.ref);
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
    const list = raw.map((g) => ({ at: Math.max(0, Math.min(dur - 0.3, +g.at || 0)), ref: lib.byId.get(+g.anim) })).filter((g) => { if (!g.ref) dropped++; return g.ref; }).sort((a, b) => a.at - b.at);
    if (list.length) { list[0].at = 0; o.seq = list.map((g) => ({ at: +g.at.toFixed(2), ref: { ...g.ref } })); }
    for (const [kind, field] of [['face', 'expression'], ['hand', 'hand'], ['legs', 'legs']]) {
      const ref = lib.byId.get(+res[field]?.[s.key]);
      if (ref && (ref.layer || 'face') === kind) o[kind] = { ...ref };
    }
  }
  const type = ['wide', 'medium', 'close'].includes(res.shot?.type) ? res.shot.type : 'wide';
  S.shots.set(L.id, { type, focus: want.has(res.shot?.focus) ? res.shot.focus : 'auto' });
  return dropped;
}
async function runDirector(lines) {
  const ai = S.ai;
  if (!ai.key) { toast('Add your OpenRouter API key first.'); return; }
  const onStage = S.speakers.filter((s) => s.charId && charOf(s));
  if (!onStage.length) { toast('Add at least one character to the stage first.'); return; }
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
  if (!S.ai.key) { toast('Add your OpenRouter API key first.'); return; }
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
  if (!chars.length) { toast('Choose at least one character first.'); return; }
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
  if (!chars.length) { toast('Choose at least one character first.'); return; }
  let data;
  try { data = extractJson(await file.text()); } catch (e) { toast(e.message); return; }
  const entries = Array.isArray(data.lines) ? data.lines : Array.isArray(data) ? data : [];
  if (!entries.length) { toast('That file has no "lines" list.'); return; }
  const libs = new Map(chars.map((s) => [s.key, libraryFor(charOf(s))]));
  const list = lineList();
  let applied = 0, dropped = 0;
  for (const e of entries) {
    const l = list[(+e.line || 0) - 1];
    if (!l) continue;
    dropped += applyDirection({ id: l.id, speaker: l.speaker, dur: l.dur }, e, libs); applied++;
  }
  S.dirty = true;
  if (S.step === 3) { const b = busy('Applying the direction…'); try { await applyLayers(); drawLineBox(); drawTimeline(); } catch (e) { toast(`Could not apply: ${e.message}`); } finally { b.done(); } }
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

function tabCanvas() {
  const seg = (items, cur, on) => h('div', { class: 'seg' }, items.map(([k, l]) => h('button', { class: String(cur()) === String(k) ? 'on' : '', onclick: (e) => { on(k); e.currentTarget.parentNode.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', String(items[i][0]) === String(k))); } }, l)));
  const file = h('input', { type: 'file', accept: 'image/*', multiple: true, style: 'display:none', onchange: async (e) => {
    for (const f of e.target.files) { const rec = { id: `bg${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: f.name, blob: f }; await dbPut('backgrounds', rec); S.myBgs.push(rec); S.bgId = rec.id; await stage.setBackgroundImage(f); }
    S.dirty = true; drawTabs();
  } });
  const pickBg = async (rec) => { S.bgId = rec?.id ?? null; await stage.setBackgroundImage(rec?.blob ?? null); S.dirty = true; drawTabs(); };
  const shared = (type) => S.sharedAssets.filter((asset) => asset.type === type);
  const addSharedBackground = async (asset) => {
    try {
      const blob = await downloadStudioAsset(asset), id = `shared-${asset.id}`;
      let rec = S.myBgs.find((item) => item.id === id);
      if (!rec) { rec = { id, name: asset.name, blob }; await dbPut('backgrounds', rec); S.myBgs.push(rec); }
      await pickBg(rec);
    } catch (e) { toast(`Could not add background: ${e.message}`); }
  };
  const addSharedProp = async (asset) => {
    try {
      const blob = await downloadStudioAsset(asset), prop = { id: crypto.randomUUID(), assetId: asset.id, name: asset.name, blob, x: .5, y: .66, w: .18, h: .18, rotation: 0, visible: true };
      await dbPut('props', prop); S.props.push(prop); S.selectedPropId = prop.id; await stage.setProps(S.props); S.dirty = true; drawTabs(); updateSel();
    } catch (e) { toast(`Could not add prop: ${e.message}`); }
  };
  const sharedGrid = (type, choose) => shared(type).length ? h('div', { class: 'studio-shared-grid' }, shared(type).map((asset) => h('button', { class: 'studio-shared-card', type: 'button', onclick: () => choose(asset) }, h('span', {}, type === 'background' ? '🖼' : '🧸'), h('b', {}, asset.name), h('small', {}, 'Shared library · tap to add')))) : h('p', { class: 'sub studio-library-empty' }, 'No shared items have been added by the admin yet.');
  const tab = (mode, label) => h('button', { class: `btn sm ${S.canvasMode === mode ? 'pri' : ''}`, type: 'button', 'aria-pressed': S.canvasMode === mode, onclick: () => { S.canvasMode = mode; redrawPanel(); } }, label);
  if (S.canvasMode === 'props') {
    const selected = S.props.find((p) => p.id === S.selectedPropId);
    const edit = (key, value) => { if (!selected) return; selected[key] = value; stage.setProps(S.props); updateSel(); S.dirty = true; dbPut('props', selected); };
    return h('div', { class: 'list' },
      h('div', { class: 'card flat' }, h('h2', {}, 'Props'), h('p', { class: 'sub studio-help' }, 'Tap a shared prop to add it. Drag it on the stage to move it; choose it to resize, rotate or remove it.'), h('div', { class: 'studio-asset-tabs' }, tab('backgrounds', 'Backgrounds'), tab('props', 'Props')), sharedGrid('prop', addSharedProp)),
      selected ? h('div', { class: 'card flat studio-prop-editor' }, h('h3', {}, selected.name), ...[['x','Position · left / right',0,1,0.01],['y','Position · top / bottom',0,1,0.01],['w','Width',0.04,0.8,0.01],['h','Height',0.04,0.8,0.01],['rotation','Rotation',-180,180,1]].map(([key,label,min,max,step]) => h('label', { class: 'studio-prop-range' }, h('span', {}, label, h('b', {}, key === 'rotation' ? `${Math.round(selected[key] || 0)}°` : `${Math.round((selected[key] ?? (key === 'x' ? .5 : key === 'y' ? .66 : .18)) * 100)}%`)), h('input', { type:'range', min, max, step, value:selected[key] ?? (key === 'x' ? .5 : key === 'y' ? .66 : .18), oninput:e => { edit(key, Number(e.target.value)); e.currentTarget.previousSibling.querySelector('b').textContent = key === 'rotation' ? `${Math.round(Number(e.target.value))}°` : `${Math.round(Number(e.target.value)*100)}%`; } }))), h('button', { class:'btn sm', style:'color:#b91c1c;border-color:#fecaca', onclick: async()=>{ await dbDel('props',selected.id); S.props=S.props.filter(p=>p.id!==selected.id); S.selectedPropId=null; await stage.setProps(S.props); S.dirty=true; drawTabs(); updateSel(); } }, 'Remove prop')) : null);
  }
  const mine = h('div', { class: 'bggrid' },
    h('button', { class: 'bgc add', onclick: () => file.click() }, h('span', {}, '+'), h('small', {}, 'Add images')),
    S.myBgs.map((r) => h('button', { class: `bgc ${S.bgId === r.id ? 'on' : ''}`, onclick: () => pickBg(r) },
      h('img', { src: URL.createObjectURL(r.blob), alt: r.name, loading: 'lazy' }),
      h('span', { class: 'x', title: 'Delete', onclick: async (e) => { e.stopPropagation(); await dbDel('backgrounds', r.id); S.myBgs = S.myBgs.filter((x) => x.id !== r.id); if (S.bgId === r.id) await pickBg(null); else drawTabs(); } }, '✕'))));
  const sw = h('div', { class: 'sw' }, BACKGROUNDS.map((b, i) => h('button', { title: b.name, class: stage.bg.preset === i && !S.bgId ? 'on' : '', style: `background:linear-gradient(135deg,${b.a},${b.b})`, onclick: async () => { stage.bg.preset = i; await pickBg(null); } })));
  return h('div', { class: 'list' },
    h('div', { class: 'card flat' }, h('h2', {}, 'Backgrounds'), h('p', { class: 'sub', style: 'font-size:12px;margin:0 0 8px' }, 'Choose an admin shared scene or add your own image. Backgrounds sit behind characters and props.'), h('div', { class: 'studio-asset-tabs' }, tab('backgrounds', 'Backgrounds'), tab('props', 'Props')), sharedGrid('background', addSharedBackground), mine, file),
    h('div', { class: 'card flat' }, h('h2', {}, 'Plain colours'), sw));
}

/** export size for the chosen orientation + quality */
function sizeFor() { const { w, h } = aspectOf(S.aspect), k = S.quality / Math.min(w, h); return { W: Math.round((w * k) / 2) * 2, H: Math.round((h * k) / 2) * 2 }; }
function tabExport() {
  const seg = (items, cur, on) => h('div', { class: 'seg' }, items.map(([k, l]) => h('button', { class: cur() === k ? 'on' : '', onclick: (e) => { on(k); e.currentTarget.parentNode.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', items[i][0] === k)); redrawPanel(); } }, l)));
  const q = seg([[360, 'Draft · 360p'], [480, 'Low · 480p'], [720, 'HD · 720p'], [1080, 'Full HD · 1080p'], [2160, '4K · 2160p']], () => S.quality, (v) => { S.quality = v; });
  const m = seg([['fast', '⚡ Fast render'], ['live', '⏺ Record live']], () => S.expMethod, (v) => { S.expMethod = v; });
  const fm = seg([['webm', 'WebM · smaller, sharper'], ['mp4', 'MP4 · plays everywhere']], () => S.format, (v) => { S.format = v; });
  const lv = seg([['std', 'Standard'], ['high', 'High'], ['max', 'Maximum']], () => S.level, (v) => { S.level = v; });
  const f = seg([[12, '12 fps · draft'], [15, '15 fps · fast'], [24, '24 fps'], [30, '30 fps · smooth']], () => S.fps, (v) => { S.fps = v; });
  return h('div', { class: 'list' },
    !player.clips.length ? h('div', { class: 'card flat' }, h('p', { class: 'sub', style: 'font-size:12px;margin:0' }, '🔇 No audio added — the video will be 8 seconds long and silent. Add audio any time to make it as long as your voice.')) : null,
    h('div', { class: 'card flat' }, h('h2', {}, 'Method'), m,
      h('p', { class: 'sub', style: 'font-size:12px;margin:8px 0 0' }, S.expMethod === 'fast'
        ? `Builds the video frame by frame on ${workerCount() || 1} CPU core${workerCount() > 1 ? 's at the same time' : ''}, as fast as your device can. The result plays at normal speed and is always complete.`
        : 'Plays the video once in real time and records the screen — takes as long as the video. Use it only if Fast render does not work on your device.')),
    h('div', { class: 'card flat' }, h('h2', {}, 'Quality'), q, S.quality >= 2160 ? h('p', { class: 'sub', style: 'font-size:12px;margin:8px 0 0' }, '4K needs a strong phone or computer and takes longer. Try 1080p first.') : null),
    h('div', { class: 'card flat' }, h('h2', {}, 'File format'), fm, h('p', { class: 'sub', style: 'font-size:12px;margin:8px 0 0' }, S.format === 'webm' ? 'WebM (VP9): same sharpness in about half the size. Plays in Chrome, Edge, Firefox, VLC and most editors; some phone galleries and WhatsApp may not open it.' : 'MP4 (H.264): opens everywhere — gallery, WhatsApp, editors — but the file is bigger for the same sharpness.')),
    h('div', { class: 'card flat' }, h('h2', {}, 'Video quality'), lv, (() => { const { W, H } = sizeFor(); const mbps = bitrateFor(W, H, S.level, S.format) / 1e6, mb = (mbps * (player.total || 0)) / 8; return h('p', { class: 'sub', style: 'font-size:12px;margin:8px 0 0' }, `${W}×${H} · about ${mbps.toFixed(1)} Mbps → roughly ${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB for this video. Higher = sharper picture and a bigger file.`); })()),
    h('div', { class: 'card flat' }, h('h2', {}, 'Smoothness'), f, h('p', { class: 'sub', style: 'font-size:12px;margin:8px 0 0' }, 'Fewer frames per second = faster export.')),
    h('button', { class: 'btn ok', style: 'width:100%;padding:14px', disabled: !pickType() && !window.VideoEncoder, onclick: doExport }, '⬇ Export video'));
}
const redrawPanel = () => { const k = panelEl.scrollTop; drawTabs(); panelEl.scrollTop = k; };

async function togglePlay() {
  if (S.exporting) return;
  if (player.playing) player.pause(); else await player.play();
  S.dirty = true;
}

async function doExport() {
  if (S.exporting) return;
  S.exporting = true; player.pause(); player.seek(0); if (selEl) selEl.hidden = true; stage.fullView = false; syncCam();
  let stop = false, wl = null;
  const b = busy('Preparing…', () => { stop = true; });
  try { wl = await navigator.wakeLock?.request('screen'); } catch { /* optional */ }
  try {
    stage.setSize(S.aspect, S.quality);
    const offline = S.expMethod === 'fast' && await canExportOffline(stage.W, stage.H, S.fps, S.format, !player.clips.length);
    if (S.expMethod === 'fast' && !offline) toast('Fast render is not supported on this device — recording live instead.');
    let t0 = performance.now();
    const progress = (p) => {
      const sec = (performance.now() - t0) / 1000, x = p > 0.02 ? (p * player.total) / sec : 0;
      b.set(offline ? `Rendering ${Math.round(p * 100)}%${x ? ` · ${x.toFixed(1)}× faster than real time · ~${Math.max(1, Math.round(sec / p - sec))}s left` : ''}` : `Recording live ${Math.round(p * 100)}%`, p);
    };
    const single = () => exportOffline({ stage, clips: player.clips, plan: shotPlan(), total: player.total, onProgress: progress, cancelled: () => stop, fps: S.fps, level: S.level, format: S.format });
    let res;
    if (offline && workerCount() > 0) {
      try {
        const layers = await buildLayerSpecs();
        const ids = [...new Set(layers.map((l) => l.charId))];
        const job = {
          aspect: S.aspect, short: S.quality, fps: S.fps, level: S.level, format: S.format, W: stage.W, H: stage.H, maxTex: S.quality >= 2160 ? 4096 : 2048,
          chars: ids.map((id) => { const d = S.characters.find((c) => c.id === id) || S.libDefs.get(id); return { id, ske: d.ske, tex: d.tex }; }),
          bg: { preset: stage.bg.preset, image: S.bgId ? S.myBgs.find((r) => r.id === S.bgId)?.blob ?? null : null }, props: S.props.map((prop) => ({ ...prop })),
          layers, plan: shotPlan(), camKeys: stage.camKeys, voice: player.clips.map((c) => ({ speaker: c.speaker, start: c.start, end: c.end, visemes: c.visemes })),
        };
        res = await exportParallel({ job, clips: player.clips, total: player.total, onProgress: progress, cancelled: () => stop, workers: workerCount() });
      } catch (e) {
        if (e.message === 'cancelled') throw e;
        console.warn('parallel export failed, using one thread', e);
        toast('Parallel rendering is not available here — using a single thread.');
        t0 = performance.now(); res = await single();
      }
    } else res = offline ? await single() : await exportRealtime({ canvas: stage.out, stage, audioStream: player.rec.stream, player, onProgress: progress, level: S.level });
    const { blob, ext, info } = res;
    const took = (performance.now() - t0) / 1000;
    const a = h('a', { href: URL.createObjectURL(blob), download: `toon-${S.aspect.replace(':', 'x')}-${Date.now()}.${ext}` });
    document.body.append(a); a.click(); a.remove();
    toast(`Done in ${took.toFixed(0)}s (${(player.total / took).toFixed(1)}× real time) · ${ext.toUpperCase()} · ${info}`);
  } catch (e) { toast(e.message === 'cancelled' ? 'Export cancelled' : `Export failed: ${e.message}`); console.error(e); }
  wl?.release?.().catch(() => {});
  b.done(); S.exporting = false; stage.setSize(S.aspect, S.preview); player.pause(); player.seek(0); S.dirty = true;
}

/* ---------------- autosave, undo / redo, reset ---------------- */
const blobIds = new WeakMap(), blobReg = new Map();
function bid(b) { let id = blobIds.get(b); if (!id) { id = `b${Math.random().toString(36).slice(2, 9)}`; blobIds.set(b, id); blobReg.set(id, b); } return id; }
const hist = { undo: [], redo: [], cur: null, curStr: '', last: 0, busy: false };
let hdrUndo, hdrRedo, savedEl, lastSaved = '', saving = false, savedTimer;
const savedAudio = new Set();

/** the part of the project that undo / redo travels through */
function docOf() {
  return {
    fits: Object.fromEntries(S.speakers.filter(s=>s.charId).map(s=>[s.charId,getFit(s.charId)])),
    speakers: S.speakers.map((s) => ({ skins: s.skins || null, manual: !!s.manual, key: s.key, name: s.name, narrator: !!s.narrator, color: s.color, charId: s.charId, flip: !!s.flip, _flipSet: !!s._flipSet, _chosen: !!s._chosen, visible: s.visible !== false, xf: s.xf || null, mask: s.mask ? { ...s.mask } : null, maskKeys: s.maskKeys || [], maskFollow: s.maskFollow || '' })),
    order: [...S.order], cast: clone(Object.fromEntries(S.cast)), shots: clone(Object.fromEntries(S.shots)), script: Object.fromEntries(S.script), solo: clone(S.solo), manual: clone(S.manual), charKeys: clone(S.charKeys), camKeys: clone(S.camKeys), aspect: S.aspect, bgId: S.bgId, bgPreset: stage?.bg.preset ?? 0,
    swaps: Object.fromEntries([...S.swaps].map(([k, pages]) => [k, Object.fromEntries(Object.entries(pages).map(([pg, b]) => [pg, bid(b)]))])),
    props: S.props.map((prop) => ({ ...prop, blob: bid(prop.blob) })),
  };
}
async function ensureDefs() {
  for (const s of S.speakers) {
    if (!s.charId?.startsWith('lib:') || S.libDefs.has(s.charId)) continue;
    const entry = libraryCharacters().find((e) => `lib:${e.id}` === s.charId);
    try { if (!entry) throw new Error('not in the list'); S.libDefs.set(s.charId, await fetchLibraryCharacter(entry)); } catch (e) { toast(`Could not load the character for ${s.name}: ${e.message}`); s.charId = null; }
  }
}
/** put a saved / undone document back into the app */
async function loadDoc(doc, { fromDisk = false } = {}) {
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
  S.charKeys = JSON.parse(JSON.stringify(doc.charKeys || {}));
  if (S.mclip && !findManual(S.mclip)) S.mclip = null;
  if (S.camSel && !S.camKeys.some((k) => k.id === S.camSel)) S.camSel = null;
  syncCam(); syncChars();
  if (!fromDisk) {
    const prev = [...S.swaps.keys()];
    S.swaps = new Map(Object.entries(doc.swaps || {}).map(([k, pages]) => [k, Object.fromEntries(Object.entries(pages).map(([pg, id]) => [pg, blobReg.get(id)]).filter(([, b]) => b))]));
    for (const [k, pages] of S.swaps) await dbPut('swaps', { id: k, pages });
    for (const k of prev) if (!S.swaps.has(k)) await dbDel('swaps', k);
  }
  if (doc.aspect && doc.aspect !== S.aspect) { S.aspect = doc.aspect; stage.setSize(S.aspect, S.preview); }
  S.bgId = doc.bgId ?? null; stage.bg.preset = doc.bgPreset ?? 0;
  await stage.setBackgroundImage(S.myBgs.find((r) => r.id === S.bgId)?.blob ?? null);
  await ensureDefs();
  if (!S.speakers.some((s) => s.key === S.animFor && s.charId)) S.animFor = S.speakers.find((s) => s.charId)?.key ?? null;
  if (S.sel && !S.speakers.some((s) => s.key === S.sel && s.charId)) S.sel = null;
}
async function restoreProject() {
  const rec = (await dbAll('project')).find((r) => r.id === 'current');
  if (!rec?.doc) return false;
  const b = busy('Restoring your project…');
  try {
    const audio = new Map((await dbAll('audio')).map((r) => [r.id, r]));
    for (const m of rec.lines) {
      const a = audio.get(m.id);
      if (!a) continue;
      try { const buffer = await audioCtx.decodeAudioData(a.raw.slice(0)); S.lines.push({ ...m, raw: a.raw, buffer, visemes: analyse(buffer) }); savedAudio.add(m.id); } catch { /* skip broken audio */ }
    }
    Object.assign(S, { quality: rec.ui.v >= 2 ? (rec.ui.quality ?? S.quality) : Math.max(720, rec.ui.quality ?? 720), /* older saves defaulted to 480p on phones */ expMethod: rec.ui.expMethod ?? S.expMethod, fps: rec.ui.fps ?? S.fps, level: rec.ui.level ?? S.level, format: rec.ui.format ?? S.format, applyAll: !!rec.ui.applyAll, tab: rec.ui.tab ?? S.tab, lineSel: rec.ui.lineSel ?? null, animFor: rec.ui.animFor ?? null });
    await loadDoc(rec.doc, { fromDisk: true });
    S.step = 3;
    await prepareStudio();
    b.done(); render();
    toast('Welcome back — your project was restored.');
    return true;
  } catch (e) { console.error(e); b.done(); return false; }
}

async function saveProject(doc, docStr) {
  const ui = { step: S.step, maxStep: S.maxStep, tab: S.tab, lineSel: S.lineSel, animFor: S.animFor, quality: S.quality, expMethod: S.expMethod, fps: S.fps, level: S.level, format: S.format, applyAll: S.applyAll, v: 2 };
  const lines = S.lines.map(({ id, order, file, speaker }) => ({ id, order, file, speaker }));
  const sig = JSON.stringify({ ui, lines }) + docStr;
  if (sig === lastSaved) return;
  for (const l of S.lines) if (!savedAudio.has(l.id) && l.raw) { await dbPut('audio', { id: l.id, raw: l.raw }); savedAudio.add(l.id); }
  for (const id of [...savedAudio]) if (!S.lines.some((l) => l.id === id)) { await dbDel('audio', id); savedAudio.delete(id); }
  await dbPut('project', { id: 'current', doc, ui, lines, ts: Date.now() });
  lastSaved = sig;
  if (savedEl) { savedEl.textContent = navigator.onLine ? 'Saved locally · cloud pending' : 'Offline'; savedEl.classList.add('show'); }
}
async function tick() {
  if (!S.ready || hist.busy || saving || S.exporting || $app.hidden) return;
  saving = true;
  try {
    const doc = docOf(), str = JSON.stringify(doc);
    if (str !== hist.curStr) {
      const now = Date.now();
      if (now - hist.last > 700) { hist.undo.push(hist.cur); if (hist.undo.length > 100) hist.undo.shift(); hist.redo = []; }
      hist.cur = doc; hist.curStr = str; hist.last = now;
    }
    updateHistoryButtons();
    await saveProject(doc, str);
  } catch (e) { console.warn('autosave failed', e); }
  saving = false;
}
function updateHistoryButtons() { if (hdrUndo) { hdrUndo.disabled = !hist.undo.length; hdrRedo.disabled = !hist.redo.length; } }
async function stepHistory(dir) {
  const from = dir < 0 ? hist.undo : hist.redo, to = dir < 0 ? hist.redo : hist.undo;
  if (!from.length || S.exporting || hist.busy) return;
  hist.busy = true;
  const b = busy(dir < 0 ? 'Undo…' : 'Redo…');
  try {
    player.pause();
    to.push(hist.cur);
    await loadDoc(from.pop());
    if (S.step === 3) { for (const s of S.speakers) { const d = charOf(s); if (d) await stage.loadCharacter(d); } await applyLayers(); }
    render();
  } catch (e) { console.error(e); toast(`Could not ${dir < 0 ? 'undo' : 'redo'}: ${e.message}`); }
  b.done();
  hist.cur = docOf(); hist.curStr = JSON.stringify(hist.cur); hist.last = Date.now();
  hist.busy = false; updateHistoryButtons();
}
async function resetEverything() {
  if (!confirm('Clear the contents of this project? Other projects are preserved.')) return;
  S.ready = false; player?.pause();
  await resetAll();
  location.reload();
}
function headerTools() {
  hdrUndo = h('button', { class: 'btn sm ico', title: 'Undo (Ctrl+Z)', onclick: () => stepHistory(-1) }, '↶');
  hdrRedo = h('button', { class: 'btn sm ico', title: 'Redo (Ctrl+Y)', onclick: () => stepHistory(1) }, '↷');
  savedEl = h('span', { class: 'saved' });
  savedEl.classList.add('show');
  savedEl.textContent = 'Saved locally';
  queueMicrotask(updateHistoryButtons);
  const cloud = h('button', { class: 'btn sm', title: 'Save everything to your 12toons cloud', onclick: async () => {
    const b = busy('Saving to the cloud…');
    try { await tick(); const n = await pushAll((p) => b.set('Saving to the cloud…', p)); toast(n ? `Saved to the cloud (${n} new file${n > 1 ? 's' : ''}).` : 'Cloud is up to date.'); } catch (e) { toast(`Cloud: ${e.message}`); } finally { b.done(); }
  } }, '☁ Save');
  r2Configured().then((ok) => { if (!ok) cloud.hidden = true; });
  exportBtn = h('button', { class: 'btn ok', onclick: doExport }, '⬇ Export');
  return h('div', { class: 'hdr-tools' }, savedEl, cloud, hdrUndo, hdrRedo, h('button', { class: 'btn sm rst', title: 'Delete everything saved on this device', onclick: resetEverything }, '⟲ Reset'), exportBtn);
}
window.addEventListener('keydown', (e) => {
  if ($app.hidden || !(e.ctrlKey || e.metaKey) || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); stepHistory(-1); } else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); stepHistory(1); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) tick(); });

/* ---------------- main loop ---------------- */
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (S.step !== 3 || !stage.layers) return;
  if (S.exporting && !player.playing) return; // offline export drives the stage itself
  if (player.playing && player.time >= player.total && !S.exporting) { player.pause(); S.dirty = true; }
  const fv = S.tab === 'camera' && S.panelOpen && !S.camPeek;
  if (stage.fullView !== fv) { stage.fullView = fv; S.dirty = true; }
  if (!player.playing && !S.dirty) return;
  S.dirty = false;
  const t = player.time;
  try { stage.render(t, player.playing ? dt : 0, player.clips, shotPlan()); } catch (e) { console.error(e); }
  if (player.playing) followLine();
  updateSel(); updateCamBox();
  if (headEl) {
    const x = t * S.pps;
    headEl.style.left = `${x}px`;
    if (player.playing && tlScroll && (x < tlScroll.scrollLeft + 10 || x > tlScroll.scrollLeft + tlScroll.clientWidth - 40)) tlScroll.scrollLeft = Math.max(0, x - 40);
  }
  if (timeEl) timeEl.textContent = `${fmt(t)} / ${fmt(player.total)}`;
  if (playBtn) playBtn.textContent = player.playing ? '⏸ Pause' : '▶ Play';
}
window.addEventListener('keydown', (e) => { if (!$app.hidden && S.step === 3 && e.code === 'Space' && !['INPUT', 'SELECT'].includes(e.target.tagName)) { e.preventDefault(); togglePlay(); } });

if (location.search.includes("debug")) window.__toon = { S, get stage() { return stage; }, get player() { return player; } };

/* ---------------- entry points used by the 12toons shell ---------------- */
let booted = false, homeFn = null;
export const setHome = (fn) => { homeFn = fn; };
async function goHome() { if (S.exporting) { toast('Wait for the export to finish.'); return; } player?.pause(); try { await tick(); } catch { /* best effort */ } homeFn?.(); }
export async function openStudio() {
  $app.hidden = false;
  if (!booted) { booted = true; await boot(); } else { S.characters = await hydrateAll((await loadCharacters()).filter((c) => c.ske || c.base)); S.dirty = true; }       // characters may have been saved in the Character Studio meanwhile
  startAutoSync();
  S.ready = true;
}
export async function closeStudio() {
  while(saving)await new Promise(resolve=>setTimeout(resolve,20));
  await tick(); player?.pause(); $app.hidden = true; S.ready = false;
}
onSyncStatus(s => { if(savedEl){savedEl.textContent=s.text;savedEl.title=s.error;savedEl.classList.add('show');} });

