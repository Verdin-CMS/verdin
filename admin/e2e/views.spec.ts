import { type APIRequestContext, type Page, expect, test } from '@playwright/test';
import { type AddressInfo } from 'node:net';
import { createServer } from 'node:http';

/**
 * Entry editor views, conditional fields and media tools (0.8). Named to run after
 * flow.spec.ts, which registers the first admin.
 */
test.describe.configure({ mode: 'serial' });

const ADMIN = { email: 'ada@example.com', password: 'correct horse 1' };

/** A 1×1 PNG and a 2×1 one (a different file for replacements). */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const WIDE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGP4z8AAQv8BD/kD/YURmXYAAAAASUVORK5CYII=',
  'base64',
);

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
    headers,
    get: (path: string) => request.get(`/admin/api${path}`, { headers }),
    post: (path: string, data: unknown) => request.post(`/admin/api${path}`, { headers, data }),
    delete: (path: string) => request.delete(`/admin/api${path}`, { headers }),
  };
}

type Api = Awaited<ReturnType<typeof admin>>;

/** `panel`: a title, a summary, a rank, a mode, and `extra` shown in the advanced mode. */
async function ensurePanel(page: Page): Promise<Api> {
  const api = await admin(page);
  const types = (await (await api.get('/content-types')).json()).data as { uid: string }[];
  if (types.some((type) => type.uid === 'api::panel')) return api;
  const applied = await api.post('/schema/apply', {
    contentTypes: {
      panel: {
        kind: 'collectionType',
        singularName: 'panel',
        pluralName: 'panels',
        displayName: 'Panel',
        options: { draftAndPublish: false },
        attributes: {
          title: { type: 'string' },
          summary: { type: 'text' },
          rank: { type: 'integer' },
          mode: { type: 'enumeration', enum: ['simple', 'advanced'] },
          extra: {
            type: 'string',
            required: true,
            conditions: { visible: { '==': [{ var: 'mode' }, 'advanced'] } },
          },
          code: { type: 'string', configurable: false },
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

/** Uploads a file through the admin API and returns it. */
async function upload(page: Page, api: Api, name: string, buffer: Buffer) {
  const response = await page.request.post('/admin/api/upload', {
    headers: api.headers,
    multipart: { files: { name, mimeType: 'image/png', buffer } },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).data[0] as { id: number; name: string; hash: string };
}

test('the entry editor follows a configured view', async ({ page }) => {
  await signIn(page);
  const api = await ensurePanel(page);
  await api.delete('/content-types/api::panel/edit-view');

  await page.goto('/admin/content/api::panel/new');
  await expect(page.getByLabel('Title')).toBeVisible();
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Configure the view' }).click();
  await expect(page.getByRole('heading', { name: 'Configure the view' })).toBeVisible();

  // Rank first, 4 columns, next to the title at 8 columns, labelled "Headline".
  await page.getByRole('button', { name: 'Move Rank earlier' }).click();
  await page.getByRole('button', { name: 'Move Rank earlier' }).click();
  await expect(page.getByText('Rank moved to position 1 of 6')).toBeAttached();
  await page.getByLabel('Width of Rank').selectOption('4');
  await page.getByLabel('Width of Title').selectOption('8');
  await page.getByRole('button', { name: 'Settings of Title' }).click();
  const dialog = page.getByRole('dialog', { name: 'Field title' });
  await dialog.getByLabel('Label').fill('Headline');
  await dialog.getByLabel('Description').fill('Shown on the home page.');
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('View saved')).toBeVisible();

  const stored = (await (await api.get('/content-types/api::panel/edit-view')).json()).data;
  expect(stored.layout[0]).toEqual([
    { name: 'rank', size: 4 },
    { name: 'title', size: 8 },
  ]);
  expect(stored.fields).toEqual({
    title: { label: 'Headline', description: 'Shown on the home page.' },
  });

  await page.getByRole('link', { name: 'Back to the editor' }).click();
  await expect(page).toHaveURL(/\/content\/api::panel\/new/);
  const headline = page.getByLabel('Headline');
  await expect(headline).toBeVisible();
  await expect(page.getByText('Shown on the home page.')).toBeVisible();
  const fields = page.locator('[data-field]');
  await expect(fields.first()).toHaveAttribute('data-field', 'rank');
  const rank = await page.locator('[data-field="rank"]').boundingBox();
  const title = await page.locator('[data-field="title"]').boundingBox();
  expect(rank && title).toBeTruthy();
  // Same row, a third and two thirds of it.
  expect(Math.abs(rank!.y - title!.y)).toBeLessThan(2);
  expect(title!.width / rank!.width).toBeGreaterThan(1.7);
  expect(title!.width / rank!.width).toBeLessThan(2.3);

  // Saving still works with the configured layout.
  await headline.fill('Configured');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/content\/api::panel\/[a-z0-9]+/);

  // Reset to default: every field on its own row again.
  await api.delete('/content-types/api::panel/edit-view');
  await page.reload();
  await expect(page.getByLabel('Title')).toHaveValue('Configured');
  await expect(page.locator('[data-field]').first()).toHaveAttribute('data-field', 'title');
});

test('a conditional field shows and hides as the form changes', async ({ page }) => {
  await signIn(page);
  const api = await ensurePanel(page);
  await api.delete('/content-types/api::panel/edit-view');

  await page.goto('/admin/content/api::panel/new');
  await page.getByLabel('Title').fill('Conditional');
  const extra = page.getByRole('textbox', { name: /^Extra/ });
  await expect(extra).toHaveCount(0);
  await page.getByLabel('Mode').selectOption('advanced');
  await expect(extra).toBeVisible();
  await extra.fill('Only for advanced panels');
  await page.getByLabel('Mode').selectOption('simple');
  await expect(extra).toHaveCount(0);

  // Hidden, the required field does not block saving (the server skips it too).
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/content\/api::panel\/[a-z0-9]+/);
  await page.getByLabel('Mode').selectOption('advanced');
  await expect(extra).toBeVisible();
});

test('the builder edits simple conditions and locks fields that are not configurable', async ({
  page,
}) => {
  await signIn(page);
  const api = await ensurePanel(page);

  await page.goto('/admin/builder/panel');
  // `code` is defined by code: listed, but it cannot be edited or removed.
  await expect(page.getByText('Not configurable')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit code' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Remove code' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit extra' })).toBeVisible();

  await page.getByRole('button', { name: 'Edit extra' }).click();
  const field = page.getByRole('dialog', { name: 'Edit field' });
  await expect(field.getByText('Show this field when')).toBeVisible();
  await expect(field.getByLabel('Field', { exact: true })).toHaveValue('mode');
  await expect(field.getByLabel('Value')).toHaveValue('advanced');
  await field.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Edit summary' }).click();
  await field.getByRole('button', { name: 'Add a condition' }).click();
  await field.getByLabel('Field', { exact: true }).selectOption('mode');
  await field.getByLabel('Comparison').selectOption('!=');
  await field.getByLabel('Value').selectOption('simple');
  await field.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Schema updated')).toBeVisible();

  const types = (await (await api.get('/content-types')).json()).data as {
    uid: string;
    attributes: Record<string, { conditions?: unknown; configurable?: boolean }>;
  }[];
  const panel = types.find((type) => type.uid === 'api::panel')!;
  expect(panel.attributes['summary'].conditions).toEqual({
    visible: { '!=': [{ var: 'mode' }, 'simple'] },
  });
  // Untouched attributes keep their condition and flags through the save.
  expect(panel.attributes['extra'].conditions).toEqual({
    visible: { '==': [{ var: 'mode' }, 'advanced'] },
  });
  expect(panel.attributes['code'].configurable).toBe(false);

  // The editor applies the new rule live.
  await page.goto('/admin/content/api::panel/new');
  const summary = page.getByRole('textbox', { name: /^Summary/ });
  await expect(summary).toBeVisible();
  await page.getByLabel('Mode').selectOption('simple');
  await expect(summary).toHaveCount(0);
});

test('a file is replaced in place, keeping its id', async ({ page }) => {
  await signIn(page);
  const api = await admin(page);
  const name = `replace-${Date.now()}.png`;
  const original = await upload(page, api, name, PNG);

  await page.goto('/admin/media');
  await page
    .getByRole('button', { name: `Open ${name}` })
    .first()
    .click();
  const sheet = page.getByRole('dialog', { name });
  await expect(sheet.getByRole('button', { name: 'Replace file' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Crop' })).toBeVisible();
  await sheet
    .locator('input[type="file"]')
    .setInputFiles({ name: 'wider.png', mimeType: 'image/png', buffer: WIDE_PNG });
  await expect(page.getByText('File replaced')).toBeVisible();

  const replaced = (await (await api.get(`/upload/files/${original.id}`)).json()).data;
  expect(replaced.id).toBe(original.id);
  expect(replaced.hash).not.toBe(original.hash);
  expect(replaced).toMatchObject({ width: 2, height: 1 });
});

test('a file is added from a URL into the current folder', async ({ page }) => {
  const server = createServer((request, response) => {
    if (request.url === '/pixel.png') {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(PNG);
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await signIn(page);
    const api = await admin(page);
    const folder = (
      await (
        await api.post('/upload/folders', { name: `Remote ${Date.now()}`, parent: null })
      ).json()
    ).data as { id: number };

    await page.goto(`/admin/media?folder=${folder.id}`);
    await page.getByRole('button', { name: 'Add from URL' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a file from a URL' });
    await dialog.getByLabel('URL').fill(`http://127.0.0.1:${port}/missing.png`);
    await dialog.getByRole('button', { name: 'Add file' }).click();
    // The server's reason shows in the dialog.
    await expect(dialog.getByText(/could not download the file/)).toBeVisible();

    await dialog.getByLabel('URL').fill(`http://127.0.0.1:${port}/pixel.png`);
    await dialog.getByLabel('Alternative text').fill('A remote pixel');
    await dialog.getByRole('button', { name: 'Add file' }).click();
    await expect(page.getByText('pixel.png added')).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open pixel.png' }).first()).toBeVisible();

    const files = (await (await api.get(`/upload/files?folder=${folder.id}`)).json()).data;
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      name: 'pixel.png',
      mime: 'image/png',
      alternativeText: 'A remote pixel',
      folder: folder.id,
    });
  } finally {
    server.close();
  }
});
