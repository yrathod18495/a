#!/usr/bin/env node
// OFFLINE conversion input only (see CLAUDE.md: the app never loads Spine data).
// Reads a character HTML page made by our older tool (the rig, the atlas pictures and the animations are JS constants inside it:
// POSES / NEWP, IMG, ANIMS_BY) and writes, for every view of one character, a standard Spine 4.2 skeleton + atlas + page picture.
// scripts/spine_to_dragonbones.py then turns those into DragonBones files, and scripts/character-zip.mjs packs the upload zip.
//
//   node scripts/character-html-to-spine.mjs <page.html> <outDir> [--character maya] [--style new|old]
//
// The page's animations are first finished the way the page itself shows them by default: its "walk variants" (limp walk) are
// added and its "new animation style" (eased keys, overlapping action) is applied. That part runs the page's own two pure functions
// inside a sandbox with a time limit; nothing else from the page is executed (the rest is read as plain data).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const [, , htmlPath, outDir, ...rest] = process.argv;
if (!htmlPath || !outDir) { console.error('Usage: node scripts/character-html-to-spine.mjs <page.html> <outDir> [--character maya] [--style new|old]'); process.exit(1); }
const opt = (name, fallback) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : fallback; };
const character = opt('character', null), style = opt('style', 'new');
const html = readFileSync(htmlPath, 'utf8');

/* ---- 1. read the data constants by bracket matching (no code is run) ---- */
function literalEnd(s, i) {
  const open = s[i];
  if (open === '"' || open === "'" || open === '`') { for (let j = i + 1; j < s.length; j++) { if (s[j] === '\\') { j++; continue; } if (s[j] === open) return j + 1; } return -1; }
  if (open !== '[' && open !== '{') return -1;
  let depth = 0, q = null;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (q) { if (c === '\\') { j++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '[' || c === '{') depth++; else if (c === ']' || c === '}') { depth--; if (depth === 0) return j + 1; }
  }
  return -1;
}
function constant(name) {
  // `const NAME = ...` or, when the page declares several constants in one statement, `, NAME = ...` (e.g. `const NEWP=[...],NEWIMG={...}`)
  const m = new RegExp(`(?:^|[;\\s])const\\s+${name}\\s*=\\s*`).exec(html) || new RegExp(`\\]\\s*,\\s*${name}\\s*=\\s*(?=[\\[{])`).exec(html) || new RegExp(`\\}\\s*,\\s*${name}\\s*=\\s*(?=[\\[{])`).exec(html);
  if (!m) return undefined;
  const start = m.index + m[0].length, end = literalEnd(html, start);
  if (end < 0) throw new Error(`${name}: the value could not be read`);
  return vm.runInNewContext(`(${html.slice(start, end)})`, {}, { timeout: 30000 });   // a literal only: objects, arrays, numbers, strings
}
const POSES = constant('POSES') || [], NEWP = constant('NEWP') || [], ANIMS_BY = constant('ANIMS_BY') || {};
const IMG = { ...(constant('IMG') || {}), ...(constant('NEWIMG') || {}) };
POSES.forEach((p) => { p.ch = p.ch || 'maya'; p.v = p.v || p.id; });
const all = [...POSES, ...NEWP];
for (const p of NEWP) if (!ANIMS_BY[p.id]) ANIMS_BY[p.id] = ANIMS_BY[p.v];

/* ---- 2. the animations as the page shows them (its own walk variants + new style), in a sandbox ---- */
function finishAnimations() {
  const lines = html.split('\n');
  const from = lines.findIndex((l) => l.startsWith('function walkVariant('));
  const to = lines.findIndex((l) => l.startsWith('function setNS('));
  if (from < 0 || to < 0) { console.warn('The page has no animation-finishing code; the animations are used as they are.'); return; }
  const code = lines.slice(from, to).join('\n');
  const sandbox = { ANIMS_BY, Math, JSON, Set, Array, Object, Number, Infinity };
  vm.runInNewContext(`${code}\n;globalThis.__done = typeof ALLAN !== 'undefined' ? ALLAN.length : -1;`, sandbox, { timeout: 60000 });
  if (style === 'old') for (const arr of new Set(Object.values(ANIMS_BY))) for (const a of arr || []) if (a._ob) a.b = a._ob;
  console.log(`animations finished by the page's own code (${style} style), styled: ${sandbox.__done}`);
}
finishAnimations();

