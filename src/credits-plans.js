// "Buy more Coins": the plans open in a window right where the user is (the studio, the dashboard, anywhere) and can be bought from there.
import { h, toast } from './dom.js';
import { apiCall } from './session.js';
import { goldCoin, coinAmount, coinText } from './coin.js';
import { CREDIT_PLANS, publicPlan } from '../shared/credit-plans.js';
import { friendlyError } from '../shared/hinglish-errors.js';
import { startCheckout } from './credits-checkout.js';
import { setCoinBalance } from './credits-badge.js';

const money = (paise) => `₹${Math.round(Number(paise || 0) / 100).toLocaleString('en-IN')}`;

export function openCreditPlans({ user, onBalance = () => {} }) {
  document.querySelector('dialog.credit-plans-window')?.remove();
  const dialog = h('dialog', { class: 'credit-plans-window', 'aria-labelledby': 'cpw-title' });
  const close = () => dialog.close();
  const message = h('p', { class: 'cpw-message', role: 'status', 'aria-live': 'polite' }, '');
  const balance = h('b', {}, '…');
  const promoInput = h('input', { class: 'cpw-promo', placeholder: 'Partner promo code (optional)', maxlength: '12', autocapitalize: 'characters', spellcheck: 'false', 'aria-label': 'Partner promo code' });
  let configured = null;          // unknown until the server answers
  const buttons = [];
  const label = () => (configured == null ? 'Checking…' : configured ? 'Buy' : 'Setup pending');
  const say = (text, kind) => { message.textContent = text; message.className = `cpw-message ${kind || ''}`; };
  const cards = CREDIT_PLANS.map(publicPlan).map((plan) => {
    const button = h('button', { type: 'button', class: 'btn pri cpw-buy', disabled: true }, label());
    buttons.push(button);
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await startCheckout({ user, plan, promo: promoInput.value.trim().toUpperCase(), onMessage: say,
          onPaid: (result) => { balance.textContent = Number(result.balance || 0).toLocaleString('en-IN'); setCoinBalance(result.balance); onBalance(result.balance); toast(`${coinText(plan.credits)} added to your account.`); } });
      } catch (e) { say(friendlyError(e), 'error'); }
      finally { button.disabled = !configured; }
    });
    return h('article', { class: `cpw-plan ${plan.popular ? 'popular' : ''}` },
      plan.popular ? h('span', { class: 'cpw-tag' }, 'Popular') : null,
      h('div', { class: 'cpw-info' }, h('b', { class: 'cpw-name' }, plan.name), h('span', { class: 'cpw-coins' }, coinAmount(plan.credits, { size: 20 })),
        h('small', {}, plan.discountPercent ? `${plan.discountPercent}% off · ` : '', 'one-time payment')),
      h('div', { class: 'cpw-side' }, h('b', { class: 'cpw-price' }, money(plan.amountPaise)), plan.compareAtPaise > plan.amountPaise ? h('del', {}, money(plan.compareAtPaise)) : null, button));
  });
  dialog.append(
    h('header', { class: 'chw-head' }, h('h2', { id: 'cpw-title' }, 'Buy Coins'), h('button', { type: 'button', class: 'chw-close', 'aria-label': 'Close', onclick: close }, '✕')),
    h('div', { class: 'cpw-balance' }, goldCoin(22), h('span', {}, 'Your balance'), balance),
    h('div', { class: 'cpw-list' }, ...cards),
    promoInput, message,
    h('footer', { class: 'chw-foot' }, h('button', { type: 'button', class: 'btn', onclick: close }, 'Close')));
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  document.body.append(dialog);
  dialog.showModal();
  apiCall('/api/payments', { action: 'catalog' }, user.uid).then((c) => {
    configured = c.configured === true; balance.textContent = Number(c.credits || 0).toLocaleString('en-IN'); setCoinBalance(c.credits); onBalance(c.credits);
    for (const b of buttons) { b.disabled = !configured; b.textContent = label(); }
    if (!configured) say('Payments are not switched on yet. Please try again later.', 'error');
  }).catch((e) => { say(`Could not check payments: ${friendlyError(e)}`, 'error'); for (const b of buttons) b.textContent = 'Try again later'; });
  return dialog;
}
