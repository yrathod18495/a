#!/usr/bin/env node
// Builds public/catalog/{animations,characters}.json for Toon Studio.
//
//   node scripts/sync-catalog.mjs --har path/to/studio.stpro.app.har.json   # offline, from a browser HAR capture
//   STPRO_TOKEN=<bearer token> node scripts/sync-catalog.mjs --live         # full refresh from the API (adds everything the HAR didn't cover)
//   --har and --live can be combined (HAR first, then live fills the gaps).
//
// The token is only ever read from the environment, it is never written to disk or to the catalog.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const API = 'https://api.stpro.app/api/Initial/', CDN = 'https://assets.stpro.app/';
const out = new URL('../public/catalog/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const arg = (k) => { const i = process.argv.indexOf(k); return i < 0 ? null : (process.argv[i + 1]?.startsWith('--') ? true : process.argv[i + 1] ?? true); };
const load = (f) => (existsSync(out + f) ? JSON.parse(readFileSync(out + f, 'utf8')) : null);

// ---- state (starts from the existing catalog so runs are additive) ----
const animCat = load('animations.json') || { base: CDN, patterns: {} };
const charCat = load('characters.json') || { base: CDN, characters: [] };
const pat = (id) => (animCat.patterns[id] ||= { categories: {} });
function addAnimation(patternId, categoryId, categoryName, a) {
  if (!a.jsonFile) return;
  const cat = (pat(patternId).categories[categoryId] ||= { id: categoryId, name: categoryName || `Category ${categoryId}`, animations: [] });
  if (categoryName) cat.name = categoryName;
  if (cat.animations.some((x) => x.id === a.animationId)) return;
  cat.animations.push({ id: a.animationId, name: a.name || a.previewName, file: a.jsonFile, preview: a.gifFile || null, length: a.totalLength, expression: !!a.isExpression, gender: a.gender || null });
}
const charById = new Map(charCat.characters.map((c) => [c.id, c]));
function addCharacter(c) { charById.set(c.id, { ...(charById.get(c.id) || {}), ...c }); }

// ---- HAR ----
const harPath = arg('--har');
if (harPath && harPath !== true) {
  const entries = JSON.parse(readFileSync(harPath, 'utf8')).log.entries;
  const bodies = entries.filter((e) => e.request.method === 'GET').map((e) => {
    let b = null; try { b = JSON.parse(e.response.content.text || 'null'); } catch { /* not json */ }
    return { url: new URL(e.request.url), b };
  }).filter((x) => x.b);
  const q = (u, k) => u.searchParams.get(k);
  const catNames = new Map();
  for (const { url, b } of bodies) if (url.pathname.endsWith('getAnimationCategories')) for (const c of b.categories || []) catNames.set(`${c.patternId}:${c.id}`, c.name);
  for (const { url, b } of bodies) {
    if (/getAnimation(Categories|sByCategoryId)$/.test(url.pathname)) {
      const patternId = +q(url, 'patternId'), categoryId = +(q(url, 'categoryId') ?? b.firstCategoryId ?? 0);
      if (url.pathname.endsWith('getAnimationCategories')) { // first page of the first category is bundled in this response
        for (const c of b.categories || []) pat(patternId).categories[c.id] ||= { id: c.id, name: c.name, animations: [] };
      }
      for (const a of b.animations || []) addAnimation(patternId, categoryId, catNames.get(`${patternId}:${categoryId}`), a);
    }
    if (url.pathname.endsWith('GetCharacterListbyIds')) for (const c of b.data || []) addCharacter({ id: c.characterId, bundleId: c.characterBundleId, name: c.characterName, pose: c.characterPoseName, patternId: c.charPatternId, skeletonId: c.characterSkeletonId, paid: !!c.isPaid, thumbnail: c.thumbnail });
    if (url.pathname.endsWith('getCharacterDataById') && b.data) addCharacter(fromData(b.data));
    if (url.pathname.includes('/Animation/getScene')) { /* scene json itself is fetched from the CDN below */ }
  }
  for (const e of entries) { // characters embedded in saved scenes
    if (!/\/Scenes\/.*\.json$/.test(e.request.url)) continue;
    try { for (const a of JSON.parse(e.response.content.text).assets || []) if (a.type === 'character') addCharacter(fromData(a)); } catch { /* skip */ }
  }
}
function fromData(d) {
  let images = {};
  try { for (const s of JSON.parse(d.subImages || '[]')) images[s.fileName] = s.animationFile; } catch { /* none */ }
  return {
    id: d.characterId, bundleId: d.characterBundleId, name: d.characterFullName ? d.characterFullName.replace(new RegExp(`\\s*${d.characterName}$`), '') : d.characterName,
    pose: d.charPattern || d.characterName, patternId: d.charPatternId, skeletonId: d.characterSkeletonId, paid: !!d.isPaid,
    thumbnail: d.thumbnail || d.characterSourceThumbnail || null, json: d.characterJSON, atlas: d.characterATLAS, images,
    lipSync: d.lipSyncData ? JSON.parse(d.lipSyncData) : undefined,
  };
}

// ---- live API ----
if (arg('--live')) {
  const token = process.env.STPRO_TOKEN;
  if (!token) { console.error('Set STPRO_TOKEN (Bearer token from studio.stpro.app) for --live'); process.exit(1); }
  const get = async (path) => {
    const r = await fetch(API + path, { headers: { Authorization: `Bearer ${token}`, Origin: 'https://studio.stpro.app', Accept: 'application/json' } });
    if (!r.ok) throw new Error(`${r.status} ${path}`);
    return r.json();
  };
  const paged = async (path, size, pick) => {
    const all = [];
    for (let page = 1; page < 200; page++) {
      const r = await get(`${path}${path.includes('?') ? '&' : '?'}page=${page}&pageSize=${size}`), rows = pick(r) || [];
      if (!rows.length) break; all.push(...rows); if (rows.length < size) break;
    }
    return all;
  };
  // 1. every Max (pro) human bundle -> its "3-4 Front" (pattern 2) character -> file urls
  const bundles = await paged('getCharactersBundleBySubTypeId?typeId=1&subTypeId=2', 14, (r) => r.data);
  console.log(`${bundles.length} bundles`);
  for (const b of bundles) {
    try {
      const list = (await get(`GetCharacterListbyIds?CharacterBundleId=${b.characterBundleId}&paramCharPatternId=2`)).data || [];
      for (const c of list.filter((x) => x.charPatternId === 2)) {
        addCharacter({ id: c.characterId, bundleId: b.characterBundleId, name: c.characterName, pose: c.characterPoseName, patternId: 2, skeletonId: c.characterSkeletonId, paid: !!c.isPaid, thumbnail: c.thumbnail || b.thumbnail });
        addCharacter(fromData((await get(`getCharacterDataById?CharacterId=${c.characterId}`)).data));
        console.log('  +', c.characterName, c.characterPoseName);
      }
    } catch (e) { console.warn('  skip bundle', b.characterBundleId, e.message); }
  }
  // 2. every animation for each skeleton we know, per category
  const skeletons = new Map();
  for (const c of charById.values()) if (c.skeletonId) skeletons.set(`${c.patternId}:${c.skeletonId}`, [c.patternId, c.skeletonId]);
  for (const [patternId, skeletonId] of skeletons.values()) {
    const base = `typeId=1&subTypeId=2&patternId=${patternId}&skeletonId=${skeletonId}`;
    const cats = await paged(`getAnimationCategories?${base}`, 10, (r) => r.categories);
    for (const c of cats) {
      for (const a of await paged(`getAnimationsByCategoryId?categoryId=${c.id}&${base}`, 14, (r) => r.animations)) addAnimation(patternId, c.id, c.name, a);
    }
    console.log(`animations for pattern ${patternId} skeleton ${skeletonId} done`);
  }
}

// ---- write ----
animCat.patterns = Object.fromEntries(Object.entries(animCat.patterns).map(([p, v]) => [p, { categories: Object.values(v.categories).filter((c) => c.animations.length) }]));
charCat.characters = [...charById.values()].sort((a, b) => b.id - a.id);
writeFileSync(out + 'animations.json', JSON.stringify(animCat));
writeFileSync(out + 'characters.json', JSON.stringify(charCat));
const nAnim = Object.values(animCat.patterns).flatMap((p) => p.categories).reduce((n, c) => n + c.animations.length, 0);
console.log(`animations: ${nAnim} · characters: ${charCat.characters.length} (${charCat.characters.filter((c) => c.json).length} with files)`);
