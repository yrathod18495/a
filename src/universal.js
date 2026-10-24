// Universal rig helpers for ANY DragonBones character: body proportion settings and limb detection (src/db/motion.js applies them).
// Nothing here depends on bone names alone: limbs are found from the skeleton's shape (setup pose), names only help.

export const FIT_DEFAULT = { leg: 1, arm: 1, hand: 1, phys: true, map: {} };
export const FIT_LIMITS = { leg: [0.6, 1.2], arm: [0.6, 1.2], hand: [0.5, 1.3] };
export const FIT_PRESETS = [
  ['Original', { leg: 1, arm: 1, hand: 1 }],
  ['Shorter legs & hands', { leg: 0.82, arm: 0.88, hand: 0.8 }],
  ['Kid', { leg: 0.7, arm: 0.75, hand: 0.75 }],
];

const KEY = '12toons.fit.';
import { context } from './store.js';
const fitKey = charId => { const c=context();return KEY+(c?c.uid+'/'+c.id+'/':'unowned/')+charId; };
export function getFit(charId) {
  try { const v = JSON.parse(localStorage.getItem(fitKey(charId)) || 'null'); if (v) return { ...FIT_DEFAULT, ...v, map: { ...(v.map || {}) } }; } catch { /* storage blocked */ }
  return { ...FIT_DEFAULT, map: {} };
}
export function setFit(charId, fit) { try { localStorage.setItem(fitKey(charId), JSON.stringify(fit)); } catch { /* storage blocked */ } }
export const isDefaultFit = (f) => !f || (f.leg === 1 && f.arm === 1 && f.hand === 1);

/* ---------- finding the limbs ---------- */
const FACE = /^(HEAD\d*$|head|Eye|Brow|Mouth|Lip|Jaw|Nose|Ear|Tongue)/i;
const FACEBONE = /^(Eye|Brow|Mouth|Lip|Jaw|Nose|Tongue)/i;
const CLOTH = /^(Lungi|Kurta|Duptta|Dupatta|Hair|Back_Hair|Skirt|Sleeve|Cape|Scarf|Tail|Earring|Saree|Pallu)/i;
// well-known names: 12toons family first, then the common naming of other tools (Mixamo, DragonBones, Spine templates ...)
const NAMES = {
  legs: [/^(2|bone3)$/, /^(thigh|up_?leg|upper_?leg|leg_?up|hip_?[lr]|[lr]_?thigh|[lr]_?up_?leg)/i, /(left|right)?_?(thigh|upleg)/i],
  arms: [/^ARM_[LR]$/, /^(upper_?arm|arm_?up|[lr]_?upper_?arm|[lr]_?arm|shoulder_?[lr]|arm_?[lr]?)$/i, /(left|right)?_?(upperarm|bicep)/i],
  hands: [/^[LR]_Palm$/, /(palm|hand|wrist)/i],
};

/**
 * bones: [{name, parent, len, x, y, ang, tx, ty, inherit}] in setup pose (world, y up); ik: [{bones, target}]
 * -> { hip, ext, legs:[[names]], arms:[[names]], hands:[names], skinLegs:[[names]] }
 */
