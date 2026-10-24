import { h, logo, toast } from './dom.js';
import { apiCall } from './session.js';

const money = (paise) => `₹${Math.round(Number(paise || 0) / 100).toLocaleString('en-IN')}`;
const stamp = (ms) => ms ? new Date(ms).toLocaleString() : '—';
const statusLabel = (s) => ({ created: 'Awaiting payment', authorized: 'Authorized', captured: 'Paid', failed: 'Failed', cancelled: 'Cancelled', pending: 'Pending' }[s] || s || 'Unknown');

let checkoutScript;
function loadCheckout() {
  if (window.Razorpay) return Promise.resolve();
  return checkoutScript ||= new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = 'https://checkout.razorpay.com/v1/checkout.js'; script.async = true;
    script.onload = () => window.Razorpay ? resolve() : reject(new Error('Razorpay checkout did not load.'));
    script.onerror = () => reject(new Error('Could not load Razorpay checkout. Check your connection and try again.'));
    document.head.append(script);
  });
}

export async function view({ user, home }) {
  const root = h('div', { class: 'sh credits-page' });
  const content = h('main', { class: 'credit-main' }, h('p', { class: 'hint' }, 'Loading credit plans…'));
  root.append(h('header', { class: 'sh-bar' }, logo(home), h('span', { class: 'sh-crumb' }, 'Buy Credits'), h('span', { class: 'sp' }), h('button', { class: 'btn', onclick: home }, '⌂ Home')), content);
  let catalog;
  try { catalog = await apiCall('/api/payments', { action: 'catalog' }, user.uid); }
  catch (e) { content.replaceChildren(h('section', { class: 'card credit-error' }, h('h2', {}, 'Could not load credit plans'), h('p', {}, e.message), h('button', { class: 'btn', onclick: home }, 'Back to Home'))); return root; }
  const balance = h('b', { class: 'credit-balance' }, `${Number(catalog.credits || 0).toLocaleString('en-IN')} credits`);
  const message = h('p', { class: 'credit-message', role: 'status', 'aria-live': 'polite' }, '');
  const history = h('div', { class: 'credit-history' }, h('p', { class: 'hint' }, 'Loading your payment history…'));
  const refreshHistory = async () => {
    try {
      const { payments } = await apiCall('/api/payments', { action: 'mine' }, user.uid);
      const entries = payments.length ? payments.map((p) => h('div', { class: 'credit-history-row' },
        h('div', {}, h('b', {}, p.planName || 'Credit purchase'), h('small', {}, `${stamp(p.createdAt)} · ${p.orderId}`)),
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
        description: `${plan.credits.toLocaleString('en-IN')} credits · ${plan.name} plan`, order_id: order.orderId,
        prefill: { name: user.displayName || '', email: user.email || '' }, theme: { color: '#d4a443' },
        handler: async (response) => {
          finished = true; message.textContent = 'Verifying payment…';
          try {
            const result = await apiCall('/api/payments', { action: 'verify', orderId: response.razorpay_order_id, paymentId: response.razorpay_payment_id, signature: response.razorpay_signature }, user.uid);
            if (result.status === 'captured') {
              balance.textContent = `${Number(result.balance).toLocaleString('en-IN')} credits`;
              message.textContent = result.credited ? `${plan.credits.toLocaleString('en-IN')} credits added to your account.` : 'Payment is already recorded in your account.';
              message.className = 'credit-message success'; toast(message.textContent);
            } else message.textContent = result.message || 'Payment is waiting for confirmation.';
            await refreshHistory();
          } catch (e) { message.textContent = `Payment submitted, but confirmation failed: ${e.message}. Your order remains in payment history.`; message.className = 'credit-message error'; await refreshHistory(); }
        },
        modal: { ondismiss: () => { if (!finished) apiCall('/api/payments', { action: 'cancel', orderId: order.orderId }, user.uid).then(refreshHistory).catch(() => {}); } },
      };
      const checkout = new window.Razorpay(options);
      checkout.on('payment.failed', (event) => {
        finished = true; const error = event.error || {};
        apiCall('/api/payments', { action: 'failed', orderId: order.orderId, code: error.code, description: error.description }, user.uid).catch(() => {});
        message.textContent = error.description || 'Payment failed. You can try again.'; message.className = 'credit-message error'; refreshHistory();
      });
      checkout.open(); message.textContent = '';
    } catch (e) { message.textContent = e.message; message.className = 'credit-message error'; }
    finally { button.disabled = false; }
  };
  content.replaceChildren(
    h('section', { class: 'credit-hero' }, h('div', {}, h('span', { class: 'credit-kicker' }, 'ACCOUNT CREDITS'), h('h1', {}, 'Choose a credit plan'), h('p', { class: 'sub' }, 'One-time purchases. Your credits are added after Razorpay confirms your payment.')),
      h('div', { class: 'credit-balance-card' }, h('small', {}, 'Your balance'), balance)),
    h('div', { class: 'credit-grid' }, ...catalog.plans.map((plan) => {
      const button = h('button', { class: 'btn pri big', disabled: !catalog.configured, onclick: null }, catalog.configured ? 'Buy this plan' : 'Payment setup pending');
      button.addEventListener('click', buy(plan, button));
      return h('article', { class: `credit-plan ${plan.popular ? 'popular' : ''}` },
        plan.popular ? h('span', { class: 'credit-popular' }, 'POPULAR') : null,
        h('h2', {}, plan.name), h('p', { class: 'credit-amount' }, h('del', {}, money(plan.compareAtPaise)), h('span', { class: 'credit-off' }, `${plan.discountPercent}% OFF`)),
        h('p', { class: 'credit-price' }, money(plan.amountPaise), h('small', {}, ' one-time')),
        h('p', { class: 'credit-count' }, `${plan.credits.toLocaleString('en-IN')} credits`),
        h('ul', {}, ...plan.features.map((feature) => h('li', {}, feature))), button);
    })),
    ...(!catalog.configured ? [h('p', { class: 'credit-setup' }, 'Checkout is disabled until RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are set on the server.')] : []),
    h('p', { class: 'credit-note' }, 'Credit spending is not connected to the current AI tools yet. They continue to use your own OpenRouter API key and may have separate provider charges.'),
    message,
    h('section', { class: 'credit-history-section' }, h('div', { class: 'credit-section-heading' }, h('h2', {}, 'Payment history'), h('button', { class: 'btn sm', onclick: refreshHistory }, '↻ Refresh')), history));
  refreshHistory();
  return root;
}
