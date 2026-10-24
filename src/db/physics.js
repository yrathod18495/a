// Hair / cloth / jewellery physics for DragonBones armatures (DragonBones has none). Written for 12toons: every hanging chain of bones is a
// verlet rope that is pinned to the body and pulled back to the animated pose, and the result is written to bone offsets (rotation).
// Chains come from the physics data the converter kept from the source rig (`_physics`) and, for rigs without any, from the shape of the skeleton.
const DEG = Math.PI / 180;
const norm = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const FACE = /^(Eye|Brow|Mouth|Lip|Jaw|Nose|Tongue)/i;
const SOFT = /^(Earring|Hair)/i;

/** [{ bones:[names], damp, stiff, grav, mix:[...], rootFixed }] */
export function chainsOf(prep, { auto = true, limbs = null } = {}) {
  const arm = prep.arm, byName = new Map(arm.bone.map((b) => [b.name, b])), kids = new Map(arm.bone.map((b) => [b.name, []]));
  for (const b of arm.bone) if (b.parent && kids.has(b.parent)) kids.get(b.parent).push(b.name);
  // 1. the physics the source rig had
  const cons = new Map();
  for (const c of arm._physics || []) if ((!c.skin || prep.active.physics.has(c.name)) && byName.has(c.bone)) cons.set(c.bone, c);
  // 2. bones that must stay out of the automatic ones
  const skip = new Set(), mark = (n) => { if (skip.has(n) || !kids.has(n)) return; skip.add(n); kids.get(n).forEach(mark); };
  for (const c of arm.ik || []) { let b = byName.get(c.bone); for (let i = 0; i <= (c.chain || 0) && b; i++) { skip.add(b.name); b = byName.get(b.parent); } mark(c.target); }
  for (const ch of [...(limbs?.arms || []), ...(limbs?.skinLegs || [])]) ch.forEach(mark);
  const isTail = (n) => { for (let k = kids.get(n); ; k = kids.get(k[0])) { if (!k.length) return true; if (k.length > 1) return false; } };
  const autoBones = new Map();
  if (auto) for (const b of arm.bone) {
    if (cons.has(b.name) || skip.has(b.name) || !isTail(b.name) || !(b.length > 0) || FACE.test(b.name)) continue;
    const par = byName.get(b.parent);
    if (par && isTail(par.name) && kids.get(par.name).length === 1 && !cons.has(par.name) && !skip.has(par.name)) continue;     // not the start of the chain
    const chain = []; for (let n = b.name; n; n = kids.get(n)[0]) { chain.push(n); if (chain.length > 16) break; }
    const moving = chain.filter((n) => byName.get(n).length > 0);
    if (moving.length < 2 && !SOFT.test(b.name)) continue;
    const rootFixed = !SOFT.test(b.name);
    chain.forEach((n, i) => { if (byName.get(n).length > 0 && !(rootFixed && i === 0) && !cons.has(n)) autoBones.set(n, { rotate: 0.9, auto: true }); });
  }
  const all = new Map([...cons].map(([n, c]) => [n, { rotate: c.rotate ?? 1, damping: c.damping, inertia: c.inertia, strength: c.strength, mass: c.mass, gravity: c.gravity, order: c.order ?? 0 }]));
  for (const [n, v] of autoBones) all.set(n, v);
  // 3. chains: a physics bone whose parent is not one starts a chain; it goes on through its single physics child (branches start new chains)
  const phys = (n) => all.has(n), out = [];
  const childPhys = (n) => kids.get(n).filter(phys);
  const start = (n, bones) => {
    bones.push(n);
    const k = childPhys(n);
    if (k.length === 1) return start(k[0], bones);
    out.push(bones);
    k.forEach((c) => start(c, []));
    return null;
  };
  for (const b of arm.bone) if (phys(b.name) && !phys(b.parent)) start(b.name, []);
  return out.map((names) => {
    const p = all.get(names[0]);
    const damp = p.auto ? 0.93 : 0.86 + 0.07 * Math.min(1, Math.max(0, p.damping ?? 0.85)), stiff = p.auto ? 0.07 : Math.min(0.2, Math.max(0.02, 0.05 * ((p.strength ?? 100) / 100) / Math.max(0.3, p.mass ?? 1)));
    return { names, damp, stiff, grav: (p.gravity || 0) * 0.08, mix: names.map((n) => all.get(n).rotate ?? 1) };
  });
}

