import { type Page, expect, test } from '@playwright/test';

import { type Api, admin, ensureType, setFeature, signIn, unique } from './support';

/** Settings → Menus: a nested tree of links and entries, served at `/api/_menus/{slug}` (0.9). */
test.describe.configure({ mode: 'serial' });

/** Links the edited item to a guide through the entry picker: type, search, choose. */
async function pickEntry(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: /^(Choose an entry|Change the entry)$/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Search entries')).toBeVisible();
  // The type list shows when several types can be linked.
  const type = dialog.getByLabel('Content type');
  if (await type.count()) await type.selectOption('api::guide');
  await dialog.getByLabel('Search entries').fill(title);
  await dialog.getByRole('button', { name: title }).click();
  await expect(dialog).toBeHidden();
}

/** A draft-and-publish type whose entries the menus link to (created once). */
async function ensureGuides(api: Api): Promise<void> {
  await ensureType(api, 'guide', {
    kind: 'collectionType',
    singularName: 'guide',
    pluralName: 'guides',
    displayName: 'Guide',
    options: { draftAndPublish: true },
    attributes: { title: { type: 'string' } },
  });
}

async function guide(api: Api, title: string, publish: boolean): Promise<string> {
  const created = await api.post('/content/api::guide', { data: { title } });
  expect(created.status(), await created.text()).toBe(201);
  const documentId = (await created.json()).data.documentId as string;
  if (publish) {
    const published = await api.post(`/content/api::guide/${documentId}/actions/publish`, {});
    expect(published.status(), await published.text()).toBeLessThan(300);
  }
  return documentId;
}

