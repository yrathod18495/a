import { friendlyError } from '../shared/hinglish-errors.js';
import { h, logo } from './dom.js';
import { apiCall } from './session.js';

const options = ['new', 'contacted', 'approved', 'declined'];
export async function affiliatesView({ user, back, toast }) {
  const root = h('div', { class: 'sh admin-affiliates' }), list = h('div', { class: 'affiliate-admin-list' }), count = h('span', { class: 'affiliate-admin-count' }), rate = h('input', { type: 'number', min: '1', max: '50', step: '0.5', class: 'affiliate-rate-input', 'aria-label': 'Commission percentage' }), rateMessage = h('span', { class: 'affiliate-rate-message', role: 'status' });
  const saveRate = h('button', { class: 'btn pri', onclick: saveCommissionRate }, 'Save rate');
  const settings = h('section', { class: 'affiliate-rate-card' }, h('div', {}, h('h2', {}, 'Commission rate'), h('p', {}, 'Applied to future captured credit purchases. Existing commission records keep their original rate.')), h('div', { class: 'affiliate-rate-controls' }, rate, h('span', {}, '%'), saveRate), rateMessage);
  root.append(h('header', { class: 'sh-bar' }, logo(back), h('span', { class: 'sh-crumb' }, 'Admin · Affiliates'), h('span', { class: 'sp' }), h('button', { class: 'btn', onclick: back }, 'Back to Admin')),
    h('main', { class: 'affiliate-admin-main' }, h('div', { class: 'affiliate-admin-heading' }, h('div', {}, h('span', { class: 'projects-eyebrow' }, 'PARTNERSHIPS'), h('h1', {}, 'Affiliate Partners'), h('p', {}, 'Review applications, referrals, commissions and payout status.')), count), settings, list));
  async function loadSettings() {
    try { const result = await apiCall('/api/affiliates', { action: 'adminSettings' }, user.uid); rate.value = String(result.commissionPercent); }
    catch (e) { rateMessage.textContent = `Rate load nahi ho paya: ${friendlyError(e)}`; }
  }
  async function saveCommissionRate() {
    const value = Number(rate.value); if (!Number.isFinite(value) || value < 1 || value > 50) { rateMessage.textContent = 'Enter a rate from 1% to 50%.'; return; }
    saveRate.disabled = true;
    try { await apiCall('/api/affiliates', { action: 'adminSettings', save: true, commissionPercent: value }, user.uid); rateMessage.textContent = `Commission rate set to ${value}% for future purchases.`; }
    catch (e) { rateMessage.textContent = e.message; }
    finally { saveRate.disabled = false; }
  }
  async function markPaid(affiliateId, commissionId, input, button, state) {
    if (input.value.trim().length < 2) { toast('Pehle bank ya payout transaction ka reference likhein.'); input.focus(); return; }
    button.disabled = true;
    try { await apiCall('/api/affiliates', { action: 'adminPayout', id: affiliateId, commissionId, status: 'paid', payoutReference: input.value.trim() }, user.uid); toast('Payout recorded.'); await load(); }
    catch (e) { toast(`Payout update nahi ho paya: ${friendlyError(e)}`); button.disabled = false; }
  }
  async function load() {
    list.replaceChildren(h('div', { class: 'affiliate-admin-empty' }, 'Loading requests…'));
    try {
      const result = await apiCall('/api/affiliates', { action: 'adminList' }, user.uid), rows = result.affiliates || [];
      count.textContent = `${rows.length} request${rows.length === 1 ? '' : 's'}`;
      list.replaceChildren(...rows.map(row => {
        const status = h('select', { class: 'affiliate-status', 'aria-label': `Status for ${row.name}` }, ...options.map(x => h('option', { value: x, selected: x === row.status }, x[0].toUpperCase() + x.slice(1))));
        status.addEventListener('change', async () => {
          status.disabled = true;
          try { const result = await apiCall('/api/affiliates', { action: 'adminStatus', id: row.id, status: status.value }, user.uid); row.status = status.value; row.referralCode = result.referralCode || row.referralCode; await load(); }
          catch (e) { status.value = row.status; toast(`Status update nahi ho paya: ${friendlyError(e)}`); }
          finally { status.disabled = false; }
        });
        const commissionRows = (row.commissions || []).map(c => {
          const state = h('span', { class: `affiliate-payout-state ${c.payoutStatus === 'paid' ? 'paid' : 'pending'}` }, c.payoutStatus === 'paid' ? 'Paid' : 'Pending');
          const controls = c.payoutStatus === 'paid' ? h('small', {}, `Ref: ${c.payoutReference || '—'}`) : (() => { const input = h('input', { class: 'affiliate-payout-reference', placeholder: 'Payout reference', 'aria-label': `Payout reference for ${c.orderId}` }), button = h('button', { class: 'btn sm', onclick: () => markPaid(row.id, c.id, input, button, state) }, 'Mark paid'); return h('div', { class: 'affiliate-payout-controls' }, input, button); })();
          return h('div', { class: 'affiliate-admin-commission' }, h('div', {}, h('b', {}, c.planName || 'Credit purchase'), h('small', {}, `${new Date(c.createdAt).toLocaleDateString()} · Purchase ₹${(Number(c.amountPaise || 0) / 100).toFixed(2)} · ${c.commissionPercent}%`)), h('div', {}, h('b', {}, `₹${(Number(c.commissionPaise || 0) / 100).toFixed(2)}`), state, controls));
        });
        const stats = row.stats || { clicks: 0, referrals: 0, conversions: 0, commissionPaise: 0, pendingPaise: 0, paidPaise: 0 };
        return h('article', { class: 'affiliate-admin-card' },
          h('div', { class: 'affiliate-admin-card-top' }, h('div', {}, h('h2', {}, row.name), h('p', {}, `${row.company} · ${row.platform}`)), status),
          h('div', { class: 'affiliate-admin-contact' }, h('a', { href: `mailto:${row.email}` }, row.email), h('a', { href: `tel:${row.phone.replace(/[^+\d]/g, '')}` }, row.phone)),
          h('div', { class: 'affiliate-admin-meta' }, row.audience ? h('span', {}, `Audience: ${row.audience}`) : null, row.profile ? h('a', { href: row.profile, target: '_blank', rel: 'noopener noreferrer' }, 'Open profile ↗') : null, h('time', {}, new Date(row.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))),
          row.message ? h('p', { class: 'affiliate-admin-message' }, row.message) : h('p', { class: 'affiliate-admin-message muted' }, 'No additional message.'),
          row.status === 'approved' ? h('p', { class: 'affiliate-admin-code' }, `Referral code: ${row.referralCode || 'Generating…'} · ${stats.clicks} clicks · ${stats.referrals} signups · ${stats.conversions} purchases`) : null,
          h('div', { class: 'affiliate-admin-totals' }, h('span', {}, `Earned ₹${(stats.commissionPaise / 100).toFixed(2)}`), h('span', {}, `Pending ₹${(stats.pendingPaise / 100).toFixed(2)}`), h('span', {}, `Paid ₹${(stats.paidPaise / 100).toFixed(2)}`)),
          commissionRows.length ? h('div', { class: 'affiliate-admin-commissions' }, h('h3', {}, 'Conversions & payouts'), ...commissionRows) : null);
      }));
      if (!rows.length) list.append(h('div', { class: 'affiliate-admin-empty' }, h('span', {}, '✦'), h('h2', {}, 'No requests yet'), h('p', {}, 'New submissions will appear here.')));
    } catch (e) { list.replaceChildren(h('div', { class: 'affiliate-admin-empty error' }, `Affiliate requests load nahi ho payin: ${friendlyError(e)}`)); }
  }
  await Promise.all([loadSettings(), load()]);
  return root;
}
