import { AccessError } from './security-policy.js';

/** Money is always whole paise. */
export const MIN_WITHDRAWAL_PAISE = 100;   // ₹1: the amount only has to be positive
const rupees = paise => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const sum = (rows, pick) => rows.reduce((n, row) => n + pick(row), 0);
const paiseOf = row => Math.max(0, Number(row.commissionPaise || 0));

/**
 * A partner's money, from their commission records and their wallet counters.
 *  earned    every confirmed commission
 *  paid      commissions marked paid by hand + withdrawals the admin approved
 *  reserved  withdrawals waiting for the admin (held back so they cannot be requested twice)
 *  available what can still be requested: earned - paid - reserved
 */
export function walletBalance(commissions = [], wallet = {}) {
  const earned = sum(commissions, paiseOf);
  const paidByHand = sum(commissions.filter(row => row.payoutStatus === 'paid'), paiseOf);
  const withdrawn = Math.max(0, Number(wallet?.withdrawnPaise || 0)), reserved = Math.max(0, Number(wallet?.reservedPaise || 0));
  const paid = paidByHand + withdrawn;
  return { earnedPaise: earned, paidPaise: paid, pendingPaise: Math.max(0, earned - paid), withdrawnPaise: withdrawn, reservedPaise: reserved, availablePaise: Math.max(0, earned - paid - reserved) };
}

/** Checks the amount the partner typed against what they have earned. */
export function checkWithdrawalAmount(amountPaise, availablePaise) {
  if (!Number.isSafeInteger(amountPaise) || amountPaise < MIN_WITHDRAWAL_PAISE)
    throw new AccessError('invalid_amount', `Please enter an amount of at least ${rupees(MIN_WITHDRAWAL_PAISE)}.`, 400);
  if (amountPaise > availablePaise)
    throw new AccessError('amount_exceeds_balance', availablePaise > 0 ? `You can withdraw up to ${rupees(availablePaise)}. Please enter a smaller amount.` : 'You have no commission available to withdraw right now.', 400);
}

const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';

/** Where the money should be sent: a UPI ID or a bank account. Returns only the fields that belong to the chosen method. */
export function cleanPayoutDetails(input = {}) {
  if (input.method === 'upi') {
    const upiId = clean(input.upiId, 120);
    if (!/^[a-zA-Z0-9._-]{2,80}@[a-zA-Z0-9]{2,40}$/.test(upiId)) throw new AccessError('invalid_upi', 'Please enter a valid UPI ID, for example name@bank.', 400);
    return { method: 'upi', upiId };
  }
  if (input.method === 'bank') {
    const accountName = clean(input.accountName, 80), accountNumber = clean(input.accountNumber, 20).replace(/\s/g, ''), ifsc = clean(input.ifsc, 11).toUpperCase();
    if (accountName.length < 2) throw new AccessError('invalid_account_name', 'Please enter the account holder name.', 400);
    if (!/^\d{9,18}$/.test(accountNumber)) throw new AccessError('invalid_account_number', 'Please enter a valid bank account number (9 to 18 digits).', 400);
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw new AccessError('invalid_ifsc', 'Please enter a valid IFSC code, for example HDFC0001234.', 400);
    return { method: 'bank', accountName, accountNumber, ifsc };
  }
  throw new AccessError('invalid_payout_method', 'Please choose UPI or bank transfer.', 400);
}

/** What the partner sees about their own request: the account number is never sent back in full. */
export function publicWithdrawal(row) {
  const payout = row.payout || {};
  const where = payout.method === 'upi' ? `UPI · ${payout.upiId}` : payout.method === 'bank' ? `Bank · ••••${String(payout.accountNumber || '').slice(-4)}` : '';
  return { id: row.id, amountPaise: row.amountPaise, status: row.status, requestedAt: row.requestedAt, reviewedAt: row.reviewedAt || null, payoutReference: row.payoutReference || '', reason: row.reason || '', where };
}
