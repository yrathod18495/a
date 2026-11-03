// Characters the admin uploads from a ZIP (admin panel -> Characters) and every signed-in creator can use in the studio.
// Served through api/studio-assets.js (actions "character:<name>") so the site stays within the 12 serverless functions of a Vercel Hobby plan.
// Small JSON files (rig, atlas json, animations) live in the Realtime Database, gzip-compressed; pictures and big files live in R2.
// Every file is addressed by the SHA-256 of its content. See shared/character-package.js for the record shapes.
//   list      any signed-in account: the characters with their categories (animations + GIF previews)
//   files     any signed-in account: the content of database files and short-lived download links for R2 files (only files of a character)
//   putFile   admin: store one small file (checked against its SHA-256)
//   commit    admin: save a character (and its category) after its files are stored; R2 files are checked and counted
//   delete    admin: remove a character and every file nobody else uses (database and R2); the last character of a category takes the category with it
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { services } from './firebase-admin.js';
import { maintenanceOn } from './maintenance.js';
import { access, send, failure } from './access.js';
import { kv } from './rtdb.js';
import { AccessError } from './security-policy.js';
import { configured, confirmAssets, signDownloads, deleteKey, assetKey } from './r2-storage.js';
import { cleanRecord, refsOf, isSha, isId, DB_MAX_BYTES } from '../shared/character-package.js';

const MAX_FILES_PER_CALL = 60;
const bad = (code, message, status = 400) => new AccessError(code, message, status);

/** everything a list needs, read in three calls */
async function readAll(store) {
  const [characters, categories] = await Promise.all([store.get('characters'), store.get('characterCategories')]);
  return { characters: characters || {}, categories: categories || {} };
}
/** the files still used by any character or category */
function usedFiles({ characters, categories }) {
  const used = new Set();
  for (const r of [...Object.values(characters), ...Object.values(categories)]) for (const f of refsOf(r)) used.add(f.sha);
  return used;
}
/** removes files nobody uses any more: database copies and R2 objects (with the owner's storage count) */
async function sweep(store, candidates, state) {
  const used = usedFiles(state);
  let removed = 0;
  for (const f of candidates) {
    if (used.has(f.sha)) continue;
    if (f.where === 'db') { await store.remove(`characterFiles/${f.sha}`); removed++; continue; }
    const owner = await store.get(`characterHashes/${f.sha}`);
    await store.remove(`characterHashes/${f.sha}`);
    if (!owner) continue;
    await deleteKey(assetKey(owner, f.sha));
    const size = await store.get(`assets/${owner}/${f.sha}`);
    await store.remove(`assets/${owner}/${f.sha}`);
    if (size != null) await store.transact(`usage/${owner}`, (u) => ({ ...(u || {}), bytes: Math.max(0, (u?.bytes || 0) - Number(size)), objects: Math.max(0, (u?.objects || 0) - 1), updatedAt: Date.now() }));
    removed++;
  }
  return removed;
}

/** database files of uploads that never finished (no character uses them) are removed once they are a few hours old */
const ORPHAN_AGE_MS = 6 * 3600 * 1000;
async function sweepOrphans(store, state) {
  const files = (await store.get('characterFiles')) || {}, used = usedFiles(state), now = Date.now();
  let removed = 0;
  for (const [sha, row] of Object.entries(files)) if (!used.has(sha) && now - Number(row?.at || 0) > ORPHAN_AGE_MS) { await store.remove(`characterFiles/${sha}`); removed++; }
  return removed;
}