/* ---- 3. Spine 4.2 JSON + atlas for one view ---- */
const unwrap = (keys) => { const out = []; let prev = null; for (const k of keys) { let v = k[1]; if (prev !== null) { let d = v - prev; d -= Math.floor((d + 180) / 360) * 360; v = prev + d; } out.push([k[0], v, k[2]]); prev = v; } return out; };
const round = (v, n = 4) => Math.round(v * 10 ** n) / 10 ** n;
function spineOf(P) {
  const bones = P.bones.map(([name, parent, x, y, rotation, scaleX, scaleY, shearX, shearY, inherit]) => {
    const b = { name, x: round(x), y: round(y), rotation: round(rotation), scaleX, scaleY, shearX, shearY };
    if (parent != null) b.parent = parent;
    if (inherit && inherit !== 'normal') b.inherit = inherit;
    return b;
  });
  const slots = P.slots.map(([name, bone, attachment, color, blend]) => ({ name, bone, ...(attachment ? { attachment } : {}), ...(color && color !== 'ffffffff' ? { color } : {}), ...(blend && blend !== 'normal' ? { blend } : {}) }));
  const skin = {};
  for (const [slot, atts] of Object.entries(P.att || {})) {
    for (const [key, a] of Object.entries(atts)) {
      if (!a || !P.reg[a.p]) continue;
      (skin[slot] ||= {})[key] = a.t === 'm'
        ? { type: 'mesh', path: a.p, uvs: a.uv, triangles: a.tr, vertices: a.v, hull: a.uv.length / 2, width: P.reg[a.p][6], height: P.reg[a.p][7] }
        : { path: a.p, x: round(a.x), y: round(a.y), rotation: round(a.r), scaleX: a.sx, scaleY: a.sy, width: a.w, height: a.h };
    }
  }
  const animations = {};
  for (const a of ANIMS_BY[P.id] || []) {
    const name = a.n.replace(/[^\w\- ]/g, '').trim().replace(/\s+/g, '_');
    const d = { bones: {}, slots: {} };
    for (const [bn, tl] of Object.entries(a.b || {})) {
      if (!P.bones.some((b) => b[0] === bn)) continue;
      const o = {};
      if (tl.r?.length) o.rotate = unwrap(tl.r).map(([time, value, st]) => ({ time: round(time), value: round(value), ...(st ? { curve: 'stepped' } : {}) }));
      if (tl.t?.length) o.translate = tl.t.map(([time, x, y, st]) => ({ time: round(time), x: round(x), y: round(y), ...(st ? { curve: 'stepped' } : {}) }));
      if (tl.s?.length) o.scale = tl.s.map(([time, x, y, st]) => ({ time: round(time), x: round(x), y: round(y), ...(st ? { curve: 'stepped' } : {}) }));
      if (Object.keys(o).length) d.bones[bn] = o;
    }
    for (const [sn, keys] of Object.entries(a.s || {})) {
      if (!P.slots.some((s) => s[0] === sn)) continue;
      d.slots[sn] = { attachment: keys.map(([time, name]) => ({ time: round(time), name: name ?? null })) };
    }
    if (a.d?.length) d.drawOrder = a.d.map(([time, offsets]) => ({ time: round(time), ...(offsets?.length ? { offsets: offsets.map(([slot, offset]) => ({ slot, offset })) } : {}) }));
    // keep the full length: a last key at the end so a loop lasts exactly a.l seconds
    if (a.l) { const any = Object.values(d.bones)[0]; if (any) { const tl = any.rotate || any.translate || any.scale; if (tl && tl.at(-1).time < a.l) tl.push({ ...tl.at(-1), time: round(a.l) }); } }
    animations[name] = d;
    animations[name].__meta = { label: a.n, group: a.c, length: a.l || 0, overlay: !!a.ik };
  }
  return { skeleton: { spine: '4.2.00', hash: P.id, images: './', width: 0, height: 0 }, bones, slots, skins: [{ name: 'default', attachments: skin }], animations };
}
function atlasOf(P, page, size) {
  const lines = [page, `size: ${size[0]},${size[1]}`, 'filter: Linear,Linear', 'pma: false'];
  for (const [name, [x, y, w, h, ox, oy, ow, oh]] of Object.entries(P.reg)) lines.push(name, `bounds: ${x},${y},${w},${h}`, `offsets: ${ox},${oy},${ow},${oh}`);
  return lines.join('\n') + '\n';
}
const webpSize = (buf) => {          // VP8X / VP8 / VP8L headers
  const fourcc = buf.toString('ascii', 12, 16);
  if (fourcc === 'VP8X') return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
  if (fourcc === 'VP8L') { const b = buf.readUInt32LE(21); return [(b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1]; }
  if (fourcc === 'VP8 ') return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
  throw new Error('Unknown WebP');
};

mkdirSync(outDir, { recursive: true });
const summary = [];
for (const P of all) {
  if (character && P.ch !== character) continue;
  const b64 = IMG[P.id];
  if (!b64) { console.warn(`${P.id}: no picture in the page, skipped`); continue; }
  const dir = join(outDir, P.id); mkdirSync(dir, { recursive: true });
  const buf = Buffer.from(b64, 'base64'), page = `${P.id}.webp`;
  writeFileSync(join(dir, page), buf);
  const spine = spineOf(P), meta = {};
  for (const [n, a] of Object.entries(spine.animations)) { meta[n] = a.__meta; delete a.__meta; }
  writeFileSync(join(dir, 'skeleton.json'), JSON.stringify(spine));
  writeFileSync(join(dir, 'skeleton.atlas'), atlasOf(P, page, webpSize(buf)));
  writeFileSync(join(dir, 'animations.json'), JSON.stringify(meta, null, 1));
  summary.push({ id: P.id, character: P.ch, view: P.v, label: P.label, bones: spine.bones.length, slots: spine.slots.length, animations: Object.keys(meta).length });
}
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 1));
console.table(summary);
