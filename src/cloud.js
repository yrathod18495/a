// Cloud side of 12toons: profile in Firestore, files in Cloudflare R2 (through /api/r2), and a "sync" that mirrors
// everything saved on this device (project, audio, characters, backgrounds and animation data).
import { auth, db, wsDoc, doc, getDoc, setDoc, deleteDoc } from './firebase.js';
import { syncAll } from './project-sync.js';
import { apiCall } from './session.js';
import { uploadAssets, confirmAssets, downloadAssets, hashBlob, fetchBlob } from './binary-cloud.js';

const API = '/api/r2';

/* ---------- how often each shared document is read ---------- */
// Firestore bills every read (and the access rules read more documents on top), so things that change rarely are kept on this device for a while.
const recent = (name, ms) => { try { return Date.now() - (Number(localStorage.getItem('toons-at-' + name)) || 0) < ms; } catch { return false; } };
const touched = (name) => { try { localStorage.setItem('toons-at-' + name, String(Date.now())); } catch { /* optional */ } };
const CONFIG_TTL = 10 * 60 * 1000, PROFILE_TTL = 12 * 60 * 60 * 1000;

/* ---------- profile ---------- */
export async function ensureProfile(user) {
  if (!user || user.uid === 'debug' || recent('profile-' + user.uid, PROFILE_TTL)) return;      // the profile is refreshed at most twice a day
  try {
    const ref = wsDoc(user.uid), snap = await getDoc(ref), now = new Date().toISOString();
    await setDoc(ref, { name: user.displayName || 'Creator', email: user.email || '', photoURL: user.photoURL || '', joinedAt: snap.data()?.joinedAt || now, lastSeen: now, plan: 'Free' }, { merge: true });
    touched('profile-' + user.uid);
  } catch (e) { console.warn('profile sync failed', e.message); }
}

/* ---------- R2 ---------- */
let statusP = null;
export const r2Configured = () => (statusP ||= fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'status' }) })
  .then((r) => (r.ok ? r.json() : { configured: false })).then((j) => !!j.configured).catch(() => false));

/* ---------- project sync ---------- */
export async function cloudInfo() {
 const uid=auth.currentUser?.uid;if(!uid||uid==='debug')return null;
 const {projects}=await apiCall('/api/projects',{action:'list'},uid);
 return projects.length?{updatedAt:Math.max(...projects.map(p=>p.updatedAt))}:null;
}
let autoTimer;
export function startAutoSync() {clearInterval(autoTimer);syncAll().catch(()=>{});autoTimer=setInterval(()=>syncAll().catch(()=>{}),180000);}   // only a safety net: saving is scheduled by project-sync (quiet 45 s, max 3 min) and when the tab is hidden
export const stopAutoSync=()=>clearInterval(autoTimer);

/* ---------- characters (saved from the Character Studio) ---------- */
const uidOf = () => { const u = auth.currentUser?.uid; return u && u !== 'debug' ? u : null; };
export async function cloudReady() { return !!uidOf() && (await r2Configured()); }
/**
 * A saved character lives in R2: the user's picture pages as hashed files (u/<uid>/a/..) and one small JSON "manifest" (template it is made from, face /
 * outfit / proportion settings, hand-placed parts, thumbnail) as the project snapshot (u/<uid>/p/<id>/state-<op>.json). The Realtime Database only
 * keeps a tiny index row (name, revision) through /api/projects, the same path animation projects use. The skeleton comes from the template again on open.
 */
