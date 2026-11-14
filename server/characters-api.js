// Characters the admin uploads from a ZIP (admin panel -> Characters) and every signed-in creator can use in the studio.
// Served through api/studio-assets.js (actions "character:<name>") so the site stays within the 12 serverless functions of a Vercel Hobby plan.
// Small JSON files (rig, atlas json, animations) live in the Realtime Database, gzip-compressed; pictures and big files live in R2.
// Every file is addressed by the SHA-256 of its content. See shared/character-package.js for the record shapes.
//   list      any signed-in account: the characters with their categories (animations + GIF previews)
//   files     any signed-in account: the content of database files and short-lived download links for R2 files (only files of a character)
//   putFile   admin: store one small file (checked against its SHA-256)
//   commit    admin: save a character (and its category) after its files are stored; R2 files are checked and counted
//   delete    admin: remove a character and every file nobody else uses (database and R2); the last character of a category takes the category with it
//   buy       any signed-in account: buy a paid character with Coins for 30 days (server clock); see docs/CHARACTER-STORE.md
//   sales     admin: the newest purchases and gifts          grant  admin: give an account 30 days of a paid character
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { services } from './firebase-admin.js';
import { maintenanceOn } from './maintenance.js';
import { access, send, failure } from './access.js';
import { kv } from './rtdb.js';
import { AccessError } from './security-policy.js';
import { configured, confirmAssets, signDownloads, deleteKey, assetKey } from './r2-storage.js';
import { cleanRecord, refsOf, isSha, isId, isGroup, DB_MAX_BYTES } from '../shared/character-package.js';
import { cleanStore, cleanViewStore, isPaid, isActive, hasStore, viewStoreOf, viewUsable, onSale, accessKey, viewFiles, categoryViewFiles, viewPreviewFiles, lockedPose } from '../shared/character-store.js';
import { accessOf, buyCharacter, grantCharacter, recentSales, validOpId } from './character-store.js';
import { lookupAccount } from './signup-bonus.js';

const MAX_FILES_PER_CALL = 60;
const bad = (code, message, status = 400) => new AccessError(code, message, status);

/** everything a list needs, read in three calls */
async function readAll(store) {
  const [characters, categories] = await Promise.all([store.get('characters'), store.get('characterCategories')]);
  return { characters: characters || {}, categories: categories || {} };
}
/** the whole library, remembered for a few seconds per server instance (the `files` check runs for every batch of files); a write forgets it */
let stateCache = { at: 0, state: null };
const forgetState = () => { stateCache = { at: 0, state: null }; };
async function cachedState(store, fresh = false) {
  if (!fresh && stateCache.state && Date.now() - stateCache.at < 15000) return stateCache.state;
  stateCache = { at: Date.now(), state: await readAll(store) };
  return stateCache.state;
}
/** the files this account may download: everything of free characters, everything of paid characters it has bought (and not expired), and only the
 *  thumbnails / previews of the paid characters on sale. An admin may download everything. */
