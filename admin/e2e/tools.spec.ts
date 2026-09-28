import { type APIRequestContext, type Page, expect, test } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

import { project } from '../playwright.config';

/**
 * Content tools (0.8): password fields, duplicating entries, list filters, relations and the
 * side-by-side preview. Named to run after flow.spec.ts, which registers the first admin.
 */
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
    put: (path: string, data: unknown) => request.put(`/admin/api${path}`, { headers, data }),
  };
}

type Api = Awaited<ReturnType<typeof admin>>;

/** `gadget` (a password, a uid, a rank, a kind, parts) and `part`, created once. */
async function ensureTypes(page: Page): Promise<Api> {
  const api = await admin(page);
  const types = (await (await api.get('/content-types')).json()).data as { uid: string }[];
  if (types.some((type) => type.uid === 'api::gadget')) return api;
  const applied = await api.post('/schema/apply', {
    contentTypes: {
      part: {
        kind: 'collectionType',
        singularName: 'part',
        pluralName: 'parts',
        displayName: 'Part',
        options: { draftAndPublish: false },
        attributes: { name: { type: 'string' } },
      },
      gadget: {
        kind: 'collectionType',
        singularName: 'gadget',
        pluralName: 'gadgets',
        displayName: 'Gadget',
        options: { draftAndPublish: false },
        attributes: {
          name: { type: 'string' },
          slug: { type: 'uid', targetField: 'name' },
          pin: { type: 'password', minLength: 4 },
          rank: { type: 'integer' },
          kind: { type: 'enumeration', enum: ['tool', 'toy'] },
          parts: { type: 'relation', relation: 'manyWay', target: 'api::part' },
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

/** The stored hash of a gadget's password (read from the test database). */
function storedPin(documentId: string): string | null {
  const db = new DatabaseSync(join(project, 'data.db'), { readOnly: true });
  try {
    const row = db.prepare('SELECT pin FROM gadgets WHERE document_id = ?').get(documentId) as
      { pin: string | null } | undefined;
    return row?.pin ?? null;
  } finally {
    db.close();
  }
}

test('a password field is hashed, kept when left empty and never returned', async ({ page }) => {
  await signIn(page);
  const api = await ensureTypes(page);

  await page.goto('/admin/content/api::gadget/new');
  await page.getByLabel('Name').fill('Locker');
  const pin = page.getByRole('textbox', { name: /^Pin/ });
  await expect(pin).toHaveAttribute('type', 'password');
  await pin.fill('12');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(pin).toHaveAttribute('type', 'text');
  await expect(pin).toHaveValue('12');
  await pin.blur();
  // The schema's minimum length is checked before saving.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('at least 4')).toBeVisible();
  await pin.fill('1234');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/content\/api::gadget\/[a-z0-9]+/);
  const documentId = page.url().split('/').pop()!.split('?')[0];

  // Empty again, with the hint, once the entry exists.
  await expect(pin).toHaveValue('');
  await expect(page.getByText('Stored hashed; leave empty to keep the current one.')).toBeVisible();
  const hash = storedPin(documentId);
  expect(hash).toMatch(/^\$argon2id\$/);

  // Never returned: not by the admin API, not by the list.
  const one = await (await api.get(`/content/api::gadget/${documentId}?populate=*`)).json();
  expect(one.data.name).toBe('Locker');
  expect(one.data).not.toHaveProperty('pin');
  expect(await (await api.get('/content/api::gadget')).text()).not.toContain(hash!);

  // Saving with the field empty keeps the password.
  await page.getByLabel('Name').fill('Locker 2');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();
  await expect
    .poll(
      async () => (await (await api.get(`/content/api::gadget/${documentId}`)).json()).data.name,
    )
    .toBe('Locker 2');
  expect(storedPin(documentId)).toBe(hash);

  // Typing a new one replaces it (once the editor has finished the previous save).
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await pin.fill('5678');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => storedPin(documentId)).not.toBe(hash);
  expect(storedPin(documentId)).toMatch(/^\$argon2id\$/);
  await expect(pin).toHaveValue('');
});

test('an entry is duplicated from the list', async ({ page }) => {
  await signIn(page);
  const api = await ensureTypes(page);
  const name = `Drill ${Date.now()}`;
  const original = await create(api, 'api::gadget', {
    name,
    slug: `drill-${Date.now()}`,
    rank: 3,
    kind: 'tool',
  });

  await page.goto('/admin/content/api::gadget');
  await page.getByRole('button', { name: `Actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(page.getByText('Entry duplicated: you are editing the copy')).toBeVisible();
  // The uid field is unique and the password is never read back: neither is copied.
  await expect(page.getByText(/Not copied: (Slug and Pin|Pin and Slug)\./)).toBeVisible();
  await expect(page).not.toHaveURL(new RegExp(original));
  await expect(page).toHaveURL(/\/content\/api::gadget\/[a-z0-9]+/);
  await expect(page.getByLabel('Name')).toHaveValue(name);
  await expect(page.getByLabel('Slug')).toHaveValue('');

  const copy = page.url().split('/').pop()!.split('?')[0];
  const data = (await (await api.get(`/content/api::gadget/${copy}`)).json()).data;
  expect(data).toMatchObject({ name, rank: 3, kind: 'tool', slug: null });
});

test('filters combine, show as chips and survive a reload', async ({ page }) => {
  await signIn(page);
  const api = await ensureTypes(page);
  const tag = `F${Date.now()}`;
  for (const [name, rank] of [
    ['Alpha', 1],
    ['Beta', 5],
    ['Gamma', 9],
  ] as const)
    await create(api, 'api::gadget', { name: `${name} ${tag}`, rank });

  await page.goto('/admin/content/api::gadget');
  await page.getByRole('button', { name: 'Filters' }).click();
  const sheet = page.getByRole('dialog', { name: 'Filter entries' });
  const first = sheet.getByRole('group', { name: 'Condition 1' });
  await first.getByLabel('Field').selectOption({ label: 'Name' });
  await first.getByLabel('Operator').selectOption({ label: 'ends with' });
  await first.getByLabel('Value').fill(tag);
  await sheet.getByRole('button', { name: 'Add condition' }).click();
  const second = sheet.getByRole('group', { name: 'Condition 2' });
  await second.getByLabel('Field').selectOption({ label: 'Rank' });
  await second.getByLabel('Operator').selectOption({ label: 'is at least' });
  await second.getByLabel('Value').fill('5');
  await page.screenshot({ path: 'test-results/screens/filter-builder.png' });
  await sheet.getByRole('button', { name: 'Apply' }).click();
  await expect(sheet).toBeHidden();

  const chips = page.getByRole('region', { name: 'Active filters' });
  const rows = page.locator('tbody tr');
  const check = async () => {
    await expect(chips.getByText(`Name ends with “${tag}”`)).toBeVisible();
    await expect(chips.getByText('Rank is at least 5')).toBeVisible();
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: `Beta ${tag}` })).toHaveCount(1);
    await expect(rows.filter({ hasText: `Gamma ${tag}` })).toHaveCount(1);
  };
  await check();
  await expect(page.getByRole('button', { name: 'Filters (2 active)' })).toBeVisible();
  expect(decodeURIComponent(page.url())).toContain(`filters[$and][0][name][$endsWith]=${tag}`);
  await page.screenshot({ path: 'test-results/screens/list-filters.png' });

  // Kept in the URL: a reload lists the same entries.
  await page.reload();
  await check();

  // Removing a chip widens the list; going back restores it.
  await chips.getByRole('button', { name: 'Remove filter: Rank is at least 5' }).click();
  await expect(rows).toHaveCount(3);
  await page.goBack();
  await check();

  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(chips).toBeHidden();
});

test('related entries are reordered and edited in a side sheet', async ({ page }) => {
  await signIn(page);
  const api = await ensureTypes(page);
  const tag = Date.now();
  const names = [`One ${tag}`, `Two ${tag}`, `Three ${tag}`];
  const parts: string[] = [];
  for (const name of names) parts.push(await create(api, 'api::part', { name }));
  const gadget = await create(api, 'api::gadget', { name: `Kit ${tag}`, parts });

  await page.goto(`/admin/content/api::gadget/${gadget}`);
  const labels = page.locator('[data-relation-label]');
  await expect(labels).toHaveText(names);

  // Drag "Three" to the top by its handle.
  const handles = page.locator('.cdk-drag-handle');
  await handles.nth(2).scrollIntoViewIfNeeded();
  const from = (await handles.nth(2).boundingBox())!;
  const to = (await handles.nth(0).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 10; step++)
    await page.mouse.move(from.x + from.width / 2, from.y + ((to.y - 4 - from.y) * step) / 10);
  await page.mouse.up();
  await expect(labels).toHaveText([names[2], names[0], names[1]]);

  // The keyboard alternative.
  await page.getByRole('button', { name: `Move ${names[0]} down` }).click();
  await expect(labels).toHaveText([names[2], names[1], names[0]]);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  const saved = (await (await api.get(`/content/api::gadget/${gadget}?populate=parts`)).json())
    .data;
  expect((saved.parts as { name: string }[]).map((part) => part.name)).toEqual([
    names[2],
    names[1],
    names[0],
  ]);

  // Edit a related entry without leaving the editor; its label follows.
  await page.getByRole('button', { name: `Edit ${names[1]}` }).click();
  const sheet = page.getByRole('dialog', { name: names[1] });
  await expect(sheet.getByLabel('Name')).toHaveValue(names[1]);
  await expect(sheet.getByRole('button', { name: 'Save', exact: true })).toBeInViewport();
  await page.waitForTimeout(300); // the slide-in animation
  await page.screenshot({ path: 'test-results/screens/related-sheet.png' });
  // No sheet in a sheet: a part has no relations, and nothing else opens.
  await sheet.getByLabel('Name').fill(`Two renamed ${tag}`);
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(labels).toHaveText([names[2], `Two renamed ${tag}`, names[0]]);
  const part = (await (await api.get(`/content/api::part/${parts[1]}`)).json()).data;
  expect(part.name).toBe(`Two renamed ${tag}`);
});

test('the preview opens side by side with device widths', async ({ page }) => {
  await signIn(page);
  const api = await ensureTypes(page);
  const gadget = await create(api, 'api::gadget', {
    name: 'Preview kit',
    slug: `kit-${Date.now()}`,
  });
  const saved = await api.put('/features/preview', {
    enabled: true,
    settings: { urls: { 'api::gadget': 'https://site.example/gadgets/{slug}' } },
  });
  expect(saved.status(), await saved.text()).toBe(200);
  await page
    .context()
    .route('https://site.example/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<p>Preview</p>' }),
    );

  try {
    await page.goto(`/admin/content/api::gadget/${gadget}`);
    const toggle = page.getByRole('button', { name: 'Side by side' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const frame = page.getByTitle('Preview of Preview kit');
    await expect(frame).toHaveAttribute('src', /^https:\/\/site\.example\/gadgets\/kit-/);
    await expect(frame).toHaveAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-forms allow-popups',
    );
    await page
      .getByRole('radio', { name: 'Mobile' })
      .or(page.getByRole('button', { name: 'Mobile' }))
      .click();
    await expect(frame).toHaveCSS('width', '390px');
    await page.screenshot({ path: 'test-results/screens/preview-side-by-side.png' });

    // The separator resizes with the keyboard.
    const separator = page.getByRole('separator', { name: 'Resize the preview' });
    await separator.focus();
    await page.keyboard.press('ArrowRight');
    await expect(separator).toHaveAttribute('aria-valuenow', '55');

    // Saving reloads the frame (a new one, with a fresh preview URL).
    const before = await frame.elementHandle();
    await page.getByLabel('Name').fill('Preview kit 2');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => before!.evaluate((element) => element.isConnected)).toBe(false);
    await expect(page.getByTitle('Preview of Preview kit 2')).toHaveAttribute(
      'src',
      /^https:\/\/site\.example\/gadgets\/kit-/,
    );
    await page.getByRole('button', { name: 'Close preview' }).click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  } finally {
    await api.put('/features/preview', { enabled: false, settings: null });
  }
});
