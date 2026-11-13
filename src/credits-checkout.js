// Buying a Coins plan with Razorpay: one flow used by the Buy Coins page and by the plans window (opened from "Buy more Coins").
import { friendlyError } from '../shared/hinglish-errors.js';
import { apiCall } from './session.js';
import { coinText } from './coin.js';

let checkoutScript;
export function loadCheckout() {
  if (window.Razorpay) return Promise.resolve();
  return checkoutScript ||= new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = 'https://checkout.razorpay.com/v1/checkout.js'; script.async = true;
    script.onload = () => window.Razorpay ? resolve() : reject(new Error('The Razorpay checkout did not load.'));
    script.onerror = () => { checkoutScript = null; reject(new Error('Could not load the Razorpay checkout. Check your internet and try again.')); };
    document.head.append(script);
  });
}

/**
 * Creates the order and opens Razorpay's window. Resolves once the window is open (throws if it could not be opened).
 * `onMessage(text, kind)` gets progress text (kind: '' | 'success' | 'error'); `onPaid(result)` runs when the Coins were added;
 * `onSettled()` runs after anything that changes the history (paid, failed, cancelled).
 */
export async function startCheckout({ user, plan, promo = '', onMessage = () => {}, onPaid = () => {}, onSettled = () => {} }) {
  onMessage('Creating secure payment order…', '');
  await loadCheckout();
  const order = await apiCall('/api/payments', { action: 'createOrder', planId: plan.id, ...(promo ? { promoCode: promo } : {}) }, user.uid);
  let finished = false;
  const checkout = new window.Razorpay({
    key: order.keyId, amount: order.amountPaise, currency: order.currency, name: '12toons',
    description: `${coinText(plan.credits)} · ${plan.name} plan`, order_id: order.orderId,
    prefill: { name: user.displayName || '', email: user.email || '' }, theme: { color: '#7c6cf5' },
    handler: async (response) => {
      finished = true; onMessage('Verifying payment…', '');
      try {
        const result = await apiCall('/api/payments', { action: 'verify', orderId: response.razorpay_order_id, paymentId: response.razorpay_payment_id, signature: response.razorpay_signature }, user.uid);
        if (result.status === 'captured') {
          onMessage(result.credited ? `${coinText(plan.credits)} added to your account.` : 'Payment is already recorded in your account.', 'success');
          onPaid(result);
        } else onMessage(result.message || 'Payment is waiting for confirmation.', '');
      } catch (e) { onMessage(`The payment was submitted, but confirmation did not complete: ${friendlyError(e)}. Your order will remain in the payment history.`, 'error'); }
      onSettled();
    },
    modal: { ondismiss: () => { if (!finished) apiCall('/api/payments', { action: 'cancel', orderId: order.orderId }, user.uid).then(onSettled).catch(() => {}); onMessage('', ''); } },
  });
  checkout.on('payment.failed', (event) => {
    finished = true; const error = event.error || {};
    apiCall('/api/payments', { action: 'failed', orderId: order.orderId, code: error.code, description: error.description }, user.uid).catch(() => {});
    onMessage(error.description || 'The payment could not be completed. You can try again.', 'error'); onSettled();
  });
  checkout.open(); onMessage('', '');
}
