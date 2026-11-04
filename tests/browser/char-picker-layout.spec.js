import { test, expect } from '@playwright/test';
// The character picker: two columns that fill the width on a phone, short square cards, the name on a bar, nothing overlapping.
for (const width of [360, 390, 430]) test(`character picker at ${width}px: two columns, compact cards`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug#/hub');
  await page.evaluate(async () => {
    const { characterPicker } = await import('/src/charpick.js');
    const c = document.createElement('canvas'); c.width = 200; c.height = 320; const g = c.getContext('2d'); g.fillStyle = '#c06'; g.fillRect(60, 10, 80, 300);
    const thumbnail = c.toDataURL(), entries = ['Maya', 'Roshan', 'Mukhiya', 'Police Officer', 'Rani'].map((name, i) => ({ id: `e${i}`, charBase: `c${i}`, name, group: i === 1 ? 'male' : i === 3 ? 'male' : 'female', thumbnail, template: { pose: 'front-side' } }));
    entries.push({ id: 'p2', charBase: 'c0', name: 'Maya', thumbnail, template: { pose: 'front' } }, { id: 'p3', charBase: 'c0', name: 'Maya', thumbnail, template: { pose: 'side' } });
    document.body.innerHTML = '<div id="host" style="padding:12px;box-sizing:border-box;width:100%"></div>';
    document.querySelector('#host').append(characterPicker({ entries, isOn: () => false, onPick() {}, steps: true }));
  });
  const boxes = () => page.locator('.cp-card').evaluateAll((els) => els.map((e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; }));
  const check = async (n) => {
    const b = await boxes(); expect(b.length).toBe(n);
    expect(new Set(b.map((x) => Math.round(x[0]))).size).toBe(2);                         // two columns
    for (const x of b) { expect(x[0]).toBeGreaterThanOrEqual(0); expect(x[2]).toBeLessThanOrEqual(width); expect(x[3] - x[1]).toBeLessThan(width / 2); expect(Math.abs((x[3] - x[1]) - (x[2] - x[0]))).toBeLessThan(2); }   // inside the screen, square, half a screen at most
    const left = Math.min(...b.map((x) => x[0])), right = Math.max(...b.map((x) => x[2])); expect(left).toBeLessThan(20); expect(right).toBeGreaterThan(width - 20);   // they fill the width
    for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) { const a = b[i], c = b[j]; expect(a[2] <= c[0] + 0.5 || c[2] <= a[0] + 0.5 || a[3] <= c[1] + 0.5 || c[3] <= a[1] + 0.5, `cards ${i} and ${j} overlap`).toBe(true); }
  };
  await expect(page.locator('.cp-stepbar')).toHaveCount(0);                                 // no "1 Character / 2 Pose" bar, no "Choose a ..." lines
  await expect(page.locator('.cp')).not.toContainText(/Choose a (character|pose)/);
  await expect(page.locator('.cp-kind')).toHaveText(['Male', 'Female', 'Boy', 'Girl']);
  await expect(page.locator('.cp-kind.on')).toHaveText('Male');                              // opens on the first kind that has characters
  await check(2);                                                                           // Male: Roshan, Police Officer
  await expect(page.locator('.cp-card b')).toHaveText(['Roshan', 'Police Officer']);
  await page.getByRole('tab', { name: 'Female' }).click(); await check(3);                  // Female: Maya, Mukhiya, Rani
  await expect(page.locator('.cp-card b')).toHaveText(['Maya', 'Mukhiya', 'Rani']);
  await page.getByRole('tab', { name: 'Boy' }).click(); await expect(page.locator('.cp-card')).toHaveCount(0); await expect(page.locator('.cp-empty')).toBeVisible();
  await expect(page.locator('.cp-next, .cp-prev, .cp-nav')).toHaveCount(0);        // no Prev / Next at all
  await page.getByRole('tab', { name: 'Female' }).click();
  await page.locator('.cp-card').first().click();    // picking a character opens page 2 by itself: the poses of Maya
  await check(3);
  await expect(page.locator('.cp-card').first().locator('b, small')).toBeVisible();
});
