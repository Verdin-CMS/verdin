import {
  type APIRequestContext,
  type Browser,
  type Page,
  expect,
  request as playwrightRequest,
  test,
} from '@playwright/test';

/** Admin accounts: invitations, sessions, API token rotation and locale-limited roles (0.8). */
test.describe.configure({ mode: 'serial' });

const ADMIN = { email: 'ada@example.com', password: 'correct horse 1' };
const BASE = 'http://localhost:1393';

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
  const request: APIRequestContext = page.request;
  return {
    get: (path: string) => request.get(`/admin/api${path}`, { headers }),
    post: (path: string, data: unknown) => request.post(`/admin/api${path}`, { headers, data }),
    put: (path: string, data: unknown) => request.put(`/admin/api${path}`, { headers, data }),
  };
}

type Api = Awaited<ReturnType<typeof admin>>;

/** French next to the default locale, and a localized `note` type (created once). */
async function ensureNotes(api: Api): Promise<void> {
  const locales = (await (await api.get('/i18n/locales')).json()).data as { code: string }[];
  if (!locales.some((locale) => locale.code === 'fr')) {
    const added = await api.post('/i18n/locales', { code: 'fr', name: 'French' });
    expect(added.status(), await added.text()).toBeLessThan(300);
  }
  const types = (await (await api.get('/content-types')).json()).data as { uid: string }[];
  if (types.some((type) => type.uid === 'api::note')) return;
  const applied = await api.post('/schema/apply', {
    contentTypes: {
      note: {
        kind: 'collectionType',
        singularName: 'note',
        pluralName: 'notes',
        displayName: 'Note',
        options: { draftAndPublish: false },
        pluginOptions: { i18n: { localized: true } },
        attributes: { title: { type: 'string' } },
      },
    },
    components: {},
    renameTables: [],
    renameColumns: [],
    allow: 'safe',
  });
  expect(applied.status(), await applied.text()).toBeLessThan(300);
}

/** Opens an admin panel link on the test server (the server builds it from its public URL). */
function onTestServer(url: string): string {
  const link = new URL(url);
  return `${BASE}${link.pathname}${link.search}`;
}

async function freshPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ locale: 'en-US' });
  return context.newPage();
}

test('an invited admin accepts the invitation and signs in', async ({ page, browser }) => {
  await signIn(page);
  await page.goto('/admin/settings/users');
  await page.getByRole('button', { name: 'Add user' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('First name').fill('Grace');
  await dialog.getByLabel('Email').fill('grace@example.com');
  // Inviting is the default: no password to type.
  await expect(dialog.getByLabel('Set a password now')).not.toBeChecked();
  await expect(dialog.getByLabel('Password', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Invite', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Invitation link' })).toBeVisible();
  // Whether it was emailed depends on the server's email provider (dev logs emails).
  await expect(page.getByText(/We emailed the link|The link was not emailed/)).toBeVisible();
  const link = await page.getByTestId('invite-url').inputValue();
  expect(link).toMatch(/\/admin\/auth\/accept-invitation\?token=/);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('cell', { name: /Grace grace@example\.com/ })).toBeVisible();

  const guest = await freshPage(browser);
  await guest.goto(onTestServer(link));
  await expect(guest.getByRole('heading', { name: 'Join the admin panel' })).toBeVisible();
  await expect(guest.getByLabel('Email')).toHaveValue('grace@example.com');
  await expect(guest.getByLabel('First name')).toHaveValue('Grace');
  await guest.getByLabel('Last name').fill('Hopper');
  await guest.getByLabel('New password').fill('grace password 1');
  await guest.getByLabel('Confirm the password').fill('grace password 2');
  await expect(guest.getByText('The passwords do not match.')).toBeVisible();
  await expect(guest.getByRole('button', { name: 'Create my account' })).toBeDisabled();
  await guest.getByLabel('Confirm the password').fill('grace password 1');
  await guest.getByRole('button', { name: 'Create my account' }).click();
  await expect(guest.getByRole('heading', { name: 'Hello, Grace' })).toBeVisible();

  // The link works once.
  const again = await freshPage(browser);
  await again.goto(onTestServer(link));
  await expect(again.getByText('This link does not work')).toBeVisible();
  await expect(again.getByRole('link', { name: 'Back to log in' })).toBeVisible();

  // A new invitation link from the users list replaces the old ones.
  await page.getByRole('button', { name: 'New invitation link for grace@example.com' }).click();
  await expect(page.getByRole('heading', { name: 'Invitation link' })).toBeVisible();
  const second = await page.getByTestId('invite-url').inputValue();
  expect(second).not.toBe(link);
  await page.getByRole('button', { name: 'Done' }).click();
});

