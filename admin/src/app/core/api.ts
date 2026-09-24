import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Runtime configuration injected by the server as `<meta name="verdin-config">`. */
export interface RuntimeConfig {
  apiBase: string;
  contentApiBase: string;
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

  get<T>(path: string, query?: string): Promise<T> {
    return this.request<T>('GET', path, undefined, query);
  }

  post<T>(path: string, body?: unknown, query?: string): Promise<T> {
    return this.request<T>('POST', path, body ?? {}, query);
  }

  put<T>(path: string, body: unknown, query?: string): Promise<T> {
    return this.request<T>('PUT', path, body, query);
  }

  delete(path: string): Promise<void> {
    return this.request<void>('DELETE', path);
  }
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
