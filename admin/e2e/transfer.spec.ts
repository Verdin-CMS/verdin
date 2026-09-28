import { type APIRequestContext, type Page, expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

/**
 * Content tools: full-text search in the list, CSV export and import, and "where used"
 * (in the editor and before deleting). Named to run after flow.spec.ts, which registers
 * the first admin.
 */
test.describe.configure({ mode: 'serial' });

const ADMIN = { email: 'ada@example.com', password: 'correct horse 1' };

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
  };
}

type Api = Awaited<ReturnType<typeof admin>>;

/** `crate` (a name, a note) and `shelf` (a name, crates), created once. */
async function ensureTypes(page: Page): Promise<Api> {
  const api = await admin(page);
  const types = (await (await api.get('/content-types')).json()).data as { uid: string }[];
  if (types.some((type) => type.uid === 'api::crate')) return api;
  const applied = await api.post('/schema/apply', {
    contentTypes: {
      crate: {
        kind: 'collectionType',
        singularName: 'crate',
        pluralName: 'crates',
        displayName: 'Crate',
        options: { draftAndPublish: false },
        attributes: { name: { type: 'string' }, note: { type: 'text' } },
      },
      shelf: {
        kind: 'collectionType',
        singularName: 'shelf',
        pluralName: 'shelves',
        displayName: 'Shelf',
        options: { draftAndPublish: false },
        attributes: {
          name: { type: 'string' },
          crates: { type: 'relation', relation: 'manyWay', target: 'api::crate' },
        },
      },
    },
    components: {},
    renameTables: [],
    renameColumns: [],
    allow: 'safe',
  });
  expect(applied.status(), await applied.text()).toBeLessThan(300);
  return api;
}

async function create(api: Api, uid: string, data: Record<string, unknown>): Promise<string> {
  const created = await api.post(`/content/${uid}`, { data });
  expect(created.status(), await created.text()).toBe(201);
  return (await created.json()).data.documentId;
}

test('the list searches all text fields and keeps the search in the URL', async ({ page }) => {
  await signIn(page);
  const api = await ensureTypes(page);
  const word = `zephyr${Date.now()}`;
  await create(api, 'api::crate', { name: 'Apples', note: `fresh ${word} apples` });
  await create(api, 'api::crate', { name: 'Pears', note: 'ripe pears' });

  await page.goto('/admin/content/api::crate');
  await page.getByRole('searchbox', { name: 'Search' }).fill(word);
  await expect(page).toHaveURL(new RegExp(`_q=${word}`));
  await expect(page.getByRole('cell', { name: 'Apples' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Pears' })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('searchbox', { name: 'Search' })).toHaveValue(word);
  await expect(page.getByRole('cell', { name: 'Apples' })).toBeVisible();
});

test('the list exports to CSV and imports a CSV file after a check', async ({ page }) => {
  await signIn(page);
  const api = await ensureTypes(page);
  await create(api, 'api::crate', { name: `Export me ${Date.now()}` });

  await page.goto('/admin/content/api::crate');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Export as CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^crates-.*\.csv$/);
  const text = await readFile(await file.path(), 'utf8');
  expect(text.split(/\r?\n/)[0]).toBe('documentId,name,note');
  expect(text).toContain('Export me');

  const stamp = Date.now();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('File').setInputFiles({
    name: 'crates.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(`Name,Label,extra\nImported ${stamp} A,x,1\nImported ${stamp} B,y,2\n`),
  });
  await expect(dialog.getByText('crates.csv: 2 rows, 3 columns')).toBeVisible();
  // `Name` is matched to `name`; the others are skipped.
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('name');
  await expect(dialog.getByLabel('extra')).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();

  await dialog.getByRole('button', { name: 'Check' }).click();
  await expect(dialog.getByRole('heading', { name: /Check result/ })).toBeFocused();
  await expect(dialog.getByText('Every row passed. You can import the file.')).toBeVisible();
  expect(
    (await (await api.get(`/content/api::crate?_q=Imported ${stamp}`)).json()).data,
  ).toHaveLength(0);

  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Import finished' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).first().click();
  await expect(page.getByRole('cell', { name: `Imported ${stamp} A` })).toBeVisible();
});

test('the editor shows where an entry is used and deleting warns about it', async ({ page }) => {
  await signIn(page);
  const api = await ensureTypes(page);
  const crate = await create(api, 'api::crate', { name: `Used crate ${Date.now()}` });
  const shelf = `Shelf ${Date.now()}`;
  await create(api, 'api::shelf', { name: shelf, crates: [crate] });

  await page.goto(`/admin/content/api::crate/${crate}`);
  const toggle = page.getByRole('button', { name: /Used in/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toContainText('1');
  await toggle.click();
  await expect(page.getByRole('link', { name: shelf })).toBeVisible();
  await expect(page.getByText('In crates')).toBeVisible();

  await page.getByRole('button', { name: 'Delete' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm.getByText('Used in 1 place')).toBeVisible();
  await expect(confirm.getByText(new RegExp(`${shelf} \\(Shelf, crates\\)`))).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
});
