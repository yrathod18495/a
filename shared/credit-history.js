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
