import { friendlyError } from '../shared/hinglish-errors.js';
// Admin panel: decide which animation of which character users get to see.
// The rules are stored in Firestore config/animations ({ '*': [...], neha: [...], mybaby: [...] }) and applied in catalog.categoriesFor().
// A second page, "Layers", renames the Character Editor layers and switches them on / off for users (Firestore config/layers).
// The big preview plays the chosen animation on the real character, so the admin can judge it before showing it to users.
import { h } from './dom.js';
import { Stage } from './db/stage.js';
import { loadCatalog, libraryCharacters, fetchLibraryCharacter, categoriesFor, fetchAnimation, getAnimRules, setAnimRules, cdn, url as assetUrl } from './catalog.js';
import { saveAnimRules, loadAnimRules, saveLayerRules, loadLayerRules } from './cloud.js';
import { getLayerRules, setLayerRules, layerId } from './layerrules.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const fmt = (n) => (n ? `${(+n).toFixed(1)}s` : '—');

async function studioView({ user, home, toast }) {
  await loadCatalog();
  const entries = libraryCharacters().filter((e) => e.template);
  const chars = [...new Map(entries.map((e) => [e.charBase, { base: e.charBase, name: e.name, thumb: e.thumbnail, poses: entries.filter((x) => x.charBase === e.charBase) }])).values()];
  // working copy of the rules: Sets per scope ('*' = every character)
  const rules = new Map(Object.entries(getAnimRules() || {}).map(([k, v]) => [k, new Set(v.map(String))]));
  const set = (k) => { if (!rules.has(k)) rules.set(k, new Set()); return rules.get(k); };
  const lnames = clone(getLayerRules().names), lhidden = new Map(Object.entries(getLayerRules().hidden).map(([k, v]) => [k, new Set(v)]));
  const lset = (k) => { if (!lhidden.has(k)) lhidden.set(k, new Set()); return lhidden.get(k); };
  const st = { mode: 'anim', layers: [], groups: null, dirtyA: false, dirtyL: false, base: chars[0]?.base, pose: null, def: null, cats: [], scope: 'char', filter: 'all', q: '', cur: null, zoom: 'wide', dirty: false, busy: false, lastSaved: '', gen: 0, note: '' };
  const hidAll = (id) => set('*').has(String(id)), hidChar = (id) => set(st.base).has(String(id));
  const isHid = (id) => hidAll(id) || hidChar(id);
  const scopeKey = () => (st.scope === 'all' ? '*' : st.base);

  /* ---------- live preview (same stage the studio uses) ---------- */
  const stage = new Stage({ maxTex: 2048 });
  stage.setSize('4:5', 640);
  let t0 = performance.now(), raf = 0, loaded = false, lastFrame = 0;
  const root = h('div', { class: 'sh ad' });
  const loop = (now) => {
    if (!root.isConnected) { cancelAnimationFrame(raf); return; }
    raf = requestAnimationFrame(loop);
    if (!loaded || document.hidden || now - lastFrame < 33) return;
    lastFrame = now;
    try { stage.render(((now - t0) / 1000) % 8, 0.016, [], [{ start: 0, end: 1e9, speaker: 'c', type: st.zoom, focus: 'auto' }]); } catch (e) { console.warn(e); }
  };
  raf = requestAnimationFrame(loop);

  const flat = () => st.cats.flatMap((c) => c.animations.map((a) => ({ ...a, cat: c }))).filter(visibleInList);
  function visibleInList(a) {
    const off = isHid(a.ref.id);
    if (st.filter === 'shown' && off) return false;
    if (st.filter === 'hidden' && !off) return false;
    return !st.q || a.name.toLowerCase().includes(st.q) || String(a.ref.id).includes(st.q);
  }

  async function loadChar(base, poseKey) {
    const ch = chars.find((c) => c.base === base); if (!ch) return;
    const entry = ch.poses.find((p) => p.template.pose === poseKey) || ch.poses.find((p) => p.template.pose === 'front-side') || ch.poses[0];
    const my = ++st.gen; st.busy = true; st.base = base; st.pose = entry.template.pose; loaded = false; drawAll();
    try {
      const def = await fetchLibraryCharacter(entry);
      if (my !== st.gen) return;
      await stage.loadCharacter(def);
      st.def = def; st.cats = categoriesFor(def.rig, { all: true }); st.layers = await adminLayers(def);
      const withCat = st.cats.flatMap((c) => c.animations.map((a) => ({ ...a, cat: c })));
      const first = withCat.find((a) => !a.cat.overlay && /^idle/i.test(a.name)) || withCat[0];
      st.busy = false; drawAll();
      if (first) await play(first);
    } catch (e) { st.busy = false; toast(`Could not load the character: ${e.message}`); drawAll(); }
  }

  /** play an animation on the character (layer animations run on top of an idle body) */
  async function play(a) {
    if (!st.def) return;
    st.cur = a; st.note = ''; drawCaption(); markCur();
    const my = ++st.gen;
    try {
      const key = `a${a.ref.id}`, anims = { [key]: await fetchAnimation(a.ref.file) }, kind = a.ref.layer || 'body', clips = [];
      if (kind !== 'body') {
        const idle = st.cats.filter((c) => !c.overlay).flatMap((c) => c.animations).find((x) => /^idle/i.test(x.name));
        if (idle) { anims[`a${idle.ref.id}`] = await fetchAnimation(idle.ref.file); clips.push({ id: 'b', kind: 'body', name: `a${idle.ref.id}`, start: 0, dur: 36000, off: 0 }); }
      }
      clips.push({ id: 'a', kind, name: key, start: 0, dur: 36000, off: 0 });
      if (my !== st.gen) return;
      stage.setRig(st.def.id, st.def.ske);
      stage.setLayers([{ key: 'c', charId: st.def.id, anims, clips, flip: false, slot: 0, visible: true, xf: null, skins: st.def.skins, hide: [] }]);
      t0 = performance.now(); loaded = true;
    } catch (e) { st.note = 'A preview is not available for this animation (its file was not found). You can still show or hide it.'; loaded = false; drawCaption(); }
  }

  /* ---------- editing the rules ---------- */
  const mark = (kind = 'anim') => { if (kind === 'layers') st.dirtyL = true; else st.dirtyA = true; st.dirty = true; drawBar(); };
  function toggle(a) {
    const k = scopeKey(), s = set(k), id = String(a.ref.id);
    if (s.has(id)) s.delete(id); else s.add(id);
    mark(); drawList(); drawCaption();
  }
  function bulk(cat, hide) {
    const s = set(scopeKey());
    for (const a of cat.animations) { if (!visibleInList(a)) continue; const id = String(a.ref.id); if (hide) s.add(id); else s.delete(id); }
    mark(); drawList();
  }
  async function publish() {
    if (st.busy) return; st.busy = true; drawBar();
    try {
      let local = false;
      if (st.dirtyA) {
        const hidden = Object.fromEntries([...rules].map(([k, v]) => [k, [...v]]));
        const r = await saveAnimRules(hidden, user); local = r.local; setAnimRules({ hidden, at: r.at }); st.dirtyA = false; st.lastSaved = r.at;
      }
      if (st.dirtyL) {
        const r = await saveLayerRules({ names: lnames, hidden: Object.fromEntries([...lhidden].map(([k, v]) => [k, [...v]])) }, user);
        setLayerRules(r); st.dirtyL = false; st.lastSaved = r.at; local = !user || user.uid === 'debug';
      }
      st.dirty = false;
      toast(local ? 'Saved on this device (test mode).' : 'Published — changes are live for users.');
    } catch (e) { toast(e.code === 'permission-denied' ? 'You are not allowed to do this. Your email must be listed as an admin in Firestore rules.' : `Could not publish: ${friendlyError(e)}`); }
    st.busy = false; drawBar();
  }
  async function discard() {
    const [r, lr] = await Promise.all([loadAnimRules().catch(() => null), loadLayerRules().catch(() => null)]);
    rules.clear(); Object.entries(r?.hidden || {}).forEach(([k, v]) => rules.set(k, new Set(v.map(String))));
    for (const k of Object.keys(lnames)) delete lnames[k]; Object.assign(lnames, clone(lr?.names || {}));
    lhidden.clear(); Object.entries(lr?.hidden || {}).forEach(([k, v]) => lhidden.set(k, new Set(v)));
    st.dirty = st.dirtyA = st.dirtyL = false; drawAll();
  }

  /* ---------- the layers of a character (same list the Character Editor shows, all outfits together) ---------- */
  async function adminLayers(def) {
    if (!st.groups) { try { st.groups = await fetch(assetUrl('12toons/groups.json')).then((r) => r.json()); } catch { st.groups = []; } }
    const groupOf = new Map();
    for (const g of st.groups) for (const a of g.attachments) groupOf.set(a, g.name);
    const regions = new Set();
    for (const t of def.tex) for (const r of t.json.SubTexture) regions.add(r.name);
    const out = [], seen = new Set();
    for (const sk of def.ske.armature[0].skin) for (const sl of sk.slot) for (const a of sl.display) {
      const slot = sl.name, key = a.name;
      if (a.type !== 'image' && a.type !== 'mesh') continue;
      if (!regions.has(a.path || a.name)) continue;
      const id = layerId(slot, key); if (seen.has(id)) continue; seen.add(id);
      out.push({ id, slot, key, group: groupOf.get(key) || groupOf.get(key.replace(/\//g, '_')) || groupOf.get(slot) || (st.groups.length ? 'Other' : 'Parts') });
    }
    return out;
  }
  const lHid = (id) => lset('*').has(id) || lset(st.base).has(id);
  const nameIn = (k, id) => lnames[k]?.[id] || '';
  const setName = (id, v) => { const k = scopeKey(); (lnames[k] ||= {})[id] = v.trim(); if (!v.trim()) delete lnames[k][id]; mark('layers'); };
  const shownName = (id, fallback) => (st.scope === 'all' ? nameIn('*', id) : nameIn(st.base, id) || nameIn('*', id)) || fallback;

  /* ---------- drawing ---------- */
  const capEl = h('div', { class: 'ad-cap' }), stageBox = h('div', { class: 'cs-stage ad-stage' }, stage.out), barEl = h('div', { class: 'ad-bar' }), listEl = h('div', { class: 'ad-list' }), topEl = h('div', { class: 'ad-top' });
  function drawCaption() {
    if (st.mode === 'layers') { capEl.replaceChildren(h('div', { class: 'ad-capname' }, h('b', {}, 'Character Editor layers'), h('small', {}, 'Rename a layer (users see your name) and switch it on or off. Off = users do not see that layer in their list; the picture stays on the character.'))); return; }
    const a = st.cur;
    if (!a) { capEl.replaceChildren(h('p', { class: 'hint' }, st.busy ? 'Loading the character…' : 'Pick an animation to see it on the character.')); return; }
    const hid = isHid(a.ref.id), byAll = hidAll(a.ref.id);
    const all = flat(), i = all.findIndex((x) => x.ref.id === a.ref.id);
    const step = (d) => { if (all.length) play(all[(i + d + all.length) % all.length]); };
    capEl.replaceChildren(...[
      h('div', { class: 'ad-capname' }, h('b', {}, a.name), h('small', {}, `${a.cat?.name || ''} · ${fmt(a.length)} · id ${a.ref.id}${a.ref.layer ? ' · layer on top of an idle body' : ''}`)),
      st.note ? h('p', { class: 'hint', style: 'color:#b45309' }, st.note) : null,
      h('div', { class: 'ad-capbtns' },
        h('button', { class: 'btn sm', onclick: () => step(-1), disabled: !all.length }, '‹ Prev'),
        h('button', { class: `btn ${hid ? '' : 'ok'}`, onclick: () => toggle(a) }, hid ? (byAll && st.scope !== 'all' ? '🚫 Hidden for everyone' : '🚫 Hidden — show it') : '👁 Shown — hide it'),
        h('button', { class: 'btn sm', onclick: () => step(1), disabled: !all.length }, 'Next ›')),
      h('div', { class: 'seg3', style: 'margin-top:8px' }, [['wide', 'Full'], ['medium', 'Upper body'], ['close', 'Face']].map(([k, l]) => h('button', { class: st.zoom === k ? 'on' : '', onclick: () => { st.zoom = k; drawCaption(); } }, l)))].filter(Boolean));
  }
  function markCur() { listEl.querySelectorAll('.ad-card').forEach((c) => c.classList.toggle('cur', st.cur && c.dataset.id === String(st.cur.ref.id))); }
  function drawTop() {
    const ch = chars.find((c) => c.base === st.base);
    topEl.replaceChildren(
      h('div', { class: 'seg3 ad-mode' }, [['anim', '🎬 Animations'], ['layers', '🧩 Layers']].map(([k, l]) => h('button', { class: st.mode === k ? 'on' : '', onclick: () => { st.mode = k; drawAll(); } }, l))),
      h('div', { class: 'ad-row' }, chars.map((c) => h('button', { class: `ad-char ${c.base === st.base ? 'on' : ''}`, onclick: () => c.base !== st.base && loadChar(c.base, st.pose) },
        c.thumb ? h('img', { src: cdn(c.thumb), alt: '' }) : '🎭', h('span', {}, c.name, h('small', {}, `${c.poses.length} poses`))))),
      h('div', { class: 'ad-row' },
        h('label', { class: 'ad-sel' }, 'Pose', h('select', { onchange: (e) => loadChar(st.base, e.target.value) }, (ch?.poses || []).map((p) => h('option', { value: p.template.pose, selected: p.template.pose === st.pose }, p.pose)))),
        h('div', { class: 'seg3' }, [['char', `Only ${ch?.name || 'this character'}`], ['all', 'Every character']].map(([k, l]) => h('button', { class: st.scope === k ? 'on' : '', title: 'Who your Show / Hide changes apply to', onclick: () => { st.scope = k; drawAll(); } }, l)))),
      h('div', { class: 'ad-row' },
        h('input', { type: 'search', class: 'ad-search', placeholder: 'Search by name or id…', value: st.q, oninput: (e) => { st.q = e.target.value.trim().toLowerCase(); drawList(); } }),
        h('div', { class: 'seg3' }, [['all', 'All'], ['shown', 'Shown'], ['hidden', 'Hidden']].map(([k, l]) => h('button', { class: st.filter === k ? 'on' : '', onclick: () => { st.filter = k; drawTop(); drawList(); } }, l)))),
      h('p', { class: 'hint', style: 'text-align:left;margin:0' }, st.scope === 'all' ? (st.mode === 'layers' ? '🌐 Your names and Show / Hide apply to every character.' : '🌐 Your Show / Hide applies to every character.') : `👤 Your Show / Hide applies to ${ch?.name || 'this character'} only. (🌐 = hidden for everyone — change that with "Every character".)`));
  }
  function drawList() {
    if (st.mode === 'layers') { drawLayerList(); return; }
    if (st.busy && !st.def) { listEl.replaceChildren(h('p', { class: 'hint' }, 'Loading…')); return; }
    const out = [], total = st.cats.reduce((n, c) => n + c.animations.length, 0), hiddenN = st.cats.reduce((n, c) => n + c.animations.filter((a) => isHid(a.ref.id)).length, 0);
    out.push(h('p', { class: 'hint', style: 'text-align:left;margin:0 0 8px' }, `${total - hiddenN} shown · ${hiddenN} hidden · ${total} animations in this pose`));
    for (const c of st.cats) {
      const items = c.animations.filter(visibleInList);
      if (!items.length) continue;
      out.push(h('div', { class: 'ad-cat' },
        h('div', { class: 'ad-cathead' }, h('b', {}, c.name), h('small', {}, `${items.length}`), h('span', { class: 'sp' }),
          h('button', { class: 'btn sm', onclick: () => bulk(c, false) }, 'Show all'), h('button', { class: 'btn sm', onclick: () => bulk(c, true) }, 'Hide all')),
        h('div', { class: 'ad-grid' }, items.map((a) => {
          const hid = isHid(a.ref.id), byAll = hidAll(a.ref.id);
          return h('div', { class: `ad-card ${hid ? 'off' : ''} ${st.cur && st.cur.ref.id === a.ref.id ? 'cur' : ''}`, 'data-id': String(a.ref.id), onclick: () => play({ ...a, cat: c }) },
            h('div', { class: 'ad-cn' }, a.name), h('small', {}, `${fmt(a.length)} · ${a.ref.id}`),
            h('button', { class: 'ad-eye', title: hid ? 'Hidden from users — click to show' : 'Shown to users — click to hide', onclick: (e) => { e.stopPropagation(); toggle({ ...a, cat: c }); } }, hid ? (byAll ? '🌐🚫' : '🚫') : '👁'));
        }))));
    }
    if (out.length === 1) out.push(h('p', { class: 'hint' }, 'Nothing matches.'));
    listEl.replaceChildren(...out);
  }
  function drawLayerList() {
    if (st.busy && !st.def) { listEl.replaceChildren(h('p', { class: 'hint' }, 'Loading…')); return; }
    const q = st.q, byGroup = new Map();
    for (const l of st.layers) {
      const hid = lHid(l.id);
      if (st.filter === 'shown' && hid) continue;
      if (st.filter === 'hidden' && !hid) continue;
      if (q && !l.key.toLowerCase().includes(q) && !shownName(l.id, '').toLowerCase().includes(q) && !l.group.toLowerCase().includes(q)) continue;
      (byGroup.get(l.group) || byGroup.set(l.group, []).get(l.group)).push(l);
    }
    const hiddenN = st.layers.filter((l) => lHid(l.id)).length, out = [h('p', { class: 'hint', style: 'text-align:left;margin:0 0 8px' }, `${st.layers.length - hiddenN} shown · ${hiddenN} hidden · ${st.layers.length} layers`)];
    const bulkL = (rows, hide) => { const sset = lset(scopeKey()); for (const l of rows) { if (hide) sset.add(l.id); else sset.delete(l.id); } mark('layers'); drawLayerList(); };
    const order = [...(st.groups || []).map((g) => g.name), 'Other', 'Parts'].filter((g, i, a) => byGroup.has(g) && a.indexOf(g) === i);
    for (const g of order) {
      const rows = byGroup.get(g), gid = `@${g}`;
      out.push(h('div', { class: 'ad-cat' },
        h('div', { class: 'ad-cathead' }, h('b', {}, g), h('input', { class: 'ad-name grp', type: 'text', value: nameIn(scopeKey(), gid), placeholder: shownName(gid, 'Group name'), title: 'Group name users see', onchange: (e) => setName(gid, e.target.value) }),
          h('small', {}, `${rows.length}`), h('span', { class: 'sp' }), h('button', { class: 'btn sm', onclick: () => bulkL(rows, false) }, 'Show all'), h('button', { class: 'btn sm', onclick: () => bulkL(rows, true) }, 'Hide all')),
        h('div', { class: 'ad-lrows' }, rows.map((l) => {
          const hid = lHid(l.id), byAll = lset('*').has(l.id);
          return h('div', { class: `ad-lrow ${hid ? 'off' : ''}` },
            h('div', { class: 'ad-lorig', title: `${l.slot} / ${l.key}` }, h('b', {}, l.key), h('small', {}, l.slot !== l.key ? l.slot : '')),
            h('input', { class: 'ad-name', type: 'text', value: nameIn(scopeKey(), l.id), placeholder: shownName(l.id, l.key), title: 'Name users see for this layer', onchange: (e) => setName(l.id, e.target.value) }),
            h('button', { class: 'ad-eye static', title: hid ? 'Hidden from users — click to show' : 'Shown to users — click to hide', onclick: () => { const sset = lset(scopeKey()); if (sset.has(l.id)) sset.delete(l.id); else sset.add(l.id); mark('layers'); drawLayerList(); } }, hid ? (byAll ? '🌐🚫' : '🚫') : '👁'));
        }))));
    }
    if (out.length === 1) out.push(h('p', { class: 'hint' }, 'Nothing matches.'));
    listEl.replaceChildren(...out);
  }
  function drawBar() {
    barEl.replaceChildren(
      h('span', { class: 'ad-state' }, st.dirtyA || st.dirtyL ? '● Unpublished changes' : st.lastSaved ? `✓ Published ${new Date(st.lastSaved).toLocaleTimeString()}` : '✓ Up to date'),
      h('span', { class: 'sp' }),
      h('button', { class: 'btn', disabled: !(st.dirtyA || st.dirtyL) || st.busy, onclick: discard }, '↺ Discard'),
      h('button', { class: 'btn ok', disabled: !(st.dirtyA || st.dirtyL) || st.busy, onclick: publish }, '☁ Publish to users'));
  }
  function drawAll() { drawTop(); drawList(); drawCaption(); drawBar(); }

  root.append(
    h('div', { class: 'cs-body ad-body' },
      h('div', { class: 'cs-left' }, stageBox, capEl),
      h('div', { class: 'cs-right ad-right' }, topEl, listEl, barEl)));
  root.dispose = () => { cancelAnimationFrame(raf); };
  drawAll();
  if (chars.length) loadChar(chars[0].base, 'front-side');
  return root;
}

export async function view(context) {
  const { dashboardView } = await import('./admin-dashboard.js');
  return dashboardView({ ...context, openStudio: () => studioView(context) });
}

