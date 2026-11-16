// A small stand-alone page that plays a character with the studio's own renderer. It is built into public/character-viewer.js
// (npm run build:viewer) and the admin screen puts it, together with the character's data, into one HTML file ("Download HTML").
import { Stage } from './db/stage.js';
import { rigInfo } from './db/info.js';

const layerFor = (def, name, anim, length) => ({ key: 'c', charId: def.id, skins: null, swap: null, anims: name ? { [name]: anim } : {}, clips: name ? [{ id: 'a', kind: 'body', name, start: 0, dur: length, off: 0 }] : [], present: null, flip: false, xf: null, mask: null, maskKeys: [], maskFollow: '', slot: 0, visible: true, keys: [] });
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter(Boolean)); return e; };

window.startCharacterViewer = async function startCharacterViewer(data, root = document.body) {
  const stage = new Stage({ maxTex: 2048 }); stage.setSize('1:1', 720); stage.fullView = false;
  const st = { view: 0, index: 0, playing: true, time: 0, speed: 1, defs: new Map() };
  const views = data.views, status = el('p', { className: 'cv-status' }, 'Loading…');
  const viewSel = el('select', { onchange: () => { st.view = +viewSel.value; st.index = 0; fillAnimations(); show(); } }, ...views.map((v, i) => el('option', { value: i, textContent: v.label })));
  const animSel = el('select', { onchange: () => { st.index = +animSel.value; show(); } });
  const info = el('small', { className: 'cv-info' });
  const playBtn = el('button', { type: 'button', onclick: () => { st.playing = !st.playing; playBtn.textContent = st.playing ? '❚❚ Pause' : '▶ Play'; } }, '❚❚ Pause');
  const step = (d) => { const n = views[st.view].animations.length; if (!n) return; st.index = (st.index + d + n) % n; animSel.value = st.index; show(); };
  const speed = el('input', { type: 'range', min: 0.25, max: 2, step: 0.05, value: 1, oninput: () => { st.speed = +speed.value; } });
  root.append(
    el('header', {}, el('strong', {}, data.name), el('span', {}, `${views.length} view${views.length === 1 ? '' : 's'} · exported ${data.exportedAt?.slice(0, 10) || ''}`)),
    el('main', {}, el('div', { className: 'cv-stage' }, stage.out, status), el('aside', {},
      el('label', {}, 'View', viewSel), el('label', {}, 'Animation', animSel), info,
      el('div', { className: 'cv-row' }, el('button', { type: 'button', onclick: () => step(-1) }, '‹ Prev'), playBtn, el('button', { type: 'button', onclick: () => step(1) }, 'Next ›')),
      el('label', {}, 'Speed', speed))));
  const fillAnimations = () => { animSel.replaceChildren(...views[st.view].animations.map((a, i) => el('option', { value: i, textContent: `${a.label || a.name}${a.layer === 'hand' ? ' (arms)' : ''}` }))); animSel.value = st.index; };
  fillAnimations();
  const toBlob = async (url) => (await fetch(url)).blob();
  async function defOf(v) {
    if (st.defs.has(v.id)) return st.defs.get(v.id);
    const tex = await Promise.all(v.tex.map(async (t) => ({ json: t.json, image: await toBlob(t.image) })));
    const def = { id: `view-${v.id}`, name: data.name, ske: v.ske, tex, rig: rigInfo(v.ske), anims: [] };
    for (const [id, other] of st.defs) { stage.unload(other.id); st.defs.delete(id); }
    st.defs.set(v.id, def); await stage.loadCharacter(def); return def;
  }
  let job = 0;
  async function show() {
    const my = ++job, v = views[st.view], a = v.animations[st.index];
    info.textContent = a ? `${a.group || ''} · ${a.length.toFixed(1)} s · ${st.index + 1} / ${v.animations.length}` : 'No animations';
    try {
      const def = await defOf(v); if (my !== job) return;
      const anim = a && (a.json && a.json.bone ? a.json : Object.values(a.json)[0]);
      stage.setLayers([layerFor(def, a?.name, anim, a?.length || 1)]); st.time = 0; status.textContent = '';
    } catch (e) { status.textContent = `This animation could not be shown: ${e.message}`; }
  }
  let last = performance.now();
  const tick = (now) => {
    requestAnimationFrame(tick);
    const a = views[st.view].animations[st.index], dt = Math.min(0.1, (now - last) / 1000) * st.speed; last = now;
    if (st.playing && a) st.time = (st.time + dt) % a.length;
    try { stage.render(st.time, st.playing ? dt : 0, [], []); } catch { /* the next frame tries again */ }
  };
  await show(); requestAnimationFrame(tick);
};
