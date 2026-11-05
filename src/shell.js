import { friendlyError } from '../shared/hinglish-errors.js';
import './style.css';
import { landingView as marketingLandingView } from './landing.js';
import './day-theme.css';
import './royal-surfaces.css';
import './stpro.css';
// 12toons shell: landing page -> login -> hub (12toons / 12toons Character Editor)
import { h, toast, logo } from './dom.js';
import { loadingSplash } from './loading-splash.js';
import { setCoinUser, mountCreditBadges } from './credits-badge.js';
import { startRoute, doneRoute } from './route-feedback.js';
import { onUser, signInGoogle, signOutUser, finishRedirect } from './firebase.js';
import { ensureProfile, r2Configured, cloudInfo, isAdmin, maintenanceStatus } from './cloud.js';
import { selectProject, projectMeta, listProjects, renameProject, deleteProject } from './store.js';
import { projectDialog } from './project-dialog.js';
import { projectsView } from './projects-view.js';
import { syncAll, syncProject } from './project-sync.js';
import { apiCall } from './session.js';
import { createShield } from './shield.js';

const DEBUG = import.meta.env.DEV && location.search.includes('debug');
const favicon = document.querySelector('link[rel~="icon"]');
const brandFavicon = favicon?.getAttribute('href') || '';
window.addEventListener('session-error', e => toast(e.detail));
window.addEventListener('session-revoked', e => toast(e.detail));
// a background save discovered this project's short ID collided with another account's and gave it a fresh one (see project-sync.js); keep the
// address bar honest so a reload still finds it, without disturbing whatever is on screen
window.addEventListener('project-id-changed', e => {
  const { oldId, newId } = e.detail, parts = location.hash.split('/');
  if (parts[2] === oldId) { parts[2] = newId; history.replaceState(null, '', location.pathname + location.search + parts.join('/')); }
});
const $shell = document.getElementById('shell'), $app = document.getElementById('app');
let features = { animator: true, character: true, background: true };
const applyFeatures = (r) => { if (r?.features) features = { animator: r.features.animator !== false, character: r.features.character !== false, background: r.features.background !== false }; };
const featureOn = (hash) => role === 'admin' || (hash === '#/toons' ? features.animator : hash === '#/characters' ? features.character : hash === '#/background-generator' ? features.background : true);
let adminUnknown = false, user = null, ready = false, studio = null, current = '', role = 'user', maintenance = true; 
let loadedAnimationProject=null;

function readTheme() { try { return localStorage.getItem('12toons-theme') === 'day' ? 'day' : 'night'; } catch { return 'night'; } }
let activeTheme = readTheme();
function setTheme(theme) {
  activeTheme = theme === 'night' ? 'night' : 'day';
  document.documentElement.dataset.theme = activeTheme;
  document.documentElement.style.colorScheme = activeTheme === 'night' ? 'dark' : 'light';
  try { localStorage.setItem('12toons-theme', activeTheme); } catch { /* theme still applies for this page view */ }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = activeTheme === 'night' ? '#141517' : '#f2f3f5';
}
setTheme(activeTheme);

/* ---------------- routing ---------------- */
const PRIVATE = ['#/hub', '#/toons', '#/characters', '#/background-generator', '#/admin', '#/credits', '#/affiliate-dashboard'];
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
// the browser / installed-app bars take the page's own background colour (day or night), never the purple brand colour
const themeMeta = document.querySelector('meta[name="theme-color"]');
const syncThemeColor = () => themeMeta?.setAttribute('content', document.documentElement.dataset.theme === 'day' ? '#f2f3f5' : '#141517');
new MutationObserver(syncThemeColor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
syncThemeColor();
// installable app: the worker only makes the site installable, it never keeps copies
if ('serviceWorker' in navigator && import.meta.env.PROD) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}), { once: true });

/* The live chat button: signed-in creators see it on every page; visitors who are signed out and admins see it on the home page and the help page.
   It is decided again on every page change (not only at sign-in), so it is there when a visitor comes back to the home page from the login page. */
