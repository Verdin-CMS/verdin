/**
 * A typed client for the Verdin content API.
 *
 * ```ts
 * import { createClient } from '@verdin/client';
 * import type { VerdinSchema } from './verdin-types'; // `verdin types -o verdin-types.ts`
 *
 * const verdin = createClient<VerdinSchema>({ url: 'https://cms.example.com', token: process.env.VERDIN_TOKEN });
 * const { data } = await verdin.collection('articles').find({
 *   filters: { title: { $containsi: 'rust' } },
 *   populate: { category: true, cover: true },
 *   sort: ['publishedAt:desc'],
 *   pagination: { pageSize: 10 },
 * });
 * ```
 */

/** The shape `verdin types` generates; any schema works without it. */
export interface SchemaShape {
  collections: Record<string, { document: unknown; input: unknown }>;
  singles: Record<string, { document: unknown; input: unknown }>;
}

type AnySchema = {
  collections: Record<string, { document: Record<string, unknown>; input: Record<string, unknown> }>;
  singles: Record<string, { document: Record<string, unknown>; input: Record<string, unknown> }>;
};

export interface ClientOptions {
  /** Server origin, e.g. `https://cms.example.com`. */
  url: string;
  /** An API token (sent as `Authorization: Bearer …`); omit for the public role. */
  token?: string;
  /** Content API prefix (`[api].prefix`). */
  prefix?: string;
  /** Custom fetch (tests, Next.js caching options…). */
  fetch?: typeof fetch;
  /** Extra headers for every request. */
  headers?: Record<string, string>;
}

export type Status = 'draft' | 'published';

/** Query parameters (Strapi v5 format). */
export interface QueryParams {
  filters?: Record<string, unknown>;
  populate?: '*' | string | string[] | Record<string, unknown>;
  fields?: string[];
  sort?: string | string[];
  pagination?: { page?: number; pageSize?: number; withCount?: boolean } | { start?: number; limit?: number; withCount?: boolean };
  status?: Status;
  locale?: string;
}

export interface Pagination {
  page?: number;
  pageSize?: number;
  pageCount?: number;
  start?: number;
  limit?: number;
  total?: number;
}

export interface ListResponse<T> {
  data: T[];
  meta: { pagination: Pagination };
}

export interface SingleResponse<T> {
  data: T;
  meta: Record<string, unknown>;
}

/** An error response, in Strapi's format. */
export class VerdinError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(status: number, name: string, message: string, details: unknown) {
    super(message);
    this.status = status;
    this.name = name;
    this.details = details;
  }
}