const cloudId = (id) => ('char_' + id).padEnd(16, '_');
const charIdOf = (pid) => pid.replace(/^char_/, '').replace(/_+$/, '');
const revisionOf = async (uid, pid) => (await apiCall('/api/projects', { action: 'list' }, uid)).projects.find((p) => p.id === pid)?.revision ?? 0;
export async function saveCharacterCloud(def) {
  const uid = uidOf();
  if (!uid) throw new Error('Please log in first to save the character to your account.');
  if (!(await r2Configured())) throw new Error('Cloud storage is not set up yet, so the character was only saved on this device.');
  if (!def.base) throw new Error('This character was saved in an old format. Open it in Character Studio and save it again.');
  const paths = Object.keys(def.pages || {}), files = new Map(), hashes = [];
  for (const path of paths) { const blob = def.pages[path], hash = await hashBlob(blob); files.set(hash, blob); hashes.push(hash); }
  const pid = cloudId(def.id), operationId = crypto.randomUUID(), now = new Date().toISOString();
  const manifest = { format: 'char3', id: def.id, name: def.name, pose: def.pose || '', base: def.base, pages: paths, assetHashes: hashes, profile: def.profile || {}, thumb: def.thumb || '', updatedAt: now };
  const sent = await uploadAssets(uid, files, { projectId: pid, opId: operationId, blob: new Blob([JSON.stringify(manifest)], { type: 'application/json' }) });    // only pictures the cloud does not have yet are sent
  if (auth.currentUser?.uid !== uid) throw new Error('The account changed. Please try again.');
  for (let attempt = 0; ; attempt++) {          // a second save can move the revision between the read and the commit, and a network blip is worth one more try
    try {
      const expected = await revisionOf(uid, pid);
      await apiCall('/api/projects', { action: 'commit', id: pid, kind: 'character', name: def.name || 'My character', deleted: false, operationId, expected, assets: sent.fresh, summary: null }, uid);
      return;
    } catch (e) {
      if (attempt >= 2 || !['conflict', 'network'].includes(e.code)) throw e;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
}
/** remove a saved character from the account (its pictures stay as shared hashed files until the admin cleans them) */
export async function deleteCharacterCloud(id) {
  const uid = uidOf();
  if (!uid || !(await r2Configured())) return;
  const pid = cloudId(id), expected = await revisionOf(uid, pid);
  if (!expected) return;
  await apiCall('/api/projects', { action: 'commit', id: pid, kind: 'character', name: 'deleted', deleted: true, operationId: crypto.randomUUID(), expected, assets: [], summary: null }, uid);
}
/** the user's saved characters: one index read (no per-character reads); the manifest itself is fetched only when a character is opened */
export async function listCharactersCloud() {
  const uid = uidOf();
  if (!uid) return [];
  try {
    const { projects } = await apiCall('/api/projects', { action: 'list' }, uid);
    return projects.filter((p) => p.kind === 'character' && !p.deleted && p.stateUrl).map((p) => ({ id: charIdOf(p.id), name: p.name, stateUrl: p.stateUrl, updatedAt: p.updatedAt, format: 'char3' }));
  } catch { return []; }
}
/** admin: a tester's saved character as a hydrate-ready record (their own pictures included), or null when they never saved it to the cloud */
export async function loadTesterCharacterFiles(id) {
  const first = await apiCall('/api/projects', { action: 'adminCharacter', id });
  if (!first.saved) return null;
  const m = JSON.parse(await (await fetchBlob(first.stateUrl)).text()), hashes = m.assetHashes || [], pages = {};
  const { urls } = hashes.length ? await apiCall('/api/projects', { action: 'adminCharacter', id, hashes }) : { urls: {} };
  const files = new Map(await Promise.all(hashes.map(async (hash) => [hash, await fetchBlob(urls[hash])])));
  (m.pages || []).forEach((path, i) => { const b = files.get(m.assetHashes[i]); pages[path] = new Blob([b], { type: b.type || 'image/webp' }); });
  return { id: m.id, name: m.name, pose: m.pose, base: m.base, pages, thumb: m.thumb, profile: m.profile || {} };
}
export async function loadCharacterCloud(meta) {
  if (meta.format !== 'char3') throw new Error('This character was saved in an old format. Recreate it in Character Studio.');
  const m = JSON.parse(await (await fetchBlob(meta.stateUrl)).text()), uid = uidOf(), files = await downloadAssets(uid, m.assetHashes || []), pages = {};
  (m.pages || []).forEach((path, i) => { const b = files.get(m.assetHashes[i]); pages[path] = new Blob([b], { type: b.type || 'image/webp' }); });
  return { id: m.id, name: m.name, pose: m.pose, base: m.base, pages, thumb: m.thumb, profile: m.profile || {} };      // opened with hydrateCharacter()
}

/* ---------- admin: which animations users may see ---------- */
const RULES_KEY = 'toons-animrules';
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
export const cachedRules = () => { try { return JSON.parse(localStorage.getItem(RULES_KEY) || 'null'); } catch { return null; } };
/** what the admin published (Firestore config/animations); falls back to the last copy kept on this device */
export async function loadAnimRules() {
  const debug = !auth.currentUser || auth.currentUser.uid === 'debug';
  if (!debug) {
    if (cachedRules() && recent('animrules', CONFIG_TTL)) return cachedRules();
    try {
      const snap = await withTimeout(getDoc(doc(db, 'config', 'animations')), 5000);
      if (snap.exists()) { const d = snap.data(), r = { hidden: JSON.parse(d.hidden || '{}'), at: d.updatedAt || '' }; try { localStorage.setItem(RULES_KEY, JSON.stringify(r)); } catch { /* optional */ } touched('animrules'); return r; }
      try { localStorage.setItem(RULES_KEY, JSON.stringify({ hidden: {}, at: '' })); } catch { /* optional */ }
      touched('animrules');
      return { hidden: {}, at: '' };
    } catch (e) { console.warn('animation rules not loaded', e.message); }
  }
  return cachedRules() || { hidden: {}, at: '' };
}
export async function saveAnimRules(hidden, user) {
  const at = new Date().toISOString(), clean = Object.fromEntries(Object.entries(hidden).filter(([, v]) => v.length));
  if (!user || user.uid === 'debug') { localStorage.setItem(RULES_KEY, JSON.stringify({ hidden: clean, at })); return { at, local: true }; }
  await setDoc(doc(db, 'config', 'animations'), { hidden: JSON.stringify(clean), updatedAt: at, by: user.email || '' });
  try { localStorage.setItem(RULES_KEY, JSON.stringify({ hidden: clean, at })); } catch { /* optional */ }
  touched('animrules');
  return { at, local: false };
}
/**
 * Is this account an admin? Only the server's answer counts. A failed call (network, a cold server) is tried again a few times and then
 * reported as `null` ("not known"), never as "not admin": an admin must not be shown the maintenance page or signed out because of one bad request.
 */
export async function isAdmin(user) {
 if(!user)return false;
 if(user.uid==='debug')return false;
 for(let attempt=0;attempt<4;attempt++){
  try{return (await apiCall('/api/security',{action:'status'},user.uid)).admin === true;}
  catch(e){if(e.status===401||e.status===403)return false;await new Promise(r=>setTimeout(r,500*(attempt+1)));}
 }
 return null;
}

/** Maintenance is controlled by the server so browser storage or route changes cannot bypass it. */
export async function maintenanceStatus() {
 try {
  const r = await fetch('/api/security', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'maintenanceStatus' }) });
  if (!r.ok) throw Error('Could not get the maintenance status right now.');
  return await r.json();
 }
 catch { return { maintenance: true, unavailable: true }; }
}

