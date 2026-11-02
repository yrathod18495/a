// Where the floating "Support" button can send people besides the live chat: the Telegram and WhatsApp group or personal chat.
// Fill in the four links below. A link that is empty (or not a normal Telegram / WhatsApp link) is simply not shown;
// if none are set, the button opens the live chat directly, as before.
//   telegram.group     a group invite link, e.g. https://t.me/+AbCdEfGh  or  https://t.me/yourgroup
//   telegram.personal  your own account, e.g. https://t.me/youruser
//   whatsapp.group     a group invite link, e.g. https://chat.whatsapp.com/AbCdEfGh123
//   whatsapp.personal  your number with country code and no plus or spaces, e.g. https://wa.me/919876543210
export const CONTACT_LINKS = Object.freeze({
  telegram: Object.freeze({ group: '', personal: '' }),
  whatsapp: Object.freeze({ group: '', personal: '' }),
});

const ALLOWED = {
  telegram: /^https:\/\/t\.me\/[A-Za-z0-9_+/-]{3,80}$/,
  whatsapp: /^https:\/\/(chat\.whatsapp\.com\/[A-Za-z0-9]{10,40}|wa\.me\/\d{8,15}(\?text=[^\s]{0,200})?)$/,
};
const LABELS = { telegram: 'Telegram', whatsapp: 'WhatsApp' };
const KINDS = { group: 'Join our group', personal: 'Message us directly' };

/** the channels that can be shown: only valid links, in the order Telegram, WhatsApp */
export function contactChannels(links = CONTACT_LINKS) {
  return ['telegram', 'whatsapp'].map((key) => {
    const options = ['group', 'personal']
      .map((kind) => ({ kind, label: KINDS[kind], url: String(links?.[key]?.[kind] || '').trim() }))
      .filter((option) => ALLOWED[key].test(option.url));
    return { key, label: LABELS[key], options };
  }).filter((channel) => channel.options.length);
}
