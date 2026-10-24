import { h, logo } from './dom.js';
import { apiCall } from './session.js';

const number = (value) => Number(value || 0).toLocaleString('en-IN');
const money = (paise) => `₹${(Number(paise || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const dateTime = (value) => value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const localDayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

export function dashboardView({ user, home, toast, openStudio, openTesters }) {
  const root = h('div', { class: 'sh admin-console' });
  const nav = h('nav', { class: 'admin-console-nav', 'aria-label': 'Admin sections' });
  const status = h('div', { class: 'admin-live-status', role: 'status' });
  const content = h('main', { class: 'admin-console-main' });
  const state = { security: null, payments: null, chats: null, affiliates: null, failures: {} };
  let busy = false;

  const switchTo = async (factory) => {
    try { root.replaceWith(await factory()); }
    catch (error) { toast(`Ye section khul nahi paya: ${error.message}`); }
  };
  const showDashboard = () => dashboardView({ user, home, toast, openStudio, openTesters });
  const openRequests = () => import('./security-view.js').then(m => m.securityView({ initialTab: 'testers', home: async () => switchTo(showDashboard), toast }));
  const requestNotice = h('button', {class:'btn sm', type:'button', hidden:true, 'aria-live':'polite', onclick:()=>switchTo(openRequests)});
  const navItems = [
    ['Overview', renderDashboard],
    ['Users', () => import('./security-view.js').then(m => m.securityView({ home: async () => switchTo(showDashboard), toast }))],
    ['Live Chat', () => import('./admin-chat.js').then(m => m.chatView({ user, toast, back: async () => switchTo(showDashboard) }))],
    ['Payments', () => import('./admin-payments.js').then(m => m.view({ user, home, toast, back: async () => switchTo(showDashboard) }))],
    ['Studio Controls', openStudio],
    ['Tester Requests', openRequests],
    ['Tester Permissions', openTesters],
    ['Add Assets', () => import('./admin-assets.js').then(m => m.assetsView({ user, home, toast, back: async () => switchTo(showDashboard) }))],
    ['Affiliates', () => import('./admin-affiliates.js').then(m => m.affiliatesView({ user, toast, back: async () => switchTo(showDashboard) }))],
  ];
  for (const [label, action] of navItems) nav.append(h('button', { class: `admin-console-tab ${label === 'Overview' ? 'active' : ''}`, type: 'button', onclick: () => switchTo(action) }, label));

  root.append(
    h('header', { class: 'admin-console-topbar' }, logo(home), h('span', { class: 'admin-console-brand' }, 'Admin Dashboard'), h('span', { class: 'sp' }), h('span', { class: 'admin-console-user', title: user.email || user.uid }, user.displayName || user.email || 'Administrator'), h('button', { class: 'btn', type: 'button', onclick: home }, 'Home')),
    nav,
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
  function renderDashboard() {
    content.replaceChildren();
    const sec = state.security, users = sec?.users || [], sessions = (sec?.sessions || []).filter(s => !s.revoked && Number(s.expiresAt) > Date.now()), payments = state.payments?.payments || [], chats = state.chats?.chats || [], affiliates = state.affiliates?.affiliates || [];
    const captured = payments.filter(p => p.status === 'captured');
    const newUsers = users.filter(u => { const time = Date.parse(u.registeredAt || ''); return Number.isFinite(time) && time >= localDayStart(); }).length;
    const unread = chats.filter(c => c.unreadAdmin === true).length;
    const opened = affiliates.filter(a => a.status === 'new' || a.status === 'contacted').length;
    const userMap = new Map(users.map(u => [u.id, u]));

    content.append(
      h('div', { class: 'admin-dashboard-heading' }, h('div', {}, h('span', { class: 'admin-eyebrow' }, 'WORKSPACE OVERVIEW'), h('h1', {}, 'Dashboard'), h('p', {}, 'Live account, payment, support and partner activity from your admin services.')),
        h('span', { class: 'admin-refresh-note' }, 'Auto refresh · 15 sec')),
      h('div', { class: 'admin-kpi-grid' },
        stat('Accounts in current report', number(users.length), 'The security API returns up to 100 account records per refresh.', '♙'),
        stat('Active sessions in report', number(sessions.length), 'Sessions not revoked and not expired.', '⌁', 'blue'),
        stat('Captured payments · latest report', number(captured.length), `${money(captured.reduce((sum, p) => sum + Number(p.amountPaise || 0), 0))} recorded in this report.`, '₹', 'violet'),
        stat('Unread support conversations', number(unread), `${number(chats.length)} conversations returned by the live chat inbox.`, '✉', 'green')),
      h('div', { class: 'admin-dashboard-grid' },
        section('Active sessions', 'LIVE ACCOUNTS', h('div', { class: 'admin-session-list' }, sessions.length ? sessions.slice(0, 6).map(s => {
          const u = userMap.get(s.id) || {};
          return h('article', { class: 'admin-session-row' }, h('span', { class: 'admin-session-avatar' }, (u.name || u.email || s.id || '?').trim()[0]?.toUpperCase() || '?'), h('span', { class: 'admin-session-copy' }, h('b', {}, u.name || u.email || s.id), h('small', {}, `${u.email || 'Account'} · Device ${s.deviceId || '—'}`)), h('span', { class: 'admin-pill live' }, 'Active'));
        }) : h('p', { class: 'admin-empty' }, state.failures.security ? 'Account aur session ka data load nahi ho paya.' : 'No active sessions in the current report.'))),
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
          !sec?.events?.length ? h('p', { class: 'admin-empty' }, state.failures.security ? 'Security events abhi nahi mil rahe.' : 'No recent security events.') : null)),
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
    ];
    const results = await Promise.allSettled(calls.map(([, call]) => call()));
    state.failures = {};
    results.forEach((result, i) => {
      const key = calls[i][0];
      if (result.status === 'fulfilled') state[key] = result.value;
      else { state.failures[key] = result.reason?.message || 'Unavailable'; state[key] = null; }
    });
    if (root.isConnected) {
      renderDashboard();
      const updated = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const errors = Object.keys(state.failures);
      status.replaceChildren(h('i', { class: `admin-live-dot ${errors.length ? 'warn' : ''}` }), h('span', {}, `${errors.length ? `Kuch data abhi nahi mil raha · ` : 'Live data connected · '}Updated ${updated} · refreshes every 15 seconds`));
      if (showToast && errors.length) toast(`Dashboard ka kuch data load nahi ho paya: ${errors.join(', ')}`);
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
    } catch { requestNotice.hidden = false; requestNotice.textContent = 'Tester requests abhi nahi mil rahin · Dobara try karein'; }
    finally { requestBusy = false; }
  }
  renderDashboard();
  refresh();
  refreshRequests();
  const requestTimer = window.setInterval(() => { if (!root.isConnected) { clearInterval(requestTimer); return; } refreshRequests(); }, 3000);
  root.dispose = () => { clearInterval(timer); clearInterval(requestTimer); };
  const timer = window.setInterval(() => { if (!root.isConnected) { clearInterval(timer); return; } refresh(); }, 15000);
  return root;
}