/** The tree's rows, top to bottom, as "level label". */
async function outline(page: Page): Promise<string[]> {
  const buttons = page
    .locator('[data-menu-item]')
    .getByRole('button', { name: /^Edit .* \(level/ });
  const labels = await buttons.evaluateAll((items) =>
    items.map((item) => item.getAttribute('aria-label') ?? ''),
  );
  return labels.map((label) => {
    const [, name, level] = /^Edit (.*) \(level (\d)\)$/.exec(label) ?? [];
    return `${level} ${name}`;
  });
}

/** Adds an item with `button` and names it, once the panel shows the new (empty) item. */
async function addItem(page: Page, button: string, label: string): Promise<void> {
  await page.getByRole('button', { name: button, exact: true }).click();
  const field = page.getByRole('region', { name: 'Item', exact: true }).getByLabel('Label');
  await expect(field).toHaveValue('');
  await expect(field).toBeFocused();
  await field.fill(label);
}

function item(page: Page, label: string) {
  return page.getByRole('button', { name: new RegExp(`^Edit ${label} \\(level \\d\\)$`) });
}

test('a nested menu of links and entries is built, reordered and served', async ({
  page,
  request,
}) => {
  await signIn(page);
  const api = await admin(page);
  await ensureGuides(api);
  const run = unique();
  const published = await guide(api, `Getting started ${run}`, true);
  await guide(api, `Unpublished ${run}`, false);
  const slug = `main-${run}`;
  await setFeature(api, 'menus', true);

  await page.goto('/admin/settings/menus');
  await page.getByRole('link', { name: 'New menu' }).first().click();
  await expect(page.getByRole('heading', { name: 'New menu', level: 1 })).toBeVisible();
  await page.getByLabel('Name').fill(`Main ${run}`);
  // The slug follows the name until it is edited.
  await expect(page.getByLabel('Slug')).toHaveValue(slug);
  await expect(page.getByText(`/api/_menus/${slug}`)).toBeVisible();

  const panel = page.getByRole('region', { name: 'Item', exact: true });

  // A path, selected (and focused) as soon as it is added.
  await addItem(page, 'Add an item', 'Home');
  await panel.getByLabel('URL').fill('/');

  // An entry: pick the type, search, choose.
  await addItem(page, 'Add an item', 'Docs');
  await panel.getByLabel('Links to').selectOption('entry');
  await pickEntry(page, `Getting started ${run}`);
  await expect(panel.locator('[data-menu-entry]')).toHaveText(`Getting started ${run}`);
  await expect(item(page, 'Docs')).toContainText(`Guide · Getting started ${run}`);

  // Children of Docs: an external link in a new tab, and an unpublished entry.
  await addItem(page, 'Add an item under Docs', 'Blog');
  await panel.getByLabel('URL').fill('https://blog.example.com');
  await panel.getByLabel('Opens in').selectOption('_blank');
  await addItem(page, 'Add an item under Docs', 'Soon');
  await panel.getByLabel('Links to').selectOption('entry');
  await pickEntry(page, `Unpublished ${run}`);

  // A heading with a link the site cannot use: flagged, and the save is held back.
  await addItem(page, 'Add an item', 'Contact');
  await panel.getByLabel('URL').fill('javascript:alert(1)');
  await expect(panel.getByText('This is not a link the site can use.')).toBeVisible();
  await page.locator('[data-menu-save]').click();
  await expect(page.getByText('1 item has problems. Fix them, then save again.')).toBeVisible();
  await panel.getByLabel('URL').fill('mailto:hello@example.com');

  await expect
    .poll(() => outline(page))
    .toEqual(['1 Home', '1 Docs', '2 Blog', '2 Soon', '1 Contact']);
  await expect(page.getByText('5 items of')).toBeVisible();

  // Reorder with the buttons: Contact goes above Docs, then under Home.
  await page.getByRole('button', { name: 'Move Contact up' }).click();
  await expect
    .poll(() => outline(page))
    .toEqual(['1 Home', '1 Contact', '1 Docs', '2 Blog', '2 Soon']);
  await page.getByRole('button', { name: 'Nest Contact under the item above' }).click();
  await expect
    .poll(() => outline(page))
    .toEqual(['1 Home', '2 Contact', '1 Docs', '2 Blog', '2 Soon']);
  // …and with the keyboard on the drag handles.
  await page.getByRole('button', { name: 'Reorder Soon' }).press('Alt+ArrowUp');
  await expect
    .poll(() => outline(page))
    .toEqual(['1 Home', '2 Contact', '1 Docs', '2 Soon', '2 Blog']);
  await page.getByRole('button', { name: 'Reorder Contact' }).press('Alt+ArrowLeft');
  await expect
    .poll(() => outline(page))
    .toEqual(['1 Home', '1 Contact', '1 Docs', '2 Soon', '2 Blog']);
  await expect(page.getByRole('button', { name: 'Move Home up' })).toBeDisabled();

  await page.locator('[data-menu-save]').click();
  await expect(page.getByText(`Main ${run} created`)).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/settings\/menus\/\d+$/);

  // The public route resolves entries and leaves out those not published.
  const served = async () => {
    const response = await request.get(`/api/_menus/${slug}`);
    expect(response.status()).toBe(200);
    return (await response.json()).data;
  };
  await expect.poll(async () => (await request.get(`/api/_menus/${slug}`)).status()).toBe(200);
  const menu = await served();
  expect(menu).toMatchObject({ slug, name: `Main ${run}` });
  expect(menu.items).toEqual([
    { label: 'Home', url: '/' },
    { label: 'Contact', url: 'mailto:hello@example.com' },
    {
      label: 'Docs',
      entry: expect.objectContaining({ uid: 'api::guide', documentId: published }),
      children: [{ label: 'Blog', url: 'https://blog.example.com', target: '_blank' }],
    },
  ]);
  expect((await request.get(`/api/_menus/nope-${run}`)).status()).toBe(404);

  // The saved tree comes back as it was; a change is saved in place.
  await page.reload();
  await expect
    .poll(() => outline(page))
    .toEqual(['1 Home', '1 Contact', '1 Docs', '2 Soon', '2 Blog']);
  await page.getByRole('button', { name: 'Move Docs up' }).click();
  await page.getByRole('button', { name: 'Remove Soon' }).click();
  await expect.poll(() => outline(page)).toEqual(['1 Home', '1 Docs', '2 Blog', '1 Contact']);
  await page.locator('[data-menu-save]').click();
  await expect(page.getByText(`Main ${run} saved`)).toBeVisible();
  await expect
    .poll(async () => ((await served()).items as { label: string }[]).map((entry) => entry.label))
    .toEqual(['Home', 'Docs', 'Contact']);

  // The list shows the menu with its item count.
  await page.getByRole('link', { name: 'All menus' }).click();
  const row = page.getByRole('row').filter({ hasText: `Main ${run}` });
  await expect(row).toContainText(slug);
  await expect(row).toContainText('4 items');
});
