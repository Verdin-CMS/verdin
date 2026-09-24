import {
  HttpClient,
  HttpErrorResponse,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, firstValueFrom, from, switchMap, throwError } from 'rxjs';

import { ApiFailure, RUNTIME_CONFIG } from './api';
import { AdminUser, PermissionSet } from './types';

interface SessionResponse {
  data: { user: AdminUser; accessToken: string; accessTokenExpiresAt: string };
}

/** Header the server requires on refresh/logout (anti-CSRF). */
const CSRF_HEADER = { 'X-Verdin-CSRF': '1' };

/**
 * The admin session. The access token lives only in memory; the refresh token is an
 * HttpOnly cookie the browser sends to the auth routes.
 */
@Injectable({ providedIn: 'root' })
export class Auth {
  private readonly http = inject(HttpClient);
  private readonly config = inject(RUNTIME_CONFIG);
  private readonly router = inject(Router);

  readonly user = signal<AdminUser | null>(null);
  readonly permissions = signal<PermissionSet>({ superAdmin: false, permissions: [] });
  readonly accessToken = signal<string | null>(null);
  readonly loggedIn = computed(() => this.user() !== null);

  private restored: Promise<void> | null = null;
  private refreshing: Promise<boolean> | null = null;

  private url(path: string): string {
    return `${this.config.apiBase}/auth${path}`;
  }

  /** Restores a session from the refresh cookie, once. */
  restore(): Promise<void> {
    this.restored ??= this.refresh().then(() => undefined);
    return this.restored;
  }

  async hasAdmin(): Promise<boolean> {
    const response = await firstValueFrom(
      this.http.get<{ data: { hasAdmin: boolean } }>(this.url('/status')),
    );
    return response.data.hasAdmin;
  }

  async login(email: string, password: string): Promise<void> {
    await this.open(
      this.http.post<SessionResponse>(
        this.url('/login'),
        { email, password },
        { withCredentials: true },
      ),
    );
  }

  async register(input: {
    email: string;
    password: string;
    firstname?: string;
    lastname?: string;
  }): Promise<void> {
    await this.open(
      this.http.post<SessionResponse>(this.url('/register-first-admin'), input, {
        withCredentials: true,
      }),
    );
  }

  /** Rotates the refresh cookie for a new access token. Concurrent callers share one call. */
  refresh(): Promise<boolean> {
    this.refreshing ??= (async () => {
      try {
        await this.open(
          this.http.post<SessionResponse>(
            this.url('/refresh'),
            {},
            { withCredentials: true, headers: CSRF_HEADER },
          ),
        );
        return true;
      } catch {
        this.clear();
        return false;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(this.url('/logout'), {}, { withCredentials: true, headers: CSRF_HEADER }),
      );
    } finally {
      this.clear();
      await this.router.navigateByUrl('/login');
    }
  }

  clear(): void {
    this.user.set(null);
    this.accessToken.set(null);
    this.permissions.set({ superAdmin: false, permissions: [] });
  }

  /** Whether the admin holds a non-content permission (`users.manage`, …). */
  can(action: string): boolean {
    const set = this.permissions();
    return set.superAdmin || set.permissions.some((permission) => permission.action === action);
  }

  /** Whether the admin holds a content action on `uid` (possibly restricted to own entries). */
  canContent(action: string, uid: string): boolean {
    const set = this.permissions();
    return (
      set.superAdmin ||
      set.permissions.some(
        (permission) =>
          permission.action === action &&
          (permission.subject === '*' || permission.subject === uid),
      )
    );
  }

  private async open(request: ReturnType<HttpClient['post']>): Promise<void> {
    try {
      const response = (await firstValueFrom(request)) as SessionResponse;
      this.accessToken.set(response.data.accessToken);
      this.user.set(response.data.user);
      const me = await firstValueFrom(
        this.http.get<{ data: { permissions: PermissionSet } }>(this.url('/me'), {
          headers: { Authorization: `Bearer ${response.data.accessToken}` },
        }),
      );
      this.permissions.set(me.data.permissions);
    } catch (error) {
      throw ApiFailure.from(error);
    }
  }
}

function isAuthRoute(request: HttpRequest<unknown>): boolean {
  return /\/auth\/(login|refresh|logout|register-first-admin|status|me)$/.test(
    request.url.split('?')[0],
  );
}

/** Adds the access token; on a 401, refreshes once and retries. */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(Auth);
  const router = inject(Router);
  if (isAuthRoute(request)) return next(request);

  const withToken = (token: string | null) =>
    token ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : request;

  return next(withToken(auth.accessToken())).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401)
        return throwError(() => error);
      return from(auth.refresh()).pipe(
        switchMap((ok) => {
          if (!ok) {
            void router.navigateByUrl('/login');
            return throwError(() => error);
          }
          return next(withToken(auth.accessToken()));
        }),
      );
    }),
  );
};

/** Routes that need a session. */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(Auth);
  const router = inject(Router);
  await auth.restore();
  return auth.loggedIn()
    ? true
    : router.createUrlTree(['/login'], { queryParams: { next: state.url } });
};

/** Login/registration pages: skip them when already logged in. */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(Auth);
  const router = inject(Router);
  await auth.restore();
  return auth.loggedIn() ? router.createUrlTree(['/']) : true;
};
