import { createHmac } from 'node:crypto';

import { type Browser, type Page, expect, test } from '@playwright/test';

/** Two-factor authentication: TOTP setup, the second sign-in step, resets and roles (0.8). */
test.describe.configure({ mode: 'serial' });

const ADMIN = { email: 'ada@example.com', password: 'correct horse 1' };
const MEMBER = { email: 'tess@example.com', password: 'tess password 1' };

/** Signs in as the first administrator (registering it when the database is new). */
async function signIn(page: Page): Promise<void> {
  await page.goto('/admin/');
  const register = page.getByRole('button', { name: 'Create account' });
  const login = page.getByRole('button', { name: 'Log in' });
  await expect(register.or(login)).toBeVisible();
  if (await register.isVisible()) {
    await page.getByLabel('First name').fill('Ada');
    await page.getByLabel('Email').fill(ADMIN.email);
    await page.getByLabel('Password').fill(ADMIN.password);
    await page.getByRole('button', { name: 'Create account' }).click();
  } else {
    await page.getByLabel('Email').fill(ADMIN.email);
    await page.getByLabel('Password', { exact: true }).fill(ADMIN.password);
    await page.getByRole('button', { name: 'Log in' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Hello, Ada' })).toBeVisible();
}

async function admin(page: Page) {
  const refreshed = await page.request.post('/admin/api/auth/refresh', {
    headers: { 'x-verdin-csrf': '1' },
  });
  const headers = { authorization: `Bearer ${(await refreshed.json()).data.accessToken}` };
  return {
    get: (path: string) => page.request.get(`/admin/api${path}`, { headers }),
    post: (path: string, data: unknown) =>
      page.request.post(`/admin/api${path}`, { headers, data }),
    put: (path: string, data: unknown) => page.request.put(`/admin/api${path}`, { headers, data }),
  };
}

async function freshPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ locale: 'en-US' });
  return context.newPage();
}

/** RFC 6238 (SHA-1, 6 digits, 30 s) for a base32 secret. */
function totp(secret: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.replace(/[\s=]/g, '').toUpperCase())
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const hmac = createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const value = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return value.toString().padStart(6, '0');
}

async function logIn(page: Page, account: { email: string; password: string }): Promise<void> {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Log in' }).click();
}

let roleId = 0;
let recoveryCodes: string[] = [];

test('an admin sets up an authenticator app and signs in with a second step', async ({
  page,
  browser,
}) => {
  await signIn(page);
  const api = await admin(page);
  const role = await api.post('/roles', { code: 'two-factor-team', name: '2FA team' });
  expect(role.status(), await role.text()).toBeLessThan(300);
  roleId = (await role.json()).data.id;
  const user = await api.post('/users', {
    email: MEMBER.email,
    password: MEMBER.password,
    firstname: 'Tess',
    roles: [roleId],
    isActive: true,
  });
  expect(user.status(), await user.text()).toBe(201);

  const member = await freshPage(browser);
  await logIn(member, MEMBER);
  await expect(member.getByRole('heading', { name: 'Hello, Tess' })).toBeVisible();
  await member.goto('/admin/profile');
  const section = member.getByTestId('two-factor');
  await expect(section.getByText('Off', { exact: true })).toBeVisible();
  await section.getByRole('button', { name: 'Set up' }).click();

  const dialog = member.getByRole('dialog');
  await dialog.getByLabel('Current password').fill(MEMBER.password);
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(
    dialog.getByRole('img', { name: 'QR code for your authenticator app' }),
  ).toBeVisible();
  const secret = (await dialog.getByTestId('totp-secret').inputValue()).replace(/\s/g, '');
  // A wrong code first, then the right one (sent on the sixth digit).
  await dialog.getByLabel('6-digit code').fill(totp(secret, Date.now() - 10 * 60_000));
  await expect(dialog.getByText('That code is not valid.', { exact: false })).toBeVisible();
  await dialog.getByLabel('6-digit code').fill(totp(secret));
  await expect(dialog.getByRole('heading', { name: 'Your recovery codes' })).toBeVisible();
  recoveryCodes = await dialog.getByTestId('recovery-codes').locator('li').allTextContents();
  expect(recoveryCodes).toHaveLength(10);
  await dialog.getByRole('button', { name: 'I saved them' }).click();
  await expect(section.getByText('10 codes left', { exact: false })).toBeVisible();

  // Signing in again takes a second step; a recovery code works once.
  const again = await freshPage(browser);
  await logIn(again, MEMBER);
  await expect(again.getByTestId('two-factor-step')).toBeVisible();
  await expect(again.getByLabel('Authentication code')).toBeFocused();
  await again.getByRole('button', { name: 'Use a recovery code' }).click();
  await again.getByLabel('Recovery code').fill('not-a-code');
  await again.getByRole('button', { name: 'Verify' }).click();
  await expect(
    again.getByText('That recovery code is not valid or was already used.'),
  ).toBeVisible();
  await again.getByLabel('Recovery code').fill(recoveryCodes[0].trim());
  await again.getByRole('button', { name: 'Verify' }).click();
  await expect(again.getByRole('heading', { name: 'Hello, Tess' })).toBeVisible();

  // The users list shows who signs in with a second factor.
  await page.goto('/admin/settings/users');
  const row = page.getByRole('row').filter({ hasText: MEMBER.email });
  await expect(row.getByTestId('user-two-factor')).toBeVisible();
});

test('a role that requires a second factor sends its members to their profile', async ({
  page,
  browser,
}) => {
  await signIn(page);
  await page.goto('/admin/settings/users');
  const row = page.getByRole('row').filter({ hasText: MEMBER.email });
  await row
    .getByRole('button', { name: `Reset two-factor authentication for ${MEMBER.email}` })
    .click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Reset two-factor' }).click();
  await expect(page.getByText(`Two-factor authentication reset for ${MEMBER.email}`)).toBeVisible();
  await expect(row.getByTestId('user-two-factor')).toHaveCount(0);

  await page.goto('/admin/settings/roles');
  await page.getByRole('button', { name: /^2FA team/ }).click();
  await page.getByLabel('Require two-factor authentication').click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Role saved').first()).toBeVisible();
  const api = await admin(page);
  const saved = (await (await api.get(`/roles/${roleId}`)).json()).data;
  expect(saved.requireTwoFactor).toBe(true);

  const member = await freshPage(browser);
  await logIn(member, MEMBER);
  await expect(member).toHaveURL(/\/admin\/profile#two-factor$/);
  await expect(member.getByTestId('two-factor-banner')).toBeVisible();
  await expect(member.getByTestId('two-factor-required')).toBeVisible();
  // Other pages are out of reach until a factor is set up.
  await member.goto('/admin/media');
  await expect(member).toHaveURL(/\/admin\/profile#two-factor$/);

  await api.put(`/roles/${roleId}`, { requireTwoFactor: false });
});
