import { type APIRequestContext, type Page, expect, test } from '@playwright/test';

/** Audit logs, releases, preview, plugin settings forms and single sign-on (0.6). */
test.describe.configure({ mode: 'serial' });

const ADMIN = { email: 'ada@example.com', password: 'correct horse 1' };

/** Signs in as the first administrator (registering it when the database is new). */
async function signIn(page: Page): Promise<void> {
  await page.goto('/admin/');
  // A new browser context has no session: the guard sends it to the login (or first run) page.
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

/** The admin access token the page holds (it lives in memory, so ask the API). */
async function token(page: Page): Promise<string> {
  const response = await page.request.post('/admin/api/auth/refresh', {
    headers: { 'x-verdin-csrf': '1' },
  });
  return (await response.json()).data.accessToken;
}

async function admin(page: Page) {
  const headers = { authorization: `Bearer ${await token(page)}` };
  const request: APIRequestContext = page.request;
  return {
    get: (path: string) => request.get(`/admin/api${path}`, { headers }),
    post: (path: string, data: unknown) => request.post(`/admin/api${path}`, { headers, data }),
    put: (path: string, data: unknown) => request.put(`/admin/api${path}`, { headers, data }),
  };
}

/** A draft-and-publish type for these tests (created once). */
async function ensureMemoType(page: Page): Promise<void> {
  const api = await admin(page);
  const types = (await (await api.get('/content-types')).json()).data as { uid: string }[];
  if (types.some((type) => type.uid === 'api::memo')) return;
  const applied = await api.post('/schema/apply', {
    contentTypes: {
      memo: {
        kind: 'collectionType',
        singularName: 'memo',
        pluralName: 'memos',
        displayName: 'Memo',
        options: { draftAndPublish: true },
        attributes: { title: { type: 'string' }, slug: { type: 'string' } },
      },
    },
    components: {},
    renameTables: [],
    renameColumns: [],
    allow: 'safe',
  });
  expect(applied.status(), await applied.text()).toBeLessThan(300);
}

async function createMemo(page: Page, title: string): Promise<string> {
  const api = await admin(page);
  const created = await api.post('/content/api::memo', {
    data: { title, slug: title.toLowerCase().replace(/\s+/g, '-') },
  });
  expect(created.status(), await created.text()).toBeLessThan(300);
  return (await created.json()).data.documentId;
}

test('audit logs list sign-ins and content changes', async ({ page }) => {
  await signIn(page);
  await ensureMemoType(page);
  await createMemo(page, 'Audited memo');

  await page.goto('/admin/');
  await page.getByRole('link', { name: 'Audit logs' }).click();
  await expect(page.getByRole('heading', { name: 'Audit logs', level: 1 })).toBeVisible();
  const table = page.getByRole('table');
  await expect(table.getByRole('button', { name: 'admin.login' }).first()).toBeVisible();

  // Quick filter: content changes only.
  await page.getByRole('button', { name: /^Content/ }).click();
  await expect(page.getByLabel('Action')).toHaveValue('entry.*');
  await expect(table.getByRole('button', { name: 'entry.create' }).first()).toBeVisible();
  await expect(table.getByRole('button', { name: 'admin.login' })).toHaveCount(0);

  // Details on demand.
  await table.getByRole('button', { name: 'Details of entry.create' }).first().click();
  await expect(table.getByText('When')).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/audit-logs.png' });

  // Free text: an exact action.
  await page.getByLabel('Action').fill('admin.login');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(table.getByRole('button', { name: 'entry.create' })).toHaveCount(0);
  await expect(table.getByRole('button', { name: 'admin.login' }).first()).toBeVisible();
});

test('a release publishes an entry added from the editor', async ({ page }) => {
  await signIn(page);
  await ensureMemoType(page);
  const documentId = await createMemo(page, 'Release me');
  const name = `Launch ${Date.now()}`;

  await page.goto('/admin/');
  await page.getByRole('link', { name: 'Releases', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Releases', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'New release' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  await expect(page.getByText('No entries yet')).toBeVisible();

  // The editor adds the entry to the release.
  await page.goto(`/admin/content/api::memo/${documentId}`);
  await expect(page.getByLabel('Title')).toHaveValue('Release me');
  await page.getByRole('button', { name: 'Add to release' }).click();
  await dialog.getByLabel('Release').selectOption({ label: name });
  await expect(dialog.getByLabel('Publish', { exact: true })).toBeChecked();
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText(`Added to ${name}`)).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/editor-releases.png' });

  // The release lists it; publish it now.
  await page.getByRole('link', { name }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Release me' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Memo', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Publish now' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Publish now' }).click();
  await expect(page.getByText(`Release ${name} published`)).toBeVisible();
  await expect(page.getByText('This release ran')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish now' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/screens/release.png' });

  const api = await admin(page);
  const live = await api.get(`/content/api::memo/${documentId}?status=published`);
  expect(live.status()).toBe(200);
  expect((await live.json()).data.publishedAt).toBeTruthy();
});

