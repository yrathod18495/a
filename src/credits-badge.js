// The Coin balance in the header of every page (users and admins). One small request, kept for a minute, and the last value is remembered
// on this device so the number is there at once. The pages that change the balance (buying Coins) call setCoinBalance().
import { h } from './dom.js';
import { apiCall } from './session.js';
import { goldCoin } from './coin.js';

const KEY = (uid) => `12toons-coins-${uid}`, FRESH_MS = 60_000;
let uid = null, balance = null, fetchedAt = 0, loading = null;
const listeners = new Set();

const remembered = (id) => { try { const v = JSON.parse(localStorage.getItem(KEY(id)) || 'null'); return Number.isFinite(v) ? v : null; } catch { return null; } };
const remember = (id, n) => { try { localStorage.setItem(KEY(id), JSON.stringify(n)); } catch { /* optional */ } };
/** "1,500" — the number only; the coin icon is drawn next to it */
export const formatCoins = (n) => Number(n || 0).toLocaleString('en-IN');

/** which account the badge belongs to (null = signed out: no badge) */
export function setCoinUser(id) {
  if (id === uid) return;
  uid = id || null; balance = uid ? remembered(uid) : null; fetchedAt = 0; loading = null;
  listeners.forEach((fn) => fn());
  if (uid) queueMicrotask(() => mountCreditBadges(document.getElementById('shell') || document));     // headers already on screen
}
export const coinBalance = () => balance;
export function setCoinBalance(n) {
  if (!uid || !Number.isFinite(Number(n))) return;
  balance = Number(n); fetchedAt = Date.now(); remember(uid, balance); listeners.forEach((fn) => fn());
}
/** ask the server for the balance (at most once a minute unless `force`) */
export function refreshCoins({ force = false } = {}) {
  if (!uid || uid === 'debug') return Promise.resolve(balance);
  if (loading) return loading;
  if (!force && Date.now() - fetchedAt < FRESH_MS) return Promise.resolve(balance);
  const asked = uid;
  loading = apiCall('/api/payments', { action: 'balance' }, asked)
    .then((r) => { if (asked === uid) setCoinBalance(r.credits); return balance; })
    .catch(() => balance)                                    // offline or a hiccup: keep showing the last number
    .finally(() => { loading = null; });
  return loading;
}

/** the badge: a gold coin and the number; a tap opens the page where Coins are bought */
export function creditsBadge({ compact = false } = {}) {
  const number = h('b', {}, '');
  const el = h('a', { class: `credit-badge${compact ? ' compact' : ''}`, href: '#/credits', title: 'Your Coins. Tap to see your balance or buy more.', 'aria-label': 'Your Coins' }, goldCoin(compact ? 18 : 20), number);
  const paint = () => {
    el.hidden = !uid || uid === 'debug';
    number.textContent = balance == null ? '…' : formatCoins(balance);
    el.setAttribute('aria-label', balance == null ? 'Your Coins' : `Your Coins: ${formatCoins(balance)}`);
  };
  listeners.add(paint);
  paint();
  queueMicrotask(() => { if (!el.hidden) refreshCoins(); });
  return Object.assign(el, { dispose: () => listeners.delete(paint) });
}

/** put a badge into every page header that does not have one yet (after the flexible gap, so it sits on the right side) */
export function mountCreditBadges(root = document) {
  if (!uid || uid === 'debug') return;
  for (const bar of root.querySelectorAll('.sh-bar, .admin-console-topbar, .projects-header')) {
    if (bar.querySelector('.credit-badge') || bar.closest('.admin-console-host')) continue;       // the admin console has one bar of its own on top
    const gap = [...bar.children].find((c) => c.classList?.contains('sp')), right = bar.querySelector('.lp-header-right');
    const badge = creditsBadge();
    if (gap) gap.after(badge);
    else if (right) right.insertBefore(badge, right.lastElementChild);                            // the home page: just before the profile button
    else bar.append(badge);
  }
}
