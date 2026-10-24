import { friendlyError } from '../shared/hinglish-errors.js';
import './style.css';
import { landingView as marketingLandingView } from './landing.js';
import './day-theme.css';
import './royal-surfaces.css';
// 12toons shell: landing page -> login -> hub (12toons / 12toons Character Studio)
import { h, toast, logo } from './dom.js';
import { onUser, signInGoogle, signOutUser, finishRedirect, refreshUser } from './firebase.js';
import { ensureProfile, r2Configured, cloudInfo, isAdmin, maintenanceStatus } from './cloud.js';
import { selectProject, projectMeta, listProjects, createProject } from './store.js';
import { projectsView } from './projects-view.js';
import { syncAll } from './project-sync.js';
import { apiCall } from './session.js';

const DEBUG = import.meta.env.DEV && location.search.includes('debug');
const favicon = document.querySelector('link[rel~="icon"]');
const brandFavicon = favicon?.getAttribute('href') || '';
const testerFavicon = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"%3E%3Crect width="32" height="32" rx="8" fill="%23d4a443"/%3E%3Ccircle cx="16" cy="16" r="6" fill="%231b1308"/%3E%3C/svg%3E';
window.addEventListener('session-error', e => toast(e.detail));
window.addEventListener('session-revoked', e => toast(e.detail));
const $shell = document.getElementById('shell'), $app = document.getElementById('app');
let user = null, ready = false, studio = null, current = '', role = 'user', maintenance = true, testerAccessOnly = false, testerApplicationStatus = 'none', staffLoginPending = sessionStorage.getItem('12toons-staff-login') === '1', staffMessage = '';
let loadedAnimationProject=null, testerAuthError='';

function readTheme() { try { return localStorage.getItem('12toons-theme') === 'night' ? 'night' : 'day'; } catch { return 'day'; } }
let activeTheme = readTheme();
function setTheme(theme) {
  activeTheme = theme === 'night' ? 'night' : 'day';
  document.documentElement.dataset.theme = activeTheme;
  document.documentElement.style.colorScheme = activeTheme === 'night' ? 'dark' : 'light';
  try { localStorage.setItem('12toons-theme', activeTheme); } catch { /* theme still applies for this page view */ }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = activeTheme === 'night' ? '#0b0907' : '#ffffff';
}
setTheme(activeTheme);

