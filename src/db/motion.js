// Motion that is not in the animations: body proportions (leg / arm / hand length) and hair / cloth physics, written onto
// DragonBones bone offsets after the pose of the frame was evaluated. Works on any armature: limbs are found from the skeleton's shape.
import { detectLimbs, applyMap, isDefaultFit } from '../universal.js';
import { Physics, chainsOf } from './physics.js';

const limbCache = new WeakMap();
/** limbs of an armature in its setup pose (y-up bones, as detectLimbs wants them) */
export function limbsFromArmature(arm, prep) {
  if (limbCache.has(prep)) return limbCache.get(prep);
  const bones = arm.getBones().map((b) => {
    const m = b.globalTransformMatrix, L = b.boneData.length, len = L * Math.hypot(m.a, m.b);
    return { name: b.name, parent: b.parent ? b.parent.name : null, len, x: m.tx, y: -m.ty, tx: m.tx + m.a * L, ty: -(m.ty + m.b * L) };
  });
  const ik = (prep.arm.ik || []).map((c) => {
    const names = []; let b = arm.getBone(c.bone);
    for (let i = 0; i <= (c.chain || 0) && b; i++) { names.unshift(b.name); b = b.parent; }
    return { bones: names, target: c.target };
  });
  const out = { bones, ik, limbs: detectLimbs(bones, ik) };
  limbCache.set(prep, out);
  return out;
}

const norm = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const IDENT = (o) => o.x === 0 && o.y === 0 && o.rotation === 0 && o.skew === 0 && o.scaleX === 1 && o.scaleY === 1;

export class Motion {
  constructor(arm, prep, fit, found) {
    this.arm = arm; this.prep = prep; this.fit = fit; this.found = found; this.bones = arm.getBones();
    this.setFit(fit);
    this.phys = new Physics(arm, chainsOf(prep, { auto: fit?.phys !== false, limbs: applyMap(found.limbs, fit?.map, found.bones) }));
    // transform constraints of the source rig (a bone follows another one's rotation / position by some mix)
    this.tc = (prep.arm._transform || []).filter((c) => (!c.skin || prep.active.transform.has(c.name)) && arm.getBone(c.target) && (c.mixRotate || c.mixX || c.mixY)).map((c) => ({ ...c, target: arm.getBone(c.target), bones: c.bones.map((n) => arm.getBone(n)).filter(Boolean) })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
  /** applies the transform constraints (needs the matrices of the pose); true when something moved, so the caller updates the armature again */
  constrain() {
    let moved = false;
    for (const c of this.tc) {
      const T = c.target.globalTransformMatrix, trot = Math.atan2(T.b, T.a) - (c.rotation || 0) * Math.PI / 180;
      for (const b of c.bones) {
        const m = b.globalTransformMatrix;
        if (c.mixRotate) { b.offset.rotation += norm(trot - Math.atan2(m.b, m.a)) * c.mixRotate; moved = true; }
        if (c.mixX || c.mixY) {
          const ox = c.x || 0, oy = -(c.y || 0), wx = T.a * ox + T.c * oy + T.tx, wy = T.b * ox + T.d * oy + T.ty, dx = (wx - m.tx) * (c.mixX || 0), dy = (wy - m.ty) * (c.mixY || 0), p = b.parent;
          if (p) { const q = p.globalTransformMatrix, det = q.a * q.d - q.b * q.c || 1; b.offset.x += (q.d * dx - q.c * dy) / det; b.offset.y += (-q.b * dx + q.a * dy) / det; } else { b.offset.x += dx; b.offset.y += dy; }
          moved = true;
        }
        b.invalidUpdate();
      }
    }
    return moved;
  }
  /** hair / cloth physics: reads the pose, writes rotation offsets */
  simulate(dt) { if (this.phys.active) { this.phys.step(dt); this.phys.apply(); return true; } return false; }
  /** fit = { leg, arm, hand, phys, map } */
  setFit(f) {
    this.fit = f;
    if (!f || isDefaultFit(f)) { this.scale = null; return; }
    const limbs = applyMap(this.found.limbs, f.map, this.found.bones), arm = this.arm;
    const roots = (chains) => [...new Set(chains.flatMap((ch) => ch.filter((n, i) => i === 0 || arm.getBone(n)?.boneData.inheritScale === false)))].map((n) => arm.getBone(n)).filter(Boolean);
    const legChains = limbs.legs.length ? limbs.legs : limbs.skinLegs, lim = (v, a, b) => Math.min(b, Math.max(a, v ?? 1));
    this.scale = { k: { leg: lim(f.leg, 0.5, 1.2), arm: lim(f.arm, 0.5, 1.2), hand: lim(f.hand, 0.4, 1.3) }, legs: roots(legChains), arms: roots(limbs.arms), hands: limbs.hands.map((n) => arm.getBone(n)).filter(Boolean),
      hip: limbs.hip ? arm.getBone(limbs.hip) : null, ext: limbs.ext };
  }
  /** removes every offset set in the last frame */
  reset() { for (const b of this.bones) if (!IDENT(b.offset)) { const o = b.offset; o.x = 0; o.y = 0; o.rotation = 0; o.skew = 0; o.scaleX = 1; o.scaleY = 1; b.invalidUpdate(); } }
  /** body proportions (before the pose is updated) */
  fitting() {
    const s = this.scale;
    if (s) {
      const { k } = s, mul = (list, fn) => { for (const b of list) { fn(b.offset); b.invalidUpdate(); } };
      mul(s.legs, (o) => { o.scaleX *= k.leg; });
      mul(s.arms, (o) => { o.scaleX *= k.arm; });
      mul(s.hands, (o) => { o.scaleX *= k.hand; o.scaleY *= k.hand; });
      const h = s.hip;
      if (h) {                       // the hips sink by the length the legs lost (a straight line down in the picture, expressed in the parent bone's axes)
        const drop = (1 - k.leg) * s.ext * 0.97, p = h.parent;
        if (p) { const m = p.globalTransformMatrix, det = m.a * m.d - m.b * m.c || 1; h.offset.x += (m.d * 0 - m.c * drop) / det; h.offset.y += (-m.b * 0 + m.a * drop) / det; } else h.offset.y += drop;
        h.invalidUpdate();
      }
    }
  }
}
