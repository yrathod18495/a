import { friendlyError } from '../shared/hinglish-errors.js';
import { h, logo } from './dom.js';
import { apiCall } from './session.js';

const money = (paise) => `₹${Math.round(Number(paise || 0) / 100).toLocaleString('en-IN')}`;
const when = (ms) => ms ? new Date(ms).toLocaleString() : '—';
const statusName = (s) => ({ created: 'Awaiting payment', authorized: 'Authorized', captured: 'Paid', failed: 'Failed', cancelled: 'Cancelled', pending: 'Pending' }[s] || s || 'Unknown');

export async function view({ user, home, back, toast }) {
  const rows = h('div', { class: 'payments-table-wrap' }, h('p', { class: 'hint' }, 'Loading payment report…'));
  const summary = h('div', { class: 'payments-summary' });
  let payments = [], cursor = null, loading = false;
  const root = h('div', { class: 'sh admin-payments' },
    h('header', { class: 'sh-bar' }, logo(home), h('span', { class: 'sh-crumb' }, 'Admin · Payments'), h('span', { class: 'sp' }), h('button', { class: 'btn', onclick: back }, '← Admin panel'), h('button', { class: 'btn', onclick: home }, '⌂ Home')),
    h('main', { class: 'payments-main' }, h('div', { class: 'payments-title' }, h('div', {}, h('h1', {}, 'Gold Coin payments'), h('p', { class: 'sub' }, 'Latest payment attempts and confirmed Gold Coin purchases.')), h('button', { class: 'btn', onclick: () => load() }, '↻ Refresh')), summary, rows));
  async function load(append = false) {
    if (loading) return;
    loading = true;
    if (!append) { payments = []; cursor = null; rows.replaceChildren(h('p', { class: 'hint' }, 'Loading payment report…')); }
    try {
      const result = await apiCall('/api/payments', { action: 'adminList', cursor: append ? cursor : null }, user.uid);
      payments = [...payments, ...(result.payments || [])]; cursor = result.nextCursor || null;
      const captured = payments.filter((p) => p.status === 'captured');
      summary.replaceChildren(
        h('article', { class: 'payments-stat' }, h('small', {}, `Captured payments (loaded ${payments.length})`), h('b', {}, String(captured.length))),
        h('article', { class: 'payments-stat' }, h('small', {}, `Captured revenue (loaded ${payments.length})`), h('b', {}, money(captured.reduce((sum, p) => sum + Number(p.amountPaise || 0), 0)))),
        h('article', { class: 'payments-stat' }, h('small', {}, 'Gold Coins delivered'), h('b', {}, captured.reduce((sum, p) => sum + Number(p.credits || 0), 0).toLocaleString('en-IN'))));
      if (!payments.length) { rows.replaceChildren(h('p', { class: 'hint' }, 'No payment attempts have been recorded yet.')); return; }
      const table = h('table', { class: 'payments-table' },
        h('thead', {}, h('tr', {}, ...['Customer', 'Plan', 'Amount', 'Gold Coins', 'Status', 'Created', 'Payment ID'].map((title) => h('th', {}, title)))),
        h('tbody', {}, ...payments.map((p) => h('tr', {},
          h('td', {}, h('b', {}, p.name || p.email || p.uid), h('small', {}, p.email || p.uid)),
          h('td', {}, p.planName || p.planId || '—'), h('td', {}, money(p.amountPaise)), h('td', {}, Number(p.credits || 0).toLocaleString('en-IN')),
          h('td', {}, h('span', { class: `credit-status ${p.status}` }, statusName(p.status))), h('td', {}, when(p.createdAt)), h('td', {}, p.paymentId || '—')))));
      rows.replaceChildren(table, h('p', { class: 'hint' }, `Showing ${payments.length} payment records.`), cursor ? h('button', { class: 'btn', onclick: () => load(true) }, 'Load more payments') : null);
    } catch (e) { rows.replaceChildren(h('p', { class: 'credit-message error' }, friendlyError(e))); toast?.(`Could not load payments: ${friendlyError(e)}`); }
    finally { loading = false; }
  }
  await load();
  return root;
}
