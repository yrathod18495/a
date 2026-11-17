import { MORE, rgb, mix, css, seeded } from './skills-more.js';
// Skills: flat vector effects that belong to a character (fire in a hand, lightning around the body, an energy ball, a magic circle on the ground).
// They are plain drawing code (no pictures): any size, any colour, tiny to store, and the same function draws them in the studio, in the tab previews and in the video export.
// A skill is an entry of the effects list (`skill` field): { id, tpl: 'skill:fire', name, target: 'char:<key>', start, end, ramp, params: {}, visible, skill: { kind, anchor, size, power, speed, color } }.
export const SKILL_ANCHORS = [['head', 'Head', 'Body'], ['chest', 'Chest', 'Body'], ['belly', 'Belly', 'Body'], ['legs', 'Legs', 'Body'], ['feet', 'Feet (ground)', 'Body'],
  ['upperArmR', 'Right upper arm', 'Arms'], ['lowerArmR', 'Right lower arm', 'Arms'], ['handR', 'Right hand', 'Arms'], ['upperArmL', 'Left upper arm', 'Arms'], ['lowerArmL', 'Left lower arm', 'Arms'], ['handL', 'Left hand', 'Arms']];
// the bone names a rig may use for each part (the first one the character has is used); the character's own right / left
const NAMES = {
  headB: ['head', 'HEAD'], chestB: ['upper_body3', 'TORSO3', 'torso2', 'upper_body2', 'TORSO2'], bellyB: ['hips', 'pelvis', 'PELVIS'],
  upR: ['right_arm_up_jt', 'right_upper_hand_circle', 'ARM_R'], loR: ['right_arm_dn_jt', 'right_lower_hand_circle', 'FOREARM_L'], haR: ['right_palm_jt', 'right_hand_palm_circle', 'R_Palm', 'right_grip'],
  upL: ['left_arm_up_jt', 'left_upper_hand_circle', 'ARM_L'], loL: ['left_arm_dn_jt', 'left_lower_hand_circle', 'FOREARM_R'], haL: ['left_palm_jt', 'left_hand_palm_circle', 'L_Palm', 'left_grip'],
};
const bonePos = (l, names) => { for (const n of names) { const b = l.arm?.getBone?.(n); if (b) { const m = b.globalTransformMatrix, M = l.mat; return { x: M[0] * m.tx + M[2] * m.ty + M[4], y: M[1] * m.tx + M[3] * m.ty + M[5] }; } } return null; };
const mid = (a, b) => (a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a || b);
/** where a skill sits on a character, in canvas pixels (layer = a stage layer with `arm`, `mat`, `box`, `anchor`); a rig without the bone falls back to the middle of the body */
export function skillAnchorPoint(l, anchor) {
  const bx = l.box; if (!bx) return null;
  const h = bx.y1 - bx.y0, cx = (bx.x0 + bx.x1) / 2, fall = (f) => ({ x: cx, y: bx.y0 + h * f });
  let p = null;
  switch (anchor) {
    case 'head': p = bonePos(l, NAMES.headB); break;
    case 'chest': p = bonePos(l, NAMES.chestB); break;
    case 'belly': p = bonePos(l, NAMES.bellyB); break;
    case 'legs': return { x: cx, y: bx.y1 - h * 0.25 };
    case 'feet': return { x: l.anchor?.x ?? cx, y: l.anchor?.y ?? bx.y1 };
    case 'upperArmR': p = mid(bonePos(l, NAMES.upR), bonePos(l, NAMES.loR)); break;
    case 'lowerArmR': p = mid(bonePos(l, NAMES.loR), bonePos(l, NAMES.haR)); break;
    case 'handR': p = bonePos(l, NAMES.haR); break;
    case 'upperArmL': p = mid(bonePos(l, NAMES.upL), bonePos(l, NAMES.loL)); break;
    case 'lowerArmL': p = mid(bonePos(l, NAMES.loL), bonePos(l, NAMES.haL)); break;
    case 'handL': p = bonePos(l, NAMES.haL); break;
    default: break;
  }
  if (p) return p;
  return fall(anchor === 'head' ? 0.12 : anchor === 'belly' ? 0.5 : 0.38);
}
// group: the heading in the Skills tab; level: what the Level slider is called; scale: size next to the character (a fraction of its height); angle: the way it points to start with (-90 = to the left)
export const SKILLS = [
  { id: 'fire', name: 'Fire', color: '#ff7a1a', anchor: 'handR', hint: 'Flames that rise and flicker', group: 'Fire and heat', level: 'Flame level', scale: 0.17 },
  { id: 'burnaura', name: 'Burning aura', color: '#ff6a10', anchor: 'chest', hint: 'Flames all round the body', group: 'Fire and heat', level: 'Flame level', scale: 0.32 },
  { id: 'embers', name: 'Embers', color: '#ff9a2a', anchor: 'belly', hint: 'Sparks that float up and fade', group: 'Fire and heat', level: 'Amount', scale: 0.3 },
  { id: 'haze', name: 'Heat haze', color: '#ffb066', anchor: 'belly', hint: 'Wavy hot air rising', group: 'Fire and heat', level: 'Strength', scale: 0.32 },
  { id: 'smoke', name: 'Smoke', color: '#9aa0aa', anchor: 'belly', hint: 'Grey smoke that rises', group: 'Fire and heat', level: 'Amount', scale: 0.32 },
  { id: 'lightning', name: 'Lightning', color: '#7ad1ff', anchor: 'chest', hint: 'Jagged bolts around the body', group: 'Lightning and power', level: 'Bolt power', scale: 0.2 },
  { id: 'arc', name: 'Lightning arc', color: '#8fdcff', anchor: 'handR', hint: 'One long bolt that jumps across (turn it to aim)', group: 'Lightning and power', level: 'Bolt power', scale: 0.3, angle: -90 },
  { id: 'voltaura', name: 'Lightning aura', color: '#7ad1ff', anchor: 'chest', hint: 'Short bolts crawling over the body', group: 'Lightning and power', level: 'Bolt power', scale: 0.4 },
  { id: 'energy', name: 'Energy ball', color: '#9a7bff', anchor: 'handR', hint: 'A glowing ball with rings', group: 'Lightning and power', level: 'Energy level', scale: 0.2 },
  { id: 'beam', name: 'Energy beam', color: '#ff4d6d', anchor: 'handR', hint: 'A straight ray from the hand (turn it to aim)', group: 'Lightning and power', level: 'Beam power', scale: 0.4, angle: -90 },
  { id: 'shockwave', name: 'Shockwave', color: '#ffd84a', anchor: 'feet', hint: 'Rings that spread over the ground', group: 'Lightning and power', level: 'Strength', scale: 0.3 },
  { id: 'circle', name: 'Magic circle', color: '#ffd84a', anchor: 'feet', hint: 'A turning rune circle on the ground', group: 'Magic', level: 'Glow level', scale: 0.2 },
  { id: 'runes', name: 'Glowing runes', color: '#ffd84a', anchor: 'chest', hint: 'Marks that glow and float round', group: 'Magic', level: 'Amount', scale: 0.4 },
  { id: 'eyes', name: 'Glowing eyes', color: '#7affc8', anchor: 'head', hint: 'Two eyes with a flare (nudge them onto the face)', group: 'Magic', level: 'Glow level', scale: 0.12 },
  { id: 'trail', name: 'Magic trail', color: '#ff7adf', anchor: 'handR', hint: 'Sparkles that follow a flying hand or ball', group: 'Magic', level: 'Amount', scale: 0.25 },
  { id: 'sparkles', name: 'Sparkles', color: '#ffe680', anchor: 'chest', hint: 'Twinkling stars', group: 'Magic', level: 'Amount', scale: 0.35 },
  { id: 'frost', name: 'Ice mist', color: '#9ad8ff', anchor: 'legs', hint: 'Cold mist and snow', group: 'Ice, water and wind', level: 'Amount', scale: 0.32 },
  { id: 'crystal', name: 'Ice crystal', color: '#7ccbff', anchor: 'feet', hint: 'Crystals that grow up from the ground', group: 'Ice, water and wind', level: 'Crystal count', scale: 0.3 },
  { id: 'water', name: 'Water ball', color: '#3fa7ff', anchor: 'handR', hint: 'A ball of water with drops', group: 'Ice, water and wind', level: 'Size of ball', scale: 0.2 },
  { id: 'wind', name: 'Wind swirl', color: '#bfe9ff', anchor: 'belly', hint: 'A turning column of wind', group: 'Ice, water and wind', level: 'Strength', scale: 0.4 },
  { id: 'shadow', name: 'Dark smoke', color: '#6a3fa0', anchor: 'belly', hint: 'Black smoke rising off the body', group: 'Dark and fear', level: 'Amount', scale: 0.38 },
  { id: 'redeye', name: 'Red eye glow', color: '#ff2a3a', anchor: 'head', hint: 'A red haze and glowing eyes (nudge onto the face)', group: 'Dark and fear', level: 'Glow level', scale: 0.2 },
  { id: 'ghost', name: 'Ghost veil', color: '#d8e8ff', anchor: 'chest', hint: 'A pale veil that waves round the body', group: 'Dark and fear', level: 'Strength', scale: 0.34 },
  { id: 'shield', name: 'Shield', color: '#5ad0ff', anchor: 'handL', hint: 'A round shield of light', group: 'Special', level: 'Strength', scale: 0.25 },
  { id: 'portal', name: 'Portal', color: '#b46bff', anchor: 'belly', hint: 'A standing doorway of swirling light', group: 'Special', level: 'Glow level', scale: 0.45 },
  { id: 'speed', name: 'Speed lines', color: '#ffffff', anchor: 'chest', hint: 'Streaks that rush past (turn it to the way you run)', group: 'Special', level: 'Amount', scale: 0.4, angle: -90 },
];
/** how big a skill is next to the character (a fraction of its height) before the Size slider */
export const SKILL_SCALE = Object.fromEntries(SKILLS.map((t) => [t.id, t.scale]));
/** what the Level slider is called for each skill */
export const SKILL_LEVEL_LABEL = Object.fromEntries(SKILLS.map((t) => [t.id, t.level]));
export const skillTemplate = (id) => SKILLS.find((s) => s.id === id) || null;
/** a new skill on the timeline */
export function newSkill(kind, { id, target, start = 0, end = 5, ramp = 0.3 } = {}) {
  const t = skillTemplate(kind) || SKILLS[0];
  return { id, tpl: `skill:${t.id}`, name: t.name, target, start, end, ramp, params: {}, visible: true, skill: cleanSkill({ kind: t.id, anchor: t.anchor, color: t.color, angle: t.angle ?? 0 }) };
}
export const isSkill = (fx) => !!fx?.skill;
/** a skill's settings, always valid. move: null (stays on the character) or { mode: 'point' | 'char', to: { x, y } (fractions of the picture), char (key), arc (-1..1), travel (share of its time spent flying), trail, aim } */
export const cleanSkill = (s) => {
  const t = skillTemplate(s?.kind) || SKILLS[0], num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
  const out = { kind: t.id, anchor: SKILL_ANCHORS.some(([k]) => k === s?.anchor) ? s.anchor : t.anchor, size: num(s?.size, 0.3, 3, 1), power: num(s?.power, 0.1, 1, 0.7), speed: num(s?.speed, 0.3, 3, 1),
    opacity: num(s?.opacity, 0.1, 1, 1), width: num(s?.width, 0.4, 2, 1), angle: num(s?.angle, -180, 180, 0), color: /^#[0-9a-f]{6}$/i.test(s?.color || '') ? s.color : t.color, dx: num(s?.dx, -1, 1, 0), dy: num(s?.dy, -1, 1, 0) };
  if (s?.move && typeof s.move === 'object') {
    const m = s.move; out.move = { mode: m.mode === 'char' ? 'char' : 'point', to: { x: num(m.to?.x, -0.2, 1.2, 0.75), y: num(m.to?.y, -0.2, 1.2, 0.45) }, char: typeof m.char === 'string' ? m.char.slice(0, 40) : '', arc: num(m.arc, -1, 1, 0.25), travel: num(m.travel, 0.1, 1, 0.6), trail: m.trail !== false, aim: m.aim !== false };
  }
  return out;
};
const ease = (u) => u * u * (3 - 2 * u);
/** where a skill is at time t: it sits on its anchor, or (with a path) it leaves the anchor and flies to the end point, bending along an arc. Returns { x, y, e (0..1 how far), dir (radians of the way it goes) } */
export function skillPlace(skill, f, t, p0, p1) {
  const m = skill.move; if (!m || !p1) return { x: p0.x, y: p0.y, e: 0, dir: null };
  const span = Math.max(0.001, (f.end - f.start) * m.travel), e = ease(Math.max(0, Math.min(1, (t - f.start) / span))), dx = p1.x - p0.x, dy = p1.y - p0.y, len = Math.hypot(dx, dy) || 1;
  const bend = Math.sin(Math.PI * e) * m.arc * len * 0.5, nx = -dy / len, ny = dx / len;
  return { x: p0.x + dx * e + nx * bend, y: p0.y + dy * e + ny * bend, e, dir: Math.atan2(dy, dx) };
}


/** the middle of the picture is the anchor point; R is the base radius. t = seconds since the skill started, k = how strong it is now (the fade in / out, 0..1) */
export function drawSkill(ctx, kind, S, t, skill, k = 1, turn = 0) {
  const c = rgb(skill.color || '#ff7a1a'), p = skill.power ?? 0.7, sp = skill.speed ?? 1, R = S * 0.3125, T = t * sp, wd = skill.width ?? 1;
  ctx.clearRect(0, 0, S, S); ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, k * (skill.opacity ?? 1))); ctx.translate(S / 2, S / 2); ctx.rotate(((skill.angle || 0) * Math.PI) / 180 + turn); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ({ fire, lightning, energy, circle, ...MORE }[kind] || fire)(ctx, R, T, c, p, wd);
  ctx.restore();
}
function fire(ctx, R, T, c, p, wd = 1) {
  const n = 5 + Math.round(p * 4), base = R * 0.15, hot = mix(c, [255, 235, 140], 0.65), core = mix(c, [255, 255, 235], 0.9);
  for (const [col, sc, wk] of [[css(c), 1, 1], [css(hot), 0.72, 0.8], [css(core), 0.42, 0.6]]) {
    ctx.fillStyle = col;
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0 : i / (n - 1) - 0.5, x = u * R * 1.1, ph = i * 1.7 + (sc * 2.3);
      const h = R * (0.9 + 0.9 * p) * (0.75 + 0.25 * Math.sin(T * 6 + ph)) * sc * (1 - Math.abs(u) * 0.7), w = R * 0.38 * wk, sway = Math.sin(T * 5 + ph) * w * 0.35;
      ctx.beginPath(); ctx.moveTo(x - w / 2, base); ctx.quadraticCurveTo(x - w * 0.7, base - h * 0.45, x + sway, base - h); ctx.quadraticCurveTo(x + w * 0.7, base - h * 0.45, x + w / 2, base); ctx.quadraticCurveTo(x, base + w * 0.25, x - w / 2, base); ctx.fill();
    }
  }
  const m = 4 + Math.round(p * 6); ctx.fillStyle = css(hot, 0.9);
  for (let i = 0; i < m; i++) { const ph = (T * 0.7 + i / m) % 1, x = Math.sin(i * 12.9) * R * 0.7 + Math.sin(T * 3 + i) * R * 0.1; ctx.globalAlpha *= 1; ctx.save(); ctx.globalAlpha *= 1 - ph; ctx.beginPath(); ctx.arc(x, base - ph * R * 2.1, R * 0.07 * (1 - ph) + 1, 0, 7); ctx.fill(); ctx.restore(); }
}
function lightning(ctx, R, T, c, p, wd = 1) {
  const rnd = seeded(Math.floor(T * 14) * 7919 + 13), n = 3 + Math.round(p * 3), glow = mix(c, [255, 255, 255], 0.2), white = mix(c, [255, 255, 255], 0.85);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.9); g.addColorStop(0, css(glow, 0.55 * p + 0.15)); g.addColorStop(1, css(glow, 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R * 0.9, 0, 7); ctx.fill();
  for (let b = 0; b < n; b++) {
    const a0 = (b / n) * Math.PI * 2 + rnd() * 0.9, len = R * wd * (0.9 + rnd() * 0.8 + p * 0.5), seg = 7, pts = [[0, 0]];
    for (let i = 1; i <= seg; i++) { const d = (i / seg) * len, j = (rnd() - 0.5) * R * 0.38 * (i < seg ? 1 : 0.4); pts.push([Math.cos(a0) * d - Math.sin(a0) * j, Math.sin(a0) * d + Math.cos(a0) * j]); }
    for (const [w, col, al] of [[R * 0.16, css(glow, 0.28), 1], [R * 0.07, css(c, 0.95), 1], [R * 0.03, css(white, 1), 1]]) { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); }
  }
}
function energy(ctx, R, T, c, p, wd = 1) {
  const r = R * wd * (0.5 + 0.2 * p) * (1 + 0.07 * Math.sin(T * 8)), hot = mix(c, [255, 255, 255], 0.55), g = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 2); g.addColorStop(0, css(c, 0.7)); g.addColorStop(1, css(c, 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r * 2, 0, 7); ctx.fill();
  ctx.fillStyle = css(c, 1); ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill(); ctx.fillStyle = css(hot, 1); ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0, 7); ctx.fill(); ctx.fillStyle = css([255, 255, 255], 1); ctx.beginPath(); ctx.arc(0, 0, r * 0.3, 0, 7); ctx.fill();
  ctx.strokeStyle = css(hot, 0.9); ctx.lineWidth = Math.max(1.5, R * 0.05);
  for (let i = 0; i < 3; i++) { const a = T * 3 * (i % 2 ? -1 : 1) + i * 2.1, rr = r * (1.35 + i * 0.22); ctx.beginPath(); ctx.arc(0, 0, rr, a, a + 1.5); ctx.stroke(); }
  ctx.fillStyle = css(hot, 1); for (let i = 0; i < 5; i++) { const a = T * 2.2 + i * 1.26, rr = r * 1.9; ctx.beginPath(); ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr * 0.8, R * 0.05 + 1, 0, 7); ctx.fill(); }
}
function circle(ctx, R, T, c, p, wd = 1) {
  const rx = R * 1.35 * wd, hot = mix(c, [255, 255, 255], 0.6);
  ctx.save(); ctx.translate(0, R * 0.15); ctx.scale(1, 0.36);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx); g.addColorStop(0, css(c, 0.05)); g.addColorStop(1, css(c, 0.3 * p + 0.1)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, 7); ctx.fill();
  ctx.strokeStyle = css(c, 1); ctx.lineWidth = R * 0.07; ctx.beginPath(); ctx.arc(0, 0, rx, 0, 7); ctx.stroke(); ctx.lineWidth = R * 0.035; ctx.beginPath(); ctx.arc(0, 0, rx * 0.82, 0, 7); ctx.stroke();
  const a = T * 0.8; ctx.save(); ctx.rotate(a); ctx.strokeStyle = css(hot, 0.95); ctx.lineWidth = R * 0.05;
  for (let i = 0; i < 16; i++) { const q = (i / 16) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(Math.cos(q) * rx * 0.84, Math.sin(q) * rx * 0.84); ctx.lineTo(Math.cos(q) * rx * 0.97, Math.sin(q) * rx * 0.97); ctx.stroke(); }
  ctx.restore(); ctx.save(); ctx.rotate(-a * 1.3); ctx.strokeStyle = css(c, 0.95); ctx.lineWidth = R * 0.05;
  for (const off of [0, Math.PI / 3]) { ctx.beginPath(); for (let i = 0; i < 3; i++) { const q = off + (i / 3) * Math.PI * 2, x = Math.cos(q) * rx * 0.74, y = Math.sin(q) * rx * 0.74; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath(); ctx.stroke(); }
  ctx.restore(); ctx.restore();
  const m = 6 + Math.round(p * 6); ctx.fillStyle = css(hot, 1);
  for (let i = 0; i < m; i++) { const ph = (T * 0.6 + i / m) % 1, ang = i * 2.399, x = Math.cos(ang) * rx * 0.8 * (0.3 + 0.7 * ((i * 7) % 5) / 5), y = R * 0.15 + Math.sin(ang) * rx * 0.3 - ph * R * 1.6; ctx.save(); ctx.globalAlpha *= 1 - ph; ctx.beginPath(); ctx.arc(x, y, R * 0.05 + 1, 0, 7); ctx.fill(); ctx.restore(); }
}
