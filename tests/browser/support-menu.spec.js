import { test, expect } from '@playwright/test';

const LINKS = `export const CONTACT_LINKS = { telegram: { group: 'https://t.me/+AbCdEfGh12', personal: 'https://t.me/twelve_help' }, whatsapp: { group: 'https://chat.whatsapp.com/AbCdEfGhIj1234', personal: '' } };
  const ALLOWED = { telegram: /^https:\\/\\/t\\.me\\/[A-Za-z0-9_+/-]{3,80}$/, whatsapp: /^https:\\/\\/(chat\\.whatsapp\\.com\\/[A-Za-z0-9]{10,40}|wa\\.me\\/\\d{8,15})$/ };
  export function contactChannels(links = CONTACT_LINKS) { return ['telegram', 'whatsapp'].map((key) => ({ key, label: key === 'telegram' ? 'Telegram' : 'WhatsApp', options: ['group', 'personal'].map((kind) => ({ kind, label: kind === 'group' ? 'Join our group' : 'Message us directly', url: links[key][kind] })).filter((o) => ALLOWED[key].test(o.url)) })).filter((c) => c.options.length); }`;

async function home(page, withLinks) {
  await page.setViewportSize({ width: 1280, height: 800 });
  if (withLinks) await page.route('**/shared/contact-links.js*', (r) => r.fulfill({ contentType: 'text/javascript', body: LINKS }));
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.route('**/api/chat', (r) => r.fulfill({ json: { messages: [], revision: 0, unreadUser: false } }));
  await page.goto('/?debug#/hub');
  // the debug session never mounts the widget by itself, so it is mounted here the way the shell does
  await page.evaluate(async () => { const { chatWidget } = await import('/src/chat-widget.js'); document.body.append(chatWidget({ uid: 'support-user-123456' }, () => {})); });
  await expect(page.locator('.support-launch')).toBeVisible();
}

test('the support button asks how to reach us: Telegram, WhatsApp, Live chat; Telegram and WhatsApp open the group or the personal chat', async ({ page }) => {
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await home(page, true);
  await page.locator('.support-launch').click();
  const menu = page.locator('.support-menu');
  await expect(menu).toBeVisible();
  await expect(page.locator('.support-panel')).toBeHidden();                       // the chat is not opened yet
  await expect(menu.locator('.support-menu-item b')).toHaveText(['Telegram', 'WhatsApp', 'Live chat']);
  // Telegram: two choices, both open in a new tab
  await menu.getByRole('menuitem', { name: /Telegram/ }).click();
  const subs = menu.locator('.support-menu-subs:not([hidden]) a');
  await expect(subs).toHaveText(['Join our group', 'Message us directly']);
  expect(await subs.evaluateAll((els) => els.map((a) => [a.href, a.target, a.rel]))).toEqual([['https://t.me/+AbCdEfGh12', '_blank', 'noopener noreferrer'], ['https://t.me/twelve_help', '_blank', 'noopener noreferrer']]);
  // WhatsApp has only the group link set, so that one tap opens it directly
  await page.context().route('https://chat.whatsapp.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<title>WhatsApp</title>' }));   // no real internet here
  const popup = page.waitForEvent('popup');
  await menu.getByRole('menuitem', { name: /WhatsApp/ }).click();
  const tab = await popup; await tab.waitForLoadState(); expect(tab.url()).toContain('chat.whatsapp.com/AbCdEfGhIj1234'); await tab.close().catch(() => {});
  await expect(menu).toBeHidden();
  // Live chat opens the normal chat panel and closes the menu
  await page.locator('.support-launch').click();
  await menu.getByRole('menuitem', { name: /Live chat/ }).click();
  await expect(page.locator('.support-panel')).toBeVisible();
  await expect(menu).toBeHidden();
  expect(errors).toEqual([]);
});

test('the menu closes with Escape and with a click outside, and the button toggles it', async ({ page }) => {
  await home(page, true);
  const menu = page.locator('.support-menu');
  await page.locator('.support-launch').click(); await expect(menu).toBeVisible();
  await page.keyboard.press('Escape'); await expect(menu).toBeHidden();
  await page.locator('.support-launch').click(); await expect(menu).toBeVisible();
  await page.mouse.click(300, 300); await expect(menu).toBeHidden();
  await page.locator('.support-launch').click(); await expect(menu).toBeVisible();
  await page.locator('.support-launch').click(); await expect(menu).toBeHidden();
  // it sits next to the button, inside the screen
  await page.locator('.support-launch').click();
  const box = await menu.boundingBox(), fab = await page.locator('.support-launch').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(1280); expect(box.y + box.height).toBeLessThanOrEqual(fab.y);
});

test('with no Telegram / WhatsApp links set, the button opens the live chat directly as before', async ({ page }) => {
  await home(page, false);
  await page.locator('.support-launch').click();
  await expect(page.locator('.support-panel')).toBeVisible();
  await expect(page.locator('.support-menu')).toBeHidden();
});