function allowedFiles(state, access, now) {
  const allowed = new Set(), add = (refs) => { for (const r of refs) allowed.add(r.db || r.r2); };
  for (const c of Object.values(state.characters)) {
    if (c.enabled === false) continue;
    const g = state.categories[c.category];
    for (const [viewId, view] of Object.entries(c.views || {})) {
      if (viewUsable(c, viewId, access, now)) { add(viewFiles(view)); add(categoryViewFiles(g?.views?.[viewId])); }
      else if (onSale(c, viewId) || onSale(c)) add(viewPreviewFiles(view));
    }
    if (c.thumb && (isPaid(c) ? onSale(c) || isActive(access.get(accessKey(c.id)), now) : true)) add([c.thumb]);
  }
  return allowed;
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
    const adminWrite = ['putFile', 'commit', 'delete', 'update', 'grant'].includes(b.action), adminAction = adminWrite || b.action === 'sales';
    const who = await access(req, { admin: adminAction, write: adminWrite || b.action === 'buy', cache: !adminAction && b.action !== 'buy' });
    if (!who.admin && await maintenanceOn()) throw bad('maintenance', '12toons is under maintenance right now. Please try again shortly.', 503);
    const svc = services(), store = kv(svc), firestore = svc.db, now = Date.now();

    if (b.action === 'list') {
      const { characters, categories } = await readAll(store);
      const owned = who.admin || !Object.values(characters).some(hasStore) ? new Map() : await accessOf(firestore, who.uid);       // one small read, and only when something is for sale
      const list = [];
      for (const c of Object.values(characters).filter((x) => x.enabled !== false).sort((a, z) => String(a.name).localeCompare(String(z.name)))) {
        const g = categories[c.category], categoryName = g?.name || c.category, { owner, ...rest } = c;
        const whole = owned.get(accessKey(c.id)), wholeAccess = whole ? { access: { expiresAt: whole.expiresAt } } : {};
        if (who.admin || !hasStore(c)) { list.push({ ...rest, categoryName, animations: g?.views || {}, ...wholeAccess }); continue; }
        // every pose is checked: usable ones come in full; the others only as pictures with their price (and when it ends, if it was bought)
        const views = {}, animations = {}; let usable = 0, offer = isPaid(c) ? onSale(c) : false;
        for (const [viewId, view] of Object.entries(c.views || {})) {
          if (viewUsable(c, viewId, owned, now)) {
            const bought = viewStoreOf(c, viewId) && owned.get(accessKey(c.id, viewId));          // a pose that was bought: when it ends
            views[viewId] = bought ? { ...view, access: { expiresAt: bought.expiresAt } } : view;
            if (g?.views?.[viewId]) animations[viewId] = g.views[viewId]; usable++; continue;
          }
          const own = viewStoreOf(c, viewId), mine = owned.get(accessKey(c.id, viewId));
          views[viewId] = lockedPose(view, { ...(own ? { store: own } : {}), ...(mine ? { access: { expiresAt: mine.expiresAt } } : {}) });
          if (onSale(c, viewId)) offer = true;
        }
        if (usable === Object.keys(c.views || {}).length) list.push({ ...rest, views, categoryName, animations, ...wholeAccess });
        else if (usable || offer) list.push({ ...rest, views, categoryName, animations, ...(usable ? {} : { locked: true }), ...(usable ? { partial: true } : {}), ...wholeAccess });
      }
      return send(res, 200, { characters: list, serverNow: now });
    }

    if (b.action === 'buy') {
      if (!isId(b.id)) throw bad('invalid_character', 'The character is not valid.');
      const character = await store.get(`characters/${b.id}`);
      if (!character) throw bad('not_found', 'This character does not exist any more.', 404);
      if (b.view != null && !isId(b.view)) throw bad('invalid_character', 'The pose is not valid.');
      const out = await buyCharacter({ db: firestore, character, viewId: b.view || null, uid: who.uid, email: who.claims?.email || '', name: who.claims?.name || '', price: b.price, opId: b.opId, now });
      return send(res, 200, out);
    }

    if (b.action === 'sales') {
      return send(res, 200, { sales: await recentSales(firestore, 100), serverNow: now });
    }

    if (b.action === 'grant') {
      if (!isId(b.id)) throw bad('invalid_character', 'The character is not valid.');
      const character = await store.get(`characters/${b.id}`);
      if (!character) throw bad('not_found', 'This character does not exist any more.', 404);
      const account = await lookupAccount({ db: firestore, auth: svc.auth }, b.email);
      if (b.view != null && !isId(b.view)) throw bad('invalid_character', 'The pose is not valid.');
      const out = await grantCharacter({ db: firestore, character, viewId: b.view || null, uid: account.uid, email: account.email, name: account.name, by: who.uid, now });
      return send(res, 200, { ...out, email: account.email });
    }

    if (b.action === 'files') {
      const refs = Array.isArray(b.refs) ? b.refs : [];
      if (!refs.length || refs.length > MAX_FILES_PER_CALL) throw bad('invalid_files', `Ask for 1 to ${MAX_FILES_PER_CALL} files at a time.`);
      const db = {}, r2 = {}, owners = new Map();
      // a paid character's files are given only to its buyers (and admins); nothing else changes for free characters
      let allowed = null;
      if (!who.admin) {
        let state = await cachedState(store);
        if (Object.values(state.characters).some(hasStore)) {
          const mine = await accessOf(firestore, who.uid), check = (st) => allowedFiles(st, mine, now);
          allowed = check(state);
          if (refs.some((r) => !allowed.has(r?.db || r?.r2))) { state = await cachedState(store, true); allowed = check(state); }          // a change may be newer than the remembered library
        }
      }
      for (const r of refs) {
        if (allowed && !allowed.has(r?.db || r?.r2)) continue;
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
      // the price: sent with the upload (null = free), else the old one stays (replacing a character does not make it free by accident)
      let priced = old?.store || null;
      if (b.character?.store !== undefined) { try { priced = cleanStore(b.character.store); } catch (e) { throw bad(e.code, e.message); } }
      let posePrices = old?.viewStore || null;                      // the same for the prices of single poses
      if (b.character?.viewStore !== undefined) { try { posePrices = cleanViewStore(b.character.viewStore, Object.keys(character.views)); } catch (e) { throw bad(e.code || 'invalid_price', e.message); } }
      state.characters[character.id] = { ...character, ...(priced ? { store: priced } : {}), ...(posePrices ? { viewStore: posePrices } : {}), owner: who.uid, enabled: true, createdAt: old?.createdAt || now, updatedAt: now };
      forgetState();
      if (category) await store.set(`characterCategories/${category.id}`, state.categories[category.id]);
      await store.set(`characters/${character.id}`, state.characters[character.id]);
      // what the replaced character / category used and nobody uses now is removed
      const removed = await sweep(store, [...(old ? refsOf(old) : []), ...(oldCategory ? refsOf(oldCategory) : [])], state);
      return send(res, 200, { ok: true, character: state.characters[character.id], replaced: !!old, categoryCreated: !!category && !oldCategory, removedFiles: removed });
    }

    if (b.action === 'update') {                                  // the admin renames a character or changes its group (Male / Female / Boy / Girl)
      if (!isId(b.id)) throw bad('invalid_character', 'The character is not valid.');
      const c = await store.get(`characters/${b.id}`);
      if (!c) throw bad('not_found', 'This character does not exist any more.', 404);
      const next = { ...c };
      if (b.name !== undefined) {
        const name = typeof b.name === 'string' ? b.name.trim() : '';
        if (!name || name.length > 60) throw bad('invalid_name', 'The name must be 1 to 60 characters.');
        next.name = name;
      }
      if (b.group !== undefined) { if (!isGroup(b.group)) throw bad('invalid_group', 'The group must be Male, Female, Boy or Girl.'); next.group = b.group; }
      if (b.store !== undefined) { const priced = (() => { try { return cleanStore(b.store); } catch (e) { throw bad(e.code, e.message); } })(); if (priced) next.store = priced; else delete next.store; }
      if (b.viewStore !== undefined) { try { const vs = cleanViewStore(b.viewStore, Object.keys(next.views || {})); if (vs) next.viewStore = vs; else delete next.viewStore; } catch (e) { throw bad(e.code || 'invalid_price', e.message); } }
      next.updatedAt = Date.now(); forgetState();
      await store.set(`characters/${b.id}`, next);
      const { owner, ...visible } = next;
      return send(res, 200, { ok: true, character: visible });
    }

    if (b.action === 'delete') {
      if (!isId(b.id)) throw bad('invalid_character', 'The character is not valid.');
      const state = await readAll(store), c = state.characters[b.id];
      if (!c) throw bad('not_found', 'This character does not exist any more.', 404);
      delete state.characters[b.id]; forgetState();
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