/* ---------- admin: names + visibility of the Character Studio layers (Firestore config/layers) ---------- */
const LAYER_KEY = 'toons-layerrules';
export const cachedLayerRules = () => { try { return JSON.parse(localStorage.getItem(LAYER_KEY) || 'null'); } catch { return null; } };
export async function loadLayerRules() {
  const debug = !auth.currentUser || auth.currentUser.uid === 'debug';
  if (!debug) {
    if (cachedLayerRules() && recent('layers', CONFIG_TTL)) return cachedLayerRules();
    try {
      const snap = await withTimeout(getDoc(doc(db, 'config', 'layers')), 5000);
      const r = snap.exists() ? { names: JSON.parse(snap.data().names || '{}'), hidden: JSON.parse(snap.data().hidden || '{}'), at: snap.data().updatedAt || '' } : { names: {}, hidden: {}, at: '' };
      try { localStorage.setItem(LAYER_KEY, JSON.stringify(r)); } catch { /* optional */ }
      touched('layers');
      return r;
    } catch (e) { console.warn('layer rules not loaded', e.message); }
  }
  return cachedLayerRules() || { names: {}, hidden: {}, at: '' };
}
export async function saveLayerRules({ names, hidden }, user) {
  const at = new Date().toISOString();
  const cleanNames = Object.fromEntries(Object.entries(names).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).filter(([, n]) => String(n).trim()))]).filter(([, v]) => Object.keys(v).length));
  const cleanHidden = Object.fromEntries(Object.entries(hidden).filter(([, v]) => v.length));
  const r = { names: cleanNames, hidden: cleanHidden, at };
  if (user && user.uid !== 'debug') await setDoc(doc(db, 'config', 'layers'), { names: JSON.stringify(cleanNames), hidden: JSON.stringify(cleanHidden), updatedAt: at, by: user.email || '' });
  try { localStorage.setItem(LAYER_KEY, JSON.stringify(r)); } catch { /* optional */ }
  touched('layers');
  return r;
}

