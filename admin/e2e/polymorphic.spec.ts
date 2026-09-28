import { type APIRequestContext, type Page, expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { project } from '../playwright.config';

/**
 * Polymorphic relations (morphToOne / morphToMany and their inverse sides): owners edited in
 * the editor (picker, reorder, remove), inverse sides read-only, left out of list filters,
 * created and edited in the builder. Named to run after flow.spec.ts, which registers the
 * first admin.
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

test('the editor edits polymorphic links: add, reorder, remove, to-one', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  await signIn(page);
  const api = await ensureTypes(page);
  const tag = `M${Date.now()}`;
  const post = await create(api, 'api::ppost', { title: `Rust ${tag}` });
  const other = await create(api, 'api::ppage', { heading: `Home ${tag}` });
  const extra = await create(api, 'api::ppost', { title: `Zig ${tag}` });
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
  await expect(list.getByRole('listitem').first()).toContainText(`Rust ${tag}`);
  await expect(list.getByRole('listitem').nth(1)).toContainText('Plain page');
  await expect(list.getByRole('listitem').nth(1)).toContainText(`Home ${tag}`);
  const about = page.locator('[data-field="about"]');
  await expect(about.getByText('No linked entries')).toBeVisible();

  // Saving another field leaves the links as they are.
  await page.getByLabel('Text').fill(`Edited ${tag}`);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();
  const saved = await links(api, note);
  expect(saved.text).toBe(`Edited ${tag}`);
  expect(saved.refs).toEqual(before.refs);
  expect(saved.about).toBeNull();

  // Reorder with the keyboard-reachable buttons.
  await list.getByRole('button', { name: `Move Home ${tag} up` }).click();
  await expect(list.getByRole('listitem').first()).toContainText(`Home ${tag}`);

  // Add: pick a type, search it, check entries; linked ones are not offered again.
  await refs.getByRole('button', { name: 'Link entries' }).click();
  const picker = page.getByRole('dialog', { name: 'Link entries' });
  await picker.getByLabel('Content type').selectOption({ label: 'Post card' });
  await picker.getByLabel('Search entries').fill(tag);
  const results = picker.getByRole('list', { name: 'Post card entries' });
  await expect(results.getByRole('listitem')).toHaveCount(2);
  await expect(results.getByRole('checkbox', { name: `Rust ${tag}` })).toBeDisabled();
  await expect(results.getByRole('listitem').filter({ hasText: `Rust ${tag}` })).toContainText(
    'Linked',
  );
  await results.getByRole('checkbox', { name: `Zig ${tag}` }).click();
  await picker.getByRole('button', { name: 'Add 1 entry' }).click();
  await expect(picker).toBeHidden();
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await expect(list.getByRole('listitem').nth(2)).toContainText(`Zig ${tag}`);

  // Remove one.
  await list.getByRole('button', { name: `Remove Rust ${tag}` }).click();
  await expect(list.getByRole('listitem')).toHaveCount(2);

  // To-one: clicking a result links it and closes the picker.
  await about.getByRole('button', { name: 'Link an entry' }).click();
  const one = page.getByRole('dialog', { name: 'Link an entry' });
  await one.getByLabel('Content type').selectOption({ label: 'Plain page' });
  await one.getByLabel('Search entries').fill(tag);
  await one.getByRole('button', { name: `Home ${tag}` }).click();
  await expect(one).toBeHidden();
  const aboutList = about.getByRole('list', { name: 'About' });
  await expect(aboutList.getByRole('listitem')).toContainText('Plain page');
  await expect(aboutList.getByRole('listitem')).toContainText(`Home ${tag}`);
  await expect(about.getByRole('button', { name: 'Link an entry' })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/screens/polymorphic-editor.png' });

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();
  const after = await links(api, note);
  expect(after.refs).toEqual([`api::ppage:${other}`, `api::ppost:${extra}`]);
  expect(after.about).toMatchObject({ __type: 'api::ppage', documentId: other });

  // The to-one link is removed again; a reload shows what was saved.
  await aboutList.getByRole('button', { name: `Remove Home ${tag}` }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();
  expect((await links(api, note)).about).toBeNull();
  await page.reload();
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list.getByRole('listitem').nth(1)).toContainText(`Zig ${tag}`);
  expect(problems).toEqual([]);
});

test('inverse sides stay read-only and a save keeps the links', async ({ page }) => {
  await signIn(page);
  const api = await ensureTypes(page);
  const tag = `I${Date.now()}`;
  const post = await create(api, 'api::ppost', { title: `Rust ${tag}` });
  const note = await create(api, 'api::pnote', {
    text: `Note ${tag}`,
    refs: [{ __type: 'api::ppost', documentId: post }],
  });
  const before = await links(api, note);

  await page.goto(`/admin/content/api::ppost/${post}`);
  const field = page.locator('[data-field="notes"]');
  const notes = field.getByRole('list', { name: 'Notes' });
  await expect(notes.getByRole('link', { name: `Note ${tag}` })).toHaveAttribute(
    'href',
    `/admin/content/api::pnote/${note}`,
  );
  await expect(notes).toContainText('Pin note');
  await expect(
    field.getByText('Read-only: linked from the “refs” field of Pin note.'),
  ).toBeVisible();
  await expect(field.getByRole('button', { name: /Link/ })).toHaveCount(0);
  await page.getByLabel('Title').fill(`Rust edited ${tag}`);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();
  expect((await links(api, note)).refs).toEqual(before.refs);
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

test('the builder edits polymorphic fields and keeps them on save', async ({ page }) => {
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
  await expect(page.getByRole('button', { name: 'Edit refs' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove refs' })).toBeVisible();

  // An owner links any type: no target to choose.
  const dialog = page.getByRole('dialog');
  await page.getByRole('button', { name: 'Edit refs' }).click();
  await expect(dialog.getByLabel('Relation', { exact: true })).toHaveValue('morphToMany');
  await expect(dialog.locator('#relation-target')).toHaveCount(0);
  await expect(dialog.locator('[data-morph-owner-hint]')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // The inverse side names the owner type and attribute.
  await page.goto('/admin/builder/ppost');
  const inverse = page.getByRole('listitem').filter({ hasText: 'notes' });
  await expect(inverse.getByText('Polymorphic', { exact: true })).toBeVisible();
  await expect(inverse).toContainText('morphMany → api::pnote');
  await expect(inverse).toContainText('refs');

  // Adding an inverse side: the owner type, then its field of the matching kind.
  await page.goto('/admin/builder/ppage');
  await page.getByRole('button', { name: 'Add field' }).click();
  await dialog.getByLabel('Name').fill('mentions');
  await dialog.getByLabel('Type').selectOption('relation');
  await dialog.getByLabel('Relation', { exact: true }).selectOption('morphMany');
  await expect(dialog.locator('[data-field-issue]')).toHaveText('Choose the owner type.');
  await expect(dialog.getByRole('button', { name: 'Done' })).toBeDisabled();
  await dialog.getByLabel('Owner type').selectOption({ label: 'Pin note' });
  // `refs` is Pin note's only morphToMany field.
  await expect(dialog.getByLabel('Owner field')).toHaveValue('refs');
  await expect(
    dialog.getByLabel('Owner field').locator('option', { hasText: 'about' }),
  ).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('heading', { name: 'Review the migration' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Schema updated')).toBeVisible();
  const pageFile = JSON.parse(
    readFileSync(join(project, 'schema', 'content-types', 'ppage.json'), 'utf8'),
  );
  expect(pageFile.attributes.mentions).toEqual({
    type: 'relation',
    relation: 'morphMany',
    target: 'api::pnote',
    morphBy: 'refs',
  });

  // Adding a field saves the whole file: the polymorphic attributes stay as written.
  await page.goto('/admin/builder/pnote');
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
