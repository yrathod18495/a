// Edits applied to a character's DragonBones skeleton JSON (never to the runtime objects), so the same result can be drawn live and baked into the saved character.
// xf: { "<slot>|<picture>": {dx, dy, s, rot} }   bones: { "<bone>": {dx, dy, s, rot} }
// dx / dy / rot are in the picture's own terms (y up, counter-clockwise); DragonBones is y down / clockwise, so those two are flipped here.

const has = (o) => o && (o.dx || o.dy || (o.s && o.s !== 1) || o.rot || (o.sv && o.sv !== 1));

/** setup-pose world matrices of the bones ({a, b, c, d, tx, ty}, DragonBones convention: x' = a x + c y + tx) */
export function worldMatrices(arm) {
  const W = new Map(), rad = Math.PI / 180;
  for (const b of arm.bone) {
    const t = b.transform || {}, sx = t.scX ?? 1, sy = t.scY ?? 1, kx = (t.skX || 0) * rad, ky = (t.skY || 0) * rad;
    const l = { a: Math.cos(ky) * sx, b: Math.sin(ky) * sx, c: -Math.sin(kx) * sy, d: Math.cos(kx) * sy, tx: t.x || 0, ty: t.y || 0 }, p = b.parent && W.get(b.parent);
    W.set(b.name, p ? { a: p.a * l.a + p.c * l.b, b: p.b * l.a + p.d * l.b, c: p.a * l.c + p.c * l.d, d: p.b * l.c + p.d * l.d, tx: p.a * l.tx + p.c * l.ty + p.tx, ty: p.b * l.tx + p.d * l.ty + p.ty } : l);
  }
  return W;
}