/* ---------------- routing ---------------- */
const PRIVATE = ['#/hub', '#/toons', '#/characters', '#/admin', '#/credits', '#/affiliate-dashboard'];
const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
const DIRECT_ROUTES = { '/admin': '#/admin', '/buy-credits': '#/credits', '/credits': '#/credits', '/terms-of-use': '#/terms', '/website-license': '#/website-license', '/license': '#/website-license', '/affiliate-partners': '#/affiliates' };
try {
  const code = new URLSearchParams(location.search).get('ref')?.trim().toUpperCase();
  if (code && /^[A-Z0-9]{8,12}$/.test(code)) {
    localStorage.setItem('12toons-affiliate-referral', code);
    const day = new Date().toISOString().slice(0, 10), marker = `12toons-affiliate-click-${code}`;
    if (localStorage.getItem(marker) !== day) {
      localStorage.setItem(marker, day);
      fetch('/api/affiliates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'click', code }) }).catch(() => {});
    }
  }
} catch { /* referral tracking is optional when browser storage is unavailable */ }
const directHash = DIRECT_ROUTES[location.pathname.replace(/\/$/, '')];
if (directHash && location.hash !== directHash) location.replace('/' + directHash);
window.addEventListener('hashchange', route);

let routing = Promise.resolve();
function route() {
  routing = routing.then(renderRoute).catch(e => {
    if (reloadForNewVersion(e)) return;
    toast(`Page khul nahi paya: ${e.message}`);
  });
  return routing;
}
// After a redeploy, an already-open tab still points at old hashed chunks that no longer exist.
// Reload once to pick up the new build; the guard stops a reload loop if the chunk is truly missing.
function reloadForNewVersion(e) {
  if (!/dynamically imported module|Importing a module script failed|error loading dynamically/i.test(String(e?.message || e))) return false;
  try {
    const last = Number(sessionStorage.getItem('chunk-reload-at') || 0);
    if (Date.now() - last < 30000) return false;
    sessionStorage.setItem('chunk-reload-at', String(Date.now()));
  } catch { return false; }
  location.reload();
  return true;
}
window.addEventListener('vite:preloadError', e => { if (reloadForNewVersion(new Error('dynamically imported module'))) e.preventDefault(); });
async function renderRoute() {
  if (!ready) return;
  const parts = (location.hash || '#/').split('/'), hash = parts.slice(0,2).join('/'), projectId = parts[2];
  document.title = hash === '#/tester' ? 'Character Tester' : hash === '#/affiliates' ? 'Affiliate Partners | 12toons' : '12toons';
  if (favicon) favicon.href = hash === '#/tester' ? testerFavicon : brandFavicon;
  if (user && (role === 'tester' || role === 'tester-pending') && hash !== '#/tester') { go('#/tester'); return; }
  if (maintenance && !(user && role === 'admin') && hash !== '#/staff-login' && hash !== '#/tester') {
    const oldView = $shell.firstElementChild; oldView?.dispose?.();
    current = '#/maintenance'; $app.hidden = true; $shell.hidden = false;
    $shell.replaceChildren(maintenanceView()); return;
  }
  if (hash === '#/staff-login' && user && role === 'admin') { go('#/admin'); return; }
  if (PRIVATE.includes(hash) && !user) { go('#/login'); return; }
  if (hash === '#/staff-login') {
    $app.hidden = true; $shell.hidden = false; $shell.replaceChildren(staffLoginView()); return;
  }
  if (hash === '#/terms' || hash === '#/website-license') {
    const { legalView } = await import('./legal.js');
    $app.hidden = true; $shell.hidden = false;
    $shell.replaceChildren(legalView({ kind: hash === '#/terms' ? 'terms' : 'license', home: () => go('#/') })); return;
  }
  if (hash === '#/credits') {
    const { view: creditsView } = await import('./credits.js');
    $shell.replaceChildren(await creditsView({ user, home: () => go('#/hub') })); return;
  }
  if (hash === '#/affiliates') {
    const { affiliateView } = await import('./affiliate.js');
    $app.hidden = true; $shell.hidden = false;
    $shell.replaceChildren(affiliateView({ home: () => go(user ? '#/hub' : '#/') })); return;
  }
  if (hash === '#/affiliate-dashboard') {
    const { affiliateDashboardView } = await import('./affiliate-dashboard.js');
    $app.hidden = true; $shell.hidden = false;
    $shell.replaceChildren(await affiliateDashboardView({ user, home: () => go('#/hub'), apply: () => go('#/affiliates') })); return;
  }
  if (current === '#/toons' && (hash !== '#/toons' || !projectId || projectId !== loadedAnimationProject)) await studio?.closeStudio();
  const oldView = $shell.firstElementChild;
  await oldView?.flushDraft?.(); oldView?.dispose?.();
  current = hash;
  if ((hash === '#/toons' || hash === '#/characters') && !projectId) {
    $app.hidden = true; $shell.hidden = false;
    $shell.replaceChildren(await projectsView({user,kind:hash==='#/toons'?'animation':'character',home:()=>go('#/hub'),toast}));
    return;
  }
  if (hash === '#/toons' || hash === '#/characters') {
    if(hash==='#/toons'&&loadedAnimationProject&&loadedAnimationProject!==projectId){location.reload();return;}
    const p=await projectMeta(user.uid,projectId);
    if(!p||p.deleted||p.kind!==(hash==='#/toons'?'animation':'character')){go(hash);return;}
    selectProject(user.uid,projectId);
  }
  if (hash === '#/toons') {
    loadedAnimationProject=projectId;
    $shell.hidden = true;
    studio ||= await import('./main.js');
    studio.setHome(() => go('#/'));
    await studio.openStudio();
    return;
  }
  $app.hidden = true; $shell.hidden = false; window.scrollTo(0, 0);
  if (hash === '#/tester') {
    if (!user || (role !== 'tester' && role !== 'admin')) {
      const { testerAccessView } = await import('./tester-access.js');
      $shell.replaceChildren(testerAccessView({ user, status: testerApplicationStatus, error: testerAuthError, accessOnly: testerAccessOnly, home: () => go('#/'), toast, login: loginTester,
        continueApproved: loginTester,
        signOut: async () => { await signOutUser({ release: !testerAccessOnly }); testerAccessOnly = false; role = 'user'; go('#/'); },
        onApproved: () => refreshUser() })); return;
    }
    const p=(await listProjects(user.uid)).find(p=>p.kind==='character'&&!p.deleted)||await createProject(user.uid,'character','Tester draft');
    selectProject(user.uid,p.id);
    const m = await import('./charstudio.js');
    $shell.replaceChildren(await m.view({ user, tester: true, toast, home: () => {}, logout: async () => { await signOutUser(); role = 'user'; go('#/'); } })); return;
  }
  if (hash === '#/admin') {
    if (!(await isAdmin(user))) { toast('Admin panel sirf admin ke liye hai.'); go('#/hub'); return; }
    const m = await import('./admin.js'); $shell.replaceChildren(await m.view({ user, home: () => go('#/hub'), toast })); return;
  }
  if (hash === '#/characters') { const m = await import('./charstudio.js'); $shell.replaceChildren(await m.view({ user, home: () => go('#/characters'), toast })); return; }
  $shell.replaceChildren(hash === '#/login' ? loginView() : hash === '#/hub' ? hubView() : landingView());
}

/* ---------------- shared bits ---------------- */
async function login() {
  try { const u = await signInGoogle(); if (u) go('#/hub'); } catch (e) { if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') toast(e.code === 'auth/unauthorized-domain' ? 'Is website ke address se login abhi allowed nahi hai. Firebase → Authentication → Settings → Authorized domains me ise jodna hoga.' : `Login nahi ho paya: ${friendlyError(e)}`); }
}
async function loginStaff() {
  staffLoginPending = true; sessionStorage.setItem('12toons-staff-login', '1'); staffMessage = '';
  try { await signInGoogle(); }
  catch (e) {
    staffLoginPending = false; sessionStorage.removeItem('12toons-staff-login');
    if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
      staffMessage = e.code === 'auth/unauthorized-domain' ? 'Is website ke address se login abhi allowed nahi hai. Firebase Authentication ke authorized domains me ise jodna hoga.' : `Google se sign in nahi ho paya: ${friendlyError(e)}`;
    }
    route();
  }
}
async function loginTester() {
  staffLoginPending = false; sessionStorage.removeItem('12toons-staff-login');
  sessionStorage.setItem('12toons-tester-login', '1');
  try { const signedIn = await signInGoogle(); if (signedIn) await refreshUser(); }
  catch (e) {
    sessionStorage.removeItem('12toons-tester-login');
    if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') toast(e.code === 'auth/unauthorized-domain' ? 'Is website ke address se login abhi allowed nahi hai. Firebase Authentication ke authorized domains me ise jodna hoga.' : `Google se sign in nahi ho paya: ${friendlyError(e)}`);
  }
}
const initial = (u) => (u.displayName || u.email || '?').trim()[0].toUpperCase();
let profileMenuCount = 0;
function profileMenu() {
  const name = user.displayName || 'Creator';
  const makeAvatar = () => user.photoURL ? h('img', { src: user.photoURL, alt: '', referrerpolicy: 'no-referrer' }) : initial(user);
  const menu = h('nav', { class: 'sh-menu', id: `account-menu-${++profileMenuCount}`, 'aria-label': 'Account options', hidden: true });
  let openEvents;
  const close = () => {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    openEvents?.abort();
  };
  const btn = h('button', {
    class: 'sh-avatar', type: 'button', title: name,
    'aria-label': `Account menu for ${name}`, 'aria-controls': menu.id, 'aria-expanded': 'false',
    onclick: (event) => {
      if (!menu.hidden) { close(); return; }
      menu.hidden = false; btn.setAttribute('aria-expanded', 'true');
      openEvents = new AbortController();
      document.addEventListener('pointerdown', (e) => { if (!root.contains(e.target)) close(); }, { signal: openEvents.signal });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); btn.focus(); } }, { signal: openEvents.signal });
      window.addEventListener('hashchange', close, { signal: openEvents.signal });
      if (event.detail === 0) menu.querySelector('button')?.focus();
    },
  }, makeAvatar());
  const menuIcon = (name) => {
    const paths = {
      moon: 'M21 12.8A9 9 0 0 1 11.2 3 9 9 0 1 0 21 12.8Z',
      sun: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5',
      affiliate: 'M4 17l6-6 4 4 6-10m-6 0h6v6',
      tester: 'M12 3l8 9-8 9-8-9 8-9Zm0 5v5m0 3v.1',
      admin: 'M4 7h16M4 17h16M8 4v6m8 4v6',
      logout: 'M10 4H4v16h6m4-12 4 4-4 4M8 12h10',
    };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', paths[name]); svg.append(path); return svg;
  };
  const item = (icon, label, description, action, extraClass = '') => h('button', {
    class: `sh-mi ${extraClass}`.trim(), type: 'button', onclick: () => { close(); action(); },
  }, h('span', { class: 'sh-mi-icon', 'aria-hidden': 'true' }, menuIcon(icon)),
  h('span', { class: 'sh-mi-copy' }, h('span', { class: 'sh-mi-label' }, label), h('small', {}, description)),
  h('span', { class: 'sh-mi-arrow', 'aria-hidden': 'true' }, '›'));
  const themeItem = item('moon', '', '', () => {
    setTheme(activeTheme === 'day' ? 'night' : 'day');
    updateThemeItem();
  });
  function updateThemeItem() {
    const isDay = activeTheme === 'day';
    themeItem.querySelector('.sh-mi-icon').replaceChildren(menuIcon(isDay ? 'moon' : 'sun'));
    themeItem.querySelector('.sh-mi-label').textContent = isDay ? 'Switch to night mode' : 'Switch to day mode';
    themeItem.querySelector('small').textContent = isDay ? 'Dark palace with gold accents' : 'White surfaces with gold accents';
  }
  updateThemeItem();
  menu.append(
    h('div', { class: 'sh-who' },
      h('span', { class: 'sh-account-avatar', 'aria-hidden': 'true' }, makeAvatar()),
      h('div', { class: 'sh-account-copy' }, h('span', { class: 'sh-menu-kicker' }, 'YOUR ACCOUNT'), h('b', {}, name), h('small', {}, user.email || ''), h('span', { class: 'sh-plan' }, 'Free plan'))),
    h('div', { class: 'sh-menu-section' }, themeItem,
      item('affiliate', 'Affiliate dashboard', 'Your referrals and earnings', () => go('#/affiliate-dashboard')),
      item('tester', 'Tester access', 'Request or open tester access', () => go('#/tester')),
      ...(role === 'admin' ? [item('admin', 'Admin panel', 'Manage your workspace', () => go('#/admin'))] : [])),
    h('div', { class: 'sh-menu-footer' }, item('logout', 'Log out', 'Sign out of this account', async () => { await signOutUser(); go('#/'); }, 'sh-mi-logout')));
  const root = h('div', { class: 'sh-profile' }, btn, menu);
  return root;
}

