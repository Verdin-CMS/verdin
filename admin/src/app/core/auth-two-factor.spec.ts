import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { Auth, TWO_FACTOR_SETUP_URL, authGuard, authInterceptor } from './auth';
import { AdminUser } from './types';

const USER: AdminUser = {
  id: 1,
  email: 'ada@example.com',
  firstname: null,
  lastname: null,
  isActive: true,
  roles: [],
  twoFactor: false,
  twoFactorRequired: false,
  createdAt: '',
  updatedAt: '',
};

function setup() {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(withInterceptors([authInterceptor])),
      provideHttpClientTesting(),
    ],
  });
  const auth = TestBed.inject(Auth);
  const http = TestBed.inject(HttpClient);
  const backend = TestBed.inject(HttpTestingController);
  const router = TestBed.inject(Router);
  const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
  return { auth, http, backend, router, navigate };
}

describe('Auth and two-factor authentication', () => {
  it('answers the second step instead of a session', async () => {
    const { auth, backend } = setup();
    const login = auth.login('ada@example.com', 'secret');
    backend.expectOne('/admin/api/auth/login').flush({
      data: { twoFactorRequired: true, twoFactorToken: 'tok', methods: ['totp', 'recovery'] },
    });
    expect(await login).toEqual({ twoFactorToken: 'tok', methods: ['totp', 'recovery'] });
    expect(auth.loggedIn()).toBe(false);
  });

  it('opens the session after the second step', async () => {
    const { auth, backend } = setup();
    const done = auth.loginTwoFactor('tok', { code: '123456' });
    const request = backend.expectOne('/admin/api/auth/login/two-factor');
    expect(request.request.body).toEqual({ twoFactorToken: 'tok', code: '123456' });
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush({
      data: { user: { ...USER, twoFactor: true }, accessToken: 'at', accessTokenExpiresAt: '' },
    });
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve));
    backend
      .expectOne('/admin/api/auth/me')
      .flush({ data: { user: USER, permissions: { superAdmin: false, permissions: [] } } });
    await done;
    expect(auth.loggedIn()).toBe(true);
    expect(auth.accessToken()).toBe('at');
  });

  it('sends the admin to their profile on TwoFactorRequiredError', async () => {
    const { auth, http, backend, navigate } = setup();
    auth.user.set(USER);
    auth.accessToken.set('at');
    const call = firstValueFrom(http.get('/admin/api/content-types'));
    backend
      .expectOne('/admin/api/content-types')
      .flush(
        { data: null, error: { status: 403, name: 'TwoFactorRequiredError', message: 'set up' } },
        { status: 403, statusText: 'Forbidden' },
      );
    await expect(call).rejects.toBeTruthy();
    expect(auth.twoFactorPending()).toBe(true);
    expect(navigate).toHaveBeenCalledWith(TWO_FACTOR_SETUP_URL);
  });

  it('keeps an admin whose role waits for a factor on their profile', async () => {
    const { auth } = setup();
    vi.spyOn(auth, 'restore').mockResolvedValue();
    auth.user.set({ ...USER, twoFactorRequired: true });
    const guard = (url: string) =>
      TestBed.runInInjectionContext(() =>
        authGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
      );
    const redirect = (await guard('/content/api::post.post')) as UrlTree;
    expect(redirect.toString()).toBe(TWO_FACTOR_SETUP_URL);
    expect(await guard('/profile')).toBe(true);
    auth.user.set({ ...USER, twoFactorRequired: true, twoFactor: true });
    expect(await guard('/content/api::post.post')).toBe(true);
  });
});
