import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
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
  await dialog.getByLabel('Name').fill('summary');
  await dialog.getByLabel('Type').selectOption('blocks');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Add field' }).click();
  await dialog.getByLabel('Name').fill('notes');
  await dialog.getByLabel('Type').selectOption('richtext');
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
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('title is a required field')).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/editor-error.png' });
  await page.getByLabel('Title').fill('Hello from Playwright');
  // Blocks editor: a paragraph with bold text.
  const summary = page.locator('.vd-prose[contenteditable="true"]');
  await summary.click();
  await page.getByRole('button', { name: 'Bold' }).click();
  await page.keyboard.type('Rich');
  await page.getByRole('button', { name: 'Bold' }).click();
  await page.keyboard.type(' summary');
  // Markdown with a live preview.
  await page.getByLabel('Notes').fill('# Notes\n\nSome **markdown**.');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Notes', level: 1 })).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/editor-rich.png' });
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published', { exact: true }).first()).toBeVisible();

  await page.getByRole('link', { name: 'Article', exact: true }).first().click();
  await expect(
    page.getByRole('cell', { name: 'Hello from Playwright', exact: true }),
  ).toBeVisible();
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
  expect(body.data[0].summary).toEqual([
    {
      type: 'paragraph',
      children: [
        { type: 'text', text: 'Rich', bold: true },
        { type: 'text', text: ' summary' },
      ],
    },
  ]);
  expect(body.data[0].notes).toBe('# Notes\n\nSome **markdown**.');

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

  // GraphQL, switched on from the same page; the public role may read articles.
  expect(
    (await request.post('/graphql', { data: { query: '{ articles { title } }' } })).status(),
  ).toBe(404);
  await page.getByLabel('Turn GraphQL on or off').click();
  await expect(page.getByText('Endpoint: /graphql')).toBeVisible();
  const graphql = await request.post('/graphql', {
    data: { query: '{ articles { title body } }' },
  });
  expect(await graphql.json()).toEqual({
    data: { articles: [{ title: 'Hello from Playwright', body: 'Written by Playwright.' }] },
  });

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
  await page.getByRole('cell', { name: 'Hello from Playwright', exact: true }).click();
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
  await page.getByRole('cell', { name: 'Hello from Playwright', exact: true }).click();
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

  // Webhooks: a local receiver gets a signed delivery when an article is published.
  const received: { event: string; signature: string; body: Record<string, unknown> }[] = [];
  const receiver = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => (raw += chunk));
    request.on('end', () => {
      received.push({
        event: String(request.headers['x-verdin-event']),
        signature: String(request.headers['x-verdin-signature'] ?? ''),
        body: JSON.parse(raw),
      });
      response.end('thanks');
    });
  });
  await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  const hookUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;
  await page.getByRole('link', { name: 'Webhooks' }).click();
  await page.getByRole('link', { name: 'New webhook' }).first().click();
  await page.getByLabel('Name').fill('Rebuild');
  await page.getByLabel('URL', { exact: true }).fill(hookUrl);
  await page.getByLabel('entry.publish').check();
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Copy the signing secret')).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/webhook-secret.png' });
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Send test event' }).click();
  await expect.poll(() => received.map((r) => r.event)).toContain('trigger-test');
  expect(received[0].signature).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);

  // Content history: edit the article, then restore the previous version.
  await page.getByRole('link', { name: 'Article', exact: true }).first().click();
  await page.getByRole('cell', { name: 'Hello from Playwright', exact: true }).click();
  await page.getByLabel('Title').fill('A title to undo');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published', { exact: true }).first()).toBeVisible();
  await expect.poll(() => received.map((r) => r.event)).toContain('entry.publish');
  const publish = received.find((r) => r.event === 'entry.publish')!;
  expect((publish.body['entry'] as { title: string }).title).toBe('A title to undo');
  receiver.close();

  await page.getByRole('link', { name: 'History' }).click();
  await expect(page.getByRole('heading', { name: 'History' }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/history.png' });
  await page.getByRole('button', { name: /Saved/ }).nth(1).click();
  await expect(page.getByText('Hello from Playwright').first()).toBeVisible();
  await page.getByRole('button', { name: 'Restore' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('Version restored as the current draft')).toBeVisible();
  await expect(page.getByLabel('Title')).toHaveValue('Hello from Playwright');

  // Bulk actions: unpublish every entry on the page.
  await page.getByRole('link', { name: 'Article', exact: true }).first().click();
  await page.getByLabel('Select all entries on this page').click();
  await expect(page.getByText('1 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Unpublish', exact: true }).click();
  await expect(page.getByText('1 entry unpublished')).toBeVisible();
  expect((await (await request.get('/api/articles')).json()).data).toHaveLength(0);

  // Content i18n: add French, build a localized type and write both versions.
  await page.getByRole('link', { name: 'Internationalization' }).click();
  await page.getByRole('button', { name: 'Add locale' }).first().click();
  await dialog.getByLabel('Code').fill('fr');
  await dialog.getByRole('button', { name: 'Add locale' }).click();
  await expect(page.getByRole('cell', { name: 'fr', exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Content-type builder' }).click();
  await page.getByRole('link', { name: 'New content type' }).click();
  await expect(page.getByRole('heading', { name: 'New content type', level: 1 })).toBeVisible();
  await page.getByLabel('Display name').fill('Page');
  await expect(page.getByLabel('Plural name (route)')).toHaveValue('pages');
  await page.getByLabel('Localized').click();
  await page.getByRole('button', { name: 'Add field' }).click();
  await dialog.getByLabel('Name').fill('heading');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Schema updated').first()).toBeVisible();
  expect(
    JSON.parse(readFileSync(join(project, 'schema', 'content-types', 'page.json'), 'utf8'))
      .pluginOptions,
  ).toEqual({ i18n: { localized: true } });

  await page.getByRole('link', { name: 'Page', exact: true }).first().click();
  await page.getByRole('link', { name: 'Create' }).click();
  await page.getByLabel('Heading').fill('Welcome');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: /^Locale:/ }).click();
  await page.getByRole('menuitemradio', { name: /French|Français|fr/ }).click();
  await expect(page.getByText(/has no .* version yet/)).toBeVisible();
  await page.getByLabel('Heading').fill('Bienvenue');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/has no .* version yet/)).toBeHidden();
  await expect(page.getByText('Last published')).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/i18n-editor.png' });
  const pages = await (
    await request.get('/admin/api/content/api::page?locale=fr', {
      headers: { authorization: `Bearer ${await token(page)}` },
    })
  ).json();
  expect(pages.data?.[0]?.heading ?? pages).toBe('Bienvenue');

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
