import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { describe, expect, it, vi } from 'vitest';

import { Account } from '../../core/account';
import { ApiFailure } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { ICONS } from '../../icons';
import { AuthFrame } from './auth-frame';
import { ResetPasswordPage } from './reset-password';

@Component({
  selector: 'vd-auth-frame',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
})
class FrameStub {}

async function setup(token: string | undefined, reset: () => Promise<void>) {
  const calls: { token: string; password: string }[] = [];
  const account = {
    resetPassword: async (value: string, password: string) => {
      calls.push({ token: value, password });
      return reset();
    },
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideIcons(ICONS),
      { provide: Account, useValue: account },
      { provide: I18n, useValue: { t: (key: string) => key } },
    ],
  });
  TestBed.overrideComponent(ResetPasswordPage, {
    remove: { imports: [AuthFrame] },
    add: { imports: [FrameStub] },
  });
  const router = TestBed.inject(Router);
  const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(ResetPasswordPage);
  if (token !== undefined) fixture.componentRef.setInput('token', token);
  fixture.detectChanges();
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  const type = async (id: string, value: string) => {
    const input = element.querySelector<HTMLInputElement>(`#${id}`)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const submit = async () => {
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const button = () => element.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  return { fixture, element, type, submit, button, calls, navigate };
}

describe('ResetPasswordPage', () => {
  it('sets the new password and goes to the login page with a notice', async () => {
    const page = await setup('abc', async () => undefined);
    expect(page.button().disabled).toBe(true);
    await page.type('reset-password', 'new secret 1');
    await page.type('reset-confirmation', 'new secret 2');
    expect(page.button().disabled).toBe(true);
    expect(page.element.textContent).toContain('account.password.mismatch');
    await page.type('reset-confirmation', 'new secret 1');
    expect(page.button().disabled).toBe(false);
    await page.submit();
    expect(page.calls).toEqual([{ token: 'abc', password: 'new secret 1' }]);
    expect(page.navigate).toHaveBeenCalledWith(['/login'], { queryParams: { reset: 1 } });
  });

  it('explains an expired link', async () => {
    const page = await setup('old', async () => {
      throw new ApiFailure(400, 'ValidationError', 'this link is invalid or has expired');
    });
    await page.type('reset-password', 'new secret 1');
    await page.type('reset-confirmation', 'new secret 1');
    await page.submit();
    expect(page.navigate).not.toHaveBeenCalled();
    expect(page.element.querySelector('[data-testid="link-invalid"]')).not.toBeNull();
    expect(page.element.textContent).toContain('auth.reset.invalid');
  });

  it('shows the invalid link message without a token', async () => {
    const page = await setup(undefined, async () => undefined);
    expect(page.element.querySelector('[data-testid="link-invalid"]')).not.toBeNull();
    expect(page.element.querySelector('form')).toBeNull();
  });
});