/** Serializes nested parameters in bracket notation: `filters[title][$eq]=x`. */
export function stringify(params: Record<string, unknown>, prefix = ''): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (value === null) {
      parts.push(`${encodeURIComponent(name)}=null`);
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (item !== null && typeof item === 'object') {
          parts.push(stringify(item as Record<string, unknown>, `${name}[${index}]`));
        } else if (item !== undefined) {
          parts.push(`${encodeURIComponent(`${name}[${index}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (value instanceof Date) {
      parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(value.toISOString())}`);
    } else if (typeof value === 'object') {
      const nested = stringify(value as Record<string, unknown>, name);
      if (nested) parts.push(nested);
    } else {
      parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.filter(Boolean).join('&');
}

export class Client<S extends SchemaShape = AnySchema> {
  private readonly options: ClientOptions;
  private readonly base: string;
  private readonly fetcher: typeof fetch;

  constructor(options: ClientOptions) {
    this.options = options;
    const prefix = options.prefix ?? '/api';
    this.base = `${options.url.replace(/\/+$/, '')}${prefix}`;
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /** A collection type by its route (`pluralName`). */
  collection<K extends keyof S['collections'] & string>(route: K): Collection<S['collections'][K]['document'], S['collections'][K]['input']> {
    return new Collection(this, route);
  }

  /** A single type by its route (`singularName`). */
  single<K extends keyof S['singles'] & string>(route: K): Single<S['singles'][K]['document'], S['singles'][K]['input']> {
    return new Single(this, route);
  }

  /** Uploads files to the media library (`plugin::upload` create grant). */
  async upload(
    files: Array<Blob | File> | Blob | File,
    info?: { name?: string; alternativeText?: string; caption?: string } | Array<{ name?: string; alternativeText?: string; caption?: string }>,
  ): Promise<MediaFile[]> {
    const form = new FormData();
    const list = Array.isArray(files) ? files : [files];
    for (const file of list) form.append('files', file, 'name' in file ? file.name : 'file');
    if (info) form.append('fileInfo', JSON.stringify(info));
    return this.request<MediaFile[]>('POST', '/upload', { body: form });
  }

  /** Files of the media library (`plugin::upload` find grant). */
  files(params: { page?: number; pageSize?: number; sort?: string; search?: string } = {}): Promise<MediaFile[]> {
    const query = stringify({
      pagination: { page: params.page, pageSize: params.pageSize },
      sort: params.sort,
      filters: params.search ? { name: { $containsi: params.search } } : undefined,
    });
    return this.request<MediaFile[]>('GET', `/upload/files${query ? `?${query}` : ''}`);
  }

  /** Runs a GraphQL operation (the `graphql` feature must be on). */
  async graphql<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await this.fetcher(`${this.options.url.replace(/\/+$/, '')}/graphql`, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ query, variables }),
    });
    const body = (await response.json()) as { data?: T; errors?: Array<{ message: string; extensions?: unknown }> };
    if (body.errors?.length) {
      const [first] = body.errors;
      throw new VerdinError(response.status, 'GraphQLError', first?.message ?? 'GraphQL error', body.errors);
    }
    return body.data as T;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { accept: 'application/json', ...this.options.headers, ...extra };
    if (this.options.token) headers['authorization'] = `Bearer ${this.options.token}`;
    return headers;
  }

  /** @internal */
  async request<T>(method: string, path: string, init: { json?: unknown; body?: BodyInit } = {}): Promise<T> {
    const headers = this.headers(init.json !== undefined ? { 'content-type': 'application/json' } : {});
    const response = await this.fetcher(`${this.base}${path}`, {
      method,
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    });
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    const body = text ? (JSON.parse(text) as unknown) : undefined;
    if (!response.ok) {
      const error = (body as { error?: { name?: string; message?: string; details?: unknown } } | undefined)?.error;
      throw new VerdinError(response.status, error?.name ?? 'Error', error?.message ?? response.statusText, error?.details);
    }
    return body as T;
  }
}

function withQuery(path: string, params?: QueryParams): string {
  const query = params ? stringify(params as Record<string, unknown>) : '';
  return query ? `${path}?${query}` : path;
}

export class Collection<D, I> {
  private readonly client: Client<SchemaShape>;
  private readonly route: string;

  constructor(client: Client<SchemaShape>, route: string) {
    this.client = client;
    this.route = route;
  }

  find(params?: QueryParams): Promise<ListResponse<D>> {
    return this.client.request('GET', withQuery(`/${this.route}`, params));
  }

  findOne(documentId: string, params?: Omit<QueryParams, 'filters' | 'pagination' | 'sort'>): Promise<SingleResponse<D>> {
    return this.client.request('GET', withQuery(`/${this.route}/${encodeURIComponent(documentId)}`, params));
  }

  /** Publishes unless `status: 'draft'` (Strapi v5 behaviour). */
  create(data: I, params?: Pick<QueryParams, 'status' | 'populate' | 'fields'>): Promise<SingleResponse<D>> {
    return this.client.request('POST', withQuery(`/${this.route}`, params), { json: { data } });
  }

  update(documentId: string, data: I, params?: Pick<QueryParams, 'status' | 'populate' | 'fields'>): Promise<SingleResponse<D>> {
    return this.client.request('PUT', withQuery(`/${this.route}/${encodeURIComponent(documentId)}`, params), { json: { data } });
  }

  delete(documentId: string): Promise<void> {
    return this.client.request('DELETE', `/${this.route}/${encodeURIComponent(documentId)}`);
  }

  publish(documentId: string): Promise<SingleResponse<D>> {
    return this.action(documentId, 'publish');
  }

  unpublish(documentId: string): Promise<SingleResponse<D>> {
    return this.action(documentId, 'unpublish');
  }

  discardDraft(documentId: string): Promise<SingleResponse<D>> {
    return this.action(documentId, 'discard-draft');
  }

  private action(documentId: string, action: string): Promise<SingleResponse<D>> {
    return this.client.request('POST', `/${this.route}/${encodeURIComponent(documentId)}/actions/${action}`);
  }
}

export class Single<D, I> {
  private readonly client: Client<SchemaShape>;
  private readonly route: string;

  constructor(client: Client<SchemaShape>, route: string) {
    this.client = client;
    this.route = route;
  }

  find(params?: Omit<QueryParams, 'filters' | 'pagination' | 'sort'>): Promise<SingleResponse<D>> {
    return this.client.request('GET', withQuery(`/${this.route}`, params));
  }

  /** Creates the document on first write. */
  update(data: I, params?: Pick<QueryParams, 'status' | 'populate' | 'fields'>): Promise<SingleResponse<D>> {
    return this.client.request('PUT', withQuery(`/${this.route}`, params), { json: { data } });
  }

  delete(): Promise<void> {
    return this.client.request('DELETE', `/${this.route}`);
  }
}

/** A media library file (see `verdin types` for the full shape). */
export interface MediaFile {
  id: number;
  documentId: string;
  name: string;
  alternativeText: string | null;
  caption: string | null;
  width: number | null;
  height: number | null;
  formats: Record<string, { url: string; width: number; height: number }> | null;
  mime: string;
  size: number;
  url: string;
  [key: string]: unknown;
}

export function createClient<S extends SchemaShape = AnySchema>(options: ClientOptions): Client<S> {
  return new Client<S>(options);
}
