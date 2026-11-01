import { friendlyError } from '../shared/hinglish-errors.js';
import { h, logo } from './dom.js';
import { apiCall } from './session.js';

const money = value => `₹${(Number(value || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = value => value ? new Date(value).toLocaleDateString([], { dateStyle: 'medium' }) : '—';

export async function affiliateDashboardView({ user, home, apply }) {
  const root = h('div', { class: 'sh affiliate-dashboard' }), content = h('main', { class: 'affiliate-dash-main' }, h('div', { class: 'dash-skeleton', role: 'status', 'aria-label': 'Loading your partner report' }, h('i', { class: 'rf-sk dash-sk-head' }), h('i', { class: 'rf-sk dash-sk-card' }), h('i', { class: 'rf-sk dash-sk-card' }), h('i', { class: 'rf-sk dash-sk-card short' })));
  root.append(h('header', { class: 'sh-bar' }, logo(home), h('span', { class: 'sh-crumb' }, 'Affiliate Dashboard'), h('span', { class: 'sp' }), h('button', { class: 'btn', onclick: home }, 'Home')), content);
  // the page is shown at once; the report fills in when the server answers
  (async () => {
  try {
    const report = await apiCall('/api/affiliates', { action: 'dashboard' }, user.uid), link = `${location.origin}/?ref=${encodeURIComponent(report.partner.referralCode)}`;
    const linkInput = h('input', { class: 'affiliate-referral-link', value: link, readonly: true, 'aria-label': 'Your referral link' }), copyMessage = h('span', { class: 'affiliate-copy-status', role: 'status' });
    const day = (t) => new Date(t).toDateString(), now = Date.now(), today = day(now), yesterday = day(now - 864e5);
    const earnedOn = (d) => report.commissions.filter((c) => day(c.createdAt) === d).reduce((n, c) => n + Number(c.commissionPaise || 0), 0);
    const rows = report.commissions.length ? report.commissions.map((row) => h('tr', {},
      h('td', { class: 'ap-date' }, date(row.createdAt)), h('td', { class: 'ap-num' }, money(row.amountPaise)),
      h('td', { class: 'ap-num' }, h('span', { class: 'ap-earn' }, `+${money(row.commissionPaise)}`)),
      h('td', { class: 'ap-num' }, h('span', { class: `affiliate-payout-state ${row.payoutStatus === 'paid' ? 'paid' : 'pending'}` }, row.payoutStatus === 'paid' ? 'Paid' : 'Pending')))) : [];
    const card = (title, value, tone) => h('article', { class: `ap-stat ${tone || ''}` }, h('small', {}, title), h('b', {}, value));
    content.replaceChildren(
      h('section', { class: 'ap-head' }, h('span', { class: 'ap-badge', 'aria-hidden': 'true' }, '₹'), h('div', {}, h('h1', {}, 'Affiliate Payouts'), h('p', {}, `Welcome, ${report.partner.name}. Track your earnings and see your payment history.`))),
      h('section', { class: 'ap-grid3' }, card("Today's earnings", money(earnedOn(today))), card("Yesterday's earnings", money(earnedOn(yesterday))), card('Withdrawable balance', money(report.pendingPaise), 'good')),
      h('section', { class: 'ap-grid2' }, h('article', { class: 'ap-big primary' }, h('small', {}, 'Total earnings'), h('b', {}, money(report.commissionPaise))), h('article', { class: 'ap-big' }, h('small', {}, 'Total withdrawn'), h('b', {}, money(report.paidPaise)))),
      h('section', { class: 'ap-link' }, h('div', {}, h('h2', {}, 'Your referral link'), h('p', {}, `Code: ${report.partner.referralCode} · ${report.clicks} clicks · ${report.referrals} signups · ${report.conversions} purchases`)),
        h('div', { class: 'affiliate-link-row' }, linkInput, h('button', { class: 'btn pri', onclick: async () => { try { await navigator.clipboard.writeText(link); copyMessage.textContent = 'Link copied.'; } catch { linkInput.select(); copyMessage.textContent = 'Press Ctrl+C to copy the link.'; } } }, 'Copy link')), copyMessage),
      h('section', { class: 'ap-table-card' }, h('h2', {}, 'Commission history'), h('p', {}, 'Every commission from a purchase made with your link. Buyers’ details are never shown.'),
        rows.length ? h('div', { class: 'ap-table-wrap' }, h('table', { class: 'ap-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', { class: 'ap-num' }, 'Purchase'), h('th', { class: 'ap-num' }, 'Your commission'), h('th', { class: 'ap-num' }, 'Status'))), h('tbody', {}, ...rows)))
          : h('div', { class: 'ap-empty' }, h('b', {}, 'No commissions yet'), h('p', {}, 'Share your link to start earning.'))),
      h('section', { class: 'ap-invite' }, h('div', {}, h('b', {}, 'Know a creator who would be a good partner?'), h('p', {}, 'Anyone can apply to become a 12toons partner — they only need to fill in the short form.')), h('a', { class: 'btn', href: '/#/affiliates', onclick: (e) => { e.preventDefault(); apply(); } }, 'Open the partner form')),
    );
  } catch (e) {
    content.replaceChildren(h('section', { class: 'affiliate-dash-unavailable' }, h('span', { class: 'projects-eyebrow' }, 'AFFILIATE PROGRAM'), h('h1', {}, 'The partner dashboard could not be opened'), h('p', {}, friendlyError(e, 'The affiliate application for this Google account has not been approved yet.')), h('button', { class: 'btn pri', onclick: apply }, 'Apply to become a partner')));
  }
  })();
  return root;
}

function kpi(label, value, note) { return h('article', { class: 'affiliate-kpi' }, h('span', {}, label), h('b', {}, String(value)), h('small', {}, note)); }
