import { listStudioAssets, loadStudioAnimation } from './studio-assets.js';
import { AssetCache } from './asset-cache.js';
import { testerAnimationAllowed } from './tester-animation-policy.js';
// Bundled 12toons characters and their animation library.

import { loadAnimRules, cachedRules, loadTesterConfig } from './cloud.js';
import { rigInfo, dirOf } from './db/info.js';
import { bakeSke } from './rigedit.js';
import { setFit } from './universal.js';

const BASE = import.meta.env.BASE_URL;
let library = [], adAnims = null, managedAnimations = [];

/* ---- admin rules: animations the admin switched off. { '*': [ids for every character], neha: [ids], mybaby: [ids] } ---- */
let hiddenRules = {};
export const setAnimRules = (r) => { hiddenRules = (r && r.hidden) || {}; };
export const getAnimRules = () => hiddenRules;
/* ---- tester rules: the only animations testers may use { anims: {'*': [ids], neha: [ids]}, limit } ---- */
let testerRules = { anims: {}, limit: 0, admin: false, blockedAnims: {}, verified: false, hiddenGroups: {}, blockedDownloads: {} };
export const setTesterRules = (r) => { testerRules = { anims: (r && r.anims) || {}, limit: (r && +r.limit) || 0, admin: r?.admin === true, blockedAnims: r?.blockedAnims || {}, verified: !!r, hiddenGroups: r?.hiddenGroups || {}, blockedDownloads: r?.blockedDownloads || {} }; };
export const getTesterRules = () => testerRules;
export async function refreshTesterRules() {
  setTesterRules(null);
  try { const r = await Promise.race([loadTesterConfig(), new Promise((res) => setTimeout(() => res(null), 2500))]); if (r) setTesterRules(r); } catch { setTesterRules(null); }
}
const isHiddenAnim = (rig, id) => { const k = String(id), all = hiddenRules['*'], mine = rig?.toonChar && hiddenRules[rig.toonChar]; return !!(all?.includes(k) || mine?.includes(k)); };

export async function loadCatalog() {
  setAnimRules(cachedRules());   // last published rules kept on this device, then the fresh ones (waits at most 2.5 s)
  try { const r = await Promise.race([loadAnimRules(), new Promise((res) => setTimeout(() => res(null), 2500))]); if (r) setAnimRules(r); } catch { /* keep the cached rules */ }
  library = [];
  adAnims = null; managedAnimations = [];
  try { managedAnimations = (await listStudioAssets()).filter(asset => asset.type === 'animation'); } catch { /* Bundled catalog stays available without account storage. */ }
  // 12toons template characters (layered SVG characters, five poses each) + their animation library
  try {
    const [chars, anims] = await Promise.all([fetch(`${BASE}12toons/characters.json`).then((r) => r.json()), fetch(`${BASE}12toons/animations.json`).then((r) => r.json())]);
    adAnims = anims;
    const mine = chars.characters.flatMap((c) => c.poses.map((p) => ({ id: `ad-${c.id}-${p.pose}`, name: c.name, pose: p.label, patternId: p.own ? 'rig' : `ad:${p.pose}`, charBase: c.id, thumbnail: `12toons/pose/${c.id}-${p.pose}.webp`, template: p, paid: false })));
    library = mine;
  } catch (e) { console.warn('12toons data failed to load', e); }
}
export const libraryCharacters = () => library;
export const cdn = (p) => url(p);

