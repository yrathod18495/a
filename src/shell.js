import './style.css';
import { landingView as marketingLandingView } from './landing.js';
// 12toons shell: landing page -> login -> hub (12toons / 12toons Character Studio)
import { h, toast, logo } from './dom.js';
import { onUser, signInGoogle, signOutUser, finishRedirect, refreshUser } from './firebase.js';
import { ensureProfile, r2Configured, pushAll, pullAll, cloudInfo, isAdmin, maintenanceStatus } from './cloud.js';
import { selectProject, projectMeta, listProjects, createProject } from './store.js';
import { projectsView } from './projects-view.js';
import { syncAll } from './project-sync.js';
import { apiCall } from './session.js';

const DEBUG = import.meta.env.DEV && location.search.includes('debug');
const favicon = document.querySelector('link[rel~="icon"]');
const brandFavicon = favicon?.getAttribute('href') || '';
const testerFavicon = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"%3E%3Crect width="32" height="32" rx="8" fill="%232563eb"/%3E%3Ccircle cx="16" cy="16" r="6" fill="white"/%3E%3C/svg%3E';
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
  if (meta) meta.content = activeTheme === 'night' ? '#080d17' : '#ffffff';
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
  routing = routing.then(renderRoute).catch(e => toast(`Could not open page: ${e.message}`));
  return routing;
}
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
    if (!(await isAdmin(user))) { toast('The admin panel is only for admins.'); go('#/hub'); return; }
    const m = await import('./admin.js'); $shell.replaceChildren(await m.view({ user, home: () => go('#/hub'), toast })); return;
  }
  if (hash === '#/characters') { const m = await import('./charstudio.js'); $shell.replaceChildren(await m.view({ user, home: () => go('#/characters'), toast })); return; }
  $shell.replaceChildren(hash === '#/login' ? loginView() : hash === '#/hub' ? hubView() : landingView());
}

/* ---------------- shared bits ---------------- */
async function login() {
  try { const u = await signInGoogle(); if (u) go('#/hub'); } catch (e) { if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') toast(e.code === 'auth/unauthorized-domain' ? 'This website address is not allowed to log in yet. Add it under Firebase → Authentication → Settings → Authorized domains.' : `Login failed: ${e.message}`); }
}
async function loginStaff() {
  staffLoginPending = true; sessionStorage.setItem('12toons-staff-login', '1'); staffMessage = '';
  try { await signInGoogle(); }
  catch (e) {
    staffLoginPending = false; sessionStorage.removeItem('12toons-staff-login');
    if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
      staffMessage = e.code === 'auth/unauthorized-domain' ? 'This website address is not allowed to log in yet. Add it under Firebase Authentication authorized domains.' : `Google sign-in failed: ${e.message}`;
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
    if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') toast(e.code === 'auth/unauthorized-domain' ? 'This website address is not allowed to log in yet. Add it under Firebase Authentication authorized domains.' : `Google sign-in failed: ${e.message}`);
  }
}
const initial = (u) => (u.displayName || u.email || '?').trim()[0].toUpperCase();
function profileMenu() {
  const menu = h('div', { class: 'sh-menu', hidden: true });
  const avatar = user.photoURL ? h('img', { src: user.photoURL, alt: '', referrerpolicy: 'no-referrer' }) : initial(user);
  const btn = h('button', { class: 'sh-avatar', title: user.displayName || 'Account', onclick: (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; } }, avatar);
  const close = () => { menu.hidden = true; };
  document.addEventListener('click', close, { once: false });
  const item = (label, fn) => h('button', { class: 'sh-mi', onclick: () => { close(); fn(); } }, label);
  const themeItem = h('button', { class: 'sh-mi', type: 'button', onclick: () => { setTheme(activeTheme === 'day' ? 'night' : 'day'); close(); } }, activeTheme === 'day' ? '☾ Switch to night mode' : '☀ Switch to day mode');
  // Temporarily disabled until Firebase Web Push VAPID is configured.
  // Preserve the UI implementation here so it can be restored after setup.
  /*
  const notifications = h('button', { class: 'sh-mi sh-notification-setting', type: 'button' }, '🔔 Enable reply notifications');
  import('./notifications.js').then(({ replyNotificationsEnabled }) => {
    notifications.textContent = replyNotificationsEnabled(user.uid) ? '🔔 Turn off reply notifications' : '🔔 Enable reply notifications';
  }).catch(() => {});
  notifications.addEventListener('click', async () => {
    close();
    try {
      const { toggleReplyNotifications, replyNotificationsEnabled } = await import('./notifications.js');
      const message = await toggleReplyNotifications(user);
      notifications.textContent = replyNotificationsEnabled(user.uid) ? '🔔 Turn off reply notifications' : '🔔 Enable reply notifications';
      toast(message);
    } catch (e) { toast(e.message || 'Could not update notification settings.'); }
  });
  */
  menu.append(
    h('div', { class: 'sh-who' }, h('b', {}, user.displayName || 'Creator'), h('small', {}, user.email || ''), h('span', { class: 'sh-plan' }, 'Free plan')),
    item('☁ Save everything to the cloud', async () => { try { const n = await pushAll(); toast(n ? `Saved (${n} new file${n > 1 ? 's' : ''}).` : 'Cloud is up to date.'); } catch (e) { toast(e.message); } }),
    item('⬇ Restore from the cloud', async () => {
      const info = await cloudInfo();
      if (!info) { toast('Nothing saved in the cloud yet.'); return; }
      if (!confirm('Download cloud projects? Unsynced local edits are preserved.')) return;
      try { await pullAll(); location.hash = '#/toons'; location.reload(); } catch (e) { toast(e.message); }
    }),
    themeItem,
    // notifications,
    item('Affiliate dashboard', () => go('#/affiliate-dashboard')),
    item('🧪 Tester access', () => go('#/tester')),
    ...(role === 'admin' ? [item('🛠 Admin panel', () => go('#/admin'))] : []),
    item('⎋ Log out', async () => {
      // Temporarily disabled with Web Push until the VAPID key is configured.
      /*
      try {
        const { replyNotificationsEnabled, disableReplyNotifications } = await import('./notifications.js');
        if (replyNotificationsEnabled(user.uid)) await disableReplyNotifications(user);
      } catch (e) { console.warn('Notification cleanup on sign out failed:', e.message); }
      */
      await signOutUser(); go('#/');
    }));
  return h('div', { class: 'sh-profile' }, btn, menu);
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
    h('p', { class: 'sub' }, '12toons is temporarily under maintenance. Please check back shortly.'),
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
        card('🎭', '12toons Character Studio', 'Build characters. Recolour parts, swap images, choose outfits and save them for your animations.', '#/characters', 'Open Character Studio →'),
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
        staffMessage = sessionStorage.getItem('12toons-staff-error') || 'Staff access could not be verified. Please try again.';
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
        staffMessage = sessionStorage.getItem('12toons-staff-error') || 'Staff access could not be verified. Please try again.';
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

