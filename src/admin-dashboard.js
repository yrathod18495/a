import { h, logo } from './dom.js';
import { apiCall } from './session.js';
import { friendlyError } from '../shared/hinglish-errors.js';

const number = (value) => Number(value || 0).toLocaleString('en-IN');
const money = (paise) => `₹${(Number(paise || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const dateTime = (value) => value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const localDayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

export function dashboardView({ user, home, toast, openStudio, openTesters }) {
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
  const openRequests = () => import('./security-view.js').then(m => m.securityView({ initialTab: 'testers', home: goOverview, toast }));
  const navItems = [
    ['Overview', overview],
    ['Users', () => import('./security-view.js').then(m => m.securityView({ home: goOverview, toast }))],
    ['Live Chat', () => import('./admin-chat.js').then(m => m.chatView({ user, toast, back: goOverview }))],
    ['Payments', () => import('./admin-payments.js').then(m => m.view({ user, home, toast, back: goOverview }))],
    ['Studio Controls', openStudio],
    ['Tester Requests', openRequests],
    ['Tester Permissions', openTesters],
    ['Find Project', () => import('./admin-find-project.js').then(m => m.findProjectView({ user, back: goOverview, toast }))],
    ['Props & Effects', () => import('./admin-props-effects.js').then(m => m.propsEffectsView({ home, toast, back: goOverview }))],
    ['Add Assets', () => import('./admin-assets.js').then(m => m.assetsView({ user, home, toast, back: goOverview }))],
    ['Affiliates', () => import('./admin-affiliates.js').then(m => m.affiliatesView({ user, toast, back: goOverview }))],
  ];
  const ICONS = {
    'Overview': 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    'Users': 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21a7 7 0 0 1 14 0M17 3.5a4 4 0 0 1 0 7M22 21a7 7 0 0 0-5-6.7',
    'Live Chat': 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z',
    'Payments': 'M6 4h12M6 9h12M9 4c4 0 6 2 6 5s-2 5-6 5l7 6',
    'Studio Controls': 'M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M8 14v6',
    'Tester Requests': 'M9 4h6a1 1 0 0 1 1 1v1h2a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h2V5a1 1 0 0 1 1-1ZM9 14l2 2 4-4',
    'Tester Permissions': 'M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6l-8-3ZM9 12l2 2 4-4',
    'Find Project': 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7ZM15 15l3 3M13.5 14a2.5 2.5 0 1 0 0-.01',
    'Props & Effects': 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3ZM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z',
    'Add Assets': 'M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5ZM12 8v8M8 12h8',
    'Affiliates': 'M3 10 12 4l9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18',
  };
  const icon = (label) => { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', ICONS[label] || ICONS.Overview); svg.append(path); return svg; };
  const bottom = h('nav', { class: 'admin-bottomnav', 'aria-label': 'Admin sections (phone)' });
  for (const [label, factory] of navItems) {
    nav.append(h('button', { class: 'admin-console-tab', type: 'button', 'data-tab': label, onclick: () => show(label, factory) }, icon(label), h('span', {}, label)));
    bottom.append(h('button', { class: 'admin-bottom-tab', type: 'button', 'data-tab': label, onclick: () => { show(label, factory); }, }, icon(label), h('span', {}, label)));
  }
  shell.append(
    h('header', { class: 'admin-console-topbar' }, logo(home), h('span', { class: 'admin-console-brand' }, 'Admin Dashboard'), h('span', { class: 'sp' }), h('span', { class: 'admin-console-user', title: user.email || user.uid }, user.displayName || user.email || 'Administrator'), h('button', { class: 'btn', type: 'button', onclick: home }, 'Home')),
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
    const requestNotice = h('button', { class: 'btn sm', type: 'button', hidden: true, 'aria-live': 'polite', onclick: () => show('Tester Requests', openRequests) });
    root.append(
      h('div', { class: 'admin-console-statusbar' }, status, requestNotice, h('span', { class: 'sp' }), h('button', { class: 'btn sm', type: 'button', onclick: () => refresh(true) }, '↻ Refresh')),
      content,
    );

    function stat(title, value, note, icon, tone = '') {
      return h('article', { class: `admin-kpi ${tone}` }, h('span', { class: 'admin-kpi-icon', 'aria-hidden': 'true' }, icon), h('small', {}, title), h('b', {}, value), h('p', {}, note));
    }
    function section(title, eyebrow, ...children) {
      return h('section', { class: 'admin-panel-card' }, h('div', { class: 'admin-panel-heading' }, h('div', {}, h('span', { class: 'admin-eyebrow' }, eyebrow), h('h2', {}, title))), ...children);
    }
    function service(name, detail, ok) {
      return h('div', { class: 'admin-service-row' }, h('i', { class: `admin-service-dot ${ok ? 'ok' : 'off'}` }), h('div', {}, h('b', {}, name), h('small', {}, detail)), h('span', { class: `admin-service-state ${ok ? 'ok' : 'off'}` }, ok ? 'Connected' : 'Unavailable'));
    }
    const KIND_TEXT = { devtools: 'Opened developer tools', shortcut: 'Pressed an inspect shortcut', 'view-source': 'Tried to view page source', console: 'Used the console', integrity: 'Tampered with the code' };
    async function acknowledge(id) {
      try { await apiCall('/api/security', { action: 'tamperAck', id }, user.uid); await refresh(true); }
      catch (e) { toast(`Could not dismiss the alert: ${friendlyError(e)}`); }
    }
    /** creators who opened the developer tools or tried to view the source (reported by src/shield.js) */
    function alertsSection() {
      const list = state.alerts?.alerts || [];
      if (!list.length) return null;
      return section(`Security alerts (${number(state.alerts.unacknowledged)})`, 'INSPECT / DEVELOPER TOOLS',
        h('div', { class: 'admin-alert-list' }, list.slice(0, 8).map((a) => h('article', { class: 'admin-alert-row' },
          h('div', {}, h('b', {}, a.name || a.email || a.uid), h('small', {}, `${KIND_TEXT[a.kind] || a.kind}${a.detail ? ` · ${a.detail}` : ''} · ${a.path || '/'}`), h('small', {}, `${dateTime(a.at)}${a.country ? ` · ${a.country}` : ''} · ${a.email || ''}`)),
          h('div', { class: 'admin-alert-actions' },
            h('button', { class: 'btn sm', type: 'button', onclick: () => show('Users', () => import('./security-view.js').then((m) => m.securityView({ home: goOverview, toast }))) }, 'Open Users'),
            h('button', { class: 'btn sm', type: 'button', onclick: () => acknowledge(a.id) }, 'Mark as seen')))),
        h('button', { class: 'btn sm', type: 'button', onclick: () => acknowledge('all') }, 'Sab dekh liye')));
    }
    function renderDashboard() {
      content.replaceChildren();
      const sec = state.security, users = sec?.users || [], sessions = (sec?.sessions || []).filter(s => !s.revoked), payments = state.payments?.payments || [], chats = state.chats?.chats || [], affiliates = state.affiliates?.affiliates || [];
      const captured = payments.filter(p => p.status === 'captured');
      const newUsers = users.filter(u => { const time = Date.parse(u.registeredAt || ''); return Number.isFinite(time) && time >= localDayStart(); }).length;
      const unread = chats.filter(c => c.unreadAdmin === true).length;
      const opened = affiliates.filter(a => a.status === 'new' || a.status === 'contacted').length;
      const userMap = new Map(users.map(u => [u.id, u]));

      content.append(
        h('div', { class: 'admin-dashboard-heading' }, h('div', {}, h('span', { class: 'admin-eyebrow' }, 'WORKSPACE OVERVIEW'), h('h1', {}, 'Dashboard'), h('p', {}, 'Live account, payment, support and partner activity from your admin services.')),
          h('span', { class: 'admin-refresh-note' }, 'Updates when you press Refresh')),
        h('div', { class: 'admin-kpi-grid' },
          stat('Accounts in current report', number(users.length), 'The security API returns up to 100 account records per refresh.', '♙'),
          stat('Active sessions in report', number(sessions.length), 'Sessions not revoked and not expired.', '⌁', 'blue'),
          stat('Captured payments · latest report', number(captured.length), `${money(captured.reduce((sum, p) => sum + Number(p.amountPaise || 0), 0))} recorded in this report.`, '₹', 'violet'),
          stat('Unread support conversations', number(unread), `${number(chats.length)} conversations returned by the live chat inbox.`, '✉', 'green')),
        alertsSection() || '',
        h('div', { class: 'admin-dashboard-grid' },
          section('Active sessions', 'LIVE ACCOUNTS', h('div', { class: 'admin-session-list' }, sessions.length ? sessions.slice(0, 6).map(s => {
            const u = userMap.get(s.id) || {};
            return h('article', { class: 'admin-session-row' }, h('span', { class: 'admin-session-avatar' }, (u.name || u.email || s.id || '?').trim()[0]?.toUpperCase() || '?'), h('span', { class: 'admin-session-copy' }, h('b', {}, u.name || u.email || s.id), h('small', {}, `${u.email || 'Account'} · Device ${s.deviceId || '—'}`)), h('span', { class: 'admin-pill live' }, 'Active'));
          }) : h('p', { class: 'admin-empty' }, state.failures.security ? 'Could not load the account and session data.' : 'No active sessions in the current report.'))),
          section('Service access', 'CONNECTION STATUS', h('div', { class: 'admin-service-list' },
            service('Account security', 'Authenticated admin API', !!state.security),
            service('Payments', 'Razorpay payment records', !!state.payments),
            service('Live chat', 'Support conversation inbox', !!state.chats),
            service('Affiliate program', 'Partner and commission records', !!state.affiliates))),
          section('Daily operations', 'TODAY · CURRENT REPORTS', h('div', { class: 'admin-ops-grid' },
            h('div', {}, h('small', {}, 'New accounts'), h('b', {}, number(newUsers)), h('span', {}, 'in returned account records')),
            h('div', {}, h('small', {}, 'Captured orders'), h('b', {}, number(captured.length)), h('span', {}, 'in latest payment report')),
            h('div', {}, h('small', {}, 'Open affiliate requests'), h('b', {}, number(opened)), h('span', {}, `${number(affiliates.length)} partner records`)),
            h('div', {}, h('small', {}, 'Support inbox'), h('b', {}, number(chats.length)), h('span', {}, `${number(unread)} unread conversations`)))),
          section('Recent account activity', 'SECURITY EVENTS', h('div', { class: 'admin-events-list' }, (sec?.events || []).slice().sort((a, b) => Number(b.at || 0) - Number(a.at || 0)).slice(0, 7).map(e => h('article', { class: 'admin-event-row' }, h('span', { class: 'admin-event-icon' }, e.code === 'device_review' ? '!' : '•'), h('div', {}, h('b', {}, String(e.code || 'Account activity').replaceAll('_', ' ')), h('small', {}, `${e.email || e.id || 'Account'} · ${dateTime(e.at)}`)), e.deviceId ? h('small', { class: 'admin-event-device' }, `Device ${e.deviceId}`) : null)),
            !sec?.events?.length ? h('p', { class: 'admin-empty' }, state.failures.security ? 'Security events are not available right now.' : 'No recent security events.') : null)),
        ),
      );
    }

    async function refresh(showToast = false) {
      if (busy || !root.isConnected) return;
      busy = true; status.replaceChildren(h('i', { class: 'admin-live-dot' }), h('span', {}, 'Updating live data…'));
      const calls = [
        ['security', () => apiCall('/api/security', { action: 'overview' }, user.uid)],
        ['payments', () => apiCall('/api/payments', { action: 'adminList' }, user.uid)],
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
        if (fresh.length) toast(`⚠ Security alert: ${fresh[0].name || fresh[0].email || 'ek user'} ne developer tools / inspect use kiya${fresh.length > 1 ? ` (+${fresh.length - 1} aur)` : ''}.`);
        renderDashboard();
        const updated = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const errors = Object.keys(state.failures);
        status.replaceChildren(h('i', { class: `admin-live-dot ${errors.length ? 'warn' : ''}` }), h('span', {}, `${errors.length ? `Some data is not available right now · ` : 'Live data connected · '}Updated ${updated} · refreshes every 15 seconds`));
        if (showToast && errors.length) toast(`Some dashboard data could not be loaded: ${errors.join(', ')}`);
      }
      busy = false;
    }

    let knownRequests = null, requestBusy = false;
    async function refreshRequests() {
      if (requestBusy || !root.isConnected || document.hidden) return;
      requestBusy = true;
      try {
        const { requests = [] } = await apiCall('/api/security', {action:'testerRequests'}, user.uid);
        if (!root.isConnected) return;
        const added = knownRequests ? requests.filter(r=>!knownRequests.has(r.uid)) : [];
        knownRequests = new Set(requests.map(r=>r.uid));
        requestNotice.hidden = !requests.length;
        requestNotice.textContent = `${requests.length} tester request${requests.length===1?'':'s'} pending · Review`;
        if (added.length) toast(`${added.length} new tester access request${added.length===1?'':'s'} awaiting approval.`);
      } catch { requestNotice.hidden = false; requestNotice.textContent = 'Tester requests are not available right now · Please try again'; }
      finally { requestBusy = false; }
    }
    renderDashboard();
    refresh();
    setTimeout(refreshRequests, 50);       // the page is attached to the document by then
    // no automatic refresh: the numbers update when the page opens or when Refresh is pressed
    root.dispose = () => {};
    return root;

  }
}
