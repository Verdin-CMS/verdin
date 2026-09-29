import { type APIRequestContext, type Browser, type Page, expect } from '@playwright/test';
import { type IncomingHttpHeaders, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Shared helpers of the feature specs (deployments, redirects, menus, forms, webhooks,
 * end users, presence). Every spec creates its own data, so they run in any order after
 * `flow.spec.ts` (which registers the first administrator on the fresh database).
 */

export const ADMIN = { email: 'ada@example.com', password: 'correct horse 1' };

/** Signs in as the first administrator (registering it when the database is new). */
export async function signIn(page: Page): Promise<void> {
  // Ask the server first: the login page shows before it moves to the register page.
  const status = await page.request.get('/admin/api/auth/status');
  const hasAdmin = (await status.json()).data.hasAdmin as boolean;
  await page.goto(hasAdmin ? '/admin/login' : '/admin/register');
  if (!hasAdmin) {
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

/** Signs in another admin in a browser context of its own. */
export async function signInAs(
  browser: Browser,
  email: string,
  password: string,
  firstname: string,
): Promise<Page> {
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: `Hello, ${firstname}` })).toBeVisible();
  return page;
}

/** The admin API as the page's signed-in admin. */
export async function admin(page: Page) {
  const refreshed = await page.request.post('/admin/api/auth/refresh', {
    headers: { 'x-verdin-csrf': '1' },
  });
  expect(refreshed.status(), await refreshed.text()).toBe(200);
  const headers = { authorization: `Bearer ${(await refreshed.json()).data.accessToken}` };
  const request: APIRequestContext = page.request;
  return {
    get: (path: string) => request.get(`/admin/api${path}`, { headers }),
    post: (path: string, data: unknown) => request.post(`/admin/api${path}`, { headers, data }),
    put: (path: string, data: unknown) => request.put(`/admin/api${path}`, { headers, data }),
    delete: (path: string) => request.delete(`/admin/api${path}`, { headers }),
  };
}

export type Api = Awaited<ReturnType<typeof admin>>;

/**
 * Switches a feature (Settings → Features) and waits until `probe` (a public or admin
 * request, 404 while the feature is off) follows: the server rebuilds its routes.
 */
export async function setFeature(
  api: Api,
  id: string,
  enabled: boolean,
  probe?: () => Promise<number>,
): Promise<void> {
  const saved = await api.put(`/features/${id}`, { enabled, settings: null });
  expect(saved.status(), await saved.text()).toBe(200);
  if (!probe) return;
  await expect.poll(async () => (await probe()) !== 404, { timeout: 10_000 }).toBe(enabled);
}

/** Creates a collection type (once) from its schema. */
export async function ensureType(
  api: Api,
  name: string,
  schema: Record<string, unknown>,
): Promise<void> {
  const types = (await (await api.get('/content-types')).json()).data as { uid: string }[];
  if (types.some((type) => type.uid === `api::${name}`)) return;
  const applied = await api.post('/schema/apply', {
    contentTypes: { [name]: schema },
    components: {},
    renameTables: [],
    renameColumns: [],
    allow: 'safe',
  });
  expect(applied.status(), await applied.text()).toBeLessThan(300);
}

/** One request a {@link Listener} received. */
export interface Received {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  /** The raw body, as sent (signatures are computed over it). */
  raw: string;
}

/** A local HTTP server that records requests; `answer` picks the reply (200 by default). */
export interface Listener {
  url: string;
  received: Received[];
  close(): Promise<void>;
}

export async function listen(
  answer: (request: Received, response: ServerResponse) => void = (_, response) =>
    response.end('ok'),
): Promise<Listener> {
  const received: Received[] = [];
  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => (raw += chunk));
    request.on('end', () => {
      const entry = {
        method: request.method ?? '',
        path: request.url ?? '',
        headers: request.headers,
        raw,
      };
      received.push(entry);
      answer(entry, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    received,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** A suffix that keeps the data of each run apart (the database lives for the whole suite). */
export function unique(): string {
  return Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
}
