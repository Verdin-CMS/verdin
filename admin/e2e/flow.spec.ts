import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { project } from '../playwright.config';

let afterEachProblems: string[] = [];
test.afterEach(() => {
  if (afterEachProblems.length) console.log(afterEachProblems.join('\n'));
});

/** A 1×1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** The admin access token the page holds (it lives in memory, so ask the API). */
async function token(page: import('@playwright/test').Page): Promise<string> {
  const response = await page.request.post('/admin/api/auth/refresh', {
    headers: { 'x-verdin-csrf': '1' },
  });
  return (await response.json()).data.accessToken;
}

test('create a type, write content, publish it and read it over the API', async ({
  page,
  request,
}) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on(
    'console',
    (message) => message.type() === 'error' && problems.push(`console: ${message.text()}`),
  );
  test
    .info()
    .attachments.push({ name: 'problems', contentType: 'text/plain', body: Buffer.from('') });
  page.on('close', () => undefined);
  afterEachProblems = problems;
  // First run: register the first administrator.
  await page.goto('/admin/');
  await expect(page).toHaveURL(/\/admin\/register$/);
  await page.getByLabel('First name').fill('Ada');
  await page.getByLabel('Email').fill('ada@example.com');
  await page.getByLabel('Password').fill('correct horse 1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Ada' })).toBeVisible();

  // Content-type builder: an Article with a required title and a body.
  await page.getByRole('link', { name: 'Content-type builder' }).click();
  await expect(page).toHaveURL(/\/admin\/builder\/new$/);
  await page.getByLabel('Display name').fill('Article');
  await expect(page.getByLabel('Plural name (route)')).toHaveValue('articles');

  const dialog = page.getByRole('dialog');
  await page.getByRole('button', { name: 'Add field' }).click();
  await dialog.getByLabel('Name').fill('title');
  await dialog.getByLabel('Required').click();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Add field' }).click();
  await dialog.getByLabel('Name').fill('body');
  await dialog.getByLabel('Type').selectOption('text');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Add field' }).click();
  await dialog.getByLabel('Name').fill('cover');
  await dialog.getByLabel('Type').selectOption('media');
  await dialog.getByRole('button', { name: 'Done' }).click();

  await page.screenshot({ path: 'test-results/screens/builder.png' });
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('heading', { name: 'Review the migration' })).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/plan.png' });
  await expect(dialog.getByText('create table articles').first()).toBeVisible();
  await expect(dialog.getByText('create table articles_cover_mda')).toBeVisible();
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Schema updated')).toBeVisible();
  const file = join(project, 'schema', 'content-types', 'article.json');
  expect(existsSync(file)).toBe(true);
  expect(JSON.parse(readFileSync(file, 'utf8')).attributes.title).toEqual({
    type: 'string',
    required: true,
  });

  // Publishing without the required title fails on the field; then write and publish.
  await page.getByRole('link', { name: 'Article', exact: true }).first().click();
  await page.getByRole('link', { name: 'Create' }).click();
  await page.getByLabel('Body').fill('Written by Playwright.');
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('title is a required field')).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/editor-error.png' });
  await page.getByLabel('Title').fill('Hello from Playwright');
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published', { exact: true }).first()).toBeVisible();

  await page.getByRole('link', { name: 'Article', exact: true }).first().click();
  await expect(page.getByRole('cell', { name: 'Hello from Playwright' })).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/list.png' });

  // The content API is closed until the public role may read articles.
  expect((await request.get('/api/articles')).status()).toBe(403);
  await page.getByRole('link', { name: 'Public access' }).click();
  await page.getByLabel('Article find', { exact: true }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Public access saved')).toBeVisible();

  const response = await request.get('/api/articles');
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.data).toHaveLength(1);
  expect(body.data[0]).toMatchObject({
    title: 'Hello from Playwright',
    body: 'Written by Playwright.',
  });
  expect(body.data[0].publishedAt).toBeTruthy();

  // Features: publish the API documentation (applies live, no restart).
  expect((await request.get('/api/docs')).status()).toBe(404);
  await page.getByRole('link', { name: 'Features' }).click();
  await expect(page.getByRole('heading', { name: 'API documentation' })).toBeVisible();
  await page.getByText('Public documentation').click();
  await expect(page.getByRole('link', { name: 'Open the API reference' })).toBeVisible();
  const docs = await request.get('/api/docs');
  expect(docs.status()).toBe(200);
  expect(docs.headers()['content-security-policy']).toContain("script-src 'self' 'sha256-");
  expect((await request.get('/api/_openapi.json')).status()).toBe(200);

  // Media library: upload an image, then pick it for the article's cover.
  await page.getByRole('link', { name: 'Media library' }).click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: 'sunset.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText('sunset.png').first()).toBeVisible();
  const files = await (
    await request.get('/admin/api/upload/files', {
      headers: { authorization: `Bearer ${await token(page)}` },
    })
  ).json();
  const uploaded = files.data[0];
  expect(uploaded).toMatchObject({ name: 'sunset.png', mime: 'image/png', width: 1, height: 1 });
  const served = await request.get(uploaded.url);
  expect(served.status()).toBe(200);
  expect(served.headers()['content-security-policy']).toContain('sandbox');

  await page.getByRole('link', { name: 'Article', exact: true }).first().click();
  await page.getByRole('cell', { name: 'Hello from Playwright' }).click();
  await page.getByRole('button', { name: 'Cover' }).click();
  await dialog
    .getByRole('button', { name: /sunset\.png/ })
    .first()
    .click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: /^Save/ }).click();
  await page.reload();
  await expect(page.getByRole('img', { name: 'sunset.png' }).first()).toBeVisible();

  // Votes on the entry itself.
  await page.getByRole('link', { name: 'Article', exact: true }).first().click();
  await page.getByRole('cell', { name: 'Hello from Playwright' }).click();
  await page.getByRole('button', { name: 'Vote up' }).click();
  await expect(page.getByRole('button', { name: 'Vote up' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Dashboard widgets: an "unseen" list (Ada opened the article, so it is empty) and a poll.
  await page.getByRole('link', { name: 'Home' }).click();
  await page.getByRole('button', { name: 'Customize' }).click();
  await page.getByRole('button', { name: 'Add widget' }).first().click();
  await dialog.getByRole('button', { name: /Entry list/ }).click();
  await dialog.getByText('Only entries I have not seen').click();
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('All caught up: nothing new to see.')).toBeVisible();

  await page.getByRole('button', { name: 'Add widget' }).first().click();
  await dialog.getByRole('button', { name: /Poll/ }).click();
  await dialog.getByLabel('Question').fill('What next?');
  await dialog.getByLabel('Answer 1').fill('Media library');
  await dialog.getByLabel('Answer 2').fill('GraphQL');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: /Media library/ }).click();
  await expect(page.getByText('1 voter')).toBeVisible();
  await expect(page.getByRole('button', { name: /Media library/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Done' }).click();
  // The layout is stored on the server: it survives a reload.
  await page.reload();
  await expect(page.getByText('What next?')).toBeVisible();
  await expect(page.getByText('All caught up: nothing new to see.')).toBeVisible();

  // Optional visual tour (VERDIN_SCREENSHOTS=1): every main page in light, dark and Spanish.
  if (process.env['VERDIN_SCREENSHOTS']) {
    await page.setViewportSize({ width: 1440, height: 900 });
    const documentId = body.data[0].documentId as string;
    const pages: [string, string][] = [
      ['home', '/admin/'],
      ['list', '/admin/content/api::article'],
      ['edit', `/admin/content/api::article/${documentId}`],
      ['builder', '/admin/builder/article'],
      ['media', '/admin/media'],
      ['users', '/admin/settings/users'],
      ['roles', '/admin/settings/roles'],
      ['tokens', '/admin/settings/tokens'],
      ['features', '/admin/settings/features'],
      ['public', '/admin/settings/public'],
    ];
    for (const [variant, preferences] of [
      ['light', { theme: 'light', locale: 'en' }],
      ['dark', { theme: 'dark', locale: 'en' }],
      ['es', { theme: 'light', locale: 'es' }],
    ] as const) {
      await page.evaluate(
        (value) => localStorage.setItem('verdin.preferences', JSON.stringify(value)),
        preferences,
      );
      for (const [name, url] of pages) {
        await page.goto(url);
        await page.waitForLoadState('networkidle');
        await page.screenshot({ path: `test-results/tour/${variant}-${name}.png` });
      }
    }
    await page.goto('/admin/');
    await page.getByRole('button', { name: 'Personalizar' }).click();
    await page.screenshot({ path: 'test-results/tour/es-dashboard-edit.png' });
    await page.getByRole('button', { name: 'Añadir widget' }).first().click();
    await page.screenshot({ path: 'test-results/tour/es-widget-dialog.png' });
    await page.keyboard.press('Escape');
    await page.context().clearCookies();
    await page.evaluate(() => sessionStorage.clear());
    await page.goto('/admin/login');
    await page.screenshot({ path: 'test-results/tour/es-login.png' });
  }
});
