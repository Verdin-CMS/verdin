import { expect, test } from '@playwright/test';

import { admin, ensureType, setFeature, signIn, unique } from './support';

/** End users: sign-up and sign-in over the content API, roles and blocking in the admin. */
test.describe.configure({ mode: 'serial' });

test('end users sign up, get a role with permissions and are blocked', async ({
  page,
  request,
}) => {
  await signIn(page);
  const api = await admin(page);
  await ensureType(api, 'recipe', {
    kind: 'collectionType',
    singularName: 'recipe',
    pluralName: 'recipes',
    displayName: 'Recipe',
    options: { draftAndPublish: false },
    attributes: { title: { type: 'string' } },
  });
  const run = unique();
  const soup = await api.post('/content/api::recipe', { data: { title: `Soup ${run}` } });
  expect(soup.status(), await soup.text()).toBe(201);
  // `/users/me` is 401 without a token once the feature is on, 404 while it is off.
  await setFeature(api, 'users', true, async () => (await request.get('/api/users/me')).status());

  // Sign up, then sign in with the email.
  const username = `cook-${run}`;
  const email = `${username}@example.com`;
  const password = 'correct horse 1';
  const signUp = await request.post('/api/auth/local/register', {
    data: { username, email, password },
  });
  expect(signUp.status(), await signUp.text()).toBe(200);
  expect((await signUp.json()).user).toMatchObject({ username, email, blocked: false });
  const signInAs = () => request.post('/api/auth/local', { data: { identifier: email, password } });
  const login = await signInAs();
  expect(login.status(), await login.text()).toBe(200);
  const jwt = (await login.json()).jwt as string;
  const auth = { authorization: `Bearer ${jwt}` };
  const me = await request.get('/api/users/me', { headers: auth });
  expect((await me.json()).username).toBe(username);
  // Wrong password; and the Authenticated role may not read recipes yet.
  const wrong = await request.post('/api/auth/local', {
    data: { identifier: email, password: 'wrong password' },
  });
  expect(wrong.status()).toBe(400);
  expect((await request.get('/api/recipes', { headers: auth })).status()).toBe(403);

  // A role that may read recipes.
  const role = `Cooks ${run}`;
  await page.goto('/admin/settings/end-users/roles');
  await page.getByRole('link', { name: 'Create role' }).click();
  await expect(page.getByRole('heading', { name: 'New role', level: 1 })).toBeVisible();
  await page.getByLabel('Name').fill(role);
  await page.getByLabel('Description').fill('Read the recipes');
  for (const action of ['find', 'findOne']) {
    const box = page.getByRole('checkbox', { name: `Recipe ${action}`, exact: true });
    await box.click();
    await expect(box).toBeChecked();
  }
  await expect(page.getByText('2 actions allowed')).toBeVisible();
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText(`${role} created`)).toBeVisible();

  // The user gets the role from the admin.
  await page.goto('/admin/settings/end-users/users');
  await page.getByRole('searchbox', { name: 'Search' }).fill(username);
  const row = page.getByRole('row').filter({ hasText: email });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Authenticated');
  await expect(row).toContainText('Email & password');
  await row.getByRole('button', { name: `Edit ${username}` }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Edit user' })).toBeVisible();
  await expect(dialog.getByLabel('Email')).toHaveValue(email);
  await dialog.getByLabel('Role').selectOption({ label: role });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(`${username} saved`)).toBeVisible();
  await expect(row).toContainText(role);

  const recipes = await request.get('/api/recipes', { headers: auth });
  expect(recipes.status(), await recipes.text()).toBe(200);
  expect(((await recipes.json()).data as { title: string }[]).map((item) => item.title)).toContain(
    `Soup ${run}`,
  );
  // Reading is all the role allows.
  const create = await request.post('/api/recipes', {
    headers: auth,
    data: { data: { title: 'Not mine to write' } },
  });
  expect(create.status()).toBe(403);

  // Blocked: no sign-in, and the token stops working.
  await row.getByRole('button', { name: `Block ${username}` }).click();
  await expect(page.getByText(`${username} is blocked`)).toBeVisible();
  await expect(row).toContainText('Blocked');
  const blocked = await signInAs();
  expect(blocked.status()).toBe(400);
  expect(JSON.stringify(await blocked.json())).toContain('blocked');
  expect((await request.get('/api/users/me', { headers: auth })).status()).not.toBe(200);
  await row.getByRole('button', { name: `Unblock ${username}` }).click();
  await expect(page.getByText(`${username} is unblocked`)).toBeVisible();
  expect((await signInAs()).status()).toBe(200);

  // An account added by an admin signs in too, and is deleted after confirming.
  const added = `chef-${run}`;
  await page.getByRole('button', { name: 'Add user' }).click();
  await dialog.getByLabel('Username').fill(added);
  await dialog.getByLabel('Email').fill(`${added}@example.com`);
  await dialog.getByLabel('Password').fill('another horse 1');
  await dialog.getByLabel('Role').selectOption({ label: role });
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText(`${added} created`)).toBeVisible();
  const chef = await request.post('/api/auth/local', {
    data: { identifier: added, password: 'another horse 1' },
  });
  expect(chef.status(), await chef.text()).toBe(200);
  await page.getByRole('searchbox', { name: 'Search' }).fill(added);
  const chefRow = page.getByRole('row').filter({ hasText: `${added}@example.com` });
  await chefRow.getByRole('button', { name: `Delete ${added}` }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText(`${added} deleted`)).toBeVisible();
  await expect(chefRow).toHaveCount(0);

  // The roles list counts the role's user and permissions.
  await page.goto('/admin/settings/end-users/roles');
  const roleRow = page.getByRole('row').filter({ hasText: role });
  await expect(roleRow).toContainText('1 user');
  await expect(roleRow).toContainText('2 permissions');
});