let widgetFor = null;
async function syncSupportWidget() {
  if (!ready || DEBUG) return;
  const hash = location.hash || '#/', home = hash === '#/' || hash === '#/help', show = user ? (role !== 'admin' || home) : home, who = user ? user.uid : 'guest';
  const existing = document.querySelector('.support-widget');
  if (!show) { existing?.dispose?.(); existing?.remove(); widgetFor = null; return; }
  if (existing && widgetFor === who) return;
  existing?.dispose?.(); existing?.remove(); widgetFor = who;
  try {
    const { chatWidget } = await import('./chat-widget.js');
    if (widgetFor !== who || document.querySelector('.support-widget')) return;          // the page changed again meanwhile
    document.body.append(chatWidget(user, () => go('#/login')));
  } catch (e) { widgetFor = null; console.warn('Live chat unavailable:', e.message); }
}
let routing = Promise.resolve();
let routeSeq = 0;
function route() {
  const key = `route-${++routeSeq}`, hash = (location.hash || '#/').split('/').slice(0, 2).join('/');
  if (ready) startRoute(key, { studio: (hash === '#/toons' || hash === '#/characters') && !!(location.hash || '').split('/')[2] });
  routing = routing.then(renderRoute).then(syncPhoneNav).then(syncSupportWidget).catch(e => {
    if (reloadForNewVersion(e)) return;
    console.error('Could not open the page', e?.stack || e);
    toast(`Could not open the page: ${e.message}`);
  }).finally(() => { doneRoute(key); if (ready) doneRoute('boot'); });
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
  // the cloud export render worker (see docs/CLOUD-EXPORT.md): a private link opened only by that one machine, never by a person and
  // never signed in as anyone — it proves it owns one job with the job's own secret. Works during maintenance and with no account at all.
  if (hash === '#/cloudrender') {
    $app.hidden = true; $shell.hidden = false;
    $shell.replaceChildren(h('div', { style: 'padding:40px;text-align:center;color:#9aa' }, 'Rendering your video…'));
    const [uid, jobId, secret] = [parts[2], parts[3], parts[4]];
    if (uid && jobId && secret) import('./cloud-render.js').then((m) => m.runCloudRenderJob({ uid, jobId, secret })).catch((e) => console.error('Cloud export route failed', e));
    return;
  }
  document.title = hash === '#/affiliates' ? 'Affiliate Partners | 12toons' : '12toons';
  if (favicon) favicon.href = brandFavicon;
  // Maintenance never blocks signing in — only a signed-in, non-admin user sees the maintenance page; admins always get through.
  if (maintenance && user && role !== 'admin') {
    if (adminUnknown) { $app.hidden = true; $shell.hidden = false; $shell.replaceChildren(adminRetryView()); return; }
    const oldView = $shell.firstElementChild; oldView?.dispose?.();
    current = '#/maintenance'; $app.hidden = true; $shell.hidden = false;
    $shell.replaceChildren(maintenanceView()); return;
  }
  if (PRIVATE.includes(hash) && !user) { go('#/login'); return; }
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
  if ((hash === '#/toons' || hash === '#/characters' || hash === '#/background-generator') && user && !featureOn(hash)) { go('#/hub'); return; }
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
  if (hash === '#/help') {
    const [{ helpView }, { CONTACT_LINKS }] = await Promise.all([import('./help-page.js'), import('../shared/contact-links.js')]);
    $shell.replaceChildren(helpView({ home: () => go(user ? '#/hub' : '#/'), isAdmin: role === 'admin', links: CONTACT_LINKS, openChat: () => document.dispatchEvent(new CustomEvent('open-live-chat')) })); return;
  }
  if (hash === '#/background-generator') {
    const m = await import('./bg-generator.js'); $app.hidden = true; $shell.hidden = false; $shell.replaceChildren(await m.view({ user, home: () => go('#/hub'), toast })); return;
  }
  if (hash === '#/admin') {
    if (!(await isAdmin(user))) { toast('The admin panel is for admins only.'); go('#/hub'); return; }
    const m = await import('./admin.js'); $shell.replaceChildren(await m.view({ user, home: () => go('#/hub'), toast })); return;
  }
  if (hash === '#/characters') { const m = await import('./charstudio.js'); $shell.replaceChildren(await m.view({ user, home: () => go('#/characters'), toast })); return; }
  $shell.replaceChildren(hash === '#/login' ? loginView() : hash === '#/hub' ? hubView() : landingView());
}


