import { test, expect } from '@playwright/test';

test('Gold Coin component draws a coin with the 12TOON lettering and the wording says Gold Coins', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/security', r => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug&workers=0');
  const result = await page.evaluate(async () => {
    const { goldCoin, coinAmount, coinText } = await import('/src/coin.js');
    const el = coinAmount(1500); document.body.append(el);
    return { text: el.textContent, label: el.querySelector('svg').getAttribute('aria-label'), lettering: el.querySelector('textPath').textContent, plain: coinText(500), size: (() => { const c = goldCoin(30); document.body.append(c); return c.getBoundingClientRect().width; })() };
  });
  expect(result.text).toMatch(/^1,500.*Gold Coins$/s); expect(result.lettering).toBe('12TOON'); expect(result.plain).toBe('500 Gold Coins'); expect(result.size).toBe(30);
  await page.locator('.gcoin').first().evaluate((el) => { el.style.cssText += ';width:240px;height:240px'; el.querySelector('svg').setAttribute('width', 240); el.querySelector('svg').setAttribute('height', 240); }); await page.locator('.gcoin').first().screenshot({ path: 'test-results/gold-coin.png' });
  expect(errors).toEqual([]);
});
