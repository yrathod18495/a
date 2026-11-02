import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTACT_LINKS, contactChannels } from '../shared/contact-links.js';

test('with no links set there is nothing to choose from (the button opens the live chat directly)', () => {
  assert.deepEqual(contactChannels(CONTACT_LINKS), []);
  assert.deepEqual(contactChannels({}), []);
  assert.deepEqual(contactChannels(null), []);
});
test('valid Telegram and WhatsApp links are listed in the order Telegram, WhatsApp; group first, then personal', () => {
  const channels = contactChannels({ telegram: { group: 'https://t.me/+AbCdEfGh12', personal: 'https://t.me/12toons_help' }, whatsapp: { group: 'https://chat.whatsapp.com/AbCdEfGhIj1234', personal: 'https://wa.me/919876543210' } });
  assert.deepEqual(channels.map((c) => c.key), ['telegram', 'whatsapp']);
  assert.deepEqual(channels[0].options.map((o) => o.kind), ['group', 'personal']);
  assert.deepEqual(channels[1].options.map((o) => o.url), ['https://chat.whatsapp.com/AbCdEfGhIj1234', 'https://wa.me/919876543210']);
});
test('a channel with only one link has one option, and one with none is left out', () => {
  const channels = contactChannels({ telegram: { group: '', personal: 'https://t.me/12toons_help' }, whatsapp: { group: '', personal: '' } });
  assert.deepEqual(channels.map((c) => [c.key, c.options.length]), [['telegram', 1]]);
});
test('anything that is not a normal Telegram / WhatsApp link is refused', () => {
  const bad = ['http://t.me/abc123', 'https://evil.example/t.me/abc123', 'javascript:alert(1)', 'https://t.me/', 'https://t.me/a b', 'https://wa.me/abc', 'https://wa.me/12', 'https://chat.whatsapp.com/', 'https://t.me.evil.com/abc123'];
  for (const url of bad) assert.deepEqual(contactChannels({ telegram: { group: url, personal: url }, whatsapp: { group: url, personal: url } }), [], url);
});
