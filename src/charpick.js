// Character picker shared by the Character Studio and the animation studio:
// one card per character (full-body picture + name); tapping a character opens its poses (front, side, back ...), each as a full-body picture.
import { h } from './dom.js';
import { cdn } from './catalog.js';

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
export function characterPicker({ entries, isOn, onPick }) {
  const groups = groupByCharacter(entries), root = h('div', { class: 'cp' });
  let open = groups.find((g) => g.poses.some(isOn))?.base ?? null;
  const draw = () => {
    const cur = groups.find((g) => g.base === open);
    root.replaceChildren(...[
      h('div', { class: 'cp-row' }, groups.map((g) => h('button', { class: `cp-card ${g.base === open ? 'open' : ''} ${g.poses.some(isOn) ? 'on' : ''}`, onclick: () => { open = open === g.base ? null : g.base; draw(); } },
        h('span', { class: 'cp-img' }, h('img', { src: cdn(g.cover), alt: '', loading: 'lazy' })), h('b', {}, g.name)))),
      cur ? h('div', { class: 'cp-poses' }, h('p', { class: 'cp-hint' }, `${cur.name} — choose a pose`),
        h('div', { class: 'cp-row' }, cur.poses.map((e) => h('button', { class: `cp-card pose ${isOn(e) ? 'on' : ''}`, onclick: () => onPick(e) },
          h('span', { class: 'cp-img' }, h('img', { src: cdn(e.thumbnail), alt: '', loading: 'lazy' })), h('small', {}, e.pose))))) : null].filter(Boolean));
  };
  draw();
  return root;
}
