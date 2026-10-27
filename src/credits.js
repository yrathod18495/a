import { friendlyError } from '../shared/hinglish-errors.js';
import { h, logo, toast } from './dom.js';
import { apiCall } from './session.js';
import { goldCoin, coinAmount, coinText, COIN_NAME } from './coin.js';

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
  const content = h('main', { class: 'credit-main' }, h('p', { class: 'hint' }, 'Loading Gold Coin plans…'));
  root.append(h('header', { class: 'sh-bar' }, logo(home), h('span', { class: 'sh-crumb' }, `Buy ${COIN_NAME}`), h('span', { class: 'sp' }), h('button', { class: 'btn', onclick: home }, '⌂ Home')), content);
  let catalog;
  try { catalog = await apiCall('/api/payments', { action: 'catalog' }, user.uid); }
  catch (e) { content.replaceChildren(h('section', { class: 'card credit-error' }, h('h2', {}, 'Could not load Gold Coin plans'), h('p', {}, friendlyError(e)), h('button', { class: 'btn', onclick: home }, 'Back to Home'))); return root; }
  const balance = h('b', { class: 'credit-balance' }, coinAmount(catalog.credits, { size: 26 }));
  const message = h('p', { class: 'credit-message', role: 'status', 'aria-live': 'polite' }, '');
  const history = h('div', { class: 'credit-history' }, h('p', { class: 'hint' }, 'Loading your payment history…'));
  const refreshHistory = async () => {
    try {
      const { payments } = await apiCall('/api/payments', { action: 'mine' }, user.uid);
      const entries = payments.length ? payments.map((p) => h('div', { class: 'credit-history-row' },
        h('div', {}, h('b', {}, p.planName || 'Gold Coins purchase'), h('small', {}, `${stamp(p.createdAt)} · ${p.orderId}`)),
        h('div', {}, h('b', {}, money(p.amountPaise)), h('small', { class: `credit-status ${p.status}` }, statusLabel(p.status))))) : [h('p', { class: 'hint' }, 'Your purchases will appear here.')];
      history.replaceChildren(...entries);
    } catch (e) { history.replaceChildren(h('p', { class: 'hint' }, e.message)); }
  };
  const buy = (plan, button) => async () => {
    button.disabled = true; message.textContent = 'Creating secure payment order…'; message.className = 'credit-message';
    try {
      await loadCheckout();
      const order = await apiCall('/api/payments', { action: 'createOrder', planId: plan.id }, user.uid);
      let finished = false;
      const options = {
        key: order.keyId, amount: order.amountPaise, currency: order.currency, name: '12toons',
        description: `${coinText(plan.credits)} · ${plan.name} plan`, order_id: order.orderId,
        prefill: { name: user.displayName || '', email: user.email || '' }, theme: { color: '#d4a443' },
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
    h('section', { class: 'credit-hero' }, h('div', {}, h('span', { class: 'credit-kicker' }, 'YOUR GOLD COINS'), h('h1', {}, 'Choose your Gold Coins plan'), h('p', { class: 'sub' }, 'One-time purchases. As soon as Razorpay confirms the payment, the coins are added to your Gold Coins account.')),
      h('div', { class: 'credit-balance-card' }, h('small', {}, 'Your balance'), balance)),
    h('div', { class: 'credit-grid' }, ...catalog.plans.map((plan) => {
      const button = h('button', { class: 'btn pri big', disabled: !catalog.configured, onclick: null }, catalog.configured ? 'Buy this plan' : 'Payment setup pending');
      button.addEventListener('click', buy(plan, button));
      return h('article', { class: `credit-plan ${plan.popular ? 'popular' : ''}` },
        plan.popular ? h('span', { class: 'credit-popular' }, 'POPULAR') : null,
        h('h2', {}, plan.name), h('p', { class: 'credit-amount' }, h('del', {}, money(plan.compareAtPaise)), h('span', { class: 'credit-off' }, `${plan.discountPercent}% OFF`)),
        h('p', { class: 'credit-price' }, money(plan.amountPaise), h('small', {}, ' one-time')),
        h('p', { class: 'credit-count' }, coinAmount(plan.credits, { size: 30 })),
        h('ul', {}, ...plan.features.map((feature) => h('li', {}, feature))), button);
    })),
    ...(!catalog.configured ? [h('p', { class: 'credit-setup' }, 'Checkout is disabled until RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are set on the server.')] : []),
    h('p', { class: 'credit-note' }, 'Gold Coins are not spent on AI tools. AI tools run on your own OpenRouter API key, and the provider may charge separately.'),
    message,
    h('section', { class: 'credit-history-section' }, h('div', { class: 'credit-section-heading' }, h('h2', {}, 'Payment history'), h('button', { class: 'btn sm', onclick: refreshHistory }, '↻ Refresh')), history));
  refreshHistory();
  return root;
}
