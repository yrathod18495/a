import { test, expect } from '@playwright/test';
// A character that was just added plays the plain idle animation ("stand"), not a random one from the idle list.
test('the default animation is the plain idle / stand animation', async ({ page }) => {
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.goto('/?debug#/hub');
  const r = await page.evaluate(async () => {
    const { idleRef } = await import('/src/catalog.js');
    const mk = (names) => ({ category: 'test', cloudAnims: names.map((n) => ({ name: n, label: n, length: 3, file: { db: 'a'.repeat(64) } })) });
    return {
      listed: idleRef(mk(['think', 'bored', 'stand', 'yawn', 'walk']))?.name,                    // 'think' comes first in the list but is not the idle
      idleName: idleRef(mk(['think', 'idle', 'sad']))?.name,
      onlyOther: idleRef(mk(['yawn', 'think']))?.name,                                          // nothing called stand / idle: the first idle-type animation
      none: idleRef(mk(['walk', 'run'])),
    };
  });
  expect(r.listed).toBe('stand'); expect(r.idleName).toBe('idle'); expect(r.onlyOther).toBe('yawn'); expect(r.none).toBeNull();
});
