import { h, logo } from './dom.js';

const field = (label, name, options = {}) => h('label', { class: 'affiliate-field' }, h('span', {}, label, options.required ? h('i', {}, ' *') : null),
  options.select ? h('select', { name, required: options.required || false }, h('option', { value: '' }, 'Choose one'), ...options.select.map(x => h('option', { value: x }, x))) :
  h('input', { name, type: options.type || 'text', placeholder: options.placeholder || '', maxlength: options.maxlength || 254, required: options.required || false, autocomplete: options.autocomplete || 'off' }));

export function affiliateView({ home }) {
  const root = h('div', { class: 'sh affiliate-page' }), message = h('p', { class: 'affiliate-message', role: 'status', 'aria-live': 'polite' });
  const form = h('form', { class: 'affiliate-form', onsubmit: submit },
    h('div', { class: 'affiliate-form-grid' },
      field('Your name', 'name', { required: true, maxlength: 120, autocomplete: 'name', placeholder: 'Full name' }),
      field('Email address', 'email', { required: true, type: 'email', autocomplete: 'email', placeholder: 'you@example.com' }),
      field('Phone or WhatsApp number', 'phone', { required: true, type: 'tel', maxlength: 32, autocomplete: 'tel', placeholder: '+91 98765 43210' }),
      field('Company or creator brand', 'company', { required: true, maxlength: 120, placeholder: 'Organization or channel name' }),
      field('Platform', 'platform', { required: true, select: ['YouTube', 'Instagram', 'Facebook', 'Website / Blog', 'Agency', 'Other'] }),
      field('Audience size', 'audience', { maxlength: 80, placeholder: 'e.g. 25,000 subscribers' }),
      h('label', { class: 'affiliate-field affiliate-wide' }, h('span', {}, 'Channel or profile link'), h('input', { name: 'profile', type: 'url', maxlength: '400', placeholder: 'https://…' })),
      h('label', { class: 'affiliate-field affiliate-wide' }, h('span', {}, 'Tell us about your partnership idea'), h('textarea', { name: 'message', rows: '4', maxlength: '1500', placeholder: 'How would you like to work with 12toons?' }))
    ),
    h('label', { class: 'affiliate-consent' }, h('input', { type: 'checkbox', name: 'consent', required: true }), h('span', {}, 'I agree that 12toons may store and use these details to review this affiliate request and contact me about it. I have read the ', h('a', { href: '/#/terms', target: '_blank', rel: 'noopener' }, 'Terms of Use'), '.')),
    h('label', { class: 'affiliate-honey', 'aria-hidden': 'true', tabindex: '-1' }, 'Leave this field empty', h('input', { name: 'website', tabindex: '-1', autocomplete: 'off' })),
    message,
    h('button', { class: 'btn pri affiliate-submit', type: 'submit' }, 'Submit partnership request'),
    h('p', { class: 'affiliate-privacy' }, 'Your contact details are visible only to authorized admins for reviewing this request. Submitting this form does not guarantee acceptance into an affiliate program.')
  );
  async function submit(e) {
    e.preventDefault(); if (!form.reportValidity()) return;
    const button = form.querySelector('button[type="submit"]'); button.disabled = true; button.textContent = 'Submitting…'; message.className = 'affiliate-message'; message.textContent = '';
    const data = Object.fromEntries(new FormData(form));
    try {
      const response = await fetch('/api/affiliates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'submit', ...data, consent: data.consent === 'on' }) });
      const result = await response.json().catch(() => ({})); if (!response.ok) throw Error(result.error || 'Abhi submit nahi ho paya. Thodi der baad dobara try karein.');
      form.reset(); message.classList.add('success'); message.textContent = 'Thanks — your partnership request has been sent. The team will review it and contact you using the details you provided.';
    } catch (err) { message.classList.add('error'); message.textContent = err.message; }
    finally { button.disabled = false; button.textContent = 'Submit partnership request'; }
  }
  root.append(h('header', { class: 'sh-bar affiliate-header' }, logo(home), h('span', { class: 'sh-crumb' }, 'Affiliate Partners'), h('span', { class: 'sp' }), h('button', { class: 'btn', onclick: home }, 'Home')),
    h('main', { class: 'affiliate-main' }, h('section', { class: 'affiliate-hero' }, h('span', { class: 'projects-eyebrow' }, 'GROW WITH 12TOONS'), h('h1', {}, 'Become an Affiliate Partner'), h('p', {}, 'Introduce 12toons to your creator community. Tell us about your audience and partnership idea, and our team will follow up.')),
      h('section', { class: 'affiliate-card' }, h('div', { class: 'affiliate-card-heading' }, h('div', {}, h('h2', {}, 'Partnership request'), h('p', {}, 'Share your contact and channel details. Fields marked with * are required.')), h('span', { class: 'affiliate-card-mark', 'aria-hidden': 'true' }, '↗')), form)));
  return root;
}
