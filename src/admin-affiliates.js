import { friendlyError } from '../shared/hinglish-errors.js';
import { h, logo } from './dom.js';
import { apiCall } from './session.js';

const options = ['new', 'contacted', 'approved', 'declined'];
const inr = paise => `₹${(Number(paise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const WITHDRAWAL_STATUS = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };
/** where the partner asked to be paid, in full (admins need it to send the money) */
const payoutLine = payout => payout?.method === 'upi' ? `UPI: ${payout.upiId}` : payout?.method === 'bank' ? `Bank: ${payout.accountName} · A/C ${payout.accountNumber} · IFSC ${payout.ifsc}` : '—';
export async function affiliatesView({ user, back, toast }) {
  const root = h('div', { class: 'sh admin-affiliates' }), list = h('div', { class: 'affiliate-admin-list' }), count = h('span', { class: 'affiliate-admin-count' }), withdrawPanel = h('section', { class: 'affiliate-withdraw-admin', hidden: true }), rate = h('input', { type: 'number', min: '1', max: '50', step: '0.5', class: 'affiliate-rate-input', 'aria-label': 'Commission percentage' }), rateMessage = h('span', { class: 'affiliate-rate-message', role: 'status' });
  const overall = h('section', { class: 'ap-grid3 ap-overall' });
  const saveRate = h('button', { class: 'btn pri', onclick: saveCommissionRate }, 'Save rate');
  const settings = h('section', { class: 'affiliate-rate-card' }, h('div', {}, h('h2', {}, 'Commission rate'), h('p', {}, 'Applied to future captured Coin purchases. Existing commission records keep their original rate.')), h('div', { class: 'affiliate-rate-controls' }, rate, h('span', {}, '%'), saveRate), rateMessage);
  root.append(h('header', { class: 'sh-bar' }, logo(back), h('span', { class: 'sh-crumb' }, 'Admin · Affiliates'), h('span', { class: 'sp' }), h('button', { class: 'btn', onclick: back }, 'Back to Admin')),
    h('main', { class: 'affiliate-admin-main' }, h('div', { class: 'affiliate-admin-heading' }, h('div', {}, h('span', { class: 'projects-eyebrow' }, 'PARTNERSHIPS'), h('h1', {}, 'Affiliate Partners'), h('p', {}, 'Review applications, referrals, commissions and payout status.')), count), overall, settings, withdrawPanel, list));
  async function loadSettings() {
    try { const result = await apiCall('/api/affiliates', { action: 'adminSettings' }, user.uid); rate.value = String(result.commissionPercent); }
    catch (e) { rateMessage.textContent = `Could not load the rate: ${friendlyError(e)}`; }
  }
  async function saveCommissionRate() {
    const value = Number(rate.value); if (!Number.isFinite(value) || value < 1 || value > 50) { rateMessage.textContent = 'Enter a rate from 1% to 50%.'; return; }
    saveRate.disabled = true;
    try { await apiCall('/api/affiliates', { action: 'adminSettings', save: true, commissionPercent: value }, user.uid); rateMessage.textContent = `Commission rate set to ${value}% for future purchases.`; }
    catch (e) { rateMessage.textContent = e.message; }
    finally { saveRate.disabled = false; }
  }
  async function markPaid(affiliateId, commissionId, input, button, state) {
    if (input.value.trim().length < 2) { toast('Please enter the bank or payout transaction reference first.'); input.focus(); return; }
    button.disabled = true;
    try { await apiCall('/api/affiliates', { action: 'adminPayout', id: affiliateId, commissionId, status: 'paid', payoutReference: input.value.trim() }, user.uid); toast('Payout recorded.'); await load(); }
    catch (e) { toast(`Could not update the payout: ${friendlyError(e)}`); button.disabled = false; }
  }
  async function decide(row, request, decision, noteInput, buttons) {
    const approve = decision === 'approved';
    if (!window.confirm(approve ? `Approve ${inr(request.amountPaise)} for ${row.name}?\n\nThis amount is deducted from their commission balance. Please make sure you have paid it to:\n${payoutLine(request.payout)}` : `Reject the ${inr(request.amountPaise)} withdrawal request from ${row.name}? The amount goes back to their available balance.`)) return;
    buttons.forEach(button => { button.disabled = true; });
    try {
      await apiCall('/api/affiliates', { action: 'adminWithdrawal', id: row.id, withdrawalId: request.id, decision, ...(approve ? { payoutReference: noteInput.value.trim() } : { note: noteInput.value.trim() }) }, user.uid);
      toast(approve ? 'Withdrawal approved. The partner\'s balance has been updated.' : 'Withdrawal rejected. The amount is available to the partner again.');
      await load();
    } catch (e) { toast(`Could not update the withdrawal: ${friendlyError(e)}`); buttons.forEach(button => { button.disabled = false; }); }
  }
  function renderWithdrawals(rows) {
    const pending = rows.flatMap(row => (row.withdrawals || []).filter(w => w.status === 'pending').map(request => ({ row, request }))).sort((a, b) => a.request.requestedAt - b.request.requestedAt);
    withdrawPanel.hidden = !pending.length;
    if (!pending.length) { withdrawPanel.replaceChildren(); return; }
    withdrawPanel.replaceChildren(h('div', { class: 'affiliate-withdraw-admin-head' }, h('h2', {}, 'Withdrawal requests'), h('span', { class: 'affiliate-admin-count' }, `${pending.length} pending`)),
      ...pending.map(({ row, request }) => {
        const note = h('input', { class: 'affiliate-payout-reference', placeholder: 'Payment reference / reason (optional)', 'aria-label': `Reference or reason for ${row.name}` });
        const approve = h('button', { class: 'btn sm pri', type: 'button', onclick: () => decide(row, request, 'approved', note, [approve, reject]) }, 'Approve');
        const reject = h('button', { class: 'btn sm', type: 'button', onclick: () => decide(row, request, 'rejected', note, [approve, reject]) }, 'Reject');
        const wallet = row.wallet || {};
        return h('article', { class: 'affiliate-withdraw-request' },
          h('div', { class: 'affiliate-withdraw-request-main' }, h('div', {}, h('b', {}, `${row.name} · ${inr(request.amountPaise)}`), h('small', {}, `${row.email} · requested ${new Date(request.requestedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`), h('small', {}, `Pay to → ${payoutLine(request.payout)}`)),
            h('small', { class: 'affiliate-withdraw-request-balance' }, `Earned ${inr(wallet.earnedPaise)} · Paid ${inr(wallet.paidPaise)} · After approval: ${inr((wallet.pendingPaise || 0) - request.amountPaise)} left`)),
          h('div', { class: 'affiliate-payout-controls' }, note, approve, reject));
      }));
  }
  async function load() {
    list.replaceChildren(h('div', { class: 'affiliate-admin-empty' }, 'Loading requests…'));
    try {
      const result = await apiCall('/api/affiliates', { action: 'adminList' }, user.uid), rows = result.affiliates || [];
      count.textContent = `${rows.length} request${rows.length === 1 ? '' : 's'}`;
      const sum = (key) => rows.reduce((n, r) => n + Number(r.stats?.[key] || 0), 0), rupees = (p) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      overall.replaceChildren(
        h('article', { class: 'ap-stat good' }, h('small', {}, 'Pending for payout (all partners)'), h('b', {}, rupees(sum('pendingPaise')))),
        h('article', { class: 'ap-stat' }, h('small', {}, 'Total paid out'), h('b', {}, rupees(sum('paidPaise')))),
        h('article', { class: 'ap-stat' }, h('small', {}, 'Approved partners'), h('b', {}, String(rows.filter((r) => r.status === 'approved').length))));
      renderWithdrawals(rows);
      list.replaceChildren(...rows.map(row => {
        const status = h('select', { class: 'affiliate-status', 'aria-label': `Status for ${row.name}` }, ...options.map(x => h('option', { value: x, selected: x === row.status }, x[0].toUpperCase() + x.slice(1))));
        status.addEventListener('change', async () => {
          status.disabled = true;
          try { const result = await apiCall('/api/affiliates', { action: 'adminStatus', id: row.id, status: status.value }, user.uid); row.status = status.value; row.referralCode = result.referralCode || row.referralCode; await load(); }
          catch (e) { status.value = row.status; toast(`Could not update the status: ${friendlyError(e)}`); }
          finally { status.disabled = false; }
        });
        const commissionRows = (row.commissions || []).map(c => {
          const state = h('span', { class: `affiliate-payout-state ${c.payoutStatus === 'paid' ? 'paid' : 'pending'}` }, c.payoutStatus === 'paid' ? 'Paid' : 'Pending');
          const controls = c.payoutStatus === 'paid' ? h('small', {}, `Ref: ${c.payoutReference || '—'}`) : (() => { const input = h('input', { class: 'affiliate-payout-reference', placeholder: 'Payout reference', 'aria-label': `Payout reference for ${c.orderId}` }), button = h('button', { class: 'btn sm', onclick: () => markPaid(row.id, c.id, input, button, state) }, 'Mark paid'); return h('div', { class: 'affiliate-payout-controls' }, input, button); })();
          return h('div', { class: 'affiliate-admin-commission' }, h('div', {}, h('b', {}, c.planName || 'Coins purchase'), h('small', {}, `${new Date(c.createdAt).toLocaleDateString()} · Purchase ₹${(Number(c.amountPaise || 0) / 100).toFixed(2)} · ${c.commissionPercent}%`)), h('div', {}, h('b', {}, `₹${(Number(c.commissionPaise || 0) / 100).toFixed(2)}`), state, controls));
        });
        const stats = row.stats || { clicks: 0, referrals: 0, conversions: 0, commissionPaise: 0, pendingPaise: 0, paidPaise: 0 };
        return h('article', { class: 'affiliate-admin-card' },
          h('div', { class: 'affiliate-admin-card-top' }, h('div', {}, h('h2', {}, row.name), h('p', {}, `${row.company} · ${row.platform}`)), status),
          h('div', { class: 'affiliate-admin-contact' }, h('a', { href: `mailto:${row.email}` }, row.email), h('a', { href: `tel:${row.phone.replace(/[^+\d]/g, '')}` }, row.phone)),
          h('div', { class: 'affiliate-admin-meta' }, row.audience ? h('span', {}, `Audience: ${row.audience}`) : null, row.profile ? h('a', { href: row.profile, target: '_blank', rel: 'noopener noreferrer' }, 'Open profile ↗') : null, h('time', {}, new Date(row.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }))),
          row.message ? h('p', { class: 'affiliate-admin-message' }, row.message) : h('p', { class: 'affiliate-admin-message muted' }, 'No additional message.'),
          row.status === 'approved' ? h('p', { class: 'affiliate-admin-code' }, `Referral code: ${row.referralCode || 'Generating…'} · ${stats.clicks} clicks · ${stats.referrals} signups · ${stats.conversions} purchases`) : null,
          h('div', { class: 'affiliate-admin-totals' }, h('span', {}, `Earned ₹${(stats.commissionPaise / 100).toFixed(2)}`), h('span', {}, `Pending ₹${(stats.pendingPaise / 100).toFixed(2)}`), h('span', {}, `Paid ₹${(stats.paidPaise / 100).toFixed(2)}`), h('span', {}, `Available ${inr(row.wallet?.availablePaise)}`)),
          (row.withdrawals || []).length ? h('div', { class: 'affiliate-admin-commissions' }, h('h3', {}, 'Withdrawals'), ...row.withdrawals.map(w => h('div', { class: 'affiliate-admin-commission' }, h('div', {}, h('b', {}, inr(w.amountPaise)), h('small', {}, `${new Date(w.requestedAt).toLocaleDateString()} · ${payoutLine(w.payout)}${w.status === 'approved' && w.payoutReference ? ` · Ref: ${w.payoutReference}` : ''}${w.status === 'rejected' && w.reason ? ` · Reason: ${w.reason}` : ''}`)), h('div', {}, h('span', { class: `affiliate-payout-state ${w.status === 'approved' ? 'paid' : w.status === 'rejected' ? 'rejected' : 'pending'}` }, WITHDRAWAL_STATUS[w.status] || w.status))))) : null,
          commissionRows.length ? h('div', { class: 'affiliate-admin-commissions' }, h('h3', {}, 'Conversions & payouts'), ...commissionRows) : null);
      }));
      if (!rows.length) list.append(h('div', { class: 'affiliate-admin-empty' }, h('span', {}, '✦'), h('h2', {}, 'No requests yet'), h('p', {}, 'New submissions will appear here.')));
    } catch (e) { list.replaceChildren(h('div', { class: 'affiliate-admin-empty error' }, `Could not load affiliate requests: ${friendlyError(e)}`)); }
  }
  await Promise.all([loadSettings(), load()]);
  return root;
}