/** Downloads a character (DragonBones skeleton + texture atlases + pictures) from its files and returns the same shape ingest() produces. */
export async function fetchLibraryCharacter(entry) {
  const ok = (r) => { if (!r.ok) throw new Error(`File load nahi hui (code ${r.status}): ${r.url}`); return r; };
  if (!entry?.template) throw new Error('Ye character template ab available nahi hai.');
  const a = entry.template, load = async () => {
    const [ske, texJsons] = await Promise.all([fetch(url(a.ske)).then(ok).then((r) => r.json()), Promise.all(a.tex.map((u) => fetch(url(u)).then(ok).then((r) => r.json())))]);
    const blobs = await Promise.all(texJsons.map((t, i) => fetch(url(dirOf(a.tex[i]) + t.imagePath)).then(ok).then((r) => r.blob())));
    return { ske, tex: texJsons.map((json, i) => ({ json, image: blobs[i] })) };
  };
  const { ske, tex } = await load();
  // own = the rig brings its animations (Village Boy, SVG Multi): listed in animIndex, one file each in animDir
  let animList = null;
  if (a.own && a.animIndex) animList = await fetch(url(a.animIndex)).then(ok).then((r) => r.json());
  const rig = rigInfo(ske, { templateId: entry.id, toonChar: entry.charBase, ...(a.own ? { animList, animDir: a.animDir } : { toonPattern: entry.patternId }) });
  return { skins: a.defaultSkin ? ['default', a.defaultSkin] : a.skins?.includes('Saree') ? ['Saree'] : null, id: `lib:${entry.id}`, name: entry.name, pose: entry.pose, patternId: entry.patternId, lib: true, thumbnail: url(entry.thumbnail), ske, tex, rig, anims: [] };
}
/**
 * A saved character is small: { id, name, pose, base: 'lib:<template id>', profile, pages: {imagePath: Blob}, thumb }.
 * The skeleton and the untouched pictures come from the template, the profile (face, nudges, outfit, hidden slots, proportions) and the user's
 * own picture pages are applied on top. Returns the full character (ske, tex, rig ...), or null when its template cannot be loaded.
 * Older saves that carry their whole skeleton (`ske`) are returned as they are.
 */
