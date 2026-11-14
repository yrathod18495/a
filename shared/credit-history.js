// The Coin history window: turns the account's payment records into rows. Only a captured payment adds Coins; the rest are shown but marked as not added.
const LABEL = { created: 'Awaiting payment', authorized: 'Authorized', captured: 'Added', failed: 'Failed', cancelled: 'Cancelled', pending: 'Pending' };
const money = (paise) => `₹${Math.round(Number(paise || 0) / 100).toLocaleString('en-IN')}`;

/** one row per payment, newest first: { id, title, when, coins, rupees, state: 'added' | 'waiting' | 'failed', label } */
export function historyRows(payments = []) {
  return (Array.isArray(payments) ? payments : [])
    .filter((p) => p && typeof p === 'object')
    .map((p) => {
      const status = String(p.status || ''), added = status === 'captured';
      return {
        id: String(p.orderId || p.id || ''), title: String(p.planName || 'Coins purchase'),
        when: Number(p.capturedAt || p.createdAt) || 0, coins: Math.max(0, Math.floor(Number(p.credits) || 0)), rupees: money(p.amountPaise),
        state: added ? 'added' : ['created', 'authorized', 'pending'].includes(status) ? 'waiting' : 'failed', label: LABEL[status] || 'Unknown',
      };
    })
    .sort((a, b) => b.when - a.when);
}
/** the Coins this account has received in total (captured payments only) */
export const totalAdded = (rows) => rows.filter((r) => r.state === 'added').reduce((sum, r) => sum + r.coins, 0);

/** Coins that were not bought: the welcome gift and changes made by 12toons support. Newest first, same row shape as historyRows. */
export function ledgerRows(lines = []) {
  return (Array.isArray(lines) ? lines : []).filter((l) => l && typeof l === 'object' && Number.isFinite(Number(l.delta)) && Number(l.delta) !== 0).map((l) => {
    const delta = Math.trunc(Number(l.delta)), kind = String(l.kind || '');
    return {
      id: '', title: kind === 'signup_bonus' ? 'Welcome gift' : String(l.reason || (delta > 0 ? 'Coins added' : 'Coins removed')).slice(0, 80),
      when: Number(l.at) || 0, coins: Math.abs(delta), rupees: '', state: delta > 0 ? 'added' : 'removed',
      label: kind === 'signup_bonus' ? 'Gift' : kind === 'store_purchase' ? 'Character Store' : delta > 0 ? 'Added by 12toons' : 'Removed by 12toons', balance: Number(l.balance),
    };
  }).sort((a, b) => b.when - a.when);
}
/** purchases and other changes together, newest first */
export const allRows = (payments, ledger) => [...historyRows(payments), ...ledgerRows(ledger)].sort((a, b) => b.when - a.when);
