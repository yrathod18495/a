import { test, expect } from '@playwright/test';

async function loginPage(page, identityReply) {
  const sent = [];
  await page.setViewportSize({ width: 900, height: 800 });
  await page.route('**/api/security', (r) => r.fulfill({ json: { maintenance: false } }));
  await page.route('**/api/r2', (r) => r.fulfill({ json: { configured: false } }));
  await page.route('https://identitytoolkit.googleapis.com/**', (r) => { sent.push([r.request().url(), r.request().postDataJSON()]); return r.fulfill(identityReply); });
  await page.route('https://securetoken.googleapis.com/**', (r) => r.fulfill({ status: 400, json: { error: { message: 'x' } } }));
  await page.goto('/#/login');
  await expect(page.getByRole('button', { name: /Continue with Google/ })).toBeVisible({ timeout: 20000 });
  return sent;
}

test('the login page has a temporary email + password form below the Google button', async ({ page }) => {
  await loginPage(page, { status: 400, json: { error: { message: 'INVALID_LOGIN_CREDENTIALS' } } });
  const form = page.locator('form.test-login');
  await expect(form).toBeVisible();
  await expect(form).toContainText('Test login'); await expect(form).toContainText('temporary');
  await expect(form.getByLabel('Email')).toHaveAttribute('type', 'email');
  await expect(form.getByLabel('Password')).toHaveAttribute('type', 'password');   // typed text is hidden
  const google = await page.getByRole('button', { name: /Continue with Google/ }).boundingBox(), box = await form.boundingBox();
  expect(box.y).toBeGreaterThan(google.y + google.height - 1);                       // below the Google button
});

test('empty fields are asked for first, and nothing is sent to the server', async ({ page }) => {
  const sent = await loginPage(page, { status: 400, json: {} });
  const form = page.locator('form.test-login');
  await form.getByRole('button', { name: 'Sign in' }).click();
  await expect(form.locator('.test-login-message')).toHaveText('Please enter your email address.');
  await form.getByLabel('Email').fill('test@gmail.com');
  await form.getByRole('button', { name: 'Sign in' }).click();
  await expect(form.locator('.test-login-message')).toHaveText('Please enter your password.');
  expect(sent).toEqual([]);
});

test('a wrong email or password shows a plain English message and the page stays on login', async ({ page }) => {
  const sent = await loginPage(page, { status: 400, json: { error: { code: 400, message: 'INVALID_LOGIN_CREDENTIALS', errors: [{ message: 'INVALID_LOGIN_CREDENTIALS' }] } } });
  const form = page.locator('form.test-login');
  await form.getByLabel('Email').fill('test@gmail.com'); await form.getByLabel('Password').fill('not-the-password');
  await form.getByRole('button', { name: 'Sign in' }).click();
  await expect(form.locator('.test-login-message')).toHaveText('The email or password is not correct. Please try again.');
  await expect(form.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  await expect(page).toHaveURL(/#\/login$/);
  // the credentials went to Firebase's sign-in service (and nowhere else of ours)
  expect(sent.length).toBe(1); expect(sent[0][0]).toContain('accounts:signInWithPassword'); expect(sent[0][1]).toMatchObject({ email: 'test@gmail.com', password: 'not-the-password' });
});
