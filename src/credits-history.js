// The window that opens when the Coin balance in the header is tapped: the balance, and every Coin purchase (newest first).
import { h } from './dom.js';
import { apiCall } from './session.js';
import { goldCoin } from './coin.js';
import { friendlyError } from '../shared/hinglish-errors.js';
import { allRows, totalAdded } from '../shared/credit-history.js';

const when = (ms) => ms ? new Date(ms).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const coins = (n) => Number(n || 0).toLocaleString('en-IN');

/** open the history window for `uid`; `balance` is the number known so far, `onBalance` receives a fresher one */
export function openCreditHistory({ uid, balance = null, onBalance = () => {} }) {
  document.querySelector('dialog.credit-history-window')?.remove();
  const dialog = h('dialog', { class: 'credit-history-window', 'aria-labelledby': 'chw-title' });
  const total = h('b', { class: 'chw-balance' }, balance == null ? '…' : coins(balance));
  const body = h('div', { class: 'chw-body', 'aria-live': 'polite' }, h('p', { class: 'chw-hint' }, 'Loading your Coin history…'));
  const close = () => { dialog.close(); };
  dialog.append(
    h('header', { class: 'chw-head' }, h('h2', { id: 'chw-title' }, 'Your Coins'), h('button', { type: 'button', class: 'chw-close', 'aria-label': 'Close', onclick: close }, '✕')),
    h('section', { class: 'chw-summary' }, h('span', { class: 'chw-label' }, 'Current balance'), h('div', { class: 'chw-figure' }, goldCoin(30), total)),
    h('h3', { class: 'chw-sub' }, 'History'), body,
    h('footer', { class: 'chw-foot' }, h('a', { class: 'btn pri', href: '#/credits', onclick: () => close() }, 'Buy more Coins'), h('button', { type: 'button', class: 'btn', onclick: close }, 'Close')));
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });                 // a click on the dark area around the window
  document.body.append(dialog);
  dialog.showModal();

  const draw = (rows, latest) => {
    if (latest != null) { total.textContent = coins(latest); onBalance(latest); }
    if (!rows.length) { body.replaceChildren(h('div', { class: 'chw-empty' }, goldCoin(34), h('b', {}, 'No Coin history yet'), h('p', {}, 'Your purchases and gifts will be listed here.'))); return; }
    body.replaceChildren(
      h('p', { class: 'chw-note' }, `${rows.filter((r) => r.state === 'added').length} addition${rows.filter((r) => r.state === 'added').length === 1 ? '' : 's'} · ${coins(totalAdded(rows))} Coins received in total`),
      h('ul', { class: 'chw-list' }, ...rows.map((r) => h('li', { class: `chw-row ${r.state}` },
        h('div', { class: 'chw-main' }, h('b', {}, r.title), h('small', {}, `${when(r.when)}${r.id ? ` · ${r.id}` : ''}`)),
        h('div', { class: 'chw-side' }, h('b', { class: 'chw-coins' }, r.state === 'added' ? `+${coins(r.coins)}` : r.state === 'removed' ? `−${coins(r.coins)}` : coins(r.coins)), h('small', {}, r.rupees ? `${r.rupees} · ` : '', h('span', { class: `chw-status ${r.state}` }, r.label)))))));
  };
  Promise.all([
    apiCall('/api/payments', { action: 'mine' }, uid),
    apiCall('/api/payments', { action: 'balance' }, uid).then((r) => r.credits).catch(() => null),
  ]).then(([{ payments, ledger }, latest]) => draw(allRows(payments, ledger), latest))
    .catch((e) => body.replaceChildren(h('p', { class: 'chw-hint error' }, `Could not load your Coin history: ${friendlyError(e)}`)));
  dialog.querySelector('.chw-close').focus();
  return dialog;
}