/* ---------------- app rail: icon column on the left, opens into a labelled menu (hidden in the studios and on public pages) ---------------- */
const RAIL_ICONS = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  home: 'M3 11 12 3l9 8M5 10v10h5v-6h4v6h5V10',
  animate: 'M3 7a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7ZM16 10.5l5-3v9l-5-3',
  actor: 'M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3.5 20a6.5 6.5 0 0 1 10-5.2M14.5 21l.7-3 5.3-5.3 2.3 2.3-5.3 5.3-3 .7Z',
  coins: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v10M9.5 9.5h4a1.7 1.7 0 0 1 0 3.5h-3a1.7 1.7 0 0 0 0 3.5h4',
  earn: 'M4 17l6-6 4 4 6-10m-6 0h6v6',
  admin: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  logout: 'M10 4H4v16h6m4-12 4 4-4 4M8 12h10',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17v.1',
};
const railIcon = (name) => { const e = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); e.setAttribute('viewBox', '0 0 24 24'); e.setAttribute('aria-hidden', 'true'); const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', RAIL_ICONS[name]); e.append(path); return e; };
const RAIL_PAGES = ['#/hub', '#/toons', '#/characters', '#/credits', '#/affiliate-dashboard', '#/help'];
let rail = null, railOpen = false;
function syncPhoneNav() {
  const parts = (location.hash || '#/').split('/'), hash = parts.slice(0, 2).join('/'), inProject = (hash === '#/toons' || hash === '#/characters') && parts[2];
  const show = !!user && !(maintenance && role !== 'admin') && !inProject && RAIL_PAGES.includes(hash);
  document.body.classList.toggle('has-rail', show);
  if (!show) { rail?.remove(); rail = null; railOpen = false; return; }
  const item = (to, icon, label, action) => h('button', { type: 'button', class: `rail-item ${to === hash ? 'on' : ''}`, title: label, 'aria-label': label, 'aria-current': to === hash ? 'page' : null, onclick: (e) => { setRail(false); if (action) action(); else if (to !== hash) { e.currentTarget.classList.add('wait'); go(to); } } }, railIcon(icon), h('span', {}, label));
  const group = (label) => h('div', { class: 'rail-group' }, label);
  const next = h('aside', { class: `rail ${railOpen ? 'open' : ''}`, 'aria-label': 'Main menu' },
    h('div', { class: 'rail-scrim', onclick: () => setRail(false) }),
    h('nav', { class: 'rail-panel' },
      h('button', { type: 'button', class: 'rail-item rail-burger', 'aria-label': 'Menu', 'aria-expanded': String(railOpen), onclick: () => setRail(!railOpen) }, railIcon('menu')),
      item('#/hub', 'home', 'Dashboard'),
      group('Studio apps'),
      ...(featureOn('#/toons') ? [item('#/toons', 'animate', 'Animator Studio')] : []),
      ...(featureOn('#/characters') ? [item('#/characters', 'actor', 'Character Editor')] : []),
      group('Account'),
      item('#/credits', 'coins', 'Coins'),
      item('#/affiliate-dashboard', 'earn', 'Earn with us'),
      ...(role === 'admin' ? [item('#/admin', 'admin', 'Admin panel')] : []),
      h('div', { class: 'rail-foot' }, item('#/help', 'help', 'Help and support'))));
  rail?.replaceWith(next); if (!rail) document.body.append(next); rail = next;
  const bar = $shell.querySelector(':scope > .sh > header');
  if (bar && !bar.querySelector('.hdr-burger')) bar.prepend(h('button', { type: 'button', class: 'hdr-burger', 'aria-label': 'Open menu', onclick: () => setRail(!railOpen) }, railIcon('menu')));
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && railOpen) setRail(false); });
function setRail(open) { railOpen = open; rail?.classList.toggle('open', open); rail?.querySelector('.rail-burger')?.setAttribute('aria-expanded', String(open)); }

/* ---------------- shared bits ---------------- */
async function login() {
  try { const u = await signInGoogle(); if (u) go('#/hub'); } catch (e) { if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') toast(e.code === 'auth/unauthorized-domain' ? 'Sign-in is not available from this web address. Please open the official 12toons website and try again.' : `Sign-in failed: ${friendlyError(e)}`); }
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
      admin: 'M4 7h16M4 17h16M8 4v6m8 4v6',
      logout: 'M10 4H4v16h6m4-12 4 4-4 4M8 12h10',
      coins: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v10M9.5 9.5h4a1.7 1.7 0 0 1 0 3.5h-3a1.7 1.7 0 0 0 0 3.5h4',
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
    themeItem.querySelector('small').textContent = isDay ? 'Dark surfaces with purple accents' : 'Light surfaces with purple accents';
  }
  updateThemeItem();
  menu.append(
    h('div', { class: 'sh-who' },
      h('span', { class: 'sh-account-avatar', 'aria-hidden': 'true' }, makeAvatar()),
      h('div', { class: 'sh-account-copy' }, h('span', { class: 'sh-menu-kicker' }, 'YOUR ACCOUNT'), h('b', {}, name), h('small', {}, user.email || ''), h('span', { class: 'sh-plan' }, 'Free plan'))),
    h('div', { class: 'sh-menu-section' }, themeItem,
      item('coins', 'Buy Coins', 'Explore packs, balance and payment history', () => go('#/credits')),
      item('affiliate', 'Affiliate dashboard', 'Your referrals and earnings', () => go('#/affiliate-dashboard')),
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
    h('p', { class: 'sub' }, '12toons is in maintenance right now. Please check back shortly.'),
    h('button', { class: 'btn pri', onclick: async () => { await signOutUser(); go('#/'); } }, 'Sign out')));
}

