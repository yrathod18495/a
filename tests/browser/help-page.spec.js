import { test, expect } from '@playwright/test';

const LINKS = `export const CONTACT_LINKS = { telegram: { group: 'https://t.me/+AbCdEfGh12', personal: 'https://t.me/twelve_help' }, whatsapp: { group: '', personal: 'https://wa.me/919876543210' } };
  const ALLOWED = { telegram: /^https:\\/\\/t\\.me\\/[A-Za-z0-9_+/-]{3,80}$/, whatsapp: /^https:\\/\\/wa\\.me\\/\\d{8,15}$/ };
  export function contactChannels(links = CONTACT_LINKS) { return ['telegram', 'whatsapp'].map((key) => ({ key, label: key === 'telegram' ? 'Telegram' : 'WhatsApp', options: ['group', 'personal'].map((kind) => ({ kind, label: kind === 'group' ? 'Join our group' : 'Message us directly', url: links[key][kind] })).filter((o) => ALLOWED[key].test(o.url)) })).filter((c) => c.options.length); }`;

async function open(page, hash, { links = false } = {}) {
  await page.setViewportSize({ width: 1280, height: 800 });
  if (links) await page.route('**/shared/contact-links.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: LINKS }));
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.route('**/api/chat', (r) => r.fulfill({ json: { messages: [], revision: 0 } }));
  await page.goto('/?debug' + hash);
}

test('"Help and support" in the menu opens the help page (it used to do nothing)', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await open(page, '#/hub');
  await page.getByRole('button', { name: 'Help and support', exact: true }).click();
  await expect(page).toHaveURL(/#\/help$/);
  await expect(page.getByRole('heading', { name: 'Help and support', level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
});

test('the help page shows the reply time, office hours, tips and the live chat option', async ({ page }) => {
  await open(page, '#/help');
  await expect(page.getByText('You will get a reply within 1 to 2 hours.')).toBeVisible();
  await expect(page.getByText('If you write after office hours, we reply when the office opens.')).toBeVisible();
  const hours = page.locator('.help-hours');
  await expect(hours).toContainText('Monday to Saturday'); await expect(hours).toContainText('10:00 AM to 7:00 PM'); await expect(hours).toContainText('Sunday'); await expect(hours).toContainText('Closed');
  await expect(hours).toContainText('IST');
  await expect(page.locator('.help-status')).toContainText(/We are online now|Our office is closed right now/);
  await expect(page.locator('.help-tips')).toContainText('Project ID');
  await expect(page.getByRole('heading', { name: 'Live chat', level: 3 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start live chat' })).toBeVisible();
  // no Telegram / WhatsApp link has been added yet, so those cards are not shown
  await expect(page.locator('.help-card.telegram, .help-card.whatsapp')).toHaveCount(0);
});

test('Telegram and WhatsApp cards appear when their links are set, with the group and personal choices', async ({ page }) => {
  await open(page, '#/help', { links: true });
  const tg = page.locator('.help-card.telegram'), wa = page.locator('.help-card.whatsapp');
  await expect(tg.getByRole('link')).toHaveText(['Join our group', 'Message us directly']);
  expect(await tg.getByRole('link').evaluateAll((a) => a.map((x) => [x.href, x.target]))).toEqual([['https://t.me/+AbCdEfGh12', '_blank'], ['https://t.me/twelve_help', '_blank']]);
  await expect(wa.getByRole('link')).toHaveText(['Message us directly']);                    // only the personal number is set
});

test('"Start live chat" opens the chat panel', async ({ page }) => {
  await open(page, '#/help');
  await page.evaluate(async () => { const { chatWidget } = await import('/src/chat-widget.js'); document.body.append(chatWidget({ uid: 'support-user-123456' }, () => {})); });   // the debug session does not mount the widget itself
  await expect(page.locator('.support-panel')).toBeHidden();
  await page.getByRole('button', { name: 'Start live chat' }).click();
  await expect(page.locator('.support-panel')).toBeVisible();
});

test('the page says it is closed outside office hours and open inside them', async ({ page }) => {
  await open(page, '#/help');
  const text = (at) => page.evaluate(async (t) => { const { supportStatus, statusText } = await import('/shared/support-info.js'); return statusText(supportStatus(t)); }, at);
  expect(await text(Date.parse('2026-11-02T11:00:00+05:30'))).toBe('We are online now. Office hours end at 7:00 PM.');
  expect(await text(Date.parse('2026-11-01T11:00:00+05:30'))).toContain('closed');
});
