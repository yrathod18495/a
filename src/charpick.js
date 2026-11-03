// Character picker shared by the Character Editor and the animation studio:
// one card per character (full-body picture + name); tapping a character opens its poses (front, side, back ...), each as a full-body picture.
import { h } from './dom.js';
import { cdn, libraryStatus } from './catalog.js';

/** 12toons entries grouped by character, front poses first: [{ base, name, cover, poses:[entry] }] */
export function groupByCharacter(entries) {
  const order = ['front-side', 'front', 'side', 'back', 'back-2'], byBase = new Map();
  for (const e of entries.filter((x) => x.template)) {
    if (!byBase.has(e.charBase)) byBase.set(e.charBase, { base: e.charBase, name: e.name, poses: [] });
    byBase.get(e.charBase).poses.push(e);
  }
  for (const g of byBase.values()) {
    g.poses.sort((a, b) => order.indexOf(a.template.pose) - order.indexOf(b.template.pose));
    g.cover = (g.poses.find((p) => p.template.pose === 'front-side') || g.poses[0]).thumbnail;
  }
  return [...byBase.values()];
}

/**
 * @param entries    library entries (only the 12toons ones are shown here)
 * @param isOn       (entry) => bool   which pose is the current one
 * @param onPick     (entry) => void   a pose was tapped
 */
export function characterPicker({ entries, isOn, onPick, steps = false }) {
  if (steps) return stepPicker({ entries, isOn, onPick });
  const groups = groupByCharacter(entries), root = h('div', { class: 'cp' });
  let open = groups.find((g) => g.poses.some(isOn))?.base ?? null;
  const draw = () => {
    const cur = groups.find((g) => g.base === open);
    root.replaceChildren(...[
      !groups.length && libraryStatus() ? h('p', { class: 'cp-hint', role: 'alert' }, libraryStatus()) : null,
      h('div', { class: 'cp-row' }, groups.map((g) => h('button', { class: `cp-card ${g.base === open ? 'open' : ''} ${g.poses.some(isOn) ? 'on' : ''}`, onclick: () => { open = open === g.base ? null : g.base; draw(); } },
        h('span', { class: 'cp-img' }, h('img', { src: cdn(g.cover), alt: '', loading: 'lazy' })), h('b', {}, g.name)))),
      cur ? h('div', { class: 'cp-poses' }, h('p', { class: 'cp-hint' }, `${cur.name} — choose a pose`),
        h('div', { class: 'cp-row' }, cur.poses.map((e) => h('button', { class: `cp-card pose ${isOn(e) ? 'on' : ''}`, onclick: () => onPick(e) },
          h('span', { class: 'cp-img' }, h('img', { src: cdn(e.thumbnail), alt: '', loading: 'lazy' })), h('small', {}, e.pose))))) : null].filter(Boolean));
  };
  draw();
  return root;
}

/**
 * The same picker as two pages with Prev / Next on both: page 1 = the characters, page 2 = the poses of the chosen character
 * (the chosen character stays at the top). Next on page 2 confirms the pose; a character that is already in use opens on its pose.
 */
function stepPicker({ entries, isOn, onPick }) {
  const groups = groupByCharacter(entries), root = h('div', { class: 'cp cp-steps' });
  const current = groups.find((g) => g.poses.some(isOn));
  const st = { step: 1, base: current?.base ?? null, pose: current?.poses.find(isOn) ?? null };
  const group = () => groups.find((g) => g.base === st.base) || null;
  const go = (step) => { st.step = step; draw(); };
  const chooseBase = (g) => { if (st.base !== g.base) { st.base = g.base; st.pose = g.poses.find((p) => p.template.pose === 'front-side') || g.poses[0]; } draw(); };
  const stepBar = h('div', { class: 'cp-stepbar', role: 'tablist', 'aria-label': 'Steps' });
  const draw = () => {
    const g = group();
    stepBar.replaceChildren(...[['1', 'Character', 1], ['2', 'Pose', 2]].map(([n, label, step]) => h('button', { type: 'button', role: 'tab', class: `cp-step${st.step === step ? ' on' : ''}`, 'aria-selected': String(st.step === step), disabled: step === 2 && !g, onclick: () => go(step) }, h('i', {}, n), label)));
    const page = st.step === 1
      ? h('div', { class: 'cp-page cp-page-characters' },
        !groups.length && libraryStatus() ? h('p', { class: 'cp-hint', role: 'alert' }, libraryStatus()) : h('p', { class: 'cp-hint' }, 'Choose a character'),
        h('div', { class: 'cp-row' }, groups.map((c) => h('button', { type: 'button', class: `cp-card ${c.base === st.base ? 'on' : ''}`, 'aria-pressed': String(c.base === st.base), onclick: () => chooseBase(c) },
          h('span', { class: 'cp-img' }, h('img', { src: cdn(c.cover), alt: '', loading: 'lazy' })), h('b', {}, c.name)))))
      : h('div', { class: 'cp-page cp-page-poses' },
        h('div', { class: 'cp-chosen' }, h('span', { class: 'cp-chosen-img' }, h('img', { src: cdn(g.cover), alt: '' })), h('div', {}, h('small', {}, 'Character'), h('b', {}, g.name))),
        h('p', { class: 'cp-hint' }, 'Choose a pose'),
        h('div', { class: 'cp-poses' }, h('div', { class: 'cp-row' }, g.poses.map((e) => h('button', { type: 'button', class: `cp-card pose ${st.pose === e ? 'on' : ''}`, 'aria-pressed': String(st.pose === e), onclick: () => { st.pose = e; draw(); } },
          h('span', { class: 'cp-img' }, h('img', { src: cdn(e.thumbnail), alt: '', loading: 'lazy' })), h('small', {}, e.pose))))));
    const prev = h('button', { type: 'button', class: 'btn cp-prev', disabled: st.step === 1, onclick: () => go(1) }, '‹ Prev');
    const next = h('button', { type: 'button', class: 'btn pri cp-next', disabled: st.step === 1 ? !g : !st.pose, onclick: () => { if (st.step === 1) go(2); else onPick(st.pose); } }, 'Next ›');
    root.replaceChildren(stepBar, page, h('div', { class: 'cp-nav' }, prev, next));
  };
  draw();
  return root;
}