test('the forgot password page answers the same for any email', async ({ browser }) => {
  const guest = await freshPage(browser);
  await guest.goto('/admin/login');
  await guest.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(guest).toHaveURL(/\/admin\/auth\/forgot-password$/);
  await guest.getByLabel('Email').fill('nobody@example.com');
  await guest.getByRole('button', { name: 'Send the link' }).click();
  await expect(guest.getByTestId('forgot-sent')).toContainText('If an account exists');
  // A reset link that is not valid says so.
  await guest.goto('/admin/auth/reset-password?token=nope');
  await guest.getByLabel('New password').fill('another password');
  await guest.getByLabel('Confirm the password').fill('another password');
  await guest.getByRole('button', { name: 'Change password' }).click();
  await expect(guest.getByText('This link does not work')).toBeVisible();
});

test('other sessions are signed out from the profile page', async ({ page }) => {
  await signIn(page);
  // Another device: a separate cookie jar signed in over the API.
  const other = await playwrightRequest.newContext({ baseURL: BASE });
  const login = await other.post('/admin/api/auth/login', { data: ADMIN });
  expect(login.status()).toBe(200);

  // The server tells this device apart by its refresh cookie.
  const listed = await (await admin(page)).get('/auth/sessions');
  const known = ((await listed.json()).data as { current: boolean }[]).some((item) => item.current);
  test.skip(!known, 'the server does not mark the current session (refresh cookie not sent)');

  await page.getByTestId('account-name').click();
  await page.getByRole('menuitem', { name: 'Profile' }).click();
  await expect(page).toHaveURL(/\/admin\/profile$/);
  await expect(page.getByRole('heading', { name: 'Profile', level: 1 })).toBeVisible();
  const sessions = page.getByTestId('session');
  await expect.poll(() => sessions.count()).toBeGreaterThan(1);
  await expect(sessions.first()).toContainText('This device');

  await page
    .getByRole('button', { name: /^Sign out (the other device|\d+ other devices)$/ })
    .click();
  const confirm = page.getByRole('alertdialog');
  await confirm.getByRole('button', { name: 'Sign out' }).click();
  await expect(sessions).toHaveCount(1);
  await expect(sessions.first()).toContainText('This device');

  // The other device's refresh token no longer works; this one still does.
  const refreshed = await other.post('/admin/api/auth/refresh', {
    headers: { 'x-verdin-csrf': '1' },
  });
  expect(refreshed.status()).toBe(401);
  await other.dispose();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Profile', level: 1 })).toBeVisible();
});

