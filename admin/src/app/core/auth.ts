import {
  HttpClient,
  HttpErrorResponse,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Observable, catchError, firstValueFrom, from, of, switchMap, throwError } from 'rxjs';

import { ApiFailure, RUNTIME_CONFIG } from './api';
import { grantsInLocale } from './permissions';
import { SecondStep, isTwoFactorRequired, secondStepOf } from './two-factor';
import { AdminUser, PermissionSet } from './types';
import { AssertionJson, RequestOptionsJson } from './webauthn';

/** What login, accepting an invitation and changing the password answer. */
export interface SessionResponse {
  data: { user: AdminUser; accessToken: string; accessTokenExpiresAt: string };
}

/** Where an admin sets up the second factor their role requires. */
export const TWO_FACTOR_SETUP_URL = '/profile#two-factor';

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
  /**
   * The admin's role requires a second factor they have not set up: until they do, the
   * server answers `TwoFactorRequiredError` everywhere but their profile.
   */
  readonly twoFactorPending = computed(() => {
    const user = this.user();
    return !!user?.twoFactorRequired && !user.twoFactor;
  });

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

  /** Single sign-on providers for the login page (none while the feature is off). */
  async ssoProviders(): Promise<{ id: string; name: string }[]> {
    try {
      const response = await firstValueFrom(
        this.http.get<{ data: { id: string; name: string }[] }>(this.url('/sso')),
      );
      return Array.isArray(response?.data) ? response.data : [];
    } catch {
      return [];
    }
  }

  /**
   * Checks the password: signs in, or answers the second step when the account has a
   * second factor (no session yet).
   */
  async login(email: string, password: string): Promise<SecondStep | null> {
    let response: SessionResponse | { data: unknown };
    try {
      response = await firstValueFrom(
        this.http.post<SessionResponse>(
          this.url('/login'),
          { email, password },
          { withCredentials: true },
        ),
      );
    } catch (error) {
      throw ApiFailure.from(error);
    }
    const step = secondStepOf(response?.data);
    if (step) return step;
    await this.open(of(response));
    return null;
  }

  /** The second step: a TOTP or recovery code, or a passkey assertion. */
  async loginTwoFactor(
    twoFactorToken: string,
    proof: { code: string } | { challengeToken: string; credential: AssertionJson },
  ): Promise<void> {
    await this.open(
      this.http.post<SessionResponse>(
        this.url('/login/two-factor'),
        { twoFactorToken, ...proof },
        { withCredentials: true },
      ),
    );
  }

  /** The challenge for signing in with a passkey. */
  async passkeyLoginOptions(
    twoFactorToken: string,
  ): Promise<{ challengeToken: string; publicKey: RequestOptionsJson }> {
    try {
      const response = await firstValueFrom(
        this.http.post<{ data: { challengeToken: string; publicKey: RequestOptionsJson } }>(
          this.url('/login/passkey/options'),
          { twoFactorToken },
        ),
      );
      return response.data;
    } catch (error) {
      throw ApiFailure.from(error);
    }
  }

  /** Reads the admin and their permissions again (after their second factors changed). */
  async reload(): Promise<void> {
    const token = this.accessToken();
    if (!token) return;
    const me = await firstValueFrom(
      this.http.get<{ data: { user: AdminUser; permissions: PermissionSet } }>(this.url('/me'), {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    if (me.data.user) this.user.set(me.data.user);
    this.permissions.set(me.data.permissions);
  }

  /** The server said the admin's role requires a second factor they do not have. */
  markTwoFactorRequired(): void {
    this.user.update((user) =>
      user && !user.twoFactorRequired ? { ...user, twoFactorRequired: true } : user,
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

  /** Accepts an invitation: sets the password and signs in, as `login` does. */
  async acceptInvitation(input: {
    token: string;
    password: string;
    firstname: string | null;
    lastname: string | null;
  }): Promise<void> {
    await this.open(
      this.http.post<SessionResponse>(this.url('/accept-invitation'), input, {
        withCredentials: true,
      }),
    );
  }

  /**
   * Sends a request answered with a new session (`PUT /users/me` with a new password ends
   * every session, this one included) and signs in with it.
   */
  async adopt(request: Observable<SessionResponse>): Promise<void> {
    await this.open(request);
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

  /** Media library actions: `own` limits updates/deletes to files the user uploaded. */
  mediaGrant(action: string): 'none' | 'own' | 'all' {
    const set = this.permissions();
    if (set.superAdmin) return 'all';
    const matching = set.permissions.filter((permission) => permission.action === action);
    if (!matching.length) return 'none';
    return matching.some((permission) => !permission.conditions?.length) ? 'all' : 'own';
  }

  /**
   * Whether the admin holds a content action on `uid` in `locale` (`null`: in some
   * locale). Permissions may be limited to some locales; the server answers 403 otherwise.
   */
  canInLocale(action: string, uid: string, locale: string | null | undefined): boolean {
    return grantsInLocale(this.permissions(), action, uid, locale);
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

  /**
   * `fetch` with the admin's access token (same-origin URLs only), refreshing it once on a
   * 401. For code outside Angular's HttpClient, such as plugin elements.
   */
  async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const target = new URL(url, document.baseURI);
    const sameOrigin = target.origin === location.origin;
    const send = (token: string | null) => {
      const headers = new Headers(init.headers);
      if (sameOrigin && token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      return fetch(target.href, {
        ...init,
        headers,
        credentials: sameOrigin ? 'same-origin' : (init.credentials ?? 'omit'),
      });
    };
    const response = await send(this.accessToken());
    if (response.status !== 401 || !sameOrigin) return response;
    return (await this.refresh()) ? send(this.accessToken()) : response;
  }

  private async open(request: Observable<unknown>): Promise<void> {
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
  return /\/auth\/(login|login\/two-factor|login\/passkey\/options|refresh|logout|register-first-admin|status|me|sso|invitation|accept-invitation|forgot-password|reset-password)$/.test(
    request.url.split('?')[0],
  );
}

/**
 * Adds the access token; on a 401, refreshes once and retries. A `TwoFactorRequiredError`
 * sends the admin to set up the second factor their role requires.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(Auth);
  const router = inject(Router);
  if (isAuthRoute(request)) return next(request);

  const withToken = (token: string | null) =>
    token ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : request;

  return next(withToken(auth.accessToken())).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && isTwoFactorRequired(error.status, error.error)) {
        auth.markTwoFactorRequired();
        if (!router.url.startsWith('/profile')) void router.navigateByUrl(TWO_FACTOR_SETUP_URL);
        return throwError(() => error);
      }
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
  if (!auth.loggedIn())
    return router.createUrlTree(['/login'], { queryParams: { next: state.url } });
  // Until the admin sets up the factor their role requires, only their profile works.
  if (auth.twoFactorPending() && !state.url.startsWith('/profile'))
    return router.parseUrl(TWO_FACTOR_SETUP_URL);
  return true;
};

/** Login/registration pages: skip them when already logged in. */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(Auth);
  const router = inject(Router);
  await auth.restore();
  return auth.loggedIn() ? router.createUrlTree(['/']) : true;
};
