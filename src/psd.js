// Layered PSD for the Character Studio: the layout of every picture of the current pose as its own named layer with a FIXED box (the box of the
// picture inside the rig's texture), and reading an edited PSD back in. (Exporting a PSD was removed with the editing tabs.)
import { readPsd } from 'ag-psd';

const GAP = 16, A_ARM = (38 * Math.PI) / 180, A_LEG = (7 * Math.PI) / 180;
const kindOf = (key) => (/^ARM_/.test(key) ? ['arm', key.slice(4)] : /^FOREARM_/.test(key) ? ['fore', key.slice(8)] : /^THIGH_/.test(key) || key === '2' ? ['thigh', key === '2' ? 'R' : key.slice(6)] : /^CALF_/.test(key) ? ['calf', key.slice(5)] : null);
const rot = (px, py, x, y, a) => ({ x: px + (x - px) * Math.cos(a) - (y - py) * Math.sin(a), y: py + (x - px) * Math.sin(a) + (y - py) * Math.cos(a) });

function shelf(items, x0, y0, width) {
  const pos = new Map(); let x = x0, y = y0, rowH = 0, maxX = x0;
  const groups = [...new Set(items.map((i) => i.group))];
  for (const g of groups) {
    if (x > x0) { y += rowH + GAP * 3; x = x0; rowH = 0; }
    for (const it of items.filter((i) => i.group === g)) {
      if (x + it.w > x0 + width && x > x0) { y += rowH + GAP; x = x0; rowH = 0; }
      pos.set(it.name, { x, y, w: it.w, h: it.h }); x += it.w + GAP; rowH = Math.max(rowH, it.h); maxX = Math.max(maxX, x);
    }
  }
  return { pos, W: maxX, H: y + rowH };
}

/**
 * items: [{name, key, group, w, h, slotIndex, panel, art, cb}]  (w,h = the layer's own box; art = centre {x,y} of the picture in the rig's set-up pose, y down;
 * cb = where the picture sits inside its box). The body is laid out like a puppet sheet in an A-pose: head cluster on top, torso, arms swung out, legs a little
 * apart with the shoes under them. Every picture keeps its fixed box; only its place changes. Swappable pictures (hands, mouths, brows ...) go in a grid below.
 * Deterministic: the same character gives the same plan on export and on import.
 * Returns {W, H, pos: Map(name -> {x, y, w, h}), figure: [name bottom->top], panels: Map(group -> [name])}
 */
