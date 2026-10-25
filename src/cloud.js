// Cloud side of 12toons: profile in Firestore, files in Cloudflare R2 (through /api/r2), and a "sync" that mirrors
// everything saved on this device (project, audio, characters, backgrounds and animation data).
import { auth, db, wsDoc, doc, getDoc, setDoc, collection, getDocs, deleteDoc } from './firebase.js';
import { syncAll } from './project-sync.js';
import { apiCall } from './session.js';
import { uploadAssets, confirmAssets, downloadAssets, hashBlob } from './binary-cloud.js';

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
 * A character is small: the user's own picture pages -> R2 (by hash: u/<uid>/a/..), everything else (template it is made from, face / outfit /
 * proportion settings, thumbnail) -> Firestore: workspaces/{uid}/characters/{id}. The skeleton comes from the template again when it is opened.
 */
export async function saveCharacterCloud(def) {
  const uid = uidOf();
  if (!uid) throw new Error('Character account me save karne ke liye pehle log in karein.');
  if (!(await r2Configured())) throw new Error('Cloud storage abhi set nahi hai, isliye character sirf is device par save hua.');
  if (!def.base) throw new Error('Ye character purane format me save hua tha. Character Studio me kholkar dobara save karein.');
  const paths = Object.keys(def.pages || {}), files = new Map(), hashes = [];
  for (const path of paths) { const blob = def.pages[path], hash = await hashBlob(blob); files.set(hash, blob); hashes.push(hash); }
  await uploadAssets(uid, files);            // only pictures the cloud does not have yet are sent
  await confirmAssets(uid, files);
  if(auth.currentUser?.uid!==uid)throw Error('Account badal gaya. Dobara try karein.');
  await setDoc(wsDoc(uid, 'characters', def.id), { id: def.id, name: def.name, pose: def.pose || '', base: def.base, pages: paths, assetHashes: hashes, format: 'lean2', profile: JSON.stringify(def.profile || {}), thumb: def.thumb || '', updatedAt: new Date().toISOString() });
  forgetChars(uid);
}
const CHARS_KEY = (uid) => 'toons-chars-' + uid, CHARS_TTL = 5 * 60 * 1000;
const forgetChars = (uid) => { try { sessionStorage.removeItem(CHARS_KEY(uid)); } catch { /* optional */ } };
/** the user's saved characters; one read per character, so the list is kept in this tab for a few minutes and dropped when a character is saved or deleted */
export async function listCharactersCloud() {
  const uid = uidOf();
  if (!uid) return [];
  try { const c = JSON.parse(sessionStorage.getItem(CHARS_KEY(uid)) || 'null'); if (c && Date.now() - c.at < CHARS_TTL) return c.rows; } catch { /* read again */ }
  try {
    const rows = (await getDocs(collection(db, 'workspaces', uid, 'characters'))).docs.map((d) => d.data());
    try { sessionStorage.setItem(CHARS_KEY(uid), JSON.stringify({ at: Date.now(), rows })); } catch { /* optional */ }
    return rows;
  } catch { return []; }
}
export async function loadCharacterCloud(meta) {
  if (meta.format !== 'lean2') throw new Error('Ye character purane format me save hua tha. Isse Character Studio me dobara banayein.');
  const uid = uidOf(), files = await downloadAssets(uid, meta.assetHashes || []), pages = {};
  (meta.pages || []).forEach((path, i) => { const b = files.get(meta.assetHashes[i]); pages[path] = new Blob([b], { type: b.type || 'image/webp' }); });
  let profile = {}; try { profile = JSON.parse(meta.profile || '{}'); } catch { /* old record */ }
  return { id: meta.id, name: meta.name, pose: meta.pose, base: meta.base, pages, thumb: meta.thumb, profile };      // opened with hydrateCharacter()
}
export async function deleteCharacterCloud(id) { const uid = uidOf(); if (uid) { await deleteDoc(wsDoc(uid, 'characters', id)); forgetChars(uid); } }

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
export async function isAdmin(user) {
 if(!user)return false;
 if(user.uid==='debug')return false;
 try{return (await apiCall('/api/security',{action:'status'},user.uid)).admin === true;}catch{return false;}
}

/** Maintenance is controlled by the server so browser storage or route changes cannot bypass it. */
export async function maintenanceStatus() {
 try {
  const r = await fetch('/api/security', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'maintenanceStatus' }) });
  if (!r.ok) throw Error('Maintenance ka status abhi nahi mil raha.');
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
  if (!user || auth.currentUser?.uid !== user.uid) throw Error('Iske liye verified admin se sign in karna zaroori hai.');
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
export async function saveTesterSubmission(def, user, extra = {}) {
  if (!user || user.uid === 'debug') return;
  await setDoc(doc(db, 'testerCharacters', def.id), { id: def.id, name: def.name, pose: def.pose || '', ownerUid: user.uid, ownerEmail: (user.email || '').toLowerCase(), profile: JSON.stringify(def.profile || {}).slice(0, 200000), thumb: def.thumb || '', updatedAt: new Date().toISOString(), ...extra });
}
export async function listTesterSubmissions() {
  try { return (await getDocs(collection(db, 'testerCharacters'))).docs.map((d) => d.data()).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))); } catch { return []; }
}

