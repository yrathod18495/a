import { friendlyError } from '../shared/hinglish-errors.js';
import { h, logo } from './dom.js';
import { apiCall } from './session.js';

// Admin · Payments: revenue pulse + settlement date, the transaction log (approve / purge) and a live Razorpay check.
const inr = (paise) => `₹${(Number(paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const rupeesShort = (paise) => `₹${Math.round(Number(paise || 0) / 100).toLocaleString('en-IN')}`;
const when = (ms) => ms ? new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const dayLabel = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dayLong = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const shiftDay = (day, days) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
/** the same rule the server uses: only a captured payment has been credited */
const stateOf = (p) => p.status === 'captured' ? 'approved' : ['failed', 'cancelled'].includes(p.status) ? p.status : 'pending';
const STATE_TEXT = { approved: 'Approved', pending: 'Pending', failed: 'Failed', cancelled: 'Cancelled' };
const GT_TEXT = { synced: 'Synced', missing: 'Not credited', not_paid: 'Not paid', unrelated: 'Not linked' };
/** a round axis maximum in rupees (1, 2, 4, 8 or 10 times a power of ten), so the four steps of the axis are round numbers too */
const niceMax = (rupees) => { if (rupees <= 0) return 1000; const power = 10 ** Math.floor(Math.log10(rupees)); return [1, 2, 4, 8, 10].map((m) => m * power).find((v) => v >= rupees); };

export async function view({ user, home, back, toast }) {
  const call = (body) => apiCall('/api/payments', body, user.uid);
  let report = null, payments = [], cursor = null, loadingList = false, tab = 'normal', gt = { items: [], skip: 0, next: null, loaded: false, loading: false };
  const selected = new Set();
  const pulse = h('section', { class: 'pay-card pay-pulse' }), tabs = h('div', { class: 'pay-tabs', role: 'tablist' }), panel = h('div', { class: 'pay-panel' });
  const root = h('div', { class: 'sh admin-payments' },
    h('header', { class: 'sh-bar' }, logo(home), h('span', { class: 'sh-crumb' }, 'Admin · Payments'), h('span', { class: 'sp' }), h('button', { class: 'btn', onclick: back }, '← Admin panel'), h('button', { class: 'btn', onclick: home }, '⌂ Home')),
    h('main', { class: 'payments-main pay-main' }, h('div', { class: 'pay-title' }, h('h1', {}, 'System revenue'), h('p', {}, 'Consolidated financial records.')), pulse, tabs, panel));
  const fail = (what, e) => toast?.(`${what}: ${friendlyError(e)}`);

  /* ---------- revenue pulse ---------- */
  async function loadRevenue() {
    try { report = await call({ action: 'adminRevenue' }); renderPulse(); }
    catch (e) { pulse.replaceChildren(h('p', { class: 'credit-message error' }, `Could not load the revenue: ${friendlyError(e)}`)); }
  }
  async function setPaidUntil(date, controls) {
    controls.forEach((c) => { c.disabled = true; });
    try { report = await call({ action: 'adminSetPaidUntil', date }); toast?.(date ? `Revenue is marked as paid until ${dayLong(date)}.` : 'The paid-until date was cleared.'); renderPulse(); }
    catch (e) { fail('Could not save the date', e); controls.forEach((c) => { c.disabled = false; }); }
  }
  function renderPulse() {
    const days = report.days, max = niceMax(Math.max(...days.map((d) => d.paise)) / 100), ticks = [4, 3, 2, 1, 0].map((i) => max * i / 4);
    const message = h('p', { class: 'pay-form-message', role: 'status', 'aria-live': 'polite' });
    const date = h('input', { type: 'date', class: 'pay-date', value: report.paidUntil, max: report.today, 'aria-label': 'Paid until date' });
    const sync = h('button', { class: 'btn pri pay-sync', type: 'button' }, 'Sync date');
    const quick = [['Yesterday', 1], ['2 days ago', 2], ['3 days ago', 3]].map(([label, back]) => h('button', { class: 'pay-chip', type: 'button', onclick: () => { date.value = shiftDay(report.today, -back); message.textContent = ''; } }, label));
    const clear = h('button', { class: 'pay-chip danger', type: 'button', onclick: () => { if (!report.paidUntil) { date.value = ''; return; } if (window.confirm('Clear the paid-until date? All revenue will count as unpaid again.')) setPaidUntil('', [sync, clear]); } }, 'Clear');
    sync.addEventListener('click', () => {
      message.className = 'pay-form-message error';
      if (!date.value) { message.textContent = 'Please choose a date, or use Clear to remove it.'; return; }
      if (date.value > report.today) { message.textContent = 'You cannot mark revenue as paid for a date that has not happened yet.'; return; }
      if (date.value === report.paidUntil) { message.className = 'pay-form-message'; message.textContent = 'This date is already saved.'; return; }
      if (window.confirm(`Mark all revenue up to and including ${dayLong(date.value)} as paid? Only revenue after that date will count as unpaid.`)) setPaidUntil(date.value, [sync, clear]);
    });
    pulse.replaceChildren(
      h('div', { class: 'pay-pulse-head' }, h('div', {}, h('b', { class: 'pay-kicker' }, '〰 Live revenue pulse'), h('small', {}, 'Consolidated financial modes (last 10 days)')),
        h('span', { class: `pay-badge ${report.paidUntil ? 'good' : ''}` }, report.paidUntil ? `Last paid until: ${dayLong(report.paidUntil)}` : 'No paid date set')),
      h('div', { class: 'pay-legend' }, h('span', {}, h('i', { class: 'settled' }), 'Paid cycle (settled)'), h('span', {}, h('i', { class: 'unpaid' }), 'Unpaid balance'), h('span', {}, h('i', { class: 'today' }), 'Today')),
      h('div', { class: 'pay-chart', role: 'img', 'aria-label': `Revenue for the last ${days.length} days` },
        h('div', { class: 'pay-axis' }, ...ticks.map((t) => h('span', {}, rupeesShort(t * 100)))),
        h('div', { class: 'pay-bars' }, ...days.map((d) => h('div', { class: 'pay-bar-col', title: `${dayLong(d.day)} · ${inr(d.paise)}` },
          h('div', { class: 'pay-bar-track' }, h('div', { class: `pay-bar ${d.state}`, style: `height:${d.paise ? Math.max(2, Math.round(d.paise / (max * 100) * 100)) : 0}%` })), h('span', {}, dayLabel(d.day)))))),
      h('div', { class: 'pay-lifetime' }, h('span', {}, '↗ Lifetime system revenue (INR)'), h('b', {}, inr(report.lifetimePaise))),
      h('div', { class: 'pay-settle' },
        h('div', { class: 'pay-settle-form' }, h('div', { class: 'pay-settle-top' }, h('span', { class: 'pay-kicker small' }, 'Mark revenue as paid until date'), h('small', {}, `Currently: ${report.paidUntil || 'not set'}`)),
          h('div', { class: 'pay-settle-row' }, date, sync), h('div', { class: 'pay-quick' }, h('small', {}, 'Quick set:'), ...quick, clear), message),
        h('div', { class: 'pay-unpaid' }, h('small', {}, 'Unpaid cycle balance'), h('b', {}, inr(report.unpaidPaise)), h('small', {}, report.paidUntil ? `Revenue after ${report.paidUntil}` : 'All revenue so far'))));
  }

  /* ---------- tabs ---------- */
  function renderTabs() {
    const tabButton = (key, title, note) => h('button', { class: `pay-tab ${tab === key ? 'on' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(tab === key), onclick: () => { tab = key; renderTabs(); renderPanel(); if (key === 'truth' && !gt.loaded) loadTruth(true); } }, h('b', {}, title), h('small', {}, note));
    tabs.replaceChildren(tabButton('normal', 'Normal payments', 'Transaction log — coin purchases'), tabButton('truth', 'Razorpay ground truth', 'Live from Razorpay — recovers a missed payment'));
  }
  const renderPanel = () => (tab === 'normal' ? renderLog() : renderTruth());

  /* ---------- transaction log ---------- */
  async function loadLog(append = false) {
    if (loadingList) return;
    loadingList = true;
    if (!append) { payments = []; cursor = null; selected.clear(); panel.replaceChildren(h('p', { class: 'hint' }, 'Loading payment report…')); }
    try { const result = await call({ action: 'adminList', cursor: append ? cursor : null }); payments = [...payments, ...(result.payments || [])]; cursor = result.nextCursor || null; if (tab === 'normal') renderLog(); }
    catch (e) { if (tab === 'normal') panel.replaceChildren(h('p', { class: 'credit-message error' }, friendlyError(e))); fail('Could not load payments', e); }
    finally { loadingList = false; }
  }
  const purgeable = () => payments.filter((p) => stateOf(p) !== 'approved');
  async function approve(p) {
    if (!window.confirm(`Approve ${inr(p.amountPaise)} from ${p.name || p.email || 'this customer'}?\n\nThe payment is checked with Razorpay first. If it was really paid, ${Number(p.credits || 0).toLocaleString('en-IN')} Coins are added to the account.`)) return;
    try { const r = await call({ action: 'adminApprove', orderId: p.orderId || p.id }); toast?.(r.credited ? `Approved. ${Number(r.credits || 0).toLocaleString('en-IN')} Coins were added.` : 'This payment was already approved.'); await Promise.all([loadLog(), loadRevenue()]); }
    catch (e) { fail('Could not approve this payment', e); }
  }
  async function purge(ids) {
    if (!ids.length) return;
    if (!window.confirm(`Permanently delete ${ids.length} unpaid payment record${ids.length === 1 ? '' : 's'}?\n\nPaid purchases are never deleted.`)) return;
    try {
      const r = await call({ action: 'adminPurge', orderIds: ids });
      toast?.(`${r.purged.length} record${r.purged.length === 1 ? '' : 's'} deleted${r.skipped.length ? `, ${r.skipped.length} skipped (paid or already gone)` : ''}.`);
      await loadLog();
    } catch (e) { fail('Could not delete the records', e); }
  }
  function renderLog() {
    const canSelect = purgeable(), allOn = canSelect.length > 0 && canSelect.every((p) => selected.has(p.id));
    const toolbar = h('div', { class: 'pay-log-tools' },
      h('button', { class: 'btn sm', type: 'button', disabled: !canSelect.length, onclick: () => { if (allOn) selected.clear(); else canSelect.forEach((p) => selected.add(p.id)); renderLog(); } }, allOn ? '☐ Deselect' : '☑ Select all'),
      selected.size ? h('button', { class: 'btn sm pay-purge-all', type: 'button', onclick: () => purge([...selected]) }, `🗑 Purge (${selected.size})`) : null);
    const cards = payments.map((p) => {
      const state = stateOf(p), id = p.orderId || p.id, pick = state !== 'approved' ? h('input', { type: 'checkbox', class: 'pay-pick', checked: selected.has(p.id), 'aria-label': `Select the payment from ${p.email || p.uid}`, onchange: (e) => { if (e.target.checked) selected.add(p.id); else selected.delete(p.id); renderLog(); } }) : null;
      return h('article', { class: `pay-item ${state} ${selected.has(p.id) ? 'picked' : ''}` },
        h('div', { class: 'pay-item-top' }, pick, h('div', { class: 'pay-who' }, h('b', {}, p.name || p.email || p.uid), h('small', {}, p.email || p.uid)), h('span', { class: `pay-state ${state}` }, STATE_TEXT[state])),
        h('div', { class: 'pay-item-mid' }, h('div', {}, h('small', {}, 'Received'), h('b', {}, inr(p.amountPaise))), h('div', { class: 'pay-entity' }, h('small', {}, 'Entity'), h('span', {}, `◎ ${Number(p.credits || 0).toLocaleString('en-IN')}`))),
        h('div', { class: 'pay-item-meta' }, h('span', { class: 'pay-plan' }, p.planName || p.planId || '—'), h('small', {}, when(p.capturedAt || p.createdAt))),
        state === 'pending' ? h('div', { class: 'pay-item-actions' }, h('button', { class: 'btn sm', type: 'button', onclick: () => purge([p.id]) }, '🗑 Purge'), h('button', { class: 'btn sm pay-approve', type: 'button', onclick: () => approve({ ...p, orderId: id }) }, '✓ Approve'))
          : state === 'approved' ? h('div', { class: 'pay-item-id' }, h('small', {}, p.paymentId || id))
          : h('div', { class: 'pay-item-actions' }, h('button', { class: 'btn sm', type: 'button', onclick: () => purge([p.id]) }, '🗑 Purge')));
    });
    panel.replaceChildren(h('section', { class: 'pay-card' },
      h('div', { class: 'pay-log-head' }, h('div', {}, h('h2', {}, '⟳ Transaction log'), h('p', {}, 'Unified view of coin purchases.')), toolbar),
      payments.length ? h('div', { class: 'pay-grid' }, ...cards) : h('p', { class: 'hint' }, 'No payment attempts have been recorded yet.'),
      h('p', { class: 'hint pay-count' }, `Showing ${payments.length} payment record${payments.length === 1 ? '' : 's'}.`),
      cursor ? h('button', { class: 'btn', type: 'button', onclick: () => loadLog(true) }, 'Load more payments') : null));
  }

  /* ---------- Razorpay ground truth ---------- */
  async function loadTruth(fresh = false) {
    if (gt.loading) return;
    gt.loading = true;
    if (fresh) { gt = { items: [], skip: 0, next: null, loaded: false, loading: true }; renderTruth(); }
    try { const r = await call({ action: 'adminGroundTruth', count: 20, skip: fresh ? 0 : gt.next }); gt.items = [...gt.items, ...r.payments]; gt.next = r.nextSkip; gt.loaded = true; }
    catch (e) { gt.error = friendlyError(e); fail('Could not load Razorpay payments', e); }
    finally { gt.loading = false; if (tab === 'truth') renderTruth(); }
  }
  async function recover(p) {
    if (!window.confirm(`Recover ${inr(p.amountPaise)} (${p.id})?\n\nRazorpay captured this payment, but the Coins were never added. They will be added to the account that placed the order.`)) return;
    try { const r = await call({ action: 'adminRecover', paymentId: p.id }); toast?.(r.recovered ? `Recovered. ${Number(r.credits || 0).toLocaleString('en-IN')} Coins were added.` : 'This payment was already credited.'); await Promise.all([loadTruth(true), loadLog(), loadRevenue()]); }
    catch (e) { fail('Could not recover this payment', e); }
  }
  function renderTruth() {
    const missing = gt.items.filter((p) => p.state === 'missing').length;
    panel.replaceChildren(h('section', { class: 'pay-card' },
      h('div', { class: 'pay-log-head' }, h('div', {}, h('h2', {}, 'Razorpay ground truth'), h('p', {}, 'The latest payments straight from Razorpay, compared with what 12toons recorded.')), h('div', { class: 'pay-log-tools' }, h('button', { class: 'btn sm', type: 'button', disabled: gt.loading, onclick: () => loadTruth(true) }, '↻ Refresh'))),
      gt.error && !gt.items.length ? h('p', { class: 'credit-message error' }, gt.error) : null,
      gt.loading && !gt.items.length ? h('p', { class: 'hint' }, 'Loading payments from Razorpay…') : null,
      gt.loaded && missing ? h('p', { class: 'pay-warning' }, `${missing} captured payment${missing === 1 ? ' is' : 's are'} not credited in 12toons. Use Recover to add the Coins.`) : null,
      gt.items.length ? h('div', { class: 'pay-gt-list' }, ...gt.items.map((p) => h('div', { class: `pay-gt-row ${p.state}` },
        h('div', { class: 'pay-gt-main' }, h('b', {}, inr(p.amountPaise)), h('small', {}, `${p.email || 'No email'} · ${p.method || '—'} · ${when(p.createdAt)}`), h('small', { class: 'pay-gt-id' }, `${p.id}${p.orderId ? ` · ${p.orderId}` : ''}`)),
        h('span', { class: `pay-state ${p.state}` }, GT_TEXT[p.state] || p.state),
        p.state === 'missing' ? h('button', { class: 'btn sm pay-approve', type: 'button', onclick: () => recover(p) }, 'Recover') : h('span', { class: 'pay-gt-none' })))) : (gt.loaded ? h('p', { class: 'hint' }, 'Razorpay has no payments to show.') : null),
      gt.next ? h('button', { class: 'btn', type: 'button', disabled: gt.loading, onclick: () => loadTruth(false) }, 'Load more') : null));
  }

  renderTabs();
  await Promise.all([loadRevenue(), loadLog()]);
  return root;
}