export function planPsd(items) {
  const props = (i) => /Props|Head_Prop/.test(i.key || ''), isHead = (k) => /^(HEAD|Hair|Back_Hair|Bun_Hair|Hair_Part|Ear_|Earring|Nose|White|Eyeball|Beard)/.test(k || '');
  const fig = items.filter((i) => !i.panel && i.art && !props(i)).sort((a, b) => a.slotIndex - b.slotIndex), rest = items.filter((i) => !fig.includes(i));
  for (const i of rest) if (props(i)) i.group = 'Extras';
  const W = 2800, M = 160, Cx = W / 2, GAPY = 46, art = new Map();
  const heads = fig.filter((i) => isHead(i.key) && !i.kind), limbs = fig.filter((i) => i.kind), shoes = fig.filter((i) => /^SHOE_/.test(i.key || '')), torso = fig.filter((i) => !heads.includes(i) && !i.kind && !shoes.includes(i));
  const ext = (i, c) => ({ x0: c.x - i.cb.w / 2, x1: c.x + i.cb.w / 2, y0: c.y - i.cb.h / 2, y1: c.y + i.cb.h / 2 });
  // a cluster keeps the relative places of the rig's set-up pose; it is moved so that its top centre sits at (cx, top)
  const cluster = (list, cx, top) => {
    if (!list.length) return { h: 0, w: 0 };
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const i of list) { const e = ext(i, i.art); x0 = Math.min(x0, e.x0); x1 = Math.max(x1, e.x1); y0 = Math.min(y0, e.y0); y1 = Math.max(y1, e.y1); }
    const dx = cx - (x0 + x1) / 2, dy = top - y0;
    for (const i of list) art.set(i.name, { x: i.art.x + dx, y: i.art.y + dy });
    return { h: y1 - y0, w: x1 - x0 };
  };
  let y = M;
  // head pieces side by side (hair, ears, nose ... explode from the head) so each one is easy to see and edit
  const HEAD_ORDER = ['Back_Hair', 'HEAD', 'Hair', 'Hair_Part', 'Bun_Hair', 'Ear_L', 'Ear_R', 'Nose', 'Earring_L', 'Earring_R', 'White', 'Eyeball_L', 'Eyeball_R', 'Beard'];
  const hrank = (i) => { const n = HEAD_ORDER.indexOf(i.key); return n < 0 ? 99 : n; };
  const rows = []; let cur = [], cw = 0;
  for (const i of [...heads].sort((a, b) => hrank(a) - hrank(b))) { if (cw + i.cb.w > 1900 && cur.length) { rows.push(cur); cur = []; cw = 0; } cur.push(i); cw += i.cb.w + 40; }
  if (cur.length) rows.push(cur);
  let hy = y;
  for (const r of rows) {
    const rh = Math.max(...r.map((i) => i.cb.h)), rw = r.reduce((a, i) => a + i.cb.w + 40, -40); let x = Cx - rw / 2;
    for (const i of r) { art.set(i.name, { x: x + i.cb.w / 2, y: hy + rh - i.cb.h / 2 }); x += i.cb.w + 40; }
    hy += rh + 40;
  }
  y = hy + GAPY - 40;
  const torsoTop = y, tc = cluster(torso, Cx, y); y += tc.h + GAPY;
  const sideOf = (kind) => {
    const ups = limbs.filter((i) => i.kind[0] === kind).sort((a, b) => a.art.x - b.art.x), m = new Map();
    ups.forEach((u, n) => m.set(u.kind[1], ups.length > 1 ? (n === 0 ? -1 : 1) : /L$/.test(u.kind[1]) ? -1 : 1));
    if (ups.length > 1 && Math.abs(ups[0].art.x - ups[1].art.x) < 6) { m.set(ups[0].kind[1], /L$/.test(ups[0].kind[1]) ? -1 : 1); m.set(ups[1].kind[1], -m.get(ups[0].kind[1])); }
    return m;
  };
  const chain = (upper, lowers, pivotY, ang, halfGap) => {
    const side = sideOf(upper);
    for (const [sfx, sd] of side) {
      const up = limbs.find((i) => i.kind[0] === upper && i.kind[1] === sfx); if (!up) continue;
      const P = { x: Cx + sd * (tc.w / 2 + halfGap), y: pivotY }, a = -sd * ang;
      let off = 0; art.set(up.name, rot(P.x, P.y, P.x, P.y + up.cb.h / 2, a)); off = up.cb.h + 30;
      for (const lw of lowers) {
        const it = fig.find((i) => lw.test(i.key || '') && (lw.test('x') ? false : new RegExp(`_${sfx}$`).test(i.key || '')));
        if (!it) continue;
        art.set(it.name, rot(P.x, P.y, P.x, P.y + off + it.cb.h / 2, a)); off += it.cb.h + 30;
      }
    }
  };
  chain('arm', [/^FOREARM_/], torsoTop + 60, A_ARM, 12);
  chain('thigh', [/^CALF_/, /^SHOE_/], y, A_LEG, 24);
  // pictures that did not get a place (unknown kinds) join the grid
  const placed = fig.filter((i) => art.has(i.name)), loose = fig.filter((i) => !art.has(i.name));
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; const pos = new Map();
  for (const i of placed) { const c = art.get(i.name), e = ext(i, c); x0 = Math.min(x0, e.x0); x1 = Math.max(x1, e.x1); y0 = Math.min(y0, e.y0); y1 = Math.max(y1, e.y1); }
  for (const i of placed) { const c = art.get(i.name); pos.set(i.name, { x: Math.round(c.x - (i.cb.x + i.cb.w / 2)), y: Math.round(c.y - (i.cb.y + i.cb.h / 2)), w: i.w, h: i.h }); }
  const panel = [...rest, ...loose], figBottom = placed.length ? y1 : M;
  const order = (g) => (g === 'Extras' ? 2 : panel.filter((i) => i.group === g).length > 30 ? 1 : 0);
  panel.sort((a, b) => order(a.group) - order(b.group));
  const g = shelf(panel, M, figBottom + 140, W - 2 * M);
  for (const [n, p] of g.pos) pos.set(n, p);
  const panels = new Map(); for (const i of panel) (panels.get(i.group) || panels.set(i.group, []).get(i.group)).push(i.name);
  const names = placed.sort((a, b) => a.slotIndex - b.slotIndex).map((i) => i.name);
  return { W: Math.max(W, g.W + M), H: Math.round((panel.length ? g.H : figBottom) + M), pos, figure: names, panels };
}
export { kindOf };

/** reads the layers of a PSD: [{name, hidden, left, top, canvas|null}] (groups are walked, their names ignored) */
export async function readPsdLayers(file) {
  const psd = readPsd(await file.arrayBuffer(), { skipThumbnail: true, skipCompositeImageData: true });
  const out = [], walk = (list, hidden) => {
    for (const l of list || []) {
      const hid = hidden || !!l.hidden;
      if (l.children) walk(l.children, hid);
      else out.push({ name: l.name || '', hidden: hid, left: l.left || 0, top: l.top || 0, canvas: l.canvas || null });
    }
  };
  walk(psd.children, false);
  return { width: psd.width, height: psd.height, layers: out };
}
