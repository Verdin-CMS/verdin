import { expect, test } from '@playwright/test';

import { admin, listen, signIn, unique } from './support';

/** Settings → Deployments: a build hook, a deploy, and the provider's callback (0.9). */
test.describe.configure({ mode: 'serial' });

test('a deploy target calls its hook and the callback marks the deploy ready', async ({
  page,
  request,
}) => {
  await signIn(page);
  // The build hook: a local server that accepts the call.
  const hook = await listen();
  const name = `Site ${unique()}`;

  await page.goto('/admin/settings/deployments');
  await expect(page.getByRole('heading', { name: 'Deployments', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Add a target' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Add a deploy target' })).toBeVisible();
  // Both fields are required.
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog.getByText('Give the target a name.')).toBeVisible();
  await expect(dialog.getByText('Enter an http(s) URL.')).toBeVisible();
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('Build hook URL').fill(`${hook.url}/build?token=secret`);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText(`${name} added`)).toBeVisible();

  // The callback URL opens right away; it carries the target's secret.
  await expect(dialog.getByRole('heading', { name: 'Callback URL' })).toBeVisible();
  const callback = (await dialog.locator('[data-callback-url]').textContent())!.trim();
  expect(callback).toMatch(/\/admin\/api\/deploy\/callback\/\d+\/[0-9a-f]{64}$/);
  await dialog.getByRole('tab', { name: 'Other CI' }).click();
  await expect(dialog.getByText(`curl -X POST '${callback}'`)).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).last().click();
  await expect(dialog).toHaveCount(0);

  // Only the host of the hook is shown: its URL is a secret.
  const row = page.locator('[data-deploy-target]', { hasText: name });
  await expect(row).toContainText('127.0.0.1');
  await expect(row).not.toContainText('token=secret');
  await expect(row).toContainText('Never deployed');

  await row.getByRole('button', { name: `Deploy ${name}` }).click();
  await expect(page.getByText(`Deploy of ${name} started`)).toBeVisible();
  await expect(row.locator('[data-deploy-status]')).toHaveText('Triggered');
  await expect.poll(() => hook.received.length).toBe(1);
  const call = hook.received[0];
  expect(call.method).toBe('POST');
  expect(call.path).toBe('/build?token=secret');
  expect(JSON.parse(call.raw)).toEqual({ trigger: 'verdin', triggeredBy: 'ada@example.com' });

  // A target deploys at most every 10 seconds.
  await row.getByRole('button', { name: `Deploy ${name}` }).click();
  await expect(page.getByText('This target deployed less than 10 seconds ago.')).toBeVisible();
  expect(hook.received).toHaveLength(1);

  // The provider reports through the callback URL (public: the path holds the secret).
  const path = new URL(callback).pathname;
  const forged = await request.post(path.replace(/[0-9a-f]{64}$/, '0'.repeat(64)), {
    data: { status: 'ready' },
  });
  expect(forged.status()).toBe(404);
  const building = await request.post(path, { data: { state: 'building' } });
  expect(building.status(), await building.text()).toBe(204);
  const ready = await request.post(path, {
    data: { status: 'ready', url: 'https://preview.example.com' },
  });
  expect(ready.status(), await ready.text()).toBe(204);

  // The page follows the deploy until it is done.
  await expect(row.locator('[data-deploy-status]')).toHaveText('Ready', { timeout: 15_000 });
  const history = page.getByRole('region', { name: 'Deploy history' });
  await page.getByRole('button', { name: 'Refresh' }).click();
  const entry = history.getByRole('row').filter({ hasText: name }).first();
  await expect(entry).toContainText('Ready');
  await expect(entry).toContainText('200');
  await expect(entry.getByRole('link', { name: 'https://preview.example.com' })).toBeVisible();

  const api = await admin(page);
  const targetId = Number(path.split('/').at(-2));
  const listed = (await (await api.get(`/deploy/deployments?targetId=${targetId}`)).json())
    .data as { status: string; url: string | null }[];
  expect(listed).toHaveLength(1);
  expect(listed[0]).toMatchObject({ status: 'ready', url: 'https://preview.example.com' });
  await hook.close();
});

test('a hook that refuses the call marks the deploy refused', async ({ page }) => {
  await signIn(page);
  const hook = await listen((_, response) => {
    response.statusCode = 503;
    response.end('down');
  });
  const name = `Broken ${unique()}`;
  const api = await admin(page);
  const created = await api.post('/deploy/targets', { name, url: `${hook.url}/build` });
  expect(created.status(), await created.text()).toBe(201);

  await page.goto('/admin/settings/deployments');
  const row = page.locator('[data-deploy-target]', { hasText: name });
  await row.getByRole('button', { name: `Deploy ${name}` }).click();
  await expect(page.getByText(`The build hook of ${name} refused the deploy`)).toBeVisible();
  await expect(row.locator('[data-deploy-status]')).toHaveText('Refused');
  const history = page.getByRole('region', { name: 'Deploy history' });
  const entry = history.getByRole('row').filter({ hasText: name }).first();
  await expect(entry).toContainText('503');
  await expect(entry).toContainText('the hook answered 503');

  // Deleting the target asks first.
  await row.getByRole('button', { name: `Delete ${name}` }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText(`Delete ${name}?`);
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText(`${name} deleted`)).toBeVisible();
  await expect(row).toHaveCount(0);
  await hook.close();
});
