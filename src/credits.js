import { friendlyError } from '../shared/hinglish-errors.js';
import { h, logo, toast } from './dom.js';
import { apiCall } from './session.js';
import { goldCoin, coinAmount, coinText, COIN_NAME } from './coin.js';
import { CREDIT_PLANS, publicPlan } from '../shared/credit-plans.js';

const money = (paise) => `₹${Math.round(Number(paise || 0) / 100).toLocaleString('en-IN')}`;
const stamp = (ms) => ms ? new Date(ms).toLocaleString() : '—';
const statusLabel = (s) => ({ created: 'Awaiting payment', authorized: 'Authorized', captured: 'Paid', failed: 'Failed', cancelled: 'Cancelled', pending: 'Pending' }[s] || s || 'Unknown');

let checkoutScript;
function loadCheckout() {
  if (window.Razorpay) return Promise.resolve();
  return checkoutScript ||= new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = 'https://checkout.razorpay.com/v1/checkout.js'; script.async = true;
    script.onload = () => window.Razorpay ? resolve() : reject(new Error('The Razorpay checkout did not load.'));
    script.onerror = () => reject(new Error('Could not load the Razorpay checkout. Check your internet and try again.'));
    document.head.append(script);
  });
}

export async function view({ user, home }) {
  const root = h('div', { class: 'sh credits-page' });
  const content = h('main', { class: 'credit-main' }, h('p', { class: 'hint' }, 'Loading Coin plans…'));
  root.append(h('header', { class: 'sh-bar' }, logo(home), h('span', { class: 'sh-crumb' }, `Buy ${COIN_NAME}`), h('span', { class: 'sp' }), h('button', { class: 'btn', onclick: home }, '⌂ Home')), content);
  // The plans never change per user, so the page shows them at once; only the balance and "payments are switched on" come from the server (kept from the last visit and refreshed in the background).
  const CACHE = `toons-credits-${user.uid}`;
  const cached = (() => { try { return JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch { return null; } })();
  const catalog = { plans: CREDIT_PLANS.map(publicPlan), configured: cached?.configured === true, credits: cached?.credits ?? null, known: !!cached };
  const balance = h('b', { class: 'credit-balance' }, catalog.credits == null ? '…' : coinAmount(catalog.credits, { size: 26 }));
  const buyButtons = [];
  // a partner's promo code: the partner earns a commission on this purchase (the price stays the same)
  let promo = '';
  const promoInput = h('input', { class: 'credit-promo-input', placeholder: 'Partner promo code (optional)', maxlength: '12', autocapitalize: 'characters', spellcheck: 'false', 'aria-label': 'Partner promo code' });
  const promoState = h('small', { class: 'credit-promo-state', role: 'status' }, '');
  const promoApply = h('button', { class: 'btn sm', type: 'button', onclick: async () => {
    const code = promoInput.value.trim().toUpperCase();
    if (!code) { promo = ''; promoState.textContent = ''; promoState.className = 'credit-promo-state'; return; }
    promoApply.disabled = true; promoState.textContent = 'Checking…'; promoState.className = 'credit-promo-state';
    try { await apiCall('/api/payments', { action: 'checkPromo', promoCode: code }, user.uid); promo = code; promoInput.value = code; promoState.textContent = '✓ Code applied. Thank you for supporting a 12toons partner.'; promoState.className = 'credit-promo-state ok'; }
    catch (e) { promo = ''; promoState.textContent = friendlyError(e); promoState.className = 'credit-promo-state bad'; }
    finally { promoApply.disabled = false; }
  } }, 'Apply');
  promoInput.addEventListener('input', () => { if (promo && promoInput.value.trim().toUpperCase() !== promo) { promo = ''; promoState.textContent = ''; promoState.className = 'credit-promo-state'; } });
  const promoBox = h('section', { class: 'credit-promo' }, h('div', { class: 'credit-promo-row' }, promoInput, promoApply), promoState);
  const buttonLabel = () => (catalog.known ? (catalog.configured ? 'Buy this plan' : 'Payment setup pending') : 'Checking…');
  const message = h('p', { class: 'credit-message', role: 'status', 'aria-live': 'polite' }, '');
  const history = h('div', { class: 'credit-history' }, h('p', { class: 'hint' }, 'Loading your payment history…'));
  const refreshHistory = async () => {
    try {
      const { payments } = await apiCall('/api/payments', { action: 'mine' }, user.uid);
      const entries = payments.length ? payments.map((p) => h('div', { class: 'credit-history-row' },
        h('div', {}, h('b', {}, p.planName || 'Coins purchase'), h('small', {}, `${stamp(p.createdAt)} · ${p.orderId}`)),
        h('div', {}, h('b', {}, money(p.amountPaise)), h('small', { class: `credit-status ${p.status}` }, statusLabel(p.status))))) : [h('p', { class: 'hint' }, 'Your purchases will appear here.')];
      history.replaceChildren(...entries);
    } catch (e) { history.replaceChildren(h('p', { class: 'hint' }, e.message)); }
  };
  const buy = (plan, button) => async () => {
    button.disabled = true; message.textContent = 'Creating secure payment order…'; message.className = 'credit-message';
    try {
      await loadCheckout();
      const order = await apiCall('/api/payments', { action: 'createOrder', planId: plan.id, ...(promo ? { promoCode: promo } : {}) }, user.uid);
      let finished = false;
      const options = {
        key: order.keyId, amount: order.amountPaise, currency: order.currency, name: '12toons',
        description: `${coinText(plan.credits)} · ${plan.name} plan`, order_id: order.orderId,
        prefill: { name: user.displayName || '', email: user.email || '' }, theme: { color: '#7c6cf5' },
        handler: async (response) => {
          finished = true; message.textContent = 'Verifying payment…';
          try {
            const result = await apiCall('/api/payments', { action: 'verify', orderId: response.razorpay_order_id, paymentId: response.razorpay_payment_id, signature: response.razorpay_signature }, user.uid);
            if (result.status === 'captured') {
              balance.replaceChildren(coinAmount(result.balance, { size: 26 }));
              message.textContent = result.credited ? `${coinText(plan.credits)} added to your account.` : 'Payment is already recorded in your account.';
              message.className = 'credit-message success'; toast(message.textContent);
            } else message.textContent = result.message || 'Payment is waiting for confirmation.';
            await refreshHistory();
          } catch (e) { message.textContent = `The payment was submitted, but confirmation did not complete: ${friendlyError(e)}. Your order will remain in the payment history.`; message.className = 'credit-message error'; await refreshHistory(); }
        },
        modal: { ondismiss: () => { if (!finished) apiCall('/api/payments', { action: 'cancel', orderId: order.orderId }, user.uid).then(refreshHistory).catch(() => {}); } },
      };
      const checkout = new window.Razorpay(options);
      checkout.on('payment.failed', (event) => {
        finished = true; const error = event.error || {};
        apiCall('/api/payments', { action: 'failed', orderId: order.orderId, code: error.code, description: error.description }, user.uid).catch(() => {});
        message.textContent = error.description || 'The payment could not be completed. You can try again.'; message.className = 'credit-message error'; refreshHistory();
      });
      checkout.open(); message.textContent = '';
    } catch (e) { message.textContent = e.message; message.className = 'credit-message error'; }
    finally { button.disabled = false; }
  };
  content.replaceChildren(
    h('section', { class: 'credit-hero' }, h('div', {}, h('span', { class: 'credit-kicker' }, 'YOUR COINS'), h('h1', {}, 'Choose your Coins plan'), h('p', { class: 'sub' }, 'One-time purchases. As soon as Razorpay confirms the payment, the coins are added to your Coins account.')),
      h('div', { class: 'credit-balance-card' }, h('small', {}, 'Your balance'), balance)),
    promoBox,
    h('div', { class: 'credit-grid' }, ...catalog.plans.map((plan) => {
      const button = h('button', { class: 'btn pri big', disabled: !catalog.configured, onclick: null }, buttonLabel());
      buyButtons.push(button);
      button.addEventListener('click', buy(plan, button));
      return h('article', { class: `credit-plan ${plan.popular ? 'popular' : ''}` },
        plan.popular ? h('span', { class: 'credit-popular' }, 'POPULAR') : null,
        h('h2', {}, plan.name), h('p', { class: 'credit-amount' }, h('del', {}, money(plan.compareAtPaise)), h('span', { class: 'credit-off' }, `${plan.discountPercent}% OFF`)),
        h('p', { class: 'credit-price' }, money(plan.amountPaise), h('small', {}, ' one-time')),
        h('p', { class: 'credit-count' }, coinAmount(plan.credits, { size: 30 })),
        h('ul', {}, ...plan.features.map((feature) => h('li', {}, feature))), button);
    })),
    message,
    h('section', { class: 'credit-history-section' }, h('div', { class: 'credit-section-heading' }, h('h2', {}, 'Payment history'), h('button', { class: 'btn sm', onclick: refreshHistory }, '↻ Refresh')), history));
  refreshHistory();
  apiCall('/api/payments', { action: 'catalog' }, user.uid).then((fresh) => {
    catalog.configured = fresh.configured === true; catalog.credits = fresh.credits; catalog.known = true;
    balance.replaceChildren(coinAmount(fresh.credits, { size: 26 }));
    for (const b of buyButtons) { b.disabled = !catalog.configured; b.textContent = buttonLabel(); }
    try { localStorage.setItem(CACHE, JSON.stringify({ configured: catalog.configured, credits: catalog.credits })); } catch { /* optional */ }
  }).catch((e) => {
    message.textContent = `Could not check your balance: ${friendlyError(e)}`; message.className = 'credit-message error';
    for (const b of buyButtons) b.textContent = 'Try again later';
  });
  return root;
}