export class Physics {
  constructor(arm, defs) {
    this.chains = defs.map((d) => ({ ...d, bones: d.names.map((n) => arm.getBone(n)).filter(Boolean), P: null, last: null })).filter((c) => c.bones.length);
    this.acc = 0;
  }
  get active() { return this.chains.length > 0; }
  /** rest joints of a chain from the current (physics free) pose */
  rest(c) {
    const pts = [], m0 = c.bones[0].globalTransformMatrix; pts.push({ x: m0.tx, y: m0.ty });
    for (const b of c.bones) { const m = b.globalTransformMatrix, L = b.boneData.length; pts.push({ x: m.tx + m.a * L, y: m.ty + m.b * L }); }
    return pts;
  }
  /** runs the simulation for `dt` seconds (0 = keep the last result) and writes bone offsets */
  step(dt) {
    this.acc = Math.min(this.acc + dt, 0.25);
    let n = 0; while (this.acc >= 1 / 60 - 1e-9) { this.acc -= 1 / 60; n++; }
    for (const c of this.chains) {
      if (n === 0 && c.last) continue;                    // paused / scrubbing: the last result stays
      const R = this.rest(c), k = c.bones.length;
      if (!c.P) c.P = R.map((p) => ({ x: p.x, y: p.y, px: p.x, py: p.y }));
      const P = c.P, lens = c.bones.map((b, i) => Math.hypot(R[i + 1].x - R[i].x, R[i + 1].y - R[i].y));
      for (let s = 0; s < n; s++) {
        P[0].px = P[0].x; P[0].py = P[0].y; P[0].x = R[0].x; P[0].y = R[0].y;
        for (let i = 1; i <= k; i++) {
          const p = P[i], vx = (p.x - p.px) * c.damp, vy = (p.y - p.py) * c.damp;
          p.px = p.x; p.py = p.y; p.x += vx; p.y += vy + c.grav;
          p.x += (R[i].x - p.x) * c.stiff; p.y += (R[i].y - p.y) * c.stiff;
        }
        for (let it = 0; it < 4; it++) for (let i = 1; i <= k; i++) {
          const a = P[i - 1], p = P[i], dx = p.x - a.x, dy = p.y - a.y, d = Math.hypot(dx, dy) || 1e-6;
          p.x = a.x + (dx / d) * lens[i - 1]; p.y = a.y + (dy / d) * lens[i - 1];
        }
      }
      // simulated joints -> rotation offsets, root to tip
      const par = c.bones[0].parent; let prevRest = par ? Math.atan2(par.globalTransformMatrix.b, par.globalTransformMatrix.a) : 0, prevSim = prevRest;
      const delta = [];
      for (let i = 0; i < k; i++) {
        const m = c.bones[i].globalTransformMatrix, rest = Math.atan2(m.b, m.a), sim = Math.atan2(P[i + 1].y - P[i].y, P[i + 1].x - P[i].x);
        const d = norm((sim - prevSim) - (rest - prevRest)) * c.mix[i];
        delta.push(d); prevRest = rest; prevSim = rest + norm(sim - rest) * c.mix[i];
      }
      c.last = delta;
    }
  }
  apply() { for (const c of this.chains) c.bones.forEach((b, i) => { b.offset.rotation += c.last ? c.last[i] : 0; b.invalidUpdate(); }); }
  reset() { for (const c of this.chains) c.P = null; this.acc = 0; }
}
