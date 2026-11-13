import { h, logo } from './dom.js';
import { apiCall } from './session.js';
import { friendlyError } from '../shared/hinglish-errors.js';
import { icon as ic } from './icons.js';

const number = (value) => Number(value || 0).toLocaleString('en-IN');
const money = (paise) => `₹${(Number(paise || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const dateTime = (value) => value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const localDayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

export function dashboardView({ user, home, toast, openStudio }) {
  // The console (top bar + section tabs) stays on screen; every section opens inside `host`, so the tabs and the back buttons always work.
  const shell = h('div', { class: 'sh admin-console' });
  const nav = h('nav', { class: 'admin-console-nav', 'aria-label': 'Admin sections' });
  const host = h('div', { class: 'admin-console-host' });
  let showing = 0, current = null;
  const setActive = (label) => shell.querySelectorAll('[data-tab]').forEach((b) => { const on = b.dataset.tab === label; b.classList.toggle('active', on); if (on) { b.setAttribute('aria-current', 'page'); b.scrollIntoView?.({ inline: 'center', block: 'nearest', behavior: 'smooth' }); } else b.removeAttribute('aria-current'); });
  async function show(label, factory) {
    const mine = ++showing;
    setActive(label);
    current?.dispose?.(); current = null;
    host.replaceChildren(h('p', { class: 'admin-console-loading', role: 'status' }, 'Loading…'));
    try {
      const view = await factory();
      if (mine !== showing) { view?.dispose?.(); return; }
      current = view; host.replaceChildren(view); window.scrollTo(0, 0);
    } catch (error) {
      if (mine !== showing) return;
      host.replaceChildren(h('section', { class: 'admin-panel-card admin-console-error' }, h('p', { class: 'admin-empty', role: 'alert' }, `This section could not be opened: ${friendlyError(error)}`), h('button', { class: 'btn', type: 'button', onclick: () => goOverview() }, '← Back to Overview')));
    }
  }
  const goOverview = () => show('Overview', overview);
  const openCharacters = () => import('./admin-characters.js').then(m => m.charactersView({ home, toast, back: goOverview }));
  const navItems = [
    ['Overview', overview],
    ['Users', () => import('./security-view.js').then(m => m.securityView({ home: goOverview, toast }))],
    ['Live Chat', () => import('./admin-chat.js').then(m => m.chatView({ user, toast, back: goOverview }))],
    ['Payments', () => import('./admin-payments.js').then(m => m.view({ user, home, toast, back: goOverview }))],
    ['Studio Controls', openStudio],
    ['Find Project', () => import('./admin-find-project.js').then(m => m.findProjectView({ user, back: goOverview, toast }))],
    ['Add Assets', () => import('./admin-assets.js').then(m => m.assetsView({ user, home, toast, back: goOverview }))],
    ['Characters', openCharacters],
    ['Affiliates', () => import('./admin-affiliates.js').then(m => m.affiliatesView({ user, toast, back: goOverview }))],
  ];
  const ICONS = {
    'Overview': 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    'Users': 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21a7 7 0 0 1 14 0M17 3.5a4 4 0 0 1 0 7M22 21a7 7 0 0 0-5-6.7',
    'Live Chat': 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z',
    'Payments': 'M6 4h12M6 9h12M9 4c4 0 6 2 6 5s-2 5-6 5l7 6',
    'Studio Controls': 'M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M8 14v6',
    'Find Project': 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7ZM15 15l3 3M13.5 14a2.5 2.5 0 1 0 0-.01',
    'Add Assets': 'M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5ZM12 8v8M8 12h8',
    'Characters': 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1M17 3l1 2 2 .5-1.5 1.5.4 2.2L17 8.2 15.1 9.2l.4-2.2L14 5.5l2-.5 1-2Z',
    'Affiliates': 'M3 10 12 4l9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18',
  };
  const icon = (label) => { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', ICONS[label] || ICONS.Overview); svg.append(path); return svg; };
  const bottom = h('nav', { class: 'admin-bottomnav', 'aria-label': 'Admin sections (phone)' });
  for (const [label, factory] of navItems) {
    nav.append(h('button', { class: 'admin-console-tab', type: 'button', 'data-tab': label, onclick: () => show(label, factory) }, icon(label), h('span', {}, label)));
    bottom.append(h('button', { class: 'admin-bottom-tab', type: 'button', 'data-tab': label, onclick: () => { show(label, factory); }, }, icon(label), h('span', {}, label)));
  }
  shell.append(
    h('header', { class: 'admin-console-topbar' }, logo(home), h('span', { class: 'admin-console-brand' }, 'Admin'), h('span', { class: 'sp' }), h('span', { class: 'admin-console-user', title: user.email || user.uid }, user.displayName || user.email || 'Administrator'), h('button', { class: 'btn', type: 'button', onclick: home }, 'Home')),
    nav,
    host,
    bottom,
  );
  shell.dispose = () => { current?.dispose?.(); showing++; };
  goOverview();
  return shell;

  /** the dashboard page: live numbers, refreshed every 15 s while it is on screen */
  function overview() {
    const root = h('div', { class: 'admin-overview' });
    const status = h('div', { class: 'admin-live-status', role: 'status' });
    const content = h('main', { class: 'admin-console-main' });
    const state = { security: null, payments: null, chats: null, affiliates: null, alerts: null, failures: {} };
    let knownAlerts = null;
    let busy = false;
    root.append(
      h('div', { class: 'admin-console-statusbar' }, status, h('span', { class: 'sp' }), h('button', { class: 'btn sm', type: 'button', onclick: () => refresh(true) }, ic('refresh'), 'Refresh')),
      content,
    );

    function stat(title, value, note, icon, tone = '') {
      return h('article', { class: `admin-kpi ${tone}` }, h('span', { class: 'admin-kpi-icon', 'aria-hidden': 'true' }, icon), h('small', {}, title), h('b', {}, value), note ? h('p', {}, note) : null);
    }
    function section(title, eyebrow, ...children) {
      return h('section', { class: 'admin-panel-card' }, h('div', { class: 'admin-panel-heading' }, h('div', {}, eyebrow ? h('span', { class: 'admin-eyebrow' }, eyebrow) : null, h('h2', {}, title))), ...children);
    }
    /** state: 'ok' (set up and working), 'off' (not set up on the server), 'down' (could not be checked) */
    function service(name, detail, st) {
      const text = { ok: 'Connected', off: 'Not set up', down: 'Unavailable' }[st];
      return h('div', { class: 'admin-service-row' }, h('i', { class: `admin-service-dot ${st === 'ok' ? 'ok' : 'off'}` }), h('div', {}, h('b', {}, name), h('small', {}, detail)), h('span', { class: `admin-service-state ${st === 'ok' ? 'ok' : 'off'}` }, text));
    }
    const KIND_TEXT = { devtools: 'Opened developer tools', shortcut: 'Pressed an inspect shortcut', 'view-source': 'Tried to view page source', console: 'Used the console', integrity: 'Tampered with the code' };
    async function acknowledge(id) {
      try { await apiCall('/api/security', { action: 'tamperAck', id }, user.uid); await refresh(true); }
      catch (e) { toast(`Could not dismiss the alert: ${friendlyError(e)}`); }
    }
    /** site controls: maintenance mode, and showing / hiding each studio card on the users' dashboard */
    function maintenanceCard() {
      const rows = [], state = {};
      const row = (key, title, onNote, offNote, save, confirmOn, iconName) => {
        const toggle = h('button', { class: 'admin-switch', type: 'button', role: 'switch', 'aria-checked': 'false', 'aria-label': title, disabled: true });
        const note = h('small', {}, 'Checking…');
        const paint = (on) => { state[key] = on; toggle.setAttribute('aria-checked', String(on)); toggle.classList.toggle('on', on); toggle.classList.toggle('good', key !== 'maintenance'); toggle.disabled = false; note.textContent = on ? onNote : offNote; };
        toggle.addEventListener('click', async () => {
          const next = toggle.getAttribute('aria-checked') !== 'true';
          if (confirmOn && next === confirmOn.when && !confirm(confirmOn.text)) return;
          toggle.disabled = true;
          try { const r = await save(next); paint(r); toast(`${title}: ${r ? 'ON' : 'OFF'}.`); }
          catch (e) { toast(`Could not change “${title}”: ${friendlyError(e)}`); toggle.disabled = false; }
        });
        rows.push({ key, paint, note, node: h('div', { class: `admin-maint-row${key === 'maintenance' ? ' lock' : ''}` }, h('span', { class: 'admin-maint-ic', 'aria-hidden': 'true' }, ic(iconName || 'eye')), h('div', { class: 'admin-maint-text' }, h('h2', {}, title), note), toggle) });
      };
      row('maintenance', 'Maintenance mode', 'On · only admins can get in', 'Off · site is open',
        async (on) => (await apiCall('/api/security', { action: 'setMaintenance', enabled: on }, user.uid)).maintenance === true,
        { when: true, text: 'Turn maintenance mode ON? Everyone except admins will be locked out until you turn it off.' }, 'lock');
      for (const [feature, title, iconName] of [['animator', 'Animator Studio', 'film'], ['character', 'Character Editor', 'user'], ['background', 'Background Generator', 'image']])
        row(feature, title, 'Visible to users', 'Hidden from users',
          async (on) => (await apiCall('/api/security', { action: 'setFeature', feature, enabled: on }, user.uid)).features[feature] !== false, undefined, iconName);
      apiCall('/api/security', { action: 'getMaintenance' }, user.uid).then((r) => { for (const x of rows) x.paint(x.key === 'maintenance' ? r.maintenance === true : r.features?.[x.key] !== false); })
        .catch((e) => { for (const x of rows) x.note.textContent = `Could not read the setting: ${friendlyError(e)}`; });
      return h('section', { class: 'admin-panel-card admin-maint' }, h('div', { class: 'admin-panel-heading' }, h('div', {}, h('h2', {}, 'Site controls'))), h('div', { class: 'admin-maint-grid' }, ...rows.map((x) => x.node)));
    }
    /** creators who opened the developer tools or tried to view the source (reported by src/shield.js) */
    function alertsSection() {
      const list = state.alerts?.alerts || [];
      if (!list.length) return null;
      return section(`Security alerts (${number(state.alerts.unacknowledged)})`, '',
        h('div', { class: 'admin-alert-list' }, list.slice(0, 8).map((a) => h('article', { class: 'admin-alert-row' },
          h('div', {}, h('b', {}, a.name || a.email || a.uid), h('small', {}, `${KIND_TEXT[a.kind] || a.kind}${a.detail ? ` · ${a.detail}` : ''} · ${a.path || '/'}`), h('small', {}, `${dateTime(a.at)}${a.country ? ` · ${a.country}` : ''} · ${a.email || ''}`)),
          h('div', { class: 'admin-alert-actions' },
            h('button', { class: 'btn sm', type: 'button', onclick: () => show('Users', () => import('./security-view.js').then((m) => m.securityView({ home: goOverview, toast }))) }, 'Open Users'),
            h('button', { class: 'btn sm', type: 'button', onclick: () => acknowledge(a.id) }, 'Mark as seen')))),
        h('button', { class: 'btn sm', type: 'button', onclick: () => acknowledge('all') }, 'Mark all as seen')));
    }
    function renderDashboard() {
      content.replaceChildren();
      const sec = state.security, users = [], sessions = (sec?.sessions || []).filter(s => !s.revoked && Date.now() - Number(s.lastSeen || 0) < 15 * 60 * 1000), payments = state.payments?.payments || [], chats = state.chats?.chats || [], affiliates = state.affiliates?.affiliates || [];
      const captured = payments.filter(p => p.status === 'captured');
      const unread = chats.filter(c => c.unreadAdmin === true).length;
      const opened = affiliates.filter(a => a.status === 'new' || a.status === 'contacted').length;
      const userMap = new Map((sec?.sessions || []).map(u => [u.id, u]));

      content.append(
        h('div', { class: 'admin-dashboard-heading' }, h('div', {}, h('h1', {}, 'Dashboard'))),
        h('div', { class: 'admin-kpi-grid' },
          stat('Accounts', number(sec?.totalUsers), '', icon('Users')),
          stat('Online now', number(sec?.onlineNow), 'last 15 minutes', ic('zap'), 'blue'),
          stat('Payments', number(captured.length), `${money(captured.reduce((sum, p) => sum + Number(p.amountPaise || 0), 0))} received`, icon('Payments'), 'violet'),
          stat('Unread chats', number(unread), `${number(chats.length)} in the inbox`, icon('Live Chat'), 'green')),
        maintenanceCard(),
        alertsSection() || '',
        h('div', { class: 'admin-dashboard-grid' },
          section('Active sessions', '', h('div', { class: 'admin-session-list' }, sessions.length ? sessions.slice(0, 6).map(s => {
            const u = userMap.get(s.id) || {};
            return h('article', { class: 'admin-session-row' }, h('span', { class: 'admin-session-avatar' }, (u.name || u.email || s.id || '?').trim()[0]?.toUpperCase() || '?', h('i', { class: 'au-live' })), h('span', { class: 'admin-session-copy' }, h('b', {}, u.name || u.email || s.id), h('small', {}, `${u.email || 'Account'} · Device ${s.deviceId || '—'}`)), h('span', { class: 'admin-seen' }, (() => { const m = Math.round((Date.now() - (s.lastSeen || 0)) / 60000); return m < 2 ? 'Just now' : `${m} min ago`; })()));
          }) : h('p', { class: 'admin-empty' }, state.failures.security ? 'Could not load the account and session data.' : 'Nobody has been active in the last 15 minutes.'))),
          section('Services', '', h('div', { class: 'admin-service-list' }, (() => {
            const sv = sec?.services, st = (v) => (!sv ? 'down' : v ? 'ok' : 'off');
            return [
              service('Database', 'Accounts and sessions', sec ? 'ok' : 'down'),
              service('Payments', 'Razorpay keys on the server', st(sv?.payments)),
              service('Payment confirmations', 'Razorpay webhook secret', st(sv?.webhook)),
              service('File storage', 'Cloudflare R2 for projects and assets', st(sv?.storage)),
            ];
          })())),
          section('Today', '', h('div', { class: 'admin-ops-grid' },
            h('div', {}, h('small', {}, 'Captured orders'), h('b', {}, number(captured.length)), h('span', {}, 'in latest payment report')),
            h('div', {}, h('small', {}, 'Open affiliate requests'), h('b', {}, number(opened)), h('span', {}, `${number(affiliates.length)} partner records`)),
            h('div', {}, h('small', {}, 'Support inbox'), h('b', {}, number(chats.length)), h('span', {}, `${number(unread)} unread conversations`)))),
        ),
      );
    }

    async function refresh(showToast = false) {
      if (busy || !root.isConnected) return;
      busy = true; status.replaceChildren(h('i', { class: 'admin-live-dot' }), h('span', {}, 'Updating live data…'));
      const calls = [
        ['security', () => apiCall('/api/security', { action: 'summary' }, user.uid)],
        ['payments', () => apiCall('/api/payments', { action: 'adminList', limit: 25 }, user.uid)],
        ['chats', () => apiCall('/api/chat', { action: 'adminList' }, user.uid)],
        ['affiliates', () => apiCall('/api/affiliates', { action: 'adminList' }, user.uid)],
        ['alerts', () => apiCall('/api/security', { action: 'tamperAlerts' }, user.uid)],
      ];
      const results = await Promise.allSettled(calls.map(([, call]) => call()));
      state.failures = {};
      results.forEach((result, i) => {
        const key = calls[i][0];
        if (result.status === 'fulfilled') state[key] = result.value;
        else { state.failures[key] = result.reason?.message || 'Unavailable'; state[key] = null; }
      });
      if (root.isConnected) {
        const ids = new Set((state.alerts?.alerts || []).map((a) => a.id)), fresh = knownAlerts ? (state.alerts?.alerts || []).filter((a) => !knownAlerts.has(a.id)) : [];
        knownAlerts = ids;
        if (fresh.length) toast(`Security alert: ${fresh[0].name || fresh[0].email || 'A user'} opened the developer tools or an inspect shortcut${fresh.length > 1 ? ` (+${fresh.length - 1} more)` : ''}.`);
        renderDashboard();
        const updated = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const errors = Object.keys(state.failures);
        status.replaceChildren(h('i', { class: `admin-live-dot ${errors.length ? 'warn' : ''}` }), h('span', {}, `${errors.length ? 'Some data is not available · ' : ''}Updated ${updated}`));
        if (showToast && errors.length) toast(`Some dashboard data could not be loaded: ${errors.join(', ')}`);
      }
      busy = false;
    }

    renderDashboard();
    setTimeout(() => refresh(), 0);          // after the page has been attached: refresh() does nothing for a view that is not on screen yet
    // no automatic refresh: the numbers update when the page opens or when Refresh is pressed
    root.dispose = () => {};
    return root;

  }
}