/* ---------------- landing ---------------- */
function landingView() {
  document.title = 'AI 2D Animation Maker Online | 12toons';
  return marketingLandingView({
    user,
    cta: () => go(user ? '#/hub' : '#/login'),
    profileMenu,
    logo
  });
}

/* ---------------- login ---------------- */
function loginView() {
  if (user) { queueMicrotask(() => go('#/hub')); return h('div'); }
  return h('div', { class: 'sh sh-center' },
    h('div', { class: 'sh-login' }, logo(() => go('#/')),
      h('h1', {}, 'Welcome back'), h('p', { class: 'sub' }, 'Log in to open your studio. Your work is saved to your account.'),
      h('button', { class: 'btn pri big gbtn', onclick: login }, h('span', { class: 'g' }, 'G'), 'Continue with Google'),
      h('button', { class: 'btn-link', onclick: () => go('#/') }, '← Back to home')));
}

function maintenanceView() {
  return h('main', { class: 'sh sh-center' }, h('section', { class: 'sh-login maintenance-card' },
    logo(() => {}), h('div', { class: 'maintenance-mark', 'aria-hidden': 'true' }, '🔧'),
    h('h1', {}, 'We’ll be back soon'),
    h('p', { class: 'sub' }, '12toons par abhi maintenance chal raha hai. Thodi der baad dobara aayein.'),
    h('a', { class: 'btn-link', href: '/#/staff-login' }, 'Staff sign in')));
}

