import { friendlyError } from '../shared/hinglish-errors.js';
import { h, logo } from './dom.js';
import { apiCall } from './session.js';

const money = value => `₹${(Number(value || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = value => value ? new Date(value).toLocaleDateString([], { dateStyle: 'medium' }) : '—';

export async function affiliateDashboardView({ user, home, apply }) {
  const root = h('div', { class: 'sh affiliate-dashboard' }), content = h('main', { class: 'affiliate-dash-main' }, h('div', { class: 'dash-skeleton', role: 'status', 'aria-label': 'Loading your partner report' }, h('i', { class: 'rf-sk dash-sk-head' }), h('i', { class: 'rf-sk dash-sk-card' }), h('i', { class: 'rf-sk dash-sk-card' }), h('i', { class: 'rf-sk dash-sk-card short' })));
  root.append(h('header', { class: 'sh-bar' }, logo(home), h('span', { class: 'sh-crumb' }, 'Affiliate Dashboard'), h('span', { class: 'sp' }), h('button', { class: 'btn', onclick: home }, 'Home')), content);
  // the page is shown at once; the report fills in when the server answers
  async function load() {
  try {
    const report = await apiCall('/api/affiliates', { action: 'dashboard' }, user.uid), link = `${location.origin}/?ref=${encodeURIComponent(report.partner.referralCode)}`;
    const linkInput = h('input', { class: 'affiliate-referral-link', value: link, readonly: true, 'aria-label': 'Your referral link' }), copyMessage = h('span', { class: 'affiliate-copy-status', role: 'status' });
    const codeInput = h('input', { class: 'affiliate-referral-link affiliate-referral-code', value: report.partner.referralCode, readonly: true, 'aria-label': 'Your referral code' });
    // copies the text of one field; if the browser blocks the clipboard the field is selected so the user can press Ctrl+C
    const copy = (input, text, what) => async () => { try { await navigator.clipboard.writeText(text); copyMessage.textContent = `${what} copied.`; } catch { input.select(); copyMessage.textContent = `Press Ctrl+C to copy the ${what.toLowerCase()}.`; } };
    const day = (t) => new Date(t).toDateString(), now = Date.now(), today = day(now), yesterday = day(now - 864e5);
    const earnedOn = (d) => report.commissions.filter((c) => day(c.createdAt) === d).reduce((n, c) => n + Number(c.commissionPaise || 0), 0);
    const rows = report.commissions.length ? report.commissions.map((row) => h('tr', {},
      h('td', { class: 'ap-date' }, date(row.createdAt)), h('td', { class: 'ap-num' }, money(row.amountPaise)),
      h('td', { class: 'ap-num' }, h('span', { class: 'ap-earn' }, `+${money(row.commissionPaise)}`)),
      h('td', { class: 'ap-num' }, h('span', { class: `affiliate-payout-state ${row.payoutStatus === 'paid' ? 'paid' : 'pending'}` }, row.payoutStatus === 'paid' ? 'Paid' : 'Pending')))) : [];
    const card = (title, value, tone) => h('article', { class: `ap-stat ${tone || ''}` }, h('small', {}, title), h('b', {}, value));
    content.replaceChildren(
      h('section', { class: 'ap-head' }, h('span', { class: 'ap-badge', 'aria-hidden': 'true' }, '₹'), h('div', {}, h('h1', {}, 'Affiliate Payouts'), h('p', {}, `Welcome, ${report.partner.name}. Track your earnings and see your payment history.`))),
      h('section', { class: 'ap-grid3' }, card("Today's earnings", money(earnedOn(today))), card("Yesterday's earnings", money(earnedOn(yesterday))), card('Withdrawable balance', money(report.wallet ? report.wallet.availablePaise : report.pendingPaise), 'good')),
      h('section', { class: 'ap-grid2' }, h('article', { class: 'ap-big primary' }, h('small', {}, 'Total earnings'), h('b', {}, money(report.commissionPaise))), h('article', { class: 'ap-big' }, h('small', {}, 'Total withdrawn'), h('b', {}, money(report.paidPaise)))),
      withdrawalSection(report, load),
      h('section', { class: 'ap-link' }, h('div', {}, h('h2', {}, 'Your referral link and code'), h('p', {}, `${report.clicks} clicks · ${report.referrals} signups · ${report.conversions} purchases`), h('p', {}, 'Two ways to earn: share the link, or give your code to anyone — when they enter it as a promo code while buying Coins, you earn the commission.')),
        h('div', { class: 'affiliate-link-row' }, linkInput, h('button', { class: 'btn pri', onclick: copy(linkInput, link, 'Link') }, 'Copy link')),
        h('div', { class: 'affiliate-link-row' }, codeInput, h('button', { class: 'btn pri', onclick: copy(codeInput, report.partner.referralCode, 'Code') }, 'Copy code')), copyMessage),
      h('section', { class: 'ap-table-card' }, h('h2', {}, 'Commission history'), h('p', {}, 'Every commission from a purchase made with your link. Buyers’ details are never shown.'),
        rows.length ? h('div', { class: 'ap-table-wrap' }, h('table', { class: 'ap-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', { class: 'ap-num' }, 'Purchase'), h('th', { class: 'ap-num' }, 'Your commission'), h('th', { class: 'ap-num' }, 'Status'))), h('tbody', {}, ...rows)))
          : h('div', { class: 'ap-empty' }, h('b', {}, 'No commissions yet'), h('p', {}, 'Share your link to start earning.'))),
      h('section', { class: 'ap-invite' }, h('div', {}, h('b', {}, 'Know a creator who would be a good partner?'), h('p', {}, 'Anyone can apply to become a 12toons partner — they only need to fill in the short form.')), h('a', { class: 'btn', href: '/#/affiliates', onclick: (e) => { e.preventDefault(); apply(); } }, 'Open the partner form')),
    );
  } catch (e) {
    content.replaceChildren(h('section', { class: 'affiliate-dash-unavailable' }, h('span', { class: 'projects-eyebrow' }, 'AFFILIATE PROGRAM'), h('h1', {}, 'The partner dashboard could not be opened'), h('p', {}, friendlyError(e, 'The affiliate application for this Google account has not been approved yet.')), h('button', { class: 'btn pri', onclick: apply }, 'Apply to become a partner')));
  }
  }
  load();
  return root;
}

const STATUS_TEXT = { pending: 'Waiting for approval', approved: 'Approved', rejected: 'Rejected' };
/** rupees typed by the partner -> whole paise, or null when it is not a valid amount (at most 2 decimals) */
const toPaise = text => /^\d{1,9}(\.\d{1,2})?$/.test(text.trim()) ? Math.round(Number(text) * 100) : null;

/** balance, the request form (the amount cannot be more than what is available) and the history of requests */
function withdrawalSection(report, reload) {
  const wallet = report.wallet || { availablePaise: 0, reservedPaise: 0, withdrawnPaise: 0 }, waiting = (report.withdrawals || []).find(x => x.status === 'pending');
  const message = h('p', { class: 'affiliate-withdraw-message', role: 'status', 'aria-live': 'polite' });
  const amount = h('input', { class: 'affiliate-withdraw-input', type: 'text', inputmode: 'decimal', placeholder: '0.00', autocomplete: 'off', 'aria-label': 'Amount to withdraw in rupees' });
  const method = h('select', { class: 'affiliate-withdraw-input', 'aria-label': 'Payout method' }, h('option', { value: 'upi' }, 'UPI'), h('option', { value: 'bank' }, 'Bank transfer'));
  const field = (label, input) => h('label', { class: 'affiliate-withdraw-field' }, h('span', {}, label), input);
  const upiId = h('input', { class: 'affiliate-withdraw-input', placeholder: 'name@bank', autocomplete: 'off' });
  const accountName = h('input', { class: 'affiliate-withdraw-input', placeholder: 'Name on the bank account', autocomplete: 'off' });
  const accountNumber = h('input', { class: 'affiliate-withdraw-input', inputmode: 'numeric', placeholder: 'Account number', autocomplete: 'off' });
  const ifsc = h('input', { class: 'affiliate-withdraw-input', placeholder: 'IFSC, e.g. HDFC0001234', autocomplete: 'off' });
  const upiFields = h('div', { class: 'affiliate-withdraw-fields' }, field('UPI ID', upiId));
  const bankFields = h('div', { class: 'affiliate-withdraw-fields', hidden: true }, field('Account holder', accountName), field('Account number', accountNumber), field('IFSC code', ifsc));
  method.addEventListener('change', () => { upiFields.hidden = method.value !== 'upi'; bankFields.hidden = method.value !== 'bank'; });
  const submit = h('button', { class: 'btn pri', type: 'button', disabled: !!waiting || wallet.availablePaise < 100 }, 'Request withdrawal');
  const all = h('button', { class: 'btn sm', type: 'button', disabled: wallet.availablePaise < 100, onclick: () => { amount.value = (wallet.availablePaise / 100).toFixed(2); message.textContent = ''; } }, 'Withdraw all');
  const fail = text => { message.className = 'affiliate-withdraw-message error'; message.textContent = text; };
  submit.addEventListener('click', async () => {
    const paise = toPaise(amount.value);
    if (paise === null || paise < 100) { fail('Please enter an amount in rupees, for example 250 or 250.50 (at least ₹1).'); amount.focus(); return; }
    if (paise > wallet.availablePaise) { fail(`You can withdraw up to ${money(wallet.availablePaise)}. Please enter a smaller amount.`); amount.focus(); return; }
    const payout = method.value === 'upi' ? { method: 'upi', upiId: upiId.value } : { method: 'bank', accountName: accountName.value, accountNumber: accountNumber.value, ifsc: ifsc.value };
    submit.disabled = true; message.className = 'affiliate-withdraw-message'; message.textContent = 'Sending your request…';
    try { await apiCall('/api/affiliates', { action: 'withdraw', amountPaise: paise, payout }); await reload(); }
    catch (e) { fail(friendlyError(e)); submit.disabled = false; }
  });
  const history = (report.withdrawals || []).length ? report.withdrawals.map(row => h('div', { class: 'affiliate-commission-row' },
    h('div', {}, h('b', {}, money(row.amountPaise)), h('small', {}, `${date(row.requestedAt)} · ${row.where || ''}${row.status === 'rejected' && row.reason ? ` · Reason: ${row.reason}` : ''}${row.status === 'approved' && row.payoutReference ? ` · Ref: ${row.payoutReference}` : ''}`)),
    h('div', { class: 'affiliate-commission-value' }, h('span', { class: `affiliate-payout-state ${row.status === 'approved' ? 'paid' : row.status === 'rejected' ? 'rejected' : 'pending'}` }, STATUS_TEXT[row.status] || row.status)))) : [h('div', { class: 'affiliate-dash-empty' }, 'Your withdrawal requests will appear here.')];
  const tile = (title, value, tone) => h('article', { class: `ap-stat ${tone || ''}` }, h('small', {}, title), h('b', {}, value));
  return h('section', { class: 'ap-table-card affiliate-withdraw-card' },
    h('h2', {}, 'Withdraw your commission'), h('p', {}, 'Request a payout of the commission you have earned. Once an admin approves it, the amount is paid to the account you enter and deducted from your balance.'),
    h('div', { class: 'ap-grid3 affiliate-wallet-tiles' }, tile('Available to withdraw', money(wallet.availablePaise), 'good'), tile('Waiting for approval', money(wallet.reservedPaise)), tile('Withdrawn so far', money(wallet.withdrawnPaise))),
    waiting ? h('p', { class: 'affiliate-withdraw-note' }, `Your request for ${money(waiting.amountPaise)} is waiting for approval. You can make another request after it has been reviewed.`) : null,
    h('div', { class: 'affiliate-withdraw-form' },
      h('div', { class: 'affiliate-withdraw-fields' }, field('Amount (₹)', h('div', { class: 'affiliate-withdraw-amount' }, amount, all)), field('Payout method', method)),
      upiFields, bankFields, h('div', { class: 'affiliate-withdraw-actions' }, submit), message),
    h('h3', {}, 'Withdrawal requests'), h('div', { class: 'affiliate-commission-list' }, ...history));
}