/** a signed-in account whose admin status could not be checked (bad network): it is not sent to the maintenance page, it can just try again */
function adminRetryView() {
  return h('main', { class: 'sh sh-center' }, h('section', { class: 'sh-login maintenance-card' },
    logo(() => {}), h('div', { class: 'maintenance-mark', 'aria-hidden': 'true' }, '📡'),
    h('h1', {}, 'Could not check your account'),
    h('p', { class: 'sub' }, 'We couldn’t verify your access with the server. Check your internet connection and try again.'),
    h('button', { class: 'btn pri big', onclick: () => location.reload() }, 'Try again')));
}

/* ---------------- hub ---------------- */
function hubView() {
  const name = (user.displayName || 'Creator').split(' ')[0];
  const cloudLine = h('p', { class: 'sh-cloud' }, 'Checking cloud…');
  r2Configured().then(async (ok) => {
    if (!ok) { cloudLine.textContent = 'Your work is saved on this device.'; return; }
    const info = await cloudInfo();
    cloudLine.textContent = info ? `☁ Last cloud save: ${new Date(info.updatedAt).toLocaleString()}` : '☁ Projects save automatically while you edit.';
  }).catch(() => { cloudLine.textContent = ''; });
  // quick way back into the latest work
  const recent = h('section', { class: 'st-recent', hidden: true });
  const drawRecent = () => listProjects(user.uid).then((all) => {
    const latest = all.filter((p) => !p.deleted).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);
    if (!latest.length) { recent.hidden = true; recent.replaceChildren(); return; }
    const afterChange = async (change) => { try { await change(); } catch (e) { toast(friendlyError(e)); } await drawRecent(); };
    recent.replaceChildren(h('div', { class: 'st-label' }, 'Continue where you left off'),
      ...latest.map((p) => h('div', { class: 'st-recent-item' },
        h('button', { type: 'button', class: 'st-recent-row', onclick: () => { location.hash = `#/${p.kind === 'animation' ? 'toons' : 'characters'}/${p.id}`; location.reload(); } },
          h('span', { class: `st-recent-ico ${p.kind}` }, p.kind === 'animation' ? '▶' : '☻'),
          h('span', { class: 'st-recent-text' }, h('b', {}, p.name), h('small', {}, `${p.kind === 'animation' ? 'Animation' : 'Character'} · ${new Date(p.updatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`)),
          h('span', { class: 'st-recent-go', 'aria-hidden': 'true' }, '→')),
        h('div', { class: 'st-recent-actions' },
          h('button', { type: 'button', class: 'btn project-action', 'aria-label': `Rename ${p.name}`, onclick: () => afterChange(async () => {
            const name = await projectDialog({ title: 'Rename project', description: 'Choose a clear name for this project.', value: p.name, confirmLabel: 'Save name' });
            if (name) await renameProject(user.uid, p.id, name);
          }) }, 'Rename'),
          h('button', { type: 'button', class: 'btn project-action danger', 'aria-label': `Delete ${p.name}`, onclick: () => afterChange(async () => {
            if (!await projectDialog({ title: 'Delete this project?', description: `“${p.name}” will be removed from your project list.`, confirmLabel: 'Delete project', danger: true, confirmOnly: true })) return;
            await deleteProject(user.uid, p.id);
            syncProject(user.uid, p.id).catch(() => {});   // the project is already gone locally; the cloud copy follows when it can
          }) }, 'Delete')))));
    recent.hidden = false;
  }).catch(() => {});
  drawRecent();
  const tool = (cls, title, text, hash, btn) => h('article', { class: `sh-tool st-tool ${cls}`, role: 'link', tabindex: '0', onclick: () => go(hash), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(hash); } } },
    h('div', { class: 'st-tool-art', 'aria-hidden': 'true' }), h('div', { class: 'st-tool-body' }, h('h3', {}, title), h('p', {}, text), h('span', { class: 'st-launch' }, btn, ' →')));
  return h('div', { class: 'sh' },
    h('header', { class: 'sh-bar' }, logo(() => go('#/')), h('span', { class: 'sp' }), profileMenu()),
    h('main', { class: 'sh-hub' }, h('h1', {}, 'Welcome to 12toons Studio'), h('p', { class: 'sub' }, `Hi ${name}, create professional animations directly in your browser.`),
      h('div', { class: 'st-label' }, 'Tools'),
      h('div', { class: 'sh-tools' },
        ...(featureOn('#/toons') ? [tool('animator', '12toons Animator Studio', 'Turn your script and your voice into animated scenes, then export a video that is ready to share.', '#/toons', 'Launch Animator Studio')] : []),
        ...(featureOn('#/characters') ? [tool('actor', '12toons Character Editor', 'Build custom characters for your animations: recolour parts, upload artwork and choose outfits.', '#/characters', 'Launch Character Editor')] : []),
        ...(featureOn('#/background-generator') ? [tool('bggen', 'Background Generator', 'Start from a blank 4K canvas, add props, pictures and text, and save backgrounds you can use in the Animator Studio.', '#/background-generator', 'Open Background Generator')] : []),
        ...(!featureOn('#/toons') && !featureOn('#/characters') && !featureOn('#/background-generator') ? [h('p', { class: 'sub' }, 'The tools are not available right now. Please check back soon.')] : [])),
      role === 'admin' && (!features.animator || !features.character || !features.background) ? h('p', { class: 'sub' }, `Hidden for users: ${[!features.animator && 'Animator Studio', !features.character && 'Character Editor', !features.background && 'Background Generator'].filter(Boolean).join(', ')} (you can still see them as admin).`) : null,
      recent,
      cloudLine));
}

