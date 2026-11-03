// The admin character upload: what a character ZIP must contain, where each file is stored, and how the stored record looks.
// Used by the admin screen (src/admin-characters.js), the server (server/characters-api.js, served by api/studio-assets.js) and the studio (src/cloud-characters.js).
//
// ZIP (made by scripts/character-zip.mjs): manifest.json + views/<view>/{skeleton.json, texture_<n>.json, texture_<n>.webp, animations/<name>.json}
// Storage: small JSON files (the rig, the atlas json, every animation) go to the database, gzip-compressed;
//          pictures (texture pages, GIF previews, the thumbnail) and any big file go to R2 (no download fee there, cached by the browser).
// A file is always addressed by the SHA-256 of its content, so the same file is stored once and a browser downloads it once.

export const PACKAGE_FORMAT = '12toons-character';
export const PACKAGE_VERSION = 1;
export const DB_MAX_BYTES = 192 * 1024;          // a JSON file up to this size (before compression) is kept in the database
export const MAX_VIEWS = 8, MAX_ANIMATIONS = 200, MAX_TEXTURES = 8;
export const VIEW_LABELS = { f34: '3/4 Front', fr: 'Front', sd: 'Side', bk: 'Back' };

export const slug = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
export const isSha = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export const isId = (v) => typeof v === 'string' && /^[a-z0-9][a-z0-9_]{1,59}$/.test(v);

/** "walk" + "female" -> "walk_female.gif" (the preview picture of an animation, named after its category) */
export const gifName = (animation, category) => `${slug(animation) || 'animation'}_${slug(category) || 'character'}.gif`;

/** 'db' or 'r2' for a file of the package */
export function storageOf(path, size) {
  if (/\.(webp|png|gif|jpe?g)$/i.test(path)) return 'r2';
  return size <= DB_MAX_BYTES ? 'db' : 'r2';
}

/** every problem with a manifest, in plain English ([] = fine). `files` is the list of paths inside the ZIP. */
export function checkManifest(m, files = null) {
  const errors = [], has = files ? new Set(files) : null, need = (path, what) => { if (has && !has.has(path)) errors.push(`${what} is missing from the ZIP: ${path}`); };
  if (!m || typeof m !== 'object') return ['The ZIP has no manifest.json. Please make the ZIP with scripts/character-zip.mjs.'];
  if (m.format !== PACKAGE_FORMAT) errors.push('This ZIP is not a 12toons character package (manifest.json has a different format).');
  if (m.version !== PACKAGE_VERSION) errors.push(`This package version (${m.version}) is not supported. Please make it again with the current script.`);
  if (!isId(m.character?.id)) errors.push('The character id must be 2 to 60 small letters, numbers or _.');
  if (typeof m.character?.name !== 'string' || !m.character.name.trim() || m.character.name.length > 60) errors.push('The character needs a name (up to 60 characters).');
  if (!isId(m.category?.id)) errors.push('The category id must be 2 to 60 small letters, numbers or _.');
  if (!Array.isArray(m.views) || !m.views.length || m.views.length > MAX_VIEWS) { errors.push(`The package must have 1 to ${MAX_VIEWS} views.`); return errors; }
  const seen = new Set();
  for (const v of m.views) {
    const tag = `View "${v?.id}"`;
    if (!isId(v?.id) || seen.has(v.id)) { errors.push(`${tag}: the view id is missing or repeated.`); continue; }
    seen.add(v.id);
    if (typeof v.skeleton !== 'string') errors.push(`${tag}: no skeleton file.`); else need(v.skeleton, `${tag} skeleton`);
    if (!Array.isArray(v.textures) || !v.textures.length || v.textures.length > MAX_TEXTURES) errors.push(`${tag}: 1 to ${MAX_TEXTURES} texture files are needed.`);
    else v.textures.forEach((t) => need(t, `${tag} texture`));
    if (!Array.isArray(v.animations) || v.animations.length > MAX_ANIMATIONS) errors.push(`${tag}: up to ${MAX_ANIMATIONS} animations are allowed.`);
    else {
      const names = new Set();
      for (const a of v.animations) {
        if (typeof a?.name !== 'string' || !a.name || names.has(a.name)) errors.push(`${tag}: an animation name is missing or repeated.`);
        else names.add(a.name);
        if (typeof a?.file !== 'string') errors.push(`${tag}: animation "${a?.name}" has no file.`); else need(a.file, `${tag} animation "${a.name}"`);
        if (!(Number(a?.length) > 0 && Number(a.length) < 600)) errors.push(`${tag}: animation "${a?.name}" needs a length in seconds.`);
      }
    }
  }
  return errors;
}

