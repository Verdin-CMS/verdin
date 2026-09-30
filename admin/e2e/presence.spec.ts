import { expect, test } from '@playwright/test';

import { admin, ensureType, setFeature, signIn, signInAs, unique } from './support';

/** Two admins on one entry: presence, the soft lock and the notice of the other's changes. */
test.describe.configure({ mode: 'serial' });

test('two admins on the same entry see each other and each other’s changes', async ({
  page,
  browser,
}) => {
  await signIn(page);
  const api = await admin(page);
  await ensureType(api, 'briefing', {
    kind: 'collectionType',
    singularName: 'briefing',
    pluralName: 'briefings',
    displayName: 'Briefing',
    options: { draftAndPublish: true },
    attributes: { title: { type: 'string' } },
  });
  const run = unique();
  const created = await api.post('/content/api::briefing', { data: { title: `Plan ${run}` } });
  expect(created.status(), await created.text()).toBe(201);
  const documentId = (await created.json()).data.documentId as string;
  // Presence lives on the realtime feature; its heartbeat route is 404 while it is off.
  await setFeature(api, 'realtime', true, async () =>
    (await api.post('/presence', { uid: 'api::briefing', documentId, leave: true })).status(),
  );

  // A second administrator, with the same role as the first.
  const roles = (await (await api.get('/roles?pageSize=100')).json()).data as {
    id: number;
    code: string;
  }[];
  const superAdmin = roles.find((role) => role.code.includes('super')) ?? roles[0];
  const email = `bob-${run}@example.com`;
  const password = 'bob password 1';
  const user = await api.post('/users', {
    email,
    password,
    firstname: 'Bob',
    lastname: 'Builder',
    roles: [superAdmin.id],
    isActive: true,
  });
  expect(user.status(), await user.text()).toBe(201);
  const bob = await signInAs(browser, email, password, 'Bob');

  const url = `/admin/content/api::briefing/${documentId}`;
  await page.goto(url);
  await expect(page.getByLabel('Title')).toHaveValue(`Plan ${run}`);
  await bob.goto(url);
  await expect(bob.getByLabel('Title')).toHaveValue(`Plan ${run}`);

  // Each sees the other viewing (and not themselves).
  await expect(page.getByRole('group', { name: /^Viewing: Bob/ })).toBeVisible({
    timeout: 15_000,
  });
  await expect(bob.getByRole('group', { name: /^Viewing: Ada/ })).toBeVisible({
    timeout: 15_000,
  });

  // Bob starts typing: Ada sees him editing, and the soft lock warns her.
  await bob.getByLabel('Title').fill(`Plan ${run} (Bob)`);
  await expect(page.getByRole('group', { name: /^Editing: Bob/ })).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByText(/^Bob.* is editing this entry — your changes may conflict$/),
  ).toBeVisible();

  // Bob saves: Ada is told, and reloads his version.
  await bob.getByRole('button', { name: 'Save draft' }).click();
  await expect(bob.getByText('Saved', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Another admin updated this entry')).toBeVisible({
    timeout: 15_000,
  });
  // Once saved, Bob is only viewing again.
  await expect(page.getByRole('group', { name: /^Viewing: Bob/ })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(page.getByLabel('Title')).toHaveValue(`Plan ${run} (Bob)`);
  await expect(page.getByText('Another admin updated this entry')).toHaveCount(0);
  // Bob sees no notice about his own change.
  await expect(bob.getByText('Another admin updated this entry')).toHaveCount(0);

  // Bob publishes: a notice of its own, dismissed without reloading.
  await bob.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(bob.getByText('Published', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Another admin published this entry')).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(page.getByText('Another admin published this entry')).toHaveCount(0);

  // Bob leaves the entry: Ada is alone again.
  await bob.goto('/admin/');
  await expect(page.getByRole('group', { name: /Bob/ })).toHaveCount(0, { timeout: 15_000 });
  await bob.context().close();
  // Realtime is off by default: leave it so for the specs that follow.
  await setFeature(api, 'realtime', false);
});
