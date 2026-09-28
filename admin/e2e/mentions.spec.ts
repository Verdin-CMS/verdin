import { type APIRequestContext, type Page, expect, test } from '@playwright/test';

/** Comments, tasks and realtime changes in the entry editor (0.8). */
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

/** A collection type that only these tests use (created once). */
async function ensureNoteType(page: Page): Promise<void> {
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
        options: { draftAndPublish: false },
        attributes: { title: { type: 'string' }, body: { type: 'text' } },
      },
    },
    components: {},
    renameTables: [],
    renameColumns: [],
    allow: 'safe',
  });
  expect(applied.status(), await applied.text()).toBeLessThan(300);
}

test('comments, mentions and tasks on an entry', async ({ page }) => {
  await signIn(page);
  await ensureNoteType(page);
  const api = await admin(page);
  const created = await api.post('/content/api::memo', { data: { title: 'Launch plan' } });
  expect(created.status(), await created.text()).toBeLessThan(300);
  const documentId = (await created.json()).data.documentId as string;

  await page.goto(`/admin/content/api::memo/${documentId}`);
  await expect(page.getByLabel('Title')).toHaveValue('Launch plan');

  // A thread on the Title field, with a mention picked from the @ list.
  await page.getByRole('button', { name: 'Comment on Title' }).click();
  const panel = page.getByRole('dialog');
  await expect(panel.getByText('About Title')).toBeVisible();
  const composer = panel.getByRole('combobox', { name: 'New comment on Title' });
  await expect(composer).toBeFocused();
  await composer.pressSequentially('Check this @Ad');
  await expect(panel.getByRole('option', { name: /Ada/ })).toBeVisible();
  await composer.press('Enter');
  await expect(composer).toHaveValue(/Check this @\[Ada[^\]]*\]\(user:\d+\) /);
  await composer.press('ControlOrMeta+Enter');
  await expect(panel.getByText('@Ada')).toBeVisible();
  await expect(composer).toHaveValue('');

  // A reply, then resolving the thread.
  await panel.getByRole('button', { name: 'Reply', exact: true }).click();
  await panel.getByRole('combobox', { name: /Reply to/ }).fill('Done, thanks');
  await panel.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(panel.getByText('Done, thanks')).toBeVisible();
  await panel.getByRole('button', { name: 'Resolve' }).click();
  await expect(panel.getByRole('button', { name: '1 resolved thread' })).toBeVisible();

  // A task, assigned to me, marked done.
  await panel.getByRole('tab', { name: /Tasks/ }).click();
  await panel.getByRole('button', { name: 'New task' }).click();
  await panel.getByLabel('Title').fill('Proofread');
  await panel.getByLabel('Assignee').selectOption({ label: 'Ada (you)' });
  await panel.getByRole('button', { name: 'Create task' }).click();
  await expect(page.getByText('Task created')).toBeVisible();
  const mine = (await (await api.get('/tasks?mine=true&status=open')).json()).data as {
    title: string;
  }[];
  expect(mine.map((task) => task.title)).toContain('Proofread');
  await panel.getByLabel('Proofread').click();
  await expect(panel.getByLabel('Proofread')).toBeChecked();
  await page.keyboard.press('Escape');

  // Another session changes the entry: the editor offers to reload.
  const changed = await api.put(`/content/api::memo/${documentId}`, {
    data: { title: 'Launch plan v2' },
  });
  expect(changed.status(), await changed.text()).toBeLessThan(300);
  await expect(page.getByText('Another admin updated this entry')).toBeVisible();
  await page.getByRole('button', { name: 'Reload' }).click();
  await expect(page.getByLabel('Title')).toHaveValue('Launch plan v2');
});
