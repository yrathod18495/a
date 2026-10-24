import { retimeAnimation } from '../managed-animation.js';
// DragonBones data preparation (pure JSON, no runtime): merge the outfits (skins) a character wears into one skin, and bind animations
// (stored by bone / slot / picture NAME, see scripts/spine_to_dragonbones.py) to the armature that will play them.

/** all skins listed in `skins` (and 'default') merged in rig order, later wins; the result has one skin called 'all' */
export function prepareArmature(ske, skins = null) {
  const arm = ske.armature[0], use = (arm.skin || []).filter((k) => !skins || k.name === 'default' || skins.includes(k.name));
  const bySlot = new Map();
  for (const k of use) for (const s of k.slot) {
    let m = bySlot.get(s.name); if (!m) bySlot.set(s.name, m = new Map());
    for (const d of s.display) m.set(d.name, d);
  }
  const disp = new Map(), slotsOut = [];
  for (const [name, m] of bySlot) { const list = [...m.values()]; slotsOut.push({ name, display: list }); disp.set(name, new Map(list.map((d, i) => [d.name, i]))); }
  const slot = arm.slot.map((s) => {
    const { _defaultAtt, ...rest } = s, idx = '_defaultAtt' in s ? disp.get(s.name)?.get(_defaultAtt) : s.displayIndex;     // plain DragonBones files keep their own index
    return { ...rest, displayIndex: idx ?? -1 };
  });
  // Spine "skin required" constraints (physics / transform) are only switched on by the skins that list them
  const active = { physics: new Set(), transform: new Set() };
  for (const k of use) { for (const n of k._physics || []) active.physics.add(n); for (const n of k._transform || []) active.transform.add(n); }
  const out = { ...arm, slot, skin: [{ name: 'all', slot: slotsOut }], animation: [...(arm.animation || [])] };
  return { active, ske: { ...ske, armature: [out] }, arm: out, disp, bones: new Set(arm.bone.map((b) => b.name)), slotIndex: new Map(arm.slot.map((s, i) => [s.name, i])) };
}

const weightedLen = (d) => { let n = 0, i = 0; const w = d.weights; for (let v = 0; v < w.length;) { const c = w[v]; n += c * 2; v += 1 + c * 2; i++; } return n; };
const meshLen = (d) => (d.weights ? weightedLen(d) : d.vertices.length);

/** one name-based animation -> DragonBones animation for this prepared armature (frames for missing bones / slots / pictures are dropped) */
export function bindAnimation(p, name, a) {
  a = retimeAnimation(a, p.arm.frameRate || p.ske.frameRate || 24);
  const out = { name, duration: a.duration, playTimes: 0, bone: (a.bone || []).filter((b) => p.bones.has(b.name)), slot: [] };
  for (const s of a.slot || []) {
    const map = p.disp.get(s.name), si = p.arm.slot.find((x) => x.name === s.name);
    if (!map || !si) continue;
    const e = { name: s.name };
    if (s.displayFrame) e.displayFrame = s.displayFrame.map((f) => ({ duration: f.duration, value: f._setup ? si.displayIndex : f.displayName ? (map.get(f.displayName) ?? -1) : -1 }));
    if (s.colorFrame) e.colorFrame = s.colorFrame;
    out.slot.push(e);
  }
  const ffd = [];
  for (const f of a.ffd || []) {
    const m = p.disp.get(f.slot)?.get(f.name); if (m == null) continue;
    const d = p.arm.skin[0].slot.find((x) => x.name === f.slot).display[m];
    if (d.type !== 'mesh' || f.frame[0].vertices.length !== meshLen(d)) continue;
    ffd.push({ name: f.name, slot: f.slot, skin: 'all', frame: f.frame });
  }
  if (ffd.length) out.ffd = ffd;
  if (a.zOrder) {
    const frame = a.zOrder.frame.map((f) => {
      const z = []; for (const [sl, off] of f.zOrderByName) { const i = p.slotIndex.get(sl); if (i != null) z.push(i, off); }
      return z.length ? { duration: f.duration, zOrder: z } : { duration: f.duration };
    });
    out.zOrder = { frame };
  }
  return out;
}

/** the DragonBones JSON to feed to `factory.parseDragonBonesData` with the given animations ({name: nameBasedAnimation}) added */
export function assemble(p, anims) {
  const arm = { ...p.arm, animation: [...p.arm.animation, ...Object.entries(anims || {}).map(([n, a]) => bindAnimation(p, n, a))] };
  return { ...p.ske, armature: [arm] };
}