/* ---------------- shield ---------------- */
// Signed-in creators (never admins) are watched for developer tools / view-source; the admin dashboard shows the alerts.
let shield = null;
function guardSession(u) {
  shield?.stop(); shield = null;
  if (!u || role === 'admin' || DEBUG || !import.meta.env.PROD) return;
  shield = createShield({ report: (report) => apiCall('/api/security', { action: 'tamperReport', ...report }, u.uid), notice: toast });
  shield.start();
}

/* ---------------- start ---------------- */
async function start() {
  startRoute('boot', { quiet: true });
  // every page header gets the Coin balance; headers are drawn by many views, so new ones are picked up as they appear
  let badgeTimer = 0;
  new MutationObserver(() => { cancelAnimationFrame(badgeTimer); badgeTimer = requestAnimationFrame(() => mountCreditBadges($shell)); }).observe($shell, { childList: true, subtree: true });
  $shell.replaceChildren(loadingSplash('Getting things ready…'));
  const maintenanceAtStart = maintenanceStatus();   // starts now and runs while the sign-in redirect is finished
  if (DEBUG) { try { const st = await maintenanceAtStart; applyFeatures(st); maintenance = st.maintenance === true; } catch { maintenance = true; } user = { uid: 'debug', displayName: 'Test Creator', email: 'test@12toons.local', photoURL: '' }; role = 'user'; ready = true; route(); return; }
  await finishRedirect();
  try { const st = await maintenanceAtStart; applyFeatures(st); maintenance = st.maintenance === true; } catch { maintenance = true; }
  let first = true;
  onUser(async (u) => {
    if (ready && user && u && user.uid !== u.uid) { location.reload(); return; }   // only a real account switch forces a reload; a momentary null (mobile auth hiccup) must not nuke unsaved work
    user = u; setCoinUser(u?.uid || null);
    if (u) {
      // the two server checks are independent, so they are asked together
      const [maintenanceNow, adminAnswer] = await Promise.all([maintenanceStatus(), isAdmin(u)]);
      applyFeatures(maintenanceNow); maintenance = maintenanceNow.maintenance === true;
      const admin = adminAnswer === true;
      if (adminAnswer === null) {          // the server could not be asked: keep the login, show a retry instead of the maintenance page
        role = 'user'; adminUnknown = true; ready = true; route(); return;
      }
      adminUnknown = false;
      role = admin ? 'admin' : 'user';
      // Signed-in users stay signed in during maintenance — a non-admin just sees the maintenance page instead of being logged out.
    } else {
      role = 'user';
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
    await syncSupportWidget();
    guardSession(u);
    if (u) { ensureProfile(u); syncAll().catch(e=>console.warn('Pending cloud sync:',e.message)); }
    if (first) { first = false; route(); } else if (!u && PRIVATE.includes(location.hash)) go('#/login'); else if (u && location.hash === '#/login') go('#/hub'); else route();
  });
}
start();

