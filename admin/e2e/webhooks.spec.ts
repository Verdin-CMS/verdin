import { expect, test } from '@playwright/test';
import { createHmac, timingSafeEqual } from 'node:crypto';

import { type Api, type Received, admin, ensureType, listen, signIn, unique } from './support';

/** Settings → Webhooks: signed deliveries to a local receiver, the delivery log, retries. */
test.describe.configure({ mode: 'serial' });

async function ensureTypes(api: Api): Promise<void> {
  for (const [name, displayName] of [
    ['parcel', 'Parcel'],
    ['hamper', 'Hamper'],
  ]) {
    await ensureType(api, name, {
      kind: 'collectionType',
      singularName: name,
      pluralName: `${name}s`,
      displayName,
      options: { draftAndPublish: false },
      attributes: { title: { type: 'string' } },
    });
  }
}

/** Checks `x-verdin-signature` (`t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<body>">`). */
function verify(request: Received, secret: string): boolean {
  const header = String(request.headers['x-verdin-signature'] ?? '');
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header);
  if (!match) return false;
  const [, timestamp, signature] = match;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${request.raw}`).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

test('entry events reach a signed webhook and show in its delivery log', async ({ page }) => {
  await signIn(page);
  const api = await admin(page);
  await ensureTypes(api);
  // The receiver refuses the first update, to leave a failed delivery in the log.
  let refuseUpdate = true;
  const receiver = await listen((request, response) => {
    if (request.headers['x-verdin-event'] === 'entry.update' && refuseUpdate) {
      refuseUpdate = false;
      response.statusCode = 500;
      response.end('try later');
      return;
    }
    response.end('thanks');
  });
  const name = `Parcels ${unique()}`;

  await page.goto('/admin/settings/webhooks');
  await page.getByRole('link', { name: 'New webhook' }).first().click();
  await expect(page.getByRole('heading', { name: 'New webhook', level: 1 })).toBeVisible();
  await page.locator('#webhook-name').fill(name);
  await page.getByLabel('URL', { exact: true }).fill(`${receiver.url}/hooks/parcels`);
  // Every entry event is on by default: keep only create and update. The checkboxes
  // render their state after the click, so wait for it each time.
  const entries = page.getByRole('checkbox', { name: 'Entries', exact: true });
  await expect(entries).toBeChecked();
  await entries.click();
  await expect(page.getByLabel('entry.publish', { exact: true })).not.toBeChecked();
  for (const event of ['entry.create', 'entry.update']) {
    await page.getByLabel(event, { exact: true }).click();
    await expect(page.getByLabel(event, { exact: true })).toBeChecked();
  }
  // Only parcels, not hampers.
  await page.getByLabel('All content types').click();
  await expect(page.getByLabel('All content types')).not.toBeChecked();
  await page.getByRole('checkbox', { name: /Parcel/ }).click();
  await expect(page.getByRole('checkbox', { name: /Parcel/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Hamper/ })).not.toBeChecked();
  await page.getByRole('button', { name: 'Add header' }).click();
  const headerValue = page.getByRole('textbox', { name: 'Value', exact: true });
  await expect(headerValue).toBeVisible();
  await page.getByPlaceholder('Name', { exact: true }).fill('x-team');
  await headerValue.fill('e2e');
  await page.getByRole('button', { name: 'Create' }).click();

  // The secret shows once.
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Copy the signing secret' })).toBeVisible();
  const secret = await dialog.getByLabel('Signing secret').inputValue();
  expect(secret).toMatch(/^whsec_[0-9a-f]{48}$/);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page).toHaveURL(/\/admin\/settings\/webhooks\/\d+$/);
  await expect(page.getByText('Signed', { exact: true })).toBeVisible();

  // A parcel is created: one signed delivery. A hamper is left out.
  const hamper = await api.post('/content/api::hamper', { data: { title: 'Not for this hook' } });
  expect(hamper.status(), await hamper.text()).toBe(201);
  const created = await api.post('/content/api::parcel', { data: { title: 'Books' } });
  expect(created.status(), await created.text()).toBe(201);
  const documentId = (await created.json()).data.documentId as string;
  await expect.poll(() => receiver.received.length).toBe(1);
  const delivery = receiver.received[0];
  expect(delivery.method).toBe('POST');
  expect(delivery.path).toBe('/hooks/parcels');
  expect(delivery.headers['x-verdin-event']).toBe('entry.create');
  expect(delivery.headers['x-verdin-delivery']).toMatch(/^\d+$/);
  expect(delivery.headers['x-team']).toBe('e2e');
  expect(delivery.headers['content-type']).toBe('application/json');
  expect(verify(delivery, secret)).toBe(true);
  // A wrong secret or a changed body do not verify.
  expect(verify(delivery, 'whsec_wrong')).toBe(false);
  expect(verify({ ...delivery, raw: delivery.raw.replace('Books', 'Bombs') }, secret)).toBe(false);
  const payload = JSON.parse(delivery.raw);
  expect(payload).toMatchObject({
    event: 'entry.create',
    uid: 'api::parcel',
    model: 'parcel',
    entry: { documentId, title: 'Books' },
  });

  // The log lists it, with its payload.
  const log = page.getByRole('row').filter({ hasText: 'entry.create' });
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(log).toContainText('Succeeded');
  await expect(log).toContainText('200');
  await log.getByRole('button', { name: 'Delivery details' }).click();
  const details = page.getByRole('dialog');
  await expect(details).toContainText(`Delivery #${delivery.headers['x-verdin-delivery']}`);
  await expect(details).toContainText('"title": "Books"');
  await expect(details).toContainText('thanks');
  await page.keyboard.press('Escape');
  await expect(details).toHaveCount(0);

  // An update the receiver refuses stays pending for a retry (the first one in 30 s);
  // redelivered now, it goes through.
  const updated = await api.put(`/content/api::parcel/${documentId}`, { data: { title: 'Maps' } });
  expect(updated.status(), await updated.text()).toBe(200);
  await expect.poll(() => receiver.received.length).toBe(2);
  const refused = page.getByRole('row').filter({ hasText: 'entry.update' });
  await expect
    .poll(async () => {
      await page.getByRole('button', { name: 'Refresh' }).click();
      return refused.textContent();
    })
    .toContain('500');
  await expect(refused).toContainText('Pending');
  const deliveryId = receiver.received[1].headers['x-verdin-delivery'];
  const redelivered = await api.post(`/webhooks/deliveries/${deliveryId}/retry`, {});
  expect(redelivered.status(), await redelivered.text()).toBe(200);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(refused).toContainText('Succeeded');
  await expect(refused).toContainText('200');
  expect(receiver.received).toHaveLength(3);
  expect(receiver.received[2].headers['x-verdin-delivery']).toBe(deliveryId);
  expect(verify(receiver.received[2], secret)).toBe(true);

  // The test button sends a signed ping.
  await page.getByRole('button', { name: 'Send test event' }).click();
  await expect(page.getByText(/Delivered: HTTP 200 in \d+ ms/).first()).toBeVisible();
  await expect.poll(() => receiver.received.length).toBe(4);
  const ping = receiver.received[3];
  expect(ping.headers['x-verdin-event']).toBe('trigger-test');
  expect(verify(ping, secret)).toBe(true);
  await expect(page.getByRole('row').filter({ hasText: 'trigger-test' })).toContainText(
    'Succeeded',
  );

  // Without a secret, deliveries are not signed.
  await page.getByRole('button', { name: 'Stop signing' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Stop signing' }).click();
  await expect(page.getByText('Not signed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Send test event' }).click();
  await expect.poll(() => receiver.received.length).toBe(5);
  expect(receiver.received[4].headers['x-verdin-signature']).toBeUndefined();
  await receiver.close();
});

test('a webhook that cannot be reached reports the failure on test', async ({ page }) => {
  await signIn(page);
  const api = await admin(page);
  // A port nothing listens on: start a receiver and close it.
  const gone = await listen();
  await gone.close();
  const created = await api.post('/webhooks', {
    name: `Gone ${unique()}`,
    url: `${gone.url}/hook`,
    events: ['entry.publish'],
  });
  expect(created.status(), await created.text()).toBe(201);
  const id = (await created.json()).data.id as number;

  await page.goto(`/admin/settings/webhooks/${id}`);
  await page.getByRole('button', { name: 'Send test event' }).click();
  await expect(page.getByText(/Delivery failed \(HTTP —, \d+ ms\)/)).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'trigger-test' });
  await expect(row).toContainText('Failed');
  await expect(row.getByRole('cell').nth(4)).toHaveText('1');
  // Retrying by hand tries again, and fails again.
  await row.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText(/Delivery failed \(HTTP —, \d+ ms\)/).first()).toBeVisible();
  await expect(row.getByRole('cell').nth(4)).toHaveText('2');
  await expect(row).toContainText('Failed');
  const removed = await api.delete(`/webhooks/${id}`);
  expect(removed.status()).toBeLessThan(300);
});