function staffLoginView() {
  return h('main', { class: 'sh sh-center' }, h('section', { class: 'sh-login' },
    logo(() => go('#/')),
    h('span', { class: 'staff-tag' }, 'STAFF ACCESS'),
    h('h1', {}, '12toons staff sign in'),
    h('p', { class: 'sub' }, 'Sign in with the Google account enabled for staff access.'),
    h('button', { class: 'btn pri big gbtn', disabled: staffLoginPending, onclick: loginStaff }, h('span', { class: 'g' }, 'G'), staffLoginPending ? 'Checking access…' : 'Continue with Google'),
    staffMessage ? h('p', { class: 'staff-error', role: 'alert' }, staffMessage) : null,
    h('button', { class: 'btn-link', onclick: () => go('#/') }, '← Back to maintenance page')));
}

/* ---------------- hub ---------------- */
function hubView() {
  const name = (user.displayName || 'Creator').split(' ')[0];
  const cloudLine = h('p', { class: 'sh-cloud' }, 'Checking cloud…'), adminSlot = h('div', { class: 'sh-admin' });
  isAdmin(user).then((ok) => { if (ok) adminSlot.append(h('button', { class: 'btn', onclick: () => go('#/admin') }, '🛠 Admin panel'), ' ', h('button', { class: 'btn', onclick: () => go('#/tester') }, '🧪 Tester page')); });
  r2Configured().then(async (ok) => {
    if (!ok) { cloudLine.textContent = 'Cloud save is not switched on yet — your work is saved on this device.'; return; }
    const info = await cloudInfo();
    cloudLine.textContent = info ? `☁ Last cloud save: ${new Date(info.updatedAt).toLocaleString()}` : '☁ Projects save automatically while you edit.';
  }).catch(() => { cloudLine.textContent = ''; });
  const card = (icon, title, text, hash, btn) => h('button', { class: 'sh-tool', onclick: () => go(hash) }, h('span', { class: 'sh-tool-ico' }, icon), h('b', {}, title), h('p', {}, text), h('span', { class: 'btn pri' }, btn));
  return h('div', { class: 'sh' },
    h('header', { class: 'sh-bar' }, logo(() => go('#/')), h('span', { class: 'sp' }), profileMenu()),
    h('main', { class: 'sh-hub' }, h('h1', {}, `Hi ${name} 👋`), h('p', { class: 'sub' }, 'What would you like to work on?'),
      h('div', { class: 'sh-tools' },
        card('🎬', '12toons', 'Animation studio. Place characters and backgrounds, add your audio lines (optional), direct the scenes with AI and export a video.', '#/toons', 'Open 12toons →'),
        card('🎭', '12toons Character Studio', 'Build characters. Recolour parts, upload artwork, choose outfits and save them for your animations.', '#/characters', 'Open Character Studio →'),
        card('💳', 'Buy Credits', 'Choose a one-time credit pack and review your payment history.', '#/credits', 'View credit plans →')),
      adminSlot, cloudLine));
}

