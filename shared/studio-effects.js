// Props and effects published by admins (studioAssets collection, types 'prop' and 'effect') and how the studio places them.
// A prop is a picture on the stage. An effect is a picture (or sprite sheet) that covers the whole frame in front of the characters
// (rain, sparkles, light leaks …) with a blend mode and an opacity. Both are kept as "props" inside a scene, so saving, undo,
// cloud sync and video export treat them the same way.
export const EFFECT_BLENDS = Object.freeze({ normal: 0, add: 1, screen: 12 });
export const EFFECT_PLACEMENTS = Object.freeze(['full', 'sticker']);
export const ASSET_CATEGORY_MAX = 40;
export const THUMB_MAX_CHARS = 9000;
export const THUMB_PATTERN = /^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/;

const bad = (message) => Object.assign(new Error(message), { status: 400, code: 'invalid_effect' });
const num = (value, min, max, fallback) => { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; };

/** the part of an asset record that is not the file itself: category, thumbnail and (for effects) blend / opacity / sprite sheet */
export function cleanAssetMeta(type, input = {}) {
  const meta = {};
  const category = String(input.category ?? '').trim().slice(0, ASSET_CATEGORY_MAX);
  if (category) meta.category = category;
  if (input.thumb != null && input.thumb !== '') {
    if (typeof input.thumb !== 'string' || input.thumb.length > THUMB_MAX_CHARS || !THUMB_PATTERN.test(input.thumb)) throw bad('Thumbnail sahi nahi hai. Image dobara upload karein.');
    meta.thumb = input.thumb;
  }
  if (type !== 'effect') return meta;
  const blend = input.blend ?? 'normal';
  if (!(blend in EFFECT_BLENDS)) throw bad('Blend mode sahi nahi hai.');
  const placement = input.placement ?? 'full';
  if (!EFFECT_PLACEMENTS.includes(placement)) throw bad('Placement sahi nahi hai.');
  Object.assign(meta, { blend, placement, opacity: +num(input.opacity, 0.05, 1, 1).toFixed(2) });
  if (input.sheet) {
    const cols = Math.floor(Number(input.sheet.cols)), rows = Math.floor(Number(input.sheet.rows)), fps = Number(input.sheet.fps);
    if (!(cols >= 1 && cols <= 16 && rows >= 1 && rows <= 16 && cols * rows >= 2 && cols * rows <= 144 && fps >= 1 && fps <= 60)) throw bad('Sprite sheet ke columns, rows (kul 2 se 144 frames) aur fps (1 se 60) sahi likhein.');
    meta.sheet = { cols, rows, fps: +fps.toFixed(1) };
  }
  return meta;
}

/** which part (u0, v0, u1, v1) of a sprite sheet is on screen at time t; a plain picture is always the whole picture */
export function sheetUv(sheet, t = 0) {
  if (!sheet || !(sheet.cols * sheet.rows > 1)) return [0, 0, 1, 1];
  const frames = sheet.cols * sheet.rows, index = Math.floor(Math.max(0, t) * (sheet.fps || 12)) % frames;
  const col = index % sheet.cols, row = Math.floor(index / sheet.cols);
  return [col / sheet.cols, row / sheet.rows, (col + 1) / sheet.cols, (row + 1) / sheet.rows];
}

export const isEffect = (prop) => prop?.kind === 'effect';
/** is the prop on screen at time t (props and effects may be limited to a time range) */
export const propActive = (prop, t) => prop && prop.visible !== false && (prop.start == null || t >= prop.start) && (prop.end == null || t < prop.end);

/** a new scene prop from a shared library asset */
export function propFromAsset(asset, blob, id) {
  const base = { id, assetId: asset.id, name: asset.name, blob, rotation: 0, visible: true };
  if (asset.type !== 'effect') return { ...base, kind: 'prop', x: 0.5, y: 0.66, w: 0.18, h: 0.18, ...(asset.category ? { category: asset.category } : {}) };
  const full = asset.placement !== 'sticker';
  return { ...base, kind: 'effect', x: 0.5, y: full ? 0.5 : 0.4, w: full ? 1 : 0.3, h: full ? 1 : 0.3, opacity: asset.opacity ?? 1, blend: asset.blend || 'normal', ...(asset.sheet ? { sheet: { ...asset.sheet } } : {}), ...(asset.category ? { category: asset.category } : {}) };
}

/* ---- props held in a character's hand: the prop follows the hand bone of that character ---- */
export const HAND_BONES = Object.freeze({ L: 'L_Palm', R: 'R_Palm' });
export const isHeld = (prop) => !!prop?.attach?.key && prop.attach.hand in HAND_BONES;
/** where a held prop sits: the palm of `layer`'s character in canvas pixels, plus the direction the hand points (upright prop = 0).
    A mirrored character mirrors the prop too. Returns null when the character has no such hand, 'hidden' while the character is off screen. */
export function heldAt(layer, hand) {
  if (!layer || layer.visible === false || layer.shown === false) return 'hidden';
  const bone = layer.arm?.getBone(HAND_BONES[hand]);
  if (!bone) return null;
  const m = bone.globalTransformMatrix, M = layer.mat, mirrored = M[0] * M[3] - M[1] * M[2] < 0;
  const vx = M[0] * m.a + M[2] * m.b, vy = M[1] * m.a + M[3] * m.b;
  return { x: M[0] * m.tx + M[2] * m.ty + M[4], y: M[1] * m.tx + M[3] * m.ty + M[5], angle: mirrored ? -Math.atan2(vy, -vx) : Math.atan2(vy, vx), mirrored };
}
/** centre and angle of a held prop of size w x h: the grip point of the picture (default its middle) sits in the palm */
export function heldPlacement(prop, held, w, h) {
  const grip = prop.grip || { x: 0.5, y: 0.5 }, turn = (prop.follow === false ? 0 : held.angle) + (held.mirrored ? -1 : 1) * (prop.rotation || 0) * Math.PI / 180;
  const gx = (grip.x - 0.5) * w * (held.mirrored ? -1 : 1), gy = (grip.y - 0.5) * h, c = Math.cos(turn), s = Math.sin(turn);
  return { cx: held.x - (c * gx - s * gy), cy: held.y - (s * gx + c * gy), angle: turn, mirrored: held.mirrored };
}

