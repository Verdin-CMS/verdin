import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Runtime configuration injected by the server as `<meta name="verdin-config">`. */
export interface RuntimeConfig {
  apiBase: string;
  contentApiBase: string;
  /** `[admin.branding]`: read with `readBranding` (see `core/branding.ts`). */
  branding?: unknown;
}

export const RUNTIME_CONFIG = new InjectionToken<RuntimeConfig>('RUNTIME_CONFIG', {
  providedIn: 'root',
  factory: () => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="verdin-config"]');
    const fallback: RuntimeConfig = { apiBase: '/admin/api', contentApiBase: '/api' };
    try {
      return meta ? { ...fallback, ...JSON.parse(meta.content) } : fallback;
    } catch {
      return fallback;
    }
  },
});

/** A validation issue from `error.details.errors`. */
export interface Issue {
  path: (string | number)[];
  message: string;
}

/** An API error in Strapi's format. */
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly kind: string,
    message: string,
    readonly issues: Issue[] = [],
  ) {
    super(message);
  }

  static from(error: unknown): ApiFailure {
    if (error instanceof ApiFailure) return error;
    if (error instanceof HttpErrorResponse) {
      const body = error.error?.error;
      if (body && typeof body === 'object') {
        return new ApiFailure(
          error.status,
          body.name ?? 'Error',
          body.message ?? error.message,
          body.details?.errors ?? [],
        );
      }
      return new ApiFailure(
        error.status,
        'NetworkError',
        error.status === 0 ? 'The server is unreachable' : error.message,
      );
    }
    return new ApiFailure(0, 'Error', error instanceof Error ? error.message : String(error));
  }
}

export interface ListResponse<T> {
  data: T[];
  meta: { pagination?: import('./types').PageMeta };
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** Thin promise-based client for the admin API. Responses are unwrapped from `{ data }`. */
@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);
  private readonly config = inject(RUNTIME_CONFIG);

  get base(): string {
    return this.config.apiBase;
  }

  async request<T>(method: Method, path: string, body?: unknown, query?: string): Promise<T> {
    const url = `${this.config.apiBase}${path}${query ? `?${query}` : ''}`;
    try {
      const response = await firstValueFrom(
        this.http.request<{ data: T } | null>(method, url, { body, withCredentials: true }),
      );
      return (response?.data ?? null) as T;
    } catch (error) {
      throw ApiFailure.from(error);
    }
  }

  /** Like `request`, but keeps `meta` (lists). */
  async list<T>(path: string, query?: string): Promise<ListResponse<T>> {
    const url = `${this.config.apiBase}${path}${query ? `?${query}` : ''}`;
    try {
      return await firstValueFrom(this.http.get<ListResponse<T>>(url, { withCredentials: true }));
    } catch (error) {
      throw ApiFailure.from(error);
    }
  }

  /**
   * Every row of a paged admin list (`?page=&pageSize=`), 100 at a time: for pickers and
   * checks that need the whole list.
   */
  listAll<T>(path: string, query?: string): Promise<T[]> {
    return collectPages((page) =>
      this.list<T>(
        path,
        [query, `page=${page}&pageSize=${ALL_PAGE_SIZE}`].filter(Boolean).join('&'),
      ),
    );
  }

  /** A POST whose answer keeps its `meta` (e.g. `{ data, meta: { leftOut } }`). */
  async postWithMeta<T, M>(
    path: string,
    body?: unknown,
    query?: string,
  ): Promise<{ data: T; meta: M }> {
    const url = `${this.config.apiBase}${path}${query ? `?${query}` : ''}`;
    try {
      return await firstValueFrom(
        this.http.post<{ data: T; meta: M }>(url, body ?? {}, { withCredentials: true }),
      );
    } catch (error) {
      throw ApiFailure.from(error);
    }
  }

  /** A GET whose answer keeps its `meta` (e.g. `{ data, meta: { hidden } }`). */
  async getWithMeta<T, M>(path: string, query?: string): Promise<{ data: T; meta: M }> {
    const url = `${this.config.apiBase}${path}${query ? `?${query}` : ''}`;
    try {
      return await firstValueFrom(
        this.http.get<{ data: T; meta: M }>(url, { withCredentials: true }),
      );
    } catch (error) {
      throw ApiFailure.from(error);
    }
  }

  /**
   * A file from the API (with the admin's token, unlike a plain link), and the name the
   * server gives it in `Content-Disposition` (else `fallback`).
   */
  async download(path: string, query: string | undefined, fallback: string): Promise<Download> {
    const url = `${this.config.apiBase}${path}${query ? `?${query}` : ''}`;
    try {
      const response = await firstValueFrom(
        this.http.get(url, { withCredentials: true, observe: 'response', responseType: 'blob' }),
      );
      return {
        blob: response.body ?? new Blob([]),
        name: attachmentName(response.headers.get('Content-Disposition')) ?? fallback,
      };
    } catch (error) {
      // Error bodies arrive as blobs too: read them for the message.
      if (error instanceof HttpErrorResponse && error.error instanceof Blob) {
        let body: unknown = null;
        try {
          body = JSON.parse(await error.error.text());
        } catch {
          // Not JSON: the status text is all there is.
        }
        throw ApiFailure.from(
          new HttpErrorResponse({
            error: body,
            status: error.status,
            statusText: error.statusText,
            url: error.url ?? undefined,
          }),
        );
      }
      throw ApiFailure.from(error);
    }
  }

  get<T>(path: string, query?: string): Promise<T> {
    return this.request<T>('GET', path, undefined, query);
  }

  post<T>(path: string, body?: unknown, query?: string): Promise<T> {
    return this.request<T>('POST', path, body ?? {}, query);
  }

  put<T>(path: string, body: unknown, query?: string): Promise<T> {
    return this.request<T>('PUT', path, body, query);
  }

  delete(path: string, query?: string): Promise<void> {
    return this.request<void>('DELETE', path, undefined, query);
  }
}

/** The largest page the admin API serves. */
export const ALL_PAGE_SIZE = 100;

/** The rows of every page `load` gives, until the last one (at most `maxPages`). */
export async function collectPages<T>(
  load: (page: number) => Promise<ListResponse<T>>,
  maxPages = 100,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const response = await load(page);
    rows.push(...response.data);
    if (!response.data.length || page >= (response.meta?.pagination?.pageCount ?? 1)) break;
  }
  return rows;
}

/** A downloaded file. */
export interface Download {
  blob: Blob;
  name: string;
}

/** The file name of a `Content-Disposition: attachment; filename="…"` header. */
export function attachmentName(header: string | null): string | null {
  if (!header) return null;
  const encoded = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(header);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim().replace(/^"|"$/g, '')) || null;
    } catch {
      // Malformed: try the plain parameter.
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header);
  const name = (plain?.[2] ?? plain?.[1] ?? '').trim();
  return name || null;
}

/** Saves `download` on the user's device, as a link click would. */
export function saveDownload(download: Download): void {
  const url = URL.createObjectURL(download.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = download.name;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser time to start reading the file.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Encodes nested query parameters in Strapi's bracket notation. */
export function toQuery(value: Record<string, unknown>, prefix = ''): string {
  const parts: string[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null || item === '') continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof item === 'object') {
      const nested = toQuery(item as Record<string, unknown>, name);
      if (nested) parts.push(nested);
    } else {
      parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(item))}`);
    }
  }
  return parts.join('&');
}