export async function hydrateCharacter(rec) {
  if (!rec || rec.ske) return rec;
  if (!rec.base) return null;
  const entry = library.find((e) => `lib:${e.id}` === rec.base);
  if (!entry) return null;
  const base = await fetchLibraryCharacter(entry), pr = rec.profile || {};
  if (pr.fit) setFit(rec.id, pr.fit);
  const tex = base.tex.map((t) => ({ json: t.json, image: rec.pages?.[t.json.imagePath] || t.image }));
  const ske = bakeSke(base.ske, { face: pr.face, xf: pr.xf, attach: pr.attach, skins: pr.skins, hide: pr.hide }), { bones, slots, skins, ...extra } = base.rig;
  return { ...base, id: rec.id, name: rec.name, pose: rec.pose || base.pose, lib: false, base: rec.base, baseSke: base.ske, ske, tex, thumb: rec.thumb, thumbnail: undefined, profile: pr, pages: rec.pages || {}, skins: null, rig: rigInfo(ske, extra) };
}
/** hydrate a list, dropping what cannot be loaded */
export async function hydrateAll(list) { return (await Promise.all(list.map((r) => hydrateCharacter(r).catch(() => null)))).filter(Boolean); }
export const url = (p) => (!p ? null : /^(https?:|blob:|data:)/.test(p) ? p : BASE + p);
/** categories for a rig: [{key, name, overlay, animations:[{ref,...}]}] */
const AD_LAYER = { HAND: 'hand', LEGS: 'legs', EXPRESSION: 'face' };
/** 12toons poses: Body animations (split into Talking / Idle / the rest) plus three layers that run on top of a body animation */
function adCategories(pose) {
  const tr = adAnims?.poses?.[pose];
  if (!tr) return [];
  const ref = (a, layer) => ({ source: 'lib', id: a.id, name: a.name, file: a.file, overlay: !!layer, layer: layer || undefined });
  const mk = (a, layer) => ({ ref: ref(a, layer), name: a.name, length: a.length, poster: a.poster });
  const body = tr.PRIMARY || [], talk = body.filter((a) => /talk|speak/i.test(a.name)), idle = body.filter((a) => /^idle/i.test(a.name)), hands = body.filter((a) => /folding|hip|pointing/i.test(a.name) && !talk.includes(a)), rest = body.filter((a) => !talk.includes(a) && !idle.includes(a) && !hands.includes(a));
  const cats = [
    { key: `ad:${pose}:talk`, name: 'Talking', overlay: false, animations: talk.map((a) => mk(a)) },
    { key: `ad:${pose}:idle`, name: 'Idle', overlay: false, animations: idle.map((a) => mk(a)) },
    { key: `ad:${pose}:hands`, name: 'Hands & arms poses', overlay: false, animations: hands.map((a) => mk(a)) },
    { key: `ad:${pose}:body`, name: 'Body animations', overlay: false, animations: rest.map((a) => mk(a)) },
    { key: `ad:${pose}:hand`, name: 'Arms & hands (layer)', overlay: true, layer: 'hand', animations: (tr.HAND || []).map((a) => mk(a, 'hand')) },
    { key: `ad:${pose}:legs`, name: 'Legs (layer)', overlay: true, layer: 'legs', animations: (tr.LEGS || []).map((a) => mk(a, 'legs')) },
    { key: `ad:${pose}:face`, name: 'Face expressions (layer)', overlay: true, layer: 'face', animations: (tr.EXPRESSION || []).map((a) => mk(a, 'face')) },
  ];
  return cats.filter((c) => c.animations.length);
}
/** the animation lists a user may pick from (the admin's hidden animations are left out); { all: true } = everything (admin screen) */
export function categoriesFor(rig, { all = false, tester = false } = {}) {
  const cats = allCategories(rig);
  if (all) return cats;
  if (tester && testerRules.admin) return cats; // Only the authenticated server response grants admin preview access.
  if (tester) {                   // testers get exactly what the admin ticked, at most `limit` animations
    const ok = new Set([...(testerRules.anims['*'] || []), ...(rig?.toonChar ? testerRules.anims[rig.toonChar] || [] : [])].map(String));
    let left = testerRules.limit > 0 ? testerRules.limit : Infinity;
    return cats.map((c) => ({ ...c, animations: c.animations.filter((a) => { if (!testerAnimationAllowed(testerRules.anims, testerRules.blockedAnims, rig?.toonChar, a.ref.id) || left <= 0) return false; left--; return true; }) })).filter((c) => c.animations.length);
  }
  return cats.map((c) => ({ ...c, animations: c.animations.filter((a) => a.ref.source !== 'lib' || !isHiddenAnim(rig, a.ref.id)) })).filter((c) => c.animations.length);
}
/** List a rig's own animations, grouped into body, hand, leg and face tracks. */
function embeddedCategories(rig) {
  const pretty = (n) => n.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const kindOf = (n) => (/leg_?part/i.test(n) ? 'legs' : /hand_?part|_hand\d*$/i.test(n) ? 'hand' : /expression|_eb$|_eb\d*$/i.test(n) ? 'face' : 'body');
  const all = rig.animList.map((a) => ({ name: a.name, file: a.file, kind: kindOf(a.name), length: a.length })).sort((a, b) => a.name.localeCompare(b.name));
  const mk = (a) => ({ ref: { source: 'rig', id: a.name, name: pretty(a.name), rigAnim: a.name, file: `${rig.animDir}${a.file}.json`, layer: a.kind, overlay: a.kind !== 'body' }, name: pretty(a.name), length: a.length });
  const body = all.filter((a) => a.kind === 'body'), pick = (re) => body.filter((a) => re.test(a.name));
  const talk = pick(/talk|lips|lipsing/i), idle = pick(/idle/i), move = pick(/walk|run|jump|dance/i).filter((a) => !talk.includes(a));
  const rest = body.filter((a) => ![...talk, ...idle, ...move].includes(a));
  const cat = (key, name, list, overlay = false, layer) => ({ key: `rig:${key}`, name, overlay, layer, animations: list.map(mk) });
  return [cat('talk', 'Talking', talk), cat('idle', 'Idle', idle), cat('move', 'Walk / run / dance', move), cat('body', 'Body animations', rest),
    cat('hand', 'Arms & hands (layer)', all.filter((a) => a.kind === 'hand'), true, 'hand'), cat('legs', 'Legs (layer)', all.filter((a) => a.kind === 'legs'), true, 'legs'),
    cat('face', 'Face expressions (layer)', all.filter((a) => a.kind === 'face'), true, 'face')].filter((x) => x.animations.length);
}
function allCategories(rig) {
  const bundled = String(rig?.toonPattern || '').startsWith('ad:') ? adCategories(rig.toonPattern.slice(3)) : rig?.animList?.length ? embeddedCategories(rig) : [];
  const clips = managedAnimations.filter(asset => asset.target === rig?.templateId);
  const labels = { body: 'Body', hand: 'Arms & hands', legs: 'Legs', face: 'Face' };
  const managed = Object.entries(labels).map(([layer, label]) => ({ key: `managed:${layer}`, name: `Admin animations · ${label}`, overlay: layer !== 'body', layer: layer === 'body' ? undefined : layer,
    animations: clips.filter(asset => asset.layer === layer).map(asset => ({ name: asset.name, length: asset.length, ref: { source: 'lib', id: asset.id, name: asset.name, file: `managed:${asset.id}`, overlay: layer !== 'body', layer: layer === 'body' ? undefined : layer } })) })).filter(category => category.animations.length);
  return [...bundled, ...managed];
}