export function detectLimbs(bones, ik = []) {
  const by = new Map(bones.map((b) => [b.name, b])), kids = new Map(bones.map((b) => [b.name, []]));
  for (const b of bones) if (b.parent && kids.has(b.parent)) kids.get(b.parent).push(b);
  const ys = bones.flatMap((b) => [b.y, b.ty]), minY = Math.min(...ys), H = Math.max(...ys) - minY || 1;
  const main = (b) => kids.get(b.name).filter((c) => c.len > 0).sort((p, q) => q.len - p.len)[0];
  const chainFrom = (b) => { const out = [b]; for (let c = main(b); c && out.length < 8; c = main(c)) out.push(c); return out; };
  const down = (b) => (b.ty - b.y) / (b.len || 1);                 // -1 = straight down, +1 = straight up
  const rel = (b) => (b.y - minY) / H;
  const total = (ch) => ch.reduce((s, b) => s + b.len, 0);
  const startsRun = (b, fn) => !(by.get(b.parent) && by.get(b.parent).len > 0 && fn(by.get(b.parent)) && main(by.get(b.parent)) === b);
  const anc = (b) => { const out = []; for (let p = by.get(b.parent); p; p = by.get(p.parent)) out.push(p); return out; };
  const lca = (list) => { if (!list.length) return null; let common = [list[0], ...anc(list[0])]; for (const b of list.slice(1)) { const a = new Set([b, ...anc(b)]); common = common.filter((x) => a.has(x)); } return common[0] || null; };

  // legs: the IK chains that end on the ground, else every long chain that hangs down from the hips
  const skinLegs = ik.filter((c) => c.bones.length >= 2).map((c) => chainFrom(by.get(c.bones[0]))).filter((ch) => down(ch[0]) < -0.3 && total(ch) > 0.15 * H);
  let legs = bones.filter((b) => b.len > 0 && down(b) < -0.64 && rel(b) > 0.18 && rel(b) < 0.68 && !FACE.test(b.name) && startsRun(b, (p) => down(p) < -0.64)).map(chainFrom).filter((ch) => total(ch) >= 0.15 * H);
  const named = bones.filter((b) => b.len > 0 && NAMES.legs.some((re) => re.test(b.name)) && rel(b) < 0.68 && down(b) < 0);
  if (!legs.length && named.length) legs = named.map(chainFrom);
  const hipOf = skinLegs.length >= 2 ? skinLegs.map((c) => c[0]) : legs.map((c) => c[0]);
  const hipBone = lca(hipOf), hip = hipBone?.name || null;
  const base = skinLegs.length ? skinLegs : legs;
  const ext = base.length ? Math.max(...base.map((ch) => ch[0].y - Math.min(...ch.map((b) => b.ty)))) : 0;
  const legNames = new Set(legs.flat().map((b) => b.name));

  // arms: chains from the shoulders (upper body, not the head, not cloth), they may hang down or stretch out sideways
  const upper = (b) => b.len > 0 && !FACE.test(b.name) && !CLOTH.test(b.name) && !legNames.has(b.name) && !(ik.some((c) => c.bones.includes(b.name)));
  let arms = bones.filter((b) => upper(b) && rel(b) > 0.5 && rel(b) < 0.9 && down(b) < -0.55 && startsRun(b, (p) => down(p) < -0.55)).map(chainFrom).filter((ch) => total(ch) >= 0.17 * H && ch.length >= 2 && ch.length <= 6);
  if (!arms.length) arms = bones.filter((b) => upper(b) && rel(b) > 0.5 && rel(b) < 0.9 && down(b) < 0.3 && startsRun(b, (p) => down(p) < 0.3)).map(chainFrom).filter((ch) => total(ch) >= 0.17 * H && ch.length >= 2 && ch.length <= 6);   // arms stretched sideways (T-pose)
  const knownArms = bones.filter((b) => b.len > 0 && NAMES.arms[0].test(b.name));
  if (knownArms.length) arms = knownArms.map(chainFrom);
  else if (!arms.length) { const g = bones.filter((b) => upper(b) && NAMES.arms.some((re) => re.test(b.name))); if (g.length) arms = g.map(chainFrom); }
  // keep the two longest (left / right)
  arms = arms.sort((p, q) => total(q) - total(p)).slice(0, 2);
  const hands = arms.map((ch) => (ch.length >= 3 && ch[ch.length - 1].len <= 0.7 * ch[ch.length - 2].len ? ch[ch.length - 1].name : null)).filter(Boolean);
  for (const b of bones) if (b.len > 0 && NAMES.hands[0].test(b.name) && !hands.includes(b.name)) hands.push(b.name);

  return { hip, ext, legs: legs.map((c) => c.map((b) => b.name)), arms: arms.map((c) => c.map((b) => b.name)), hands, skinLegs: skinLegs.map((c) => c.map((b) => b.name)) };
}

/** a user's own bone map (Body tab) replaces what was detected: {legs: 'a,b', arms: 'c,d', hands: 'e,f', hip: 'g'} (root bone names) */
export function applyMap(limbs, map, bones) {
  if (!map) return limbs;
  const list = (s) => String(s || '').split(/[,\s]+/).filter(Boolean), by = new Map(bones.map((b) => [b.name, b])), kids = new Map(bones.map((b) => [b.name, []]));
  for (const b of bones) if (b.parent && kids.has(b.parent)) kids.get(b.parent).push(b);
  const chain = (n) => { const out = []; let b = by.get(n); while (b && out.length < 8) { out.push(b.name); b = kids.get(b.name).filter((c) => c.len > 0).sort((p, q) => q.len - p.len)[0]; } return out; };
  const out = { ...limbs };
  if (list(map.legs).length) { out.legs = list(map.legs).filter((n) => by.has(n)).map(chain); out.skinLegs = out.legs; out.ext = Math.max(0, ...out.legs.map((ch) => by.get(ch[0]).y - Math.min(...ch.map((n) => by.get(n).ty)))); }
  if (list(map.arms).length) out.arms = list(map.arms).filter((n) => by.has(n)).map(chain);
  if (list(map.hands).length) out.hands = list(map.hands).filter((n) => by.has(n));
  if (map.hip && by.has(map.hip)) out.hip = map.hip;
  return out;
}

