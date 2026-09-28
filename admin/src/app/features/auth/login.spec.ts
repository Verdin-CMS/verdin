import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { describe, expect, it, vi } from 'vitest';

import { ApiFailure } from '../../core/api';
import { Auth } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import { SecondStep } from '../../core/two-factor';
import { ICONS } from '../../icons';
import { AuthFrame } from './auth-frame';
import { LoginPage } from './login';

@Component({
  selector: 'vd-auth-frame',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
})
class FrameStub {}

async function setup(
  step: SecondStep | null,
  second: (token: string, proof: unknown) => Promise<void> = async () => undefined,
) {
  const logins: { email: string; password: string }[] = [];
  const proofs: { token: string; proof: unknown }[] = [];
  const auth = {
    ssoProviders: async () => [],
    hasAdmin: async () => true,
    login: async (email: string, password: string) => {
      logins.push({ email, password });
      return step;
    },
    loginTwoFactor: async (token: string, proof: unknown) => {
      proofs.push({ token, proof });
      return second(token, proof);
    },
    passkeyLoginOptions: async () => {
      throw new Error('not used');
    },
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideIcons(ICONS),
      { provide: Auth, useValue: auth },
      { provide: I18n, useValue: { t: (key: string) => key } },
    ],
  });
  TestBed.overrideComponent(LoginPage, {
    remove: { imports: [AuthFrame] },
    add: { imports: [FrameStub] },
  });
  const router = TestBed.inject(Router);
  const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
  const fixture = TestBed.createComponent(LoginPage);
  fixture.detectChanges();
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  // The code field submits on its own (not awaited by the event): let it finish.
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  };
  const type = async (id: string, value: string) => {
    const input = element.querySelector<HTMLInputElement>(`#${id}`)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  };
  const submit = async () => {
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
  };
  const signIn = async () => {
    await type('email', 'ada@example.com');
    await type('password', 'secret password');
    await submit();
  };
  return { fixture, element, type, submit, signIn, settle, logins, proofs, navigate };
}

const STEP: SecondStep = { twoFactorToken: 'tok', methods: ['totp', 'recovery'] };

describe('LoginPage', () => {
  it('signs in with the password alone when the account has no second factor', async () => {
    const page = await setup(null);
    await page.signIn();
    expect(page.logins).toEqual([{ email: 'ada@example.com', password: 'secret password' }]);
    expect(page.navigate).toHaveBeenCalledWith('/');
    expect(page.element.querySelector('[data-testid="two-factor-step"]')).toBeNull();
  });

  it('asks for the code and sends it once six digits are typed', async () => {
    const page = await setup(STEP);
    await page.signIn();
    expect(page.navigate).not.toHaveBeenCalled();
    expect(page.element.querySelector('[data-testid="two-factor-step"]')).not.toBeNull();
    expect(page.element.querySelector('#password')).toBeNull();
    expect(document.activeElement?.id).toBe('two-factor-code');
    await page.type('two-factor-code', '12 34a5');
    expect(page.element.querySelector<HTMLInputElement>('#two-factor-code')!.value).toBe('12345');
    expect(page.proofs).toEqual([]);
    await page.type('two-factor-code', '123456');
    expect(page.proofs).toEqual([{ token: 'tok', proof: { code: '123456' } }]);
    expect(page.navigate).toHaveBeenCalledWith('/');
  });

  it('explains a wrong code and lets the admin try again', async () => {
    const page = await setup(STEP, async () => {
      throw new ApiFailure(400, 'ValidationError', 'Invalid credentials');
    });
    await page.signIn();
    await page.type('two-factor-code', '000000');
    expect(page.element.textContent).toContain('twoFactor.login.invalidCode');
    expect(page.element.querySelector<HTMLInputElement>('#two-factor-code')!.value).toBe('');
    expect(page.element.querySelector('[data-testid="two-factor-step"]')).not.toBeNull();
    expect(page.navigate).not.toHaveBeenCalled();
  });

  it('goes back to the password when the second step expired', async () => {
    const page = await setup(STEP, async () => {
      throw new ApiFailure(401, 'UnauthorizedError', 'Unauthorized');
    });
    await page.signIn();
    await page.type('two-factor-code', '123456');
    expect(page.element.querySelector('[data-testid="two-factor-step"]')).toBeNull();
    expect(page.element.querySelector('#password')).not.toBeNull();
    expect(page.element.textContent).toContain('twoFactor.login.expired');
  });

  it('takes a recovery code instead', async () => {
    const page = await setup(STEP);
    await page.signIn();
    expect(page.element.querySelector('[data-testid="use-passkey"]')).toBeNull();
    page.element.querySelector<HTMLButtonElement>('[data-testid="use-recovery"]')!.click();
    await page.settle();
    expect(page.element.textContent).toContain('twoFactor.login.recoveryLabel');
    await page.type('two-factor-code', 'abcd-efgh');
    expect(page.proofs).toEqual([]);
    await page.submit();
    expect(page.proofs).toEqual([{ token: 'tok', proof: { code: 'abcd-efgh' } }]);
    expect(page.navigate).toHaveBeenCalledWith('/');
  });

  it('offers a passkey when the account has one', async () => {
    const page = await setup({ twoFactorToken: 'tok', methods: ['totp', 'passkey', 'recovery'] });
    await page.signIn();
    expect(page.element.querySelector('[data-testid="switch-passkey"]')).not.toBeNull();
  });
});