test('the editor opens a preview of the draft', async ({ page }) => {
  await signIn(page);
  await ensureMemoType(page);
  const documentId = await createMemo(page, 'Preview me');
  const api = await admin(page);
  const saved = await api.put('/features/preview', {
    enabled: true,
    settings: { urls: { 'api::memo': 'https://site.example/memos/{slug}' } },
  });
  expect(saved.status(), await saved.text()).toBe(200);

  await page.goto(`/admin/content/api::memo/${documentId}`);
  const button = page.getByRole('button', { name: 'Open preview' });
  await expect(button).toBeVisible();
  // The site: answer locally and keep the URL the editor opened.
  let previewed = '';
  await page.context().route('https://site.example/**', (route) => {
    previewed = route.request().url();
    return route.fulfill({ contentType: 'text/html', body: '<p>Preview</p>' });
  });
  const popup = page.waitForEvent('popup');
  await button.click();
  const opened = await popup;
  await expect
    .poll(() => previewed)
    .toMatch(/^https:\/\/site\.example\/memos\/preview-me\?preview=/);
  await opened.close();
  await api.put('/features/preview', { enabled: false, settings: null });
});

test('plugin settings use the form the plugin declares', async ({ page, request }) => {
  await signIn(page);
  const api = await admin(page);
  expect((await api.put('/plugins/sample', { enabled: true })).status()).toBe(200);

  await page.goto('/admin/settings/plugins');
  await page
    .locator('section[aria-labelledby="plugin-sample"]')
    .getByRole('button', { name: 'Settings' })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: /sample/ })).toBeVisible();
  await expect(dialog.getByLabel('Repeat')).toHaveValue('1');

  // Client-side checks mirror the manifest.
  await dialog.getByLabel('Greeting').fill('a greeting that is far too long');
  await dialog.getByLabel('Repeat').fill('9');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Use at most 20 characters.')).toBeVisible();
  await expect(dialog.getByText('Must be at most 5.')).toBeVisible();
  await expect(dialog.getByLabel('Greeting')).toHaveAttribute('aria-invalid', 'true');
  await page.screenshot({ path: 'test-results/screens/plugin-settings.png' });

  await dialog.getByLabel('Greeting').fill('Playwright');
  await dialog.getByLabel('Repeat').fill('3');
  await dialog.getByLabel('Shout').click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Settings of sample saved')).toBeVisible();
  await expect(dialog).toBeHidden();

  const plugins = (await (await api.get('/plugins')).json()).data.plugins as {
    name: string;
    settings: Record<string, unknown>;
  }[];
  expect(plugins.find((plugin) => plugin.name === 'sample')?.settings).toMatchObject({
    greeting: 'Playwright',
    times: 3,
    loud: true,
  });
  const hello = await request.get('/api/plugins/sample/hello');
  expect((await hello.json()).message).toBe('hello Playwright');

  // The server still refuses what the form would not send.
  const refused = await api.put('/plugins/sample', { enabled: true, settings: { times: 9 } });
  expect(refused.status()).toBe(400);
});

test('the login page offers the configured single sign-on providers', async ({ page, browser }) => {
  await signIn(page);
  const api = await admin(page);
  const saved = await api.put('/features/sso', {
    enabled: true,
    settings: {
      providers: [
        {
          id: 'corp',
          name: 'Corp account',
          issuer: 'https://login.example.com',
          clientId: 'verdin-e2e',
        },
      ],
    },
  });
  expect(saved.status(), await saved.text()).toBe(200);

  // The settings form shows what to register at the provider.
  await page.goto('/admin/settings/features');
  await page.getByRole('button', { name: 'Configure providers' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Button text')).toHaveValue('Corp account');
  await expect(dialog.getByText(/\/admin\/api\/auth\/sso\/corp\/callback$/)).toBeVisible();
  await expect(dialog.getByText('VERDIN_SSO_CORP_SECRET')).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/sso-settings.png' });
  await page.keyboard.press('Escape');

  const guest = await browser.newContext({ locale: 'en-US' });
  const login = await guest.newPage();
  const button = login.getByRole('link', { name: 'Continue with Corp account' });
  // The app is rebuilt after the switch: reload until the provider is listed.
  await expect
    .poll(
      async () => {
        await login.goto('/admin/login');
        await login.getByRole('heading', { name: 'Welcome back' }).waitFor();
        return button.count();
      },
      { timeout: 15_000 },
    )
    .toBe(1);
  await expect(button).toHaveAttribute('href', '/admin/api/auth/sso/corp');
  await login.screenshot({ path: 'test-results/screens/login-sso.png' });

  // A failed sign-in comes back with the reason.
  await login.goto('/admin/login?ssoError=no%20admin%20account%20for%20this%20identity');
  await expect(login.getByRole('alert')).toContainText('no admin account for this identity');
  await guest.close();

  await api.put('/features/sso', { enabled: false, settings: null });
});
