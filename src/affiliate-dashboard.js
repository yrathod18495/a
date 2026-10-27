import { friendlyError } from '../shared/hinglish-errors.js';
import { h, logo } from './dom.js';
import { apiCall } from './session.js';

const money = value => `₹${(Number(value || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = value => value ? new Date(value).toLocaleDateString([], { dateStyle: 'medium' }) : '—';

export async function affiliateDashboardView({ user, home, apply }) {
  const root = h('div', { class: 'sh affiliate-dashboard' }), content = h('main', { class: 'affiliate-dash-main' }, h('p', { class: 'sub' }, 'Loading your partner report…'));
  root.append(h('header', { class: 'sh-bar' }, logo(home), h('span', { class: 'sh-crumb' }, 'Affiliate Dashboard'), h('span', { class: 'sp' }), h('button', { class: 'btn', onclick: home }, 'Home')), content);
  try {
    const report = await apiCall('/api/affiliates', { action: 'dashboard' }, user.uid), link = `${location.origin}/?ref=${encodeURIComponent(report.partner.referralCode)}`;
    const linkInput = h('input', { class: 'affiliate-referral-link', value: link, readonly: true, 'aria-label': 'Your referral link' }), copyMessage = h('span', { class: 'affiliate-copy-status', role: 'status' });
    const commissionRows = report.commissions.length ? report.commissions.map(row => h('div', { class: 'affiliate-commission-row' },
      h('div', {}, h('b', {}, row.planName || 'Gold Coins purchase'), h('small', {}, `${date(row.createdAt)} · ${money(row.amountPaise)} purchase · ${Number(row.commissionPercent || 0)}% rate`)),
      h('div', { class: 'affiliate-commission-value' }, h('b', {}, money(row.commissionPaise)), h('span', { class: `affiliate-payout-state ${row.payoutStatus === 'paid' ? 'paid' : 'pending'}` }, row.payoutStatus === 'paid' ? `Paid${row.paidAt ? ` · ${date(row.paidAt)}` : ''}` : 'Pending payout')))) : [h('div', { class: 'affiliate-dash-empty' }, 'Confirmed purchases through your link will appear here.')];
    content.replaceChildren(
      h('section', { class: 'affiliate-dash-hero' }, h('span', { class: 'projects-eyebrow' }, 'PARTNER PERFORMANCE'), h('h1', {}, `Welcome, ${report.partner.name}`), h('p', {}, 'Share your link to bring new creators to 12toons. Reports update after a referred account completes a Gold Coins purchase.')),
      h('section', { class: 'affiliate-link-card' }, h('div', {}, h('h2', {}, 'Your referral link'), h('p', {}, `Referral code: ${report.partner.referralCode}`)), h('div', { class: 'affiliate-link-row' }, linkInput, h('button', { class: 'btn pri', onclick: async () => { try { await navigator.clipboard.writeText(link); copyMessage.textContent = 'Link copied'; } catch { linkInput.select(); document.execCommand('copy'); copyMessage.textContent = 'Link copied'; } } }, 'Copy link')), copyMessage),
      h('section', { class: 'affiliate-kpis' },
        kpi('Link clicks', report.clicks, 'Unique visitors per day'), kpi('Referred signups', report.referrals, 'New accounts attributed'), kpi('Confirmed purchases', report.conversions, 'Captured Gold Coin purchases'), kpi('Commission earned', money(report.commissionPaise), `${money(report.pendingPaise)} pending · ${money(report.paidPaise)} paid`)),
      h('section', { class: 'affiliate-commission-card' }, h('div', { class: 'affiliate-commission-heading' }, h('div', {}, h('h2', {}, 'Commission report'), h('p', {}, 'Commissions are recorded after Razorpay confirms a referred purchase. Payouts are handled manually by the program administrator.'))), h('div', { class: 'affiliate-commission-list' }, ...commissionRows))
    );
  } catch (e) {
    content.replaceChildren(h('section', { class: 'affiliate-dash-unavailable' }, h('span', { class: 'projects-eyebrow' }, 'AFFILIATE PROGRAM'), h('h1', {}, 'The partner dashboard could not be opened'), h('p', {}, friendlyError(e, 'The affiliate application for this Google account has not been approved yet.')), h('button', { class: 'btn pri', onclick: apply }, 'Apply to become a partner')));
  }
  return root;
}

function kpi(label, value, note) { return h('article', { class: 'affiliate-kpi' }, h('span', {}, label), h('b', {}, String(value)), h('small', {}, note)); }