/* ---------- testers: who they are, which animations they may use, what they saved (Firestore config/testers, testerCharacters) ---------- */
const TESTER_KEY = 'toons-testers';
const emptyTesters = () => ({ emails: [], anims: {}, limit: 0, at: '' });
export const cachedTesters = () => { try { return JSON.parse(localStorage.getItem(TESTER_KEY) || 'null'); } catch { return null; } };
export function watchTesterConfig(next, error) {
  const owner = auth.currentUser?.uid;
  let stopped = false, timer, busy = false, signature = '';
  const refresh = async () => {
    if (stopped || busy || document.hidden) return;
    busy = true;
    try {
      const config = await apiCall('/api/security', { action: 'testerAnimations' }, owner);
      if (stopped) return;
      const current = JSON.stringify([config.admin === true, config.blockedAnims, config.anims, config.limit, config.hiddenGroups, config.blockedDownloads]);
      if (current !== signature) { signature = current; next(config); }
      try { localStorage.setItem(TESTER_KEY, JSON.stringify(config)); } catch { /* optional */ }
    } catch (e) {
      signature = '';
      if (!stopped) error?.(e);
    } finally {
      busy = false;
      if (!stopped) timer = setTimeout(refresh, 30000);   // admin changes reach a tester within half a minute (or at once when the tab comes back)
    }
  };
  const wake = () => { clearTimeout(timer); refresh(); };
  document.addEventListener('visibilitychange', wake);
  refresh();
  const stop = () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', wake); };
  stop.refresh = wake;
  return stop;
}
export async function loadTesterConfig() {
  if (!auth.currentUser) return emptyTesters();
  const config = await apiCall('/api/security', { action: 'testerAnimations' });
  try { localStorage.setItem(TESTER_KEY, JSON.stringify(config)); } catch { /* optional */ }
  return config;
}
export async function saveTesterConfig(cfg, user) {
  if (!user || auth.currentUser?.uid !== user.uid) throw Error('You must sign in as a verified admin for this.');
  const config = await apiCall('/api/security', { action: 'saveTesterAnimations', anims: cfg.anims, limit: cfg.limit, blockedAnims: cfg.blockedAnims, hiddenGroups: cfg.hiddenGroups, blockedDownloads: cfg.blockedDownloads }, user.uid);
  try { localStorage.setItem(TESTER_KEY, JSON.stringify(config)); } catch { /* optional */ }
  return config;
}
/** Tester page access is granted only by the server-verified Firebase UID role. */
export async function isTester(user) {
  if (!user || user.uid === 'debug') return false;
  try { return (await apiCall('/api/security', { action: 'testerStatus' }, user.uid)).status === 'approved'; }
  catch { return false; }
}
/** the tester's saved character, as a row the admin can see (the files stay in the tester's own cloud folder) */
export async function saveTesterSubmission(def, user) {
  if (!user || user.uid === 'debug') return;
  await apiCall('/api/security', { action: 'saveTesterCharacter', id: def.id, name: def.name, pose: def.pose || '', profile: JSON.stringify(def.profile || {}), thumb: def.thumb || '' }, user.uid);
}
/** admin: every character the testers saved (read on the server, so it does not depend on the Firestore rules) */
export async function listTesterSubmissions() {
  const uid = auth.currentUser?.uid;
  if (!uid) return [];
  try { return (await apiCall('/api/security', { action: 'testerSubmissions' }, uid)).submissions || []; } catch { return []; }
}
/** admin: find any user's project by the short ID they read out, with its owner and recent save history */
export async function adminFindProject(id, user) {
  return apiCall('/api/projects', { action: 'adminLookup', id: String(id || '').trim() }, user.uid);
}

