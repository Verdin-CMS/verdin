import { type Page, expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

import { admin, setFeature, signIn, unique } from './support';

/** Settings → Forms: fields, public submissions (valid, invalid, spam) and the inbox (0.9). */
test.describe.configure({ mode: 'serial' });

/** Adds a field and gives it a label, once its card is there. */
async function addField(page: Page, label: string) {
  const cards = page.locator('[data-form-field]');
  const before = await cards.count();
  await page.getByRole('button', { name: 'Add a field' }).click();
  await expect(cards).toHaveCount(before + 1);
  const card = cards.nth(before);
  await expect(card.getByLabel('Label')).toBeFocused();
  if (label) await card.getByLabel('Label').fill(label);
  return card;
}

test('a form takes public submissions and lists them in the admin', async ({ page, request }) => {
  await signIn(page);
  const api = await admin(page);
  await setFeature(api, 'forms', true);
  const run = unique();
  const slug = `contact-${run}`;

  await page.goto('/admin/settings/forms');
  await page.getByRole('link', { name: 'New form' }).first().click();
  await expect(page.getByRole('heading', { name: 'New form', level: 1 })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).first().fill(`Contact ${run}`);
  await expect(page.getByLabel('Slug')).toHaveValue(slug);

  // A new form starts with an email field.
  const cards = page.locator('[data-form-field]');
  await expect(cards).toHaveCount(1);
  const email = cards.first();
  await expect(email.getByLabel('Label')).toHaveValue('Email');
  await expect(email.getByLabel('Name', { exact: true })).toHaveValue('email');
  await expect(email.getByLabel('Type')).toHaveValue('email');
  await email.getByRole('checkbox', { name: 'Required' }).click();

  // The name follows the label until it is edited.
  const name = await addField(page, 'Your name');
  await expect(name.getByLabel('Name', { exact: true })).toHaveValue('yourName');
  await name.getByRole('checkbox', { name: 'Required' }).click();
  await name.getByLabel('Placeholder').fill('Ada Lovelace');

  const topic = await addField(page, 'Topic');
  await topic.getByLabel('Type').selectOption('select');
  await topic.getByLabel('Options').fill('Sales\nSupport');

  const age = await addField(page, 'Age');
  await age.getByLabel('Type').selectOption('number');

  const newsletter = await addField(page, 'Newsletter');
  await newsletter.getByLabel('Type').selectOption('checkbox');

  const message = await addField(page, 'Message');
  await message.getByLabel('Type').selectOption('textarea');
  await message.getByLabel('Maximum length').fill('200');

  // A field without a label or with the spam trap's name holds the save back.
  const broken = await addField(page, '');
  await broken.getByLabel('Name', { exact: true }).fill('_gotcha');
  await page.locator('[data-form-save]').click();
  await expect(page.getByText('Fix these problems, then save again')).toBeVisible();
  await expect(broken.getByText('Give the field a label.')).toBeVisible();
  await expect(broken.getByText("_gotcha is the spam trap's field.")).toBeVisible();
  await page.getByRole('button', { name: 'Remove Untitled field' }).click();
  await expect(cards).toHaveCount(6);
  // Reorder: the message goes above the checkbox.
  await page.getByRole('button', { name: 'Move Message up' }).click();
  await expect(cards.nth(4).getByLabel('Label')).toHaveValue('Message');

  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByLabel('Success message').fill('Thanks, we will write back.');
  await expect(page.getByRole('switch', { name: 'Spam trap' })).toBeChecked();
  await page.locator('[data-form-save]').click();
  await expect(page.getByText(`Contact ${run} created`)).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/settings\/forms\/\d+$/);

  // The definition sites render the form from.
  let definition = await request.get(`/api/_forms/${slug}`);
  await expect
    .poll(async () => (definition = await request.get(`/api/_forms/${slug}`)).status())
    .toBe(200);
  const served = (await definition.json()).data;
  expect(served.honeypot).toBe('_gotcha');
  expect(
    (served.fields as { name: string; type: string; required: boolean }[]).map(
      ({ name, type, required }) => `${name}:${type}:${required}`,
    ),
  ).toEqual([
    'email:email:true',
    'yourName:text:true',
    'topic:select:false',
    'age:number:false',
    'message:textarea:false',
    'newsletter:checkbox:false',
  ]);

  // A valid JSON submission, and a plain form post.
  const endpoint = `/api/_forms/${slug}`;
  const valid = await request.post(endpoint, {
    data: {
      data: {
        email: 'grace@example.com',
        yourName: 'Grace',
        topic: 'Support',
        age: 37,
        newsletter: true,
        message: 'My compiler is broken',
        extra: 'not a field',
      },
    },
  });
  expect(valid.status(), await valid.text()).toBe(201);
  expect((await valid.json()).data.message).toBe('Thanks, we will write back.');
  const posted = await request.post(endpoint, {
    form: { email: 'alan@example.com', yourName: 'Alan', topic: 'Sales', _gotcha: '' },
  });
  expect(posted.status(), await posted.text()).toBe(201);

  // An invalid one says what is wrong, field by field.
  const invalid = await request.post(endpoint, {
    data: { email: 'not an email', topic: 'Billing', age: 'old', message: 'x'.repeat(201) },
  });
  expect(invalid.status()).toBe(400);
  const errors = (await invalid.json()).error.details.errors as {
    path: string[];
    message: string;
  }[];
  expect(Object.fromEntries(errors.map((error) => [error.path[0], error.message]))).toEqual({
    email: 'must be an email address',
    yourName: 'is required',
    topic: 'is not one of the options',
    age: 'must be a number',
    message: 'is too long',
  });

  // A bot that fills the spam trap is told it worked, and nothing is stored.
  const spam = await request.post(endpoint, {
    data: { email: 'bot@example.com', yourName: 'Bot', _gotcha: 'http://spam.example.com' },
  });
  expect(spam.status()).toBe(201);

  // The inbox: the two real submissions, newest first.
  await page.getByRole('tab', { name: 'Submissions' }).click();
  const rows = page.locator('[data-submission]');
  await expect(rows).toHaveCount(2);
  await expect(page.getByText('2 in total')).toBeVisible();
  await expect(rows.nth(0)).toContainText('alan@example.com');
  await expect(rows.nth(1)).toContainText('grace@example.com');
  await expect(rows.nth(1)).toContainText('My compiler is broken');
  await expect(rows.nth(1)).toContainText('37');
  await expect(rows.nth(1)).toContainText('Yes');
  await expect(page.getByText('bot@example.com')).toHaveCount(0);
  await expect(page.getByText('not a field')).toHaveCount(0);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`${slug}-submissions.csv`);
  const csv = readFileSync(await file.path(), 'utf8');
  expect(csv).toContain('grace@example.com');
  expect(csv).toContain('alan@example.com');

  // Deleting a submission asks first.
  await rows
    .nth(0)
    .getByRole('button', { name: /^Delete submission \d+$/ })
    .click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('Delete this submission?');
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Submission deleted')).toBeVisible();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('grace@example.com');
});
