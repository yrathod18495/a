// Skills: flat vector effects that belong to a character (fire in a hand, lightning around the body, an energy ball, a magic circle on the ground).
// They are plain drawing code (no pictures): any size, any colour, tiny to store, and the same function draws them in the studio, in the tab previews and in the video export.
// A skill is an entry of the effects list (`skill` field): { id, tpl: 'skill:fire', name, target: 'char:<key>', start, end, ramp, params: {}, visible, skill: { kind, anchor, size, power, speed, color } }.
export const SKILL_ANCHORS = [['handR', 'Right hand'], ['handL', 'Left hand'], ['head', 'Head'], ['chest', 'Chest'], ['feet', 'Feet (ground)']];
export const SKILLS = [
  { id: 'fire', name: 'Fire', color: '#ff7a1a', anchor: 'handR', hint: 'Flames that rise and flicker' },
  { id: 'lightning', name: 'Lightning', color: '#7ad1ff', anchor: 'chest', hint: 'Jagged bolts around the body' },
  { id: 'energy', name: 'Energy ball', color: '#9a7bff', anchor: 'handR', hint: 'A glowing ball with rings' },
  { id: 'circle', name: 'Magic circle', color: '#ffd84a', anchor: 'feet', hint: 'A turning rune circle on the ground' },
];
/** how big a skill is next to the character (a fraction of its height) before the Size slider */
export const SKILL_SCALE = { fire: 0.17, lightning: 0.2, energy: 0.2, circle: 0.2 };
export const skillTemplate = (id) => SKILLS.find((s) => s.id === id) || null;
/** a new skill on the timeline */
export function newSkill(kind, { id, target, start = 0, end = 5, ramp = 0.3 } = {}) {
  const t = skillTemplate(kind) || SKILLS[0];
  return { id, tpl: `skill:${t.id}`, name: t.name, target, start, end, ramp, params: {}, visible: true, skill: { kind: t.id, anchor: t.anchor, size: 1, power: 0.7, speed: 1, color: t.color } };
}
export const isSkill = (fx) => !!fx?.skill;
export const cleanSkill = (s) => {
  const t = skillTemplate(s?.kind) || SKILLS[0], num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
  return { kind: t.id, anchor: SKILL_ANCHORS.some(([k]) => k === s?.anchor) ? s.anchor : t.anchor, size: num(s?.size, 0.3, 3, 1), power: num(s?.power, 0.1, 1, 0.7), speed: num(s?.speed, 0.3, 3, 1), color: /^#[0-9a-f]{6}$/i.test(s?.color || '') ? s.color : t.color };
};

const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
const css = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const seeded = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** the middle of the picture is the anchor point; R is the base radius. t = seconds since the skill started, k = how strong it is now (the fade in / out, 0..1) */
export function drawSkill(ctx, kind, S, t, skill, k = 1) {
  const c = rgb(skill.color || '#ff7a1a'), p = skill.power ?? 0.7, sp = skill.speed ?? 1, R = S * 0.3125, T = t * sp;
  ctx.clearRect(0, 0, S, S); ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, k)); ctx.translate(S / 2, S / 2); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ({ fire, lightning, energy, circle }[kind] || fire)(ctx, R, T, c, p);
  ctx.restore();
}
function fire(ctx, R, T, c, p) {
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
function lightning(ctx, R, T, c, p) {
  const rnd = seeded(Math.floor(T * 14) * 7919 + 13), n = 3 + Math.round(p * 3), glow = mix(c, [255, 255, 255], 0.2), white = mix(c, [255, 255, 255], 0.85);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.9); g.addColorStop(0, css(glow, 0.55 * p + 0.15)); g.addColorStop(1, css(glow, 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R * 0.9, 0, 7); ctx.fill();
  for (let b = 0; b < n; b++) {
    const a0 = (b / n) * Math.PI * 2 + rnd() * 0.9, len = R * (0.9 + rnd() * 0.8 + p * 0.5), seg = 7, pts = [[0, 0]];
    for (let i = 1; i <= seg; i++) { const d = (i / seg) * len, j = (rnd() - 0.5) * R * 0.38 * (i < seg ? 1 : 0.4); pts.push([Math.cos(a0) * d - Math.sin(a0) * j, Math.sin(a0) * d + Math.cos(a0) * j]); }
    for (const [w, col, al] of [[R * 0.16, css(glow, 0.28), 1], [R * 0.07, css(c, 0.95), 1], [R * 0.03, css(white, 1), 1]]) { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); }
  }
}
function energy(ctx, R, T, c, p) {
  const r = R * (0.5 + 0.2 * p) * (1 + 0.07 * Math.sin(T * 8)), hot = mix(c, [255, 255, 255], 0.55), g = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 2); g.addColorStop(0, css(c, 0.7)); g.addColorStop(1, css(c, 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r * 2, 0, 7); ctx.fill();
  ctx.fillStyle = css(c, 1); ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill(); ctx.fillStyle = css(hot, 1); ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0, 7); ctx.fill(); ctx.fillStyle = css([255, 255, 255], 1); ctx.beginPath(); ctx.arc(0, 0, r * 0.3, 0, 7); ctx.fill();
  ctx.strokeStyle = css(hot, 0.9); ctx.lineWidth = Math.max(1.5, R * 0.05);
  for (let i = 0; i < 3; i++) { const a = T * 3 * (i % 2 ? -1 : 1) + i * 2.1, rr = r * (1.35 + i * 0.22); ctx.beginPath(); ctx.arc(0, 0, rr, a, a + 1.5); ctx.stroke(); }
  ctx.fillStyle = css(hot, 1); for (let i = 0; i < 5; i++) { const a = T * 2.2 + i * 1.26, rr = r * 1.9; ctx.beginPath(); ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr * 0.8, R * 0.05 + 1, 0, 7); ctx.fill(); }
}
function circle(ctx, R, T, c, p) {
  const rx = R * 1.35, hot = mix(c, [255, 255, 255], 0.6);
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