test('an API token is regenerated after confirming', async ({ page, request }) => {
  await signIn(page);
  const api = await admin(page);
  await ensureNotes(api);
  const created = await api.post('/api-tokens', {
    name: 'Rotating',
    description: null,
    kind: 'read-only',
    expiresInDays: null,
    permissions: [],
  });
  expect(created.status(), await created.text()).toBeLessThan(300);
  const oldKey = (await created.json()).data.accessKey as string;
  const read = (key: string) =>
    request.get('/api/notes', { headers: { authorization: `Bearer ${key}` } });
  expect((await read(oldKey)).status()).toBe(200);

  await page.goto('/admin/settings/tokens');
  await page.getByRole('button', { name: 'Regenerate Rotating' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('stops working immediately');
  await confirm.getByRole('button', { name: 'Regenerate' }).click();
  const dialog = page.getByRole('dialog');
  const newKey = await dialog.getByRole('textbox', { name: 'Token' }).inputValue();
  expect(newKey).not.toBe(oldKey);
  await dialog.getByRole('button', { name: 'Done' }).click();

  expect((await read(oldKey)).status()).toBe(401);
  expect((await read(newKey)).status()).toBe(200);
});

test('a role limited to French edits only the French versions', async ({ page, browser }) => {
  await signIn(page);
  const api = await admin(page);
  await ensureNotes(api);
  const english = await api.post('/content/api::note', { data: { title: 'Hello' } });
  expect(english.status(), await english.text()).toBe(201);
  const englishId = (await english.json()).data.documentId as string;
  const french = await api.post('/content/api::note?locale=fr', { data: { title: 'Bonjour' } });
  expect(french.status(), await french.text()).toBe(201);

  const permissions = ['content.read', 'content.create', 'content.update'].map((action) => ({
    action,
    subject: 'api::note',
    conditions: [],
  }));
  const role = await api.post('/roles', {
    code: 'french-editor',
    name: 'French editor',
    permissions,
  });
  expect(role.status(), await role.text()).toBeLessThan(300);
  const roleId = (await role.json()).data.id as number;

  // The role editor limits the type's permissions to French.
  await page.goto('/admin/settings/roles');
  await page.getByRole('button', { name: /^French editor/ }).click();
  await page.getByRole('button', { name: 'Locales of Note: All locales' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Only these locales').check();
  await expect(dialog.getByText('Choose at least one locale.')).toBeVisible();
  await dialog.getByRole('checkbox', { name: /French/ }).click();
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('button', { name: /^Locales of Note: fr$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Role saved').first()).toBeVisible();
  const saved = (await (await api.get(`/roles/${roleId}`)).json()).data as {
    permissions: { subject?: string; locales?: string[] }[];
  };
  const notes = saved.permissions.filter((permission) => permission.subject === 'api::note');
  expect(notes).toHaveLength(3);
  for (const permission of notes) expect(permission.locales).toEqual(['fr']);

  const user = await api.post('/users', {
    email: 'frida@example.com',
    password: 'frida password 1',
    firstname: 'Frida',
    roles: [roleId],
    isActive: true,
  });
  expect(user.status(), await user.text()).toBe(201);

  const editor = await freshPage(browser);
  await editor.goto('/admin/login');
  await editor.getByLabel('Email').fill('frida@example.com');
  await editor.getByLabel('Password', { exact: true }).fill('frida password 1');
  await editor.getByRole('button', { name: 'Log in' }).click();
  await expect(editor.getByRole('heading', { name: 'Hello, Frida' })).toBeVisible();

  // The list opens in French (the default locale is not granted) and English is disabled.
  await editor.goto('/admin/content/api::note');
  const locale = editor.locator('#list-locale');
  await expect(locale).toHaveValue('fr');
  await expect(locale.locator('option[value="en"]')).toBeDisabled();
  await expect(editor.getByText('Bonjour')).toBeVisible();
  await expect(editor.getByText('Hello', { exact: true })).toHaveCount(0);
  await expect(editor.getByRole('link', { name: 'Create' }).first()).toBeVisible();

  await editor.getByText('Bonjour').click();
  await expect(editor).toHaveURL(/[?&]locale=fr\b/);
  await editor.getByLabel('Title').fill('Bonjour à tous');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor.getByText('Saved', { exact: true }).first()).toBeVisible();

  // The English version is out of reach: the editor opens without a save button, the API says no.
  await editor.goto(`/admin/content/api::note/${englishId}?locale=en`);
  await expect(editor.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  const refreshed = await editor.request.post('/admin/api/auth/refresh', {
    headers: { 'x-verdin-csrf': '1' },
  });
  const token = (await refreshed.json()).data.accessToken as string;
  const denied = await editor.request.put(`/admin/api/content/api::note/${englishId}?locale=en`, {
    headers: { authorization: `Bearer ${token}` },
    data: { data: { title: 'Hi' } },
  });
  expect(denied.status()).toBe(403);
});