/* ---------------- start ---------------- */
async function start() {
  $shell.replaceChildren(h('div', { class: 'sh sh-center' }, h('p', { class: 'sub' }, 'Loading…')));
  try { maintenance = (await maintenanceStatus()).maintenance === true; } catch { maintenance = true; }
  if (DEBUG) { user = { uid: 'debug', displayName: 'Test Creator', email: 'test@12toons.local', photoURL: '' }; role = 'user'; ready = true; route(); return; }
  await finishRedirect();
  let first = true;
  onUser(async (u, authState = {}) => {
    if (ready && user?.uid !== u?.uid) { location.reload(); return; }
    user = u;
    testerAccessOnly = !!authState.testerAccessOnly;
    testerAuthError = authState.testerError || '';
    testerApplicationStatus = authState.testerStatus || (u ? testerApplicationStatus : 'none');
    if (u && testerAccessOnly) {
      role = 'tester-pending'; ready = true;
      document.querySelector('.support-widget')?.remove();
      if (first) first = false;
      route(); return;
    }
    if (u) {
      maintenance = (await maintenanceStatus()).maintenance === true;
      const admin = await isAdmin(u);
      if (staffLoginPending && !admin) {
        staffLoginPending = false; sessionStorage.removeItem('12toons-staff-login');
        staffMessage = sessionStorage.getItem('12toons-staff-error') || 'Staff access verify nahi ho paya. Dobara try karein.';
        sessionStorage.removeItem('12toons-staff-error');
        await signOutUser({ release: false }); user = null; role = 'user'; ready = true; route(); return;
      }
      staffLoginPending = false; sessionStorage.removeItem('12toons-staff-login');
      testerAccessOnly = false; sessionStorage.removeItem('12toons-tester-login');
      const testerStatus = admin ? 'none' : (await apiCall('/api/security', { action: 'testerStatus' }, u.uid).catch(() => ({ status: 'none' }))).status;
      const tester = testerStatus === 'approved';
      role = admin ? 'admin' : tester ? 'tester' : 'user';
      testerApplicationStatus = testerStatus || 'none';
      if (maintenance && !admin && !tester) {
        await signOutUser(); user = null; role = 'user';
      }
    } else {
      role = 'user';
      if (staffLoginPending) {
        staffLoginPending = false; sessionStorage.removeItem('12toons-staff-login');
        staffMessage = sessionStorage.getItem('12toons-staff-error') || 'Staff access verify nahi ho paya. Dobara try karein.';
        sessionStorage.removeItem('12toons-staff-error');
      }
    }
    ready = true;
    if (user) {
      // Temporarily disabled until Firebase Web Push VAPID is configured.
      // import('./notifications.js').then(({ syncReplyNotifications }) => syncReplyNotifications(user)).catch(() => {});
      const referralCode = localStorage.getItem('12toons-affiliate-referral');
      if (referralCode && role !== 'admin') {
        try { await apiCall('/api/affiliates', { action: 'attribute', code: referralCode }, user.uid); localStorage.removeItem('12toons-affiliate-referral'); }
        catch (e) { if (e.status === 400 || e.status === 403) localStorage.removeItem('12toons-affiliate-referral'); }
      }
    }
    document.querySelector('.support-widget')?.remove();
    const publicHome = !user && !maintenance && (location.hash || '#/') === '#/';
    const adminHome = user && role === 'admin' && (location.hash || '#/') === '#/';
    if ((user && role !== 'admin') || publicHome || adminHome) {
      try { const { chatWidget } = await import('./chat-widget.js'); document.body.append(chatWidget(user, () => go('#/login'))); }
      catch (e) { console.warn('Live chat unavailable:', e.message); }
    }
    if (u && role !== 'tester') { ensureProfile(u); syncAll().catch(e=>console.warn('Pending cloud sync:',e.message)); }
    if (first) { first = false; route(); } else if (!u && PRIVATE.includes(location.hash) && !maintenance) go('#/login'); else if (u && (location.hash === '#/login' || location.hash === '#/staff-login')) go(maintenance ? '#/admin' : '#/hub'); else route();
  });
}
start();