export const CHARACTER_BODY_MAX = 600 * 1024;
/** one character action; `b` is the request body with its action name without the "character:" prefix */
export async function characterAction(req, res, b) {
  try {
    const adminAction = ['putFile', 'commit', 'delete'].includes(b.action);
    const who = await access(req, { admin: adminAction, write: adminAction, cache: !adminAction });
    if (!who.admin && await maintenanceOn()) throw bad('maintenance', '12toons is under maintenance right now. Please try again shortly.', 503);
    const store = kv(services());

    if (b.action === 'list') {
      const { characters, categories } = await readAll(store);
      const list = Object.values(characters).filter((c) => c.enabled !== false).sort((a, z) => String(a.name).localeCompare(String(z.name)))
        .map(({ owner, ...c }) => { const g = categories[c.category]; return { ...c, categoryName: g?.name || c.category, animations: g?.views || {} }; });
      return send(res, 200, { characters: list });
    }

    if (b.action === 'files') {
      const refs = Array.isArray(b.refs) ? b.refs : [];
      if (!refs.length || refs.length > MAX_FILES_PER_CALL) throw bad('invalid_files', `Ask for 1 to ${MAX_FILES_PER_CALL} files at a time.`);
      const db = {}, r2 = {}, owners = new Map();
      for (const r of refs) {
        if (isSha(r?.db)) { const row = await store.get(`characterFiles/${r.db}`); if (row?.gz) db[r.db] = row.gz; continue; }
        if (isSha(r?.r2)) { const owner = await store.get(`characterHashes/${r.r2}`); if (owner) { if (!owners.has(owner)) owners.set(owner, []); owners.get(owner).push(r.r2); } continue; }
        throw bad('invalid_files', 'A file reference is not valid.');
      }
      for (const [owner, hashes] of owners) Object.assign(r2, await signDownloads(owner, hashes));
      return send(res, 200, { db, r2 });
    }

    if (b.action === 'putFile') {
      if (!isSha(b.sha) || typeof b.gz !== 'string' || !b.gz) throw bad('invalid_file', 'The file is not valid.');
      if (await store.get(`characterFiles/${b.sha}/size`)) return send(res, 200, { ok: true, existed: true });   // the same content is stored once
      let raw;
      try { raw = gunzipSync(Buffer.from(b.gz, 'base64'), { maxOutputLength: DB_MAX_BYTES + 1 }); } catch { throw bad('invalid_file', 'The file could not be read. Please try the upload again.'); }
      if (raw.length > DB_MAX_BYTES) throw bad('file_too_large', 'This file is too big for the database; it should go to R2.');
      if (createHash('sha256').update(raw).digest('hex') !== b.sha) throw bad('invalid_file', 'The file changed on the way. Please try the upload again.');
      try { JSON.parse(raw.toString('utf8')); } catch { throw bad('invalid_file', 'Only JSON files are stored in the database.'); }
      await store.set(`characterFiles/${b.sha}`, { gz: b.gz, size: raw.length, at: Date.now() });
      return send(res, 200, { ok: true });
    }

    if (b.action === 'commit') {
      let record;
      try { record = cleanRecord(b); } catch (e) { throw bad(e.code || 'invalid_character', e.message); }
      const { character, category } = record;
      const state = await readAll(store);
      const existingCategory = state.categories[character.category];
      if (!category && !existingCategory) throw bad('category_missing', `The category "${character.category}" does not exist yet. Upload a ZIP that brings its animations first.`);
      const refs = [...refsOf(character), ...(category ? refsOf(category) : [])];
      // every database file must be stored, every R2 file must really be in R2 (checked and counted once, like a project save)
      for (const f of refs.filter((x) => x.where === 'db')) if (!(await store.get(`characterFiles/${f.sha}/size`))) throw bad('file_missing', 'A file was not uploaded completely. Please try again.', 409);
      const r2 = refs.filter((x) => x.where === 'r2');
      if (r2.length && !configured()) throw bad('storage_unavailable', 'Cloud storage is not set up yet.', 503);
      if (r2.length) await confirmAssets(who.uid, store, r2.map((x) => ({ hash: x.sha, size: x.size })));
      for (const f of r2) if (!(await store.get(`characterHashes/${f.sha}`))) await store.set(`characterHashes/${f.sha}`, who.uid);
      // the views of the character need animations in its category
      const views = (category || existingCategory).views || {};
      for (const vid of Object.keys(character.views)) if (!views[vid]) throw bad('view_mismatch', `The category "${character.category}" has no animations for the view "${vid}".`);
      const now = Date.now(), old = state.characters[character.id], oldCategory = category ? existingCategory : null;
      if (category) state.categories[category.id] = { ...category, owner: who.uid, createdAt: oldCategory?.createdAt || now, updatedAt: now };
      state.characters[character.id] = { ...character, owner: who.uid, enabled: true, createdAt: old?.createdAt || now, updatedAt: now };
      if (category) await store.set(`characterCategories/${category.id}`, state.categories[category.id]);
      await store.set(`characters/${character.id}`, state.characters[character.id]);
      // what the replaced character / category used and nobody uses now is removed
      const removed = await sweep(store, [...(old ? refsOf(old) : []), ...(oldCategory ? refsOf(oldCategory) : [])], state);
      return send(res, 200, { ok: true, character: state.characters[character.id], replaced: !!old, categoryCreated: !!category && !oldCategory, removedFiles: removed });
    }

    if (b.action === 'delete') {
      if (!isId(b.id)) throw bad('invalid_character', 'The character is not valid.');
      const state = await readAll(store), c = state.characters[b.id];
      if (!c) throw bad('not_found', 'This character does not exist any more.', 404);
      delete state.characters[b.id];
      await store.remove(`characters/${b.id}`);
      const candidates = refsOf(c);
      // the last character of a category: its animations and GIF previews go too
      const g = state.categories[c.category], categoryEmpty = g && !Object.values(state.characters).some((x) => x.category === c.category);
      if (categoryEmpty) { delete state.categories[c.category]; await store.remove(`characterCategories/${c.category}`); candidates.push(...refsOf(g)); }
      const removed = await sweep(store, candidates, state) + await sweepOrphans(store, state);
      return send(res, 200, { ok: true, removedFiles: removed, categoryRemoved: !!categoryEmpty });
    }

    throw bad('unknown_action', 'This character action was not recognized.');
  } catch (error) { return failure(res, error); }
}
