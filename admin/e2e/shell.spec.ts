import { type Page, expect, test } from '@playwright/test';

/** The shell's page titles, skip link and focus after navigation. */
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

test('titles pages, skips to the content and focuses the heading after a navigation', async ({
  page,
}) => {
  await signIn(page);
  await expect(page).toHaveTitle('Home · Verdin');

  // The skip link is the first stop and lands on the page's heading.
  await page.goto('/admin/settings/webhooks');
  await expect(page).toHaveTitle('Webhooks · Settings · Verdin');
  await page.keyboard.press('Tab');
  const skip = page.getByTestId('skip-link');
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Webhooks' })).toBeFocused();

  // A navigation moves the focus to the new page's heading.
  await page.getByRole('link', { name: 'API tokens' }).click();
  await expect(page).toHaveTitle('API tokens · Settings · Verdin');
  await expect(page.getByRole('heading', { level: 1, name: 'API tokens' })).toBeFocused();
});