const cache = new AssetCache();
export function fetchAnimation(file) {
  if (file.startsWith('managed:')) return cache.load(file, () => loadStudioAnimation(file.slice(8)));
  return cache.load(file, () => fetch(url(file), { signal: AbortSignal.timeout(20000) })
    .then(r => { if (!r.ok) throw new Error(`Animation load nahi hui (code ${r.status}).`); return r.json(); })
    .then(j => j && j.bone ? j : Object.values(j)[0]));
}

/* ---- modes: animations that are built from several library animations ---- */
export const MODE_REFS = {
  speaker: { source: 'mode', id: 'speaker', name: 'Speaker mode' },
  listener: { source: 'mode', id: 'listener', name: 'Listener mode' },
};
/** the library animations a character can use to build its modes */
export function modePools(rig) {
  const cats = categoriesFor(rig).filter((c) => !c.overlay);
  const pick = (re, filter = () => true) => cats.filter((c) => re.test(c.name)).flatMap((c) => c.animations).filter(filter).map((a) => ({ ref: { ...a.ref }, length: a.length || 4 }));
  return {
    talk: pick(/talk/i, (a) => !/lips/i.test(a.name)),
    hands: pick(/hands?/i, (a) => /folding|hip/i.test(a.name)),   // standing with hands held / folded / on hips
    idle: pick(/idle/i),
  };
}
/** the "Modes" category shown first in the animation list */
export function modeEntries(rig) {
  const cats = categoriesFor(rig).filter((c) => !c.overlay), all = cats.flatMap((c) => c.animations);
  const find = (re) => all.find((a) => re.test(a.name));
  const talk = find(/^talk one$|^talk · style 1$/i), fold = find(/folding/i), hip = find(/^both hand on hip|^hands on hip · both/i), lh = find(/^left palm on hip|^hand on hip · left/i), rh = find(/^right palm on hip|^hand on hip · right/i);
  const entry = (ref, name, like) => ({ ref, name, preview: like?.preview, poster: like?.poster, mode: true });
  const list = [];
  const pools = modePools(rig);
  if (pools.talk.length) list.push(entry(MODE_REFS.speaker, '🎤 Speaker mode', talk));
  if (pools.hands.length || pools.idle.length) list.push(entry(MODE_REFS.listener, '👂 Listener mode', fold));
  for (const [a, label] of [[fold, 'Arms folded'], [hip, 'Hands on hips'], [lh, 'Left hand on hip'], [rh, 'Right hand on hip']]) {
    if (a) list.push(entry({ ...a.ref, name: `Listener · ${label}` }, `👂 ${label}`, a));
  }
  return { key: 'modes', name: '✨ Modes (speaker / listener)', animations: list };
}
