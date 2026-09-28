import { type APIRequestContext, type Page, expect, test } from '@playwright/test';

/** Review workflows and right-to-left languages (0.7). */
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

/** A draft-and-publish type that only these tests use (created once). */
async function ensureStoryType(page: Page): Promise<void> {
  const api = await admin(page);
  const types = (await (await api.get('/content-types')).json()).data as { uid: string }[];
  if (types.some((type) => type.uid === 'api::story')) return;
  const applied = await api.post('/schema/apply', {
    contentTypes: {
      story: {
        kind: 'collectionType',
        singularName: 'story',
        pluralName: 'stories',
        displayName: 'Story',
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

async function setReview(page: Page, enabled: boolean): Promise<void> {
  const api = await admin(page);
  const saved = await api.put('/features/review', { enabled, settings: null });
  expect(saved.status(), await saved.text()).toBe(200);
  // The server rebuilds its routes: wait until the workflows API follows the switch.
  await expect
    .poll(async () => (await api.get('/review-workflows')).status())
    .toBe(enabled ? 200 : 404);
}

test('a review workflow holds publishing until its stage', async ({ page }) => {
  await signIn(page);
  await ensureStoryType(page);
  await setReview(page, true);
  const api = await admin(page);
  const roles = (await (await api.get('/roles')).json()).data as { code: string; name: string }[];
  const superAdmin = roles.find((role) => role.code === 'super-admin')!;
  const name = `Editorial ${Date.now()}`;

  // Settings → Review workflows: a new workflow (it starts with three stages).
  await page.goto('/admin/');
  await page.getByRole('link', { name: 'Review workflows' }).click();
  await expect(page.getByRole('heading', { name: 'Review workflows', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'New workflow' }).first().click();
  await expect(page.getByRole('heading', { name: 'New workflow', level: 1 })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(name);
  const stages = page.getByRole('listitem', { name: /^Stage \d$/ });
  await expect(stages).toHaveCount(3);
  // Reorder with the keyboard-accessible buttons, then back.
  await page.getByRole('button', { name: 'Move Ready up' }).click();
  await expect(stages.nth(1).getByLabel('Stage name')).toHaveValue('Ready');
  await page.getByRole('button', { name: 'Move Ready down' }).click();
  await expect(stages.nth(2).getByLabel('Stage name')).toHaveValue('Ready');
  // Only super admins move entries to "Ready", and publishing needs it.
  const onlySuperAdmins = stages.nth(2).getByLabel(superAdmin.name);
  await onlySuperAdmins.click();
  await expect(onlySuperAdmins).toBeChecked();
  await page.getByLabel('Required stage to publish').selectOption({ label: 'Ready' });
  await page.getByLabel('Story').click();
  await expect(page.getByLabel('Story')).toBeChecked();
  await page.screenshot({ path: 'test-results/screens/review-workflow.png' });
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText(`Workflow ${name} created`)).toBeVisible();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();

  const workflows = (await (await api.get('/review-workflows')).json()).data as {
    name: string;
    publishStageId: number;
    stages: { id: number; name: string; roles: string[] }[];
  }[];
  const saved = workflows.find((workflow) => workflow.name === name)!;
  const ready = saved.stages.find((stage) => stage.name === 'Ready')!;
  expect(saved.publishStageId).toBe(ready.id);
  expect(ready.roles).toEqual(['super-admin']);

  // A new entry starts at the first stage: the list shows it.
  const created = await api.post('/content/api::story', { data: { title: 'Under review' } });
  expect(created.status(), await created.text()).toBeLessThan(300);
  const documentId = (await created.json()).data.documentId as string;
  await page.goto('/admin/content/api::story');
  await expect(page.getByRole('columnheader', { name: 'Stage' })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'Under review' });
  await expect(row.getByText('To do')).toBeVisible();

  // The editor: the Review card, and publishing refused before "Ready".
  await row.click();
  await expect(page.getByLabel('Title')).toHaveValue('Under review');
  const card = page.locator('section[aria-labelledby="entry-review-title"]');
  await expect(card.getByRole('heading', { name: 'Review' })).toBeVisible();
  await expect(card.getByLabel('Stage')).toHaveValue(String(saved.stages[0].id));
  await expect(card.getByText('can be published once it is in the “Ready” stage')).toBeVisible();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(
    page.getByText('the entry must be in the review stage `Ready` to be published'),
  ).toBeVisible();

  // Assign it to me, then move it to "Ready": publishing goes through.
  await card.getByLabel('Assignee').selectOption({ label: 'Ada · you' });
  await expect(page.getByText('Assignee updated')).toBeVisible();
  await card.getByLabel('Stage').selectOption({ label: 'Ready' });
  await expect(page.getByText('Moved to Ready')).toBeVisible();
  await expect(card.getByText('can be published once')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/screens/review-editor.png' });
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published', { exact: true }).first()).toBeVisible();
  const live = await api.get(`/content/api::story/${documentId}?status=published`);
  expect(live.status()).toBe(200);

  // Home: assigned to me.
  await page.goto('/admin/');
  const assigned = page.locator('section[aria-labelledby="assigned-review-title"]');
  await expect(assigned.getByRole('heading', { name: 'Assigned to me' })).toBeVisible();
  await expect(assigned.getByRole('link', { name: /Under review/ })).toBeVisible();

  await setReview(page, false);
});

test('Arabic turns the interface right to left', async ({ page }) => {
  await signIn(page);
  const html = page.locator('html');
  await expect(html).toHaveAttribute('dir', 'ltr');

  await page.getByRole('button', { name: 'Preferences' }).click();
  await page.getByRole('menuitem', { name: /^Language/ }).hover();
  await page.getByRole('menuitemradio', { name: 'العربية' }).click();
  await expect(html).toHaveAttribute('dir', 'rtl');
  await expect(html).toHaveAttribute('lang', 'ar');
  // The sidebar moves to the right-hand side.
  const sidebar = page.locator('[data-slot="sidebar-container"]').first();
  const box = await sidebar.boundingBox();
  const width = page.viewportSize()!.width;
  if (box) expect(box.x + box.width).toBeGreaterThan(width - 4);
  // The choice is kept: a reload starts in Arabic, right to left.
  await page.reload();
  await expect(html).toHaveAttribute('dir', 'rtl');
  await page.goto('/admin/settings/users');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/rtl-page.png', fullPage: true });

  // The menu may still be open (now in Arabic) after choosing a language.
  const language = page.getByRole('menuitem', { name: /^اللغة/ });
  if (!(await language.isVisible())) await page.getByRole('button', { name: 'التفضيلات' }).click();
  await language.hover();
  await page.getByRole('menuitemradio', { name: 'English' }).click();
  await expect(html).toHaveAttribute('dir', 'ltr');
  await expect(html).toHaveAttribute('lang', 'en');
});
