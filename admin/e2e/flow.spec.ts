import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { project } from '../playwright.config';

let afterEachProblems: string[] = [];
test.afterEach(() => {
  if (afterEachProblems.length) console.log(afterEachProblems.join('\n'));
});

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

  await page.screenshot({ path: 'test-results/screens/builder.png' });
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('heading', { name: 'Review the migration' })).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/plan.png' });
  await expect(dialog.getByText('create table articles')).toBeVisible();
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
});