/* ---- the stored record ----
   A file reference is { db: <sha256> } (in the database) or { r2: <sha256>, size } (in R2); both carry the sha so the browser can cache it.
   character: { id, name, category, views: { <view>: { label, skeleton: ref, textures: [{ json: ref, page: ref }] } }, thumb: ref|null, owner, createdAt }
   category:  { id, name, views: { <view>: { animations: [{ name, label, group, layer, length, file: ref, gif: ref|null, gifName }] } }, owner, createdAt } */
const isRef = (r) => !!r && typeof r === 'object' && ((isSha(r.db) && !('r2' in r)) || (isSha(r.r2) && Number.isSafeInteger(r.size) && r.size > 0 && !('db' in r)));
export const refSha = (r) => r?.db || r?.r2 || null;

/** checks a record sent by the admin screen and returns a clean copy (only known fields); throws a plain-English message when something is wrong */
export function cleanRecord(input) {
  const bad = (message) => { throw Object.assign(new Error(message), { code: 'invalid_character', status: 400 }); };
  const ref = (r, what) => { if (!isRef(r)) bad(`${what} is not a valid file.`); return r.db ? { db: r.db } : { r2: r.r2, size: r.size }; };
  const c = input?.character, g = input?.category;
  if (!isId(c?.id) || typeof c.name !== 'string' || !c.name.trim() || c.name.length > 60) bad('The character id or name is not valid.');
  if (!isId(g?.id) || typeof g.name !== 'string' || !g.name.trim() || g.name.length > 60) bad('The category id or name is not valid.');
  const views = Object.entries(c.views || {});
  if (!views.length || views.length > MAX_VIEWS) bad(`The character must have 1 to ${MAX_VIEWS} views.`);
  const character = { id: c.id, name: c.name.trim(), category: g.id, views: {}, thumb: c.thumb ? ref(c.thumb, 'The thumbnail') : null };
  for (const [vid, v] of views) {
    if (!isId(vid)) bad('A view id is not valid.');
    if (!Array.isArray(v.textures) || !v.textures.length || v.textures.length > MAX_TEXTURES) bad(`View ${vid}: 1 to ${MAX_TEXTURES} textures are needed.`);
    character.views[vid] = { label: String(v.label || VIEW_LABELS[vid] || vid).slice(0, 40), skeleton: ref(v.skeleton, `View ${vid} skeleton`), textures: v.textures.map((t, i) => ({ json: ref(t.json, `View ${vid} texture ${i}`), page: ref(t.page, `View ${vid} picture ${i}`) })) };
  }
  let category = null;
  if (g.views) {
    category = { id: g.id, name: g.name.trim(), views: {} };
    for (const [vid, v] of Object.entries(g.views)) {
      if (!isId(vid) || !Array.isArray(v.animations) || v.animations.length > MAX_ANIMATIONS) bad(`View ${vid}: the animation list is not valid.`);
      category.views[vid] = { animations: v.animations.map((a) => {
        if (typeof a?.name !== 'string' || !a.name || a.name.length > 80) bad(`View ${vid}: an animation name is not valid.`);
        return { name: a.name, label: String(a.label || a.name).slice(0, 80), group: String(a.group || 'Body').slice(0, 30), layer: a.layer === 'hand' ? 'hand' : 'body', length: Math.min(600, Math.max(0.05, Number(a.length) || 1)),
          file: ref(a.file, `Animation ${a.name}`), gif: a.gif ? ref(a.gif, `The preview of ${a.name}`) : null, gifName: String(a.gifName || gifName(a.name, g.id)).slice(0, 120) };
      }) };
    }
  }
  return { character, category };
}

/** every file a record points to: [{ sha, where: 'db'|'r2', size }] */
export function refsOf(record) {
  const out = [], add = (r) => { if (r && refSha(r)) out.push({ sha: refSha(r), where: r.db ? 'db' : 'r2', size: r.size || 0 }); };
  for (const v of Object.values(record?.views || {})) {
    add(v.skeleton); for (const t of v.textures || []) { add(t.json); add(t.page); }
    for (const a of v.animations || []) { add(a.file); add(a.gif); }
  }
  add(record?.thumb);
  return out;
}
