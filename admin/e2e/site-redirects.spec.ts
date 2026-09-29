import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

import { admin, setFeature, signIn, unique } from './support';

/** Settings → Redirects: edited in place, CSV in and out, served at `/api/_redirects` (0.9). */
test.describe.configure({ mode: 'serial' });

interface Served {
  source: string;
  destination: string;
  status: number;
}

test('redirects are added, edited, exported, imported and served', async ({ page, request }) => {
  await signIn(page);
  const api = await admin(page);
  const served = async (prefix: string): Promise<Served[]> => {
    const response = await request.get('/api/_redirects');
    expect(response.status()).toBe(200);
    return ((await response.json()).data as Served[]).filter((item) =>
      item.source.startsWith(prefix),
    );
  };
  // Off, the page says so and the public route does not exist.
  await setFeature(api, 'redirects', false, async () =>
    (await request.get('/api/_redirects')).status(),
  );
  await page.goto('/admin/settings/redirects');
  await expect(page.getByText('Redirects is off')).toBeVisible();
  await page.getByRole('link', { name: 'Open features' }).click();
  await page.getByLabel('Turn Redirects on or off').click();
  await page.getByRole('link', { name: 'Manage redirects' }).click();
  await expect(page).toHaveURL(/\/admin\/settings\/redirects$/);
  await expect.poll(async () => (await request.get('/api/_redirects')).status()).toBe(200);

  const base = `/r-${unique()}`;
  const editor = page.locator('[data-redirect-editor]');
  await page.getByRole('button', { name: 'Add a redirect' }).click();
  // The row is checked before it is saved.
  await editor.getByLabel('From').fill('old-page');
  await editor.getByLabel('To').fill(`${base}/new-page`);
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor.getByText('The source is a path that starts with /.')).toBeVisible();
  await editor.getByLabel('From').fill(`${base}/new-page`);
  await expect(editor.getByText('A path cannot redirect to itself.')).toBeVisible();
  await editor.getByLabel('From').fill(`${base}/old-page`);
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(`Redirect from ${base}/old-page added`)).toBeVisible();

  // Enter saves too; the type is a select.
  await page.getByRole('button', { name: 'Add a redirect' }).click();
  await editor.getByLabel('From').fill(`${base}/sale`);
  await editor.getByLabel('To').fill('https://shop.example.com/sale');
  await editor.getByLabel('Type').selectOption('302');
  await editor.getByLabel('To').press('Enter');
  await expect(page.getByText(`Redirect from ${base}/sale added`)).toBeVisible();
  const rows = page.locator('[data-redirect]', { hasText: base });
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: `${base}/sale` })).toContainText('302 · Temporary');

  // A redirect that would loop is refused by the server.
  await page.getByRole('button', { name: 'Add a redirect' }).click();
  await editor.getByLabel('From').fill(`${base}/new-page`);
  await editor.getByLabel('To').fill(`${base}/old-page`);
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor.getByText('this redirect would loop')).toBeVisible();
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await expect(editor).toHaveCount(0);

  // Editing a row turns it into the editor.
  await page.getByRole('button', { name: `Edit the redirect from ${base}/old-page` }).click();
  await expect(editor.getByLabel('From')).toHaveValue(`${base}/old-page`);
  await editor.getByLabel('To').fill(`${base}/newer-page`);
  await editor.getByLabel('Type').selectOption('308');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(`Redirect from ${base}/old-page saved`)).toBeVisible();
  await expect(rows.filter({ hasText: `${base}/old-page` })).toContainText(`${base}/newer-page`);

  await expect
    .poll(() => served(base))
    .toEqual([
      { source: `${base}/old-page`, destination: `${base}/newer-page`, status: 308 },
      { source: `${base}/sale`, destination: 'https://shop.example.com/sale', status: 302 },
    ]);

  // Search filters the rows.
  await page.getByRole('searchbox', { name: 'Search redirects' }).fill(`${base}/sale`);
  await expect(rows).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Search redirects' }).fill('');
  await expect(rows).toHaveCount(2);

  // Export: a CSV with a header row.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('redirects.csv');
  const exported = readFileSync(await file.path(), 'utf8');
  expect(exported.split('\r\n')[0]).toBe('source,destination,status');
  expect(exported).toContain(`${base}/old-page,${base}/newer-page,308\r\n`);
  expect(exported).toContain(`${base}/sale,https://shop.example.com/sale,302\r\n`);

  // Import: new sources are added, known ones updated, unreadable lines skipped.
  const csv = [
    'source,destination,status',
    `${base}/sale,https://shop.example.com/summer,301`,
    `"${base}/blog, old",${base}/blog,307`,
    `${base}/team,${base}/about`,
    'not-a-path,/somewhere,301',
  ].join('\n');
  await page.locator('input[type=file][accept=".csv,text/csv"]').setInputFiles({
    name: 'redirects.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await expect(page.getByText('2 redirects added, 1 updated, 1 skipped')).toBeVisible();
  await expect(page.getByText('Lines that could not be read: 5')).toBeVisible();
  await expect(rows).toHaveCount(4);

  await expect
    .poll(() => served(base))
    .toEqual([
      { source: `${base}/blog, old`, destination: `${base}/blog`, status: 307 },
      { source: `${base}/old-page`, destination: `${base}/newer-page`, status: 308 },
      { source: `${base}/sale`, destination: 'https://shop.example.com/summer', status: 301 },
      { source: `${base}/team`, destination: `${base}/about`, status: 301 },
    ]);

  // Deleting asks first; the route follows.
  await page.getByRole('button', { name: `Delete the redirect from ${base}/team` }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText(`Delete the redirect from ${base}/team?`);
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText(`Redirect from ${base}/team deleted`)).toBeVisible();
  await expect(rows).toHaveCount(3);
  await expect
    .poll(async () => (await served(base)).map((item) => item.source))
    .not.toContain(`${base}/team`);
});
