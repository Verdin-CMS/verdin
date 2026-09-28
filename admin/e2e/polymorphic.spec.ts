import { type APIRequestContext, type Page, expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { project } from '../playwright.config';

/**
 * Polymorphic relations (morphToOne / morphToMany and their inverse sides): read-only in the
 * editor, left out of list filters, listed read-only by the builder, and never overwritten
 * by a save. Named to run after flow.spec.ts, which registers the first admin.
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

/**
 * `pnote` owns the links (`about`: morphToOne, `refs`: morphToMany); `ppost` reads the notes
 * pointing at it (`notes`: morphMany by `refs`); `ppage` is another linkable type.
 */
async function ensureTypes(page: Page): Promise<Api> {
  const api = await admin(page);
  const types = (await (await api.get('/content-types')).json()).data as { uid: string }[];
  if (types.some((type) => type.uid === 'api::pnote')) return api;
  const type = (name: string, displayName: string, attributes: Record<string, unknown>) => ({
    kind: 'collectionType',
    singularName: name,
    pluralName: `${name}s`,
    displayName,
    options: { draftAndPublish: false },
    attributes,
  });
  const applied = await api.post('/schema/apply', {
    contentTypes: {
      pnote: type('pnote', 'Pin note', {
        text: { type: 'string' },
        about: { type: 'relation', relation: 'morphToOne' },
        refs: { type: 'relation', relation: 'morphToMany' },
      }),
      ppost: type('ppost', 'Post card', {
        title: { type: 'string' },
        notes: { type: 'relation', relation: 'morphMany', target: 'api::pnote', morphBy: 'refs' },
      }),
      ppage: type('ppage', 'Plain page', { heading: { type: 'string' } }),
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

async function links(api: Api, documentId: string) {
  const read = await api.get(`/content/api::pnote/${documentId}?populate=*`);
  expect(read.status(), await read.text()).toBe(200);
  const data = (await read.json()).data;
  return {
    text: data.text as string,
    about: data.about as { __type: string; documentId: string } | null,
    refs: (data.refs as { __type: string; documentId: string }[]).map(
      (item) => `${item.__type}:${item.documentId}`,
    ),
  };
}

test('the editor shows polymorphic links read-only and a save keeps them', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  await signIn(page);
  const api = await ensureTypes(page);
  const tag = `M${Date.now()}`;
  const post = await create(api, 'api::ppost', { title: `Rust ${tag}` });
  const other = await create(api, 'api::ppage', { heading: `Home ${tag}` });
  const note = await create(api, 'api::pnote', {
    text: `First ${tag}`,
    refs: [
      { __type: 'api::ppost', documentId: post },
      { __type: 'api::ppage', documentId: other },
    ],
  });
  const before = await links(api, note);
  expect(before.refs).toEqual([`api::ppost:${post}`, `api::ppage:${other}`]);
  expect(before.about).toBeNull();

  await page.goto(`/admin/content/api::pnote/${note}`);
  await expect(page.getByLabel('Text')).toHaveValue(`First ${tag}`);
  const refs = page.locator('[data-field="refs"]');
  const list = refs.getByRole('list', { name: 'Refs' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list.getByRole('listitem').first()).toContainText('Post card');
  await expect(list.getByRole('link', { name: `Rust ${tag}` })).toHaveAttribute(
    'href',
    `/admin/content/api::ppost/${post}`,
  );
  await expect(list.getByRole('listitem').nth(1)).toContainText('Plain page');
  await expect(list.getByRole('link', { name: `Home ${tag}` })).toBeVisible();
  await expect(refs.getByText('Polymorphic relation — managed through the API.')).toBeVisible();
  await expect(page.locator('[data-field="about"]').getByText('No linked entries')).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/polymorphic-editor.png' });

  // Saving another field leaves the links as they are (they are not sent back).
  await page.getByLabel('Text').fill(`Edited ${tag}`);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();
  const after = await links(api, note);
  expect(after.text).toBe(`Edited ${tag}`);
  expect(after.refs).toEqual(before.refs);
  expect(after.about).toBeNull();

  // The inverse side lists the note; saving the post is not rejected.
  await list.getByRole('link', { name: `Rust ${tag}` }).click();
  await expect(page).toHaveURL(new RegExp(`/content/api::ppost/${post}`));
  const notes = page.locator('[data-field="notes"]').getByRole('list', { name: 'Notes' });
  await expect(notes.getByRole('link', { name: `Edited ${tag}` })).toBeVisible();
  await expect(notes).toContainText('Pin note');
  await page.getByLabel('Title').fill(`Rust edited ${tag}`);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();
  expect((await links(api, note)).refs).toEqual(before.refs);
  expect(problems).toEqual([]);
});

test('lists leave polymorphic relations out of the filters', async ({ page }) => {
  await signIn(page);
  await ensureTypes(page);
  await page.goto('/admin/content/api::pnote');
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await page.getByRole('button', { name: 'Filters' }).click();
  const sheet = page.getByRole('dialog', { name: 'Filter entries' });
  const field = sheet.getByRole('group', { name: 'Condition 1' }).getByLabel('Field');
  await expect(field.locator('option', { hasText: 'Text' })).toHaveCount(1);
  await expect(field.locator('option', { hasText: /Refs|About/ })).toHaveCount(0);
});

test('the builder lists polymorphic fields read-only and keeps them on save', async ({ page }) => {
  await signIn(page);
  const api = await ensureTypes(page);
  const note = await create(api, 'api::pnote', {
    text: 'Kept',
    about: { __type: 'api::ppage', documentId: await create(api, 'api::ppage', { heading: 'X' }) },
  });
  const before = await links(api, note);

  await page.goto('/admin/builder/pnote');
  const refs = page.getByRole('listitem').filter({ hasText: 'refs' });
  await expect(refs.getByText('Polymorphic', { exact: true })).toBeVisible();
  await expect(refs.getByText('morphToMany', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit refs' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Remove refs' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit text' })).toBeVisible();

  // The inverse side names the owner type and attribute.
  await page.goto('/admin/builder/ppost');
  const inverse = page.getByRole('listitem').filter({ hasText: 'notes' });
  await expect(inverse.getByText('Polymorphic', { exact: true })).toBeVisible();
  await expect(inverse).toContainText('morphMany → api::pnote');
  await expect(inverse).toContainText('refs');

  // Adding a field saves the whole file: the polymorphic attributes stay as written.
  await page.goto('/admin/builder/pnote');
  const dialog = page.getByRole('dialog');
  await page.getByRole('button', { name: 'Add field' }).click();
  await dialog.getByLabel('Name').fill('mood');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('heading', { name: 'Review the migration' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Schema updated')).toBeVisible();
  const file = JSON.parse(
    readFileSync(join(project, 'schema', 'content-types', 'pnote.json'), 'utf8'),
  );
  expect(file.attributes.about).toEqual({ type: 'relation', relation: 'morphToOne' });
  expect(file.attributes.refs).toEqual({ type: 'relation', relation: 'morphToMany' });
  expect(file.attributes.mood).toEqual({ type: 'string' });
  expect(await links(api, note)).toEqual(before);
});
