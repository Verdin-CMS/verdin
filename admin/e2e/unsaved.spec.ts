import { type APIRequestContext, type Page, expect, test } from '@playwright/test';

/** Unsaved edits, unpublishing and discarding a draft ask before losing work. */
test.describe.configure({ mode: 'serial' });

const ADMIN = { email: 'ada@example.com', password: 'correct horse 1' };

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
  };
}

/** A draft-and-publish collection type that only these tests use (created once). */
async function ensureLeafletType(page: Page): Promise<void> {
  const api = await admin(page);
  const types = (await (await api.get('/content-types')).json()).data as { uid: string }[];
  if (types.some((type) => type.uid === 'api::leaflet')) return;
  const applied = await api.post('/schema/apply', {
    contentTypes: {
      leaflet: {
        kind: 'collectionType',
        singularName: 'leaflet',
        pluralName: 'leaflets',
        displayName: 'Leaflet',
        options: { draftAndPublish: true },
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

test('leaving, unpublishing and discarding ask before losing work', async ({ page }) => {
  await signIn(page);
  await ensureLeafletType(page);
  const api = await admin(page);
  const created = await api.post('/content/api::leaflet', { data: { title: 'Spring sale' } });
  expect(created.status(), await created.text()).toBeLessThan(300);
  const documentId = (await created.json()).data.documentId as string;
  const published = await api.post(`/content/api::leaflet/${documentId}/actions/publish`, {});
  expect(published.status(), await published.text()).toBeLessThan(300);

  await page.goto(`/admin/content/api::leaflet/${documentId}`);
  const title = page.getByLabel('Title');
  await expect(title).toHaveValue('Spring sale');
  const confirm = page.getByRole('alertdialog');

  // Unsaved edits: leaving asks; staying keeps them.
  await title.fill('Summer sale');
  await page.getByRole('link', { name: 'Leaflet', exact: true }).first().click();
  await expect(confirm.getByText('Discard unsaved changes?')).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/content/api::leaflet/${documentId}`));
  await expect(title).toHaveValue('Summer sale');

  // Saved edits leave the form clean; discarding the draft asks, then restores the live one.
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await expect(confirm.getByText('Discard the draft?')).toBeVisible();
  await confirm.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.getByText('Changes discarded')).toBeVisible();
  await expect(title).toHaveValue('Spring sale');

  // Unpublishing asks too; cancelling keeps the entry published.
  await page.getByRole('button', { name: 'Unpublish' }).click();
  await expect(confirm.getByText('Unpublish this entry?')).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  await page.getByRole('button', { name: 'Unpublish' }).click();
  await confirm.getByRole('button', { name: 'Unpublish' }).click();
  await expect(page.getByText('Unpublished', { exact: true })).toBeVisible();

  // Nothing is unsaved after the discard: leaving goes straight to the list.
  await page.getByRole('link', { name: 'Leaflet', exact: true }).first().click();
  await expect(page).toHaveURL(/\/content\/api::leaflet$/);
  await expect(confirm).toHaveCount(0);

  // Discarding unsaved edits when leaving goes on to the list.
  await page.goto(`/admin/content/api::leaflet/${documentId}`);
  await expect(title).toHaveValue('Spring sale');
  await title.fill('Autumn sale');
  await page.getByRole('link', { name: 'Leaflet', exact: true }).first().click();
  await confirm.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page).toHaveURL(/\/content\/api::leaflet$/);
});