/** moves / scales / rotates one picture (image or mesh); `m` = world matrix of the slot's bone (weighted meshes keep world positions, the edit happens in the bone's own axes) */
function moveDisplay(a, e, m) {
  const o = { ...a }, sv = e.sv || 1, s = e.s || 1, rad = ((e.rot || 0) * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  if (a.type === 'image') {
    const t = a.transform || {};
    o.transform = { ...t, x: (t.x || 0) + (e.dx || 0), y: (t.y || 0) - (e.dy || 0), scX: (t.scX ?? 1) * s, scY: (t.scY ?? 1) * s * sv, skX: (t.skX || 0) - (e.rot || 0), skY: (t.skY || 0) - (e.rot || 0) };
    return o;
  }
  if (a.type !== 'mesh' || !a.vertices) return o;
  let v = a.vertices; const n = v.length / 2, weighted = !!a.weights;      // unweighted: slot-local points; weighted: setup positions (the bone-local points are derived from them)
  const det = m ? m.a * m.d - m.b * m.c || 1 : 1;
  if (weighted && m) { v = v.slice(); for (let i = 0; i < n; i++) { const x = v[i * 2] - m.tx, y = v[i * 2 + 1] - m.ty; v[i * 2] = (m.d * x - m.c * y) / det; v[i * 2 + 1] = (-m.b * x + m.a * y) / det; } }
  if (sv !== 1 && a.uvs) {       // the mesh gets longer / shorter along the picture's height (v) axis: its outline follows the art
    v = v.slice(); const uv = a.uvs; let mx = 0, my = 0, mv = 0;
    for (let i = 0; i < n; i++) { mx += v[i * 2]; my += v[i * 2 + 1]; mv += uv[i * 2 + 1]; }
    mx /= n; my /= n; mv /= n;
    let sx = 0, sy = 0, vv = 0;
    for (let i = 0; i < n; i++) { const dv = uv[i * 2 + 1] - mv; sx += (v[i * 2] - mx) * dv; sy += (v[i * 2 + 1] - my) * dv; vv += dv * dv; }
    const len = Math.hypot(sx, sy);
    if (vv > 1e-9 && len > 1e-9) {
      const ux = sx / len, uy = sy / len;
      for (let i = 0; i < n; i++) { const t = ((v[i * 2] - mx) * ux + (v[i * 2 + 1] - my) * uy) * (sv - 1); v[i * 2] += t * ux; v[i * 2 + 1] += t * uy; }
    }
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) { cx += v[i * 2]; cy += -v[i * 2 + 1]; }
  cx /= n || 1; cy /= n || 1;
  const out = v.slice();
  for (let i = 0; i < n; i++) {
    const px = (v[i * 2] - cx) * s, py = (-v[i * 2 + 1] - cy) * s;
    out[i * 2] = cx + px * cos - py * sin + (e.dx || 0);
    out[i * 2 + 1] = -(cy + px * sin + py * cos + (e.dy || 0));
  }
  if (weighted && m) for (let i = 0; i < n; i++) { const x = out[i * 2], y = out[i * 2 + 1]; out[i * 2] = m.a * x + m.c * y + m.tx; out[i * 2 + 1] = m.b * x + m.d * y + m.ty; }
  o.vertices = out;
  return o;
}

/** new skeleton JSON with the edits applied (unchanged parts are shared with the original) */
/** draw order: { "<slot>": steps }; positive steps bring the slot forward (drawn later, on top), negative send it back */
export function reorderSlots(slots, order = {}) {
  const list = slots.slice();
  for (const [name, steps] of Object.entries(order)) {
    const i = list.findIndex((s) => s.name === name), n = Math.trunc(Number(steps) || 0);
    if (i < 0 || !n) continue;
    const [slot] = list.splice(i, 1);
    list.splice(Math.max(0, Math.min(list.length, i + n)), 0, slot);
  }
  return list;
}
/**
 * A drag on the screen (a move of `wx`, `wy` armature units, y down) becomes the edit of one picture: the picture is moved in the axes of its slot's bone,
 * so it follows the mouse even where the bone is turned. Returns the {dx, dy} to ADD to the picture's edit (dy is "up", like the sliders).
 */
export function dragToEdit(arm, slotName, wx, wy) {
  const W = worldMatrices(arm), bone = arm.slot.find((s) => s.name === slotName)?.parent, m = (bone && W.get(bone)) || { a: 1, b: 0, c: 0, d: 1 };
  const det = m.a * m.d - m.b * m.c || 1;
  const lx = (m.d * wx - m.c * wy) / det, ly = (-m.b * wx + m.a * wy) / det;      // world -> the bone's own axes
  return { dx: lx, dy: -ly };
}
export function patchRig(ske, { xf = {}, bones = {}, attach = {}, order = {} } = {}) {
  const arm = ske.armature[0], out = { ...arm };
  if (Object.keys(order).length) out.slot = reorderSlots(arm.slot, order);
  if (Object.keys(attach).length) out.slot = out.slot.map((sl) => (sl.name in attach ? { ...sl, _defaultAtt: attach[sl.name] || null } : sl));      // which picture of a slot is shown ('' = none)
  if (Object.entries(bones).some(([, e]) => has(e))) {
    out.bone = arm.bone.map((b) => {
      const e = bones[b.name];
      if (!has(e)) return b;
      const t = b.transform || {};
      return { ...b, transform: { ...t, x: (t.x || 0) + (e.dx || 0), y: (t.y || 0) - (e.dy || 0), scX: (t.scX ?? 1) * (e.s || 1), scY: (t.scY ?? 1) * (e.s || 1), skX: (t.skX || 0) - (e.rot || 0), skY: (t.skY || 0) - (e.rot || 0) } };
    });
  }
  const xfs = Object.entries(xf).filter(([, e]) => has(e));
  if (xfs.length) {
    const W = worldMatrices(arm);
    out.skin = arm.skin.map((sk) => {
      let slots = null;
      for (const [key, e] of xfs) {
        const [slot, att] = key.split('|'), si = (slots || sk.slot).findIndex((x) => x.name === slot);
        if (si < 0) continue;
        const di = (slots || sk.slot)[si].display.findIndex((d) => d.name === att);
        if (di < 0) continue;
        slots ||= sk.slot.slice();
        const sl = slots[si], display = sl.display.slice(); display[di] = moveDisplay(sl.display[di], e, W.get(arm.slot.find((x) => x.name === slot)?.parent)); slots[si] = { ...sl, display };
      }
      return slots ? { ...sk, slot: slots } : sk;
    });
  }
  return { ...ske, armature: [out] };
}

/** the face profile (sliders) as bone + attachment edits for an 12toons-style head */
export const FACE = [
  { key: 'eyes', label: 'Eyes', icon: '👁', sliders: [['y', 'Up / down', -40, 40, 1, 0], ['gap', 'Distance', -25, 25, 1, 0], ['shift', 'Left / right', -40, 40, 1, 0], ['size', 'Size', 0.6, 1.6, 0.02, 1]] },
  { key: 'brows', label: 'Eyebrows', icon: '〰', sliders: [['y', 'Up / down', -40, 40, 1, 0], ['gap', 'Distance', -25, 25, 1, 0], ['shift', 'Left / right', -40, 40, 1, 0], ['tilt', 'Tilt', -25, 25, 1, 0], ['size', 'Size', 0.6, 1.6, 0.02, 1]] },
  { key: 'nose', label: 'Nose', icon: '👃', sliders: [['y', 'Up / down', -40, 40, 1, 0], ['shift', 'Left / right', -40, 40, 1, 0], ['size', 'Size', 0.6, 1.6, 0.02, 1]] },
  { key: 'lips', label: 'Lips', icon: '👄', sliders: [['y', 'Up / down', -40, 40, 1, 0], ['shift', 'Left / right', -40, 40, 1, 0], ['size', 'Size', 0.6, 1.6, 0.02, 1]] },
  { key: 'ears', label: 'Ears', icon: '👂', sliders: [['y', 'Up / down', -40, 40, 1, 0], ['gap', 'Distance', -25, 25, 1, 0], ['shift', 'Left / right', -40, 40, 1, 0], ['size', 'Size', 0.6, 1.6, 0.02, 1]] },
];
export const faceDefaults = () => Object.fromEntries(FACE.map((g) => [g.key, Object.fromEntries(g.sliders.map(([k, , , , , d]) => [k, d]))]));

/** names of the head pieces in an 12toons rig (bones for the parts that have one, attachments for the others) */
const HEAD = {
  eyes: { bones: { Eyeball_R: 1, Eyeball_L: -1 }, atts: [['White', 0], ['EB', 0], ['EB2', 0], ['EB3', 0], ['EB4', 0]] },
  brows: { bones: { Eyebrow_R_N: 1, Eyebrow_L_N: -1 }, atts: [] },
  nose: { bones: {}, atts: [['Nose', 0]] },
  lips: { bones: { 'Mouth/X': 0 }, atts: [] },
  ears: { bones: {}, atts: [['Ear_R', 1], ['Ear_L', -1]] },
};
export function faceEdits(profile, ske) {
  const arm = ske.armature[0], bones = {}, xf = {}, slotOf = (att) => arm.slot.find((s) => s.name === att || s.name === att.replace(/\d+$/, ''))?.name;
  const names = new Set(arm.bone.map((b) => b.name));
  for (const [grp, spec] of Object.entries(HEAD)) {
    const p = profile?.[grp]; if (!p) continue;
    const y = p.y || 0, gap = p.gap || 0, shift = p.shift || 0, size = p.size ?? 1, tilt = p.tilt || 0;
    for (const [b, side] of Object.entries(spec.bones)) if (names.has(b)) bones[b] = { dx: y, dy: side * gap + shift, s: size, rot: side * tilt };
    for (const [att, side] of spec.atts) {
      const slot = slotOf(att) || att;
      xf[`${slot}|${att}`] = { dx: y, dy: side * gap + shift, s: size, rot: 0 };
    }
  }
  return { bones, xf };
}


const mergeEdit = (a, b) => ({ dx: (a?.dx || 0) + (b?.dx || 0), dy: (a?.dy || 0) + (b?.dy || 0), s: (a?.s ?? 1) * (b?.s ?? 1), rot: (a?.rot || 0) + (b?.rot || 0), sv: (a?.sv ?? 1) * (b?.sv ?? 1) });
/** every edit the studio can make (face sliders, nudges, picture choice, outfit, hidden slots) as one list of skeleton edits */
export function editsOf(ske, { face, xf = {}, attach = {}, order = {} }) {
  const fe = faceEdits(face || faceDefaults(), ske), all = { ...fe.xf };
  for (const [k, e] of Object.entries(xf)) all[k] = mergeEdit(all[k], e);
  return { xf: all, bones: fe.bones, attach, order };
}
/** the finished skeleton of a character: the template skeleton + the profile (face, xf, attach, skins, hide), as a new object */
export function bakeSke(ske, { face, xf, attach, order, skins = null, hide = [] }) {
  const out = JSON.parse(JSON.stringify(patchRig(ske, editsOf(ske, { face, xf, attach, order })))), arm = out.armature[0], gone = new Set(hide);
  arm.skin = arm.skin.filter((k) => !skins || k.name === 'default' || skins.includes(k.name));
  for (const k of arm.skin) k.slot = k.slot.filter((sl) => !gone.has(sl.name));
  return out;
}
