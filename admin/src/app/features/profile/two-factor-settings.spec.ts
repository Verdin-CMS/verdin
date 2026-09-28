import { TestBed } from '@angular/core/testing';
import { provideIcons } from '@ng-icons/core';
import { afterEach, describe, expect, it } from 'vitest';

import { ApiFailure } from '../../core/api';
import { Auth } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import { TwoFactor, TwoFactorStatus } from '../../core/two-factor';
import { ICONS } from '../../icons';
import { TwoFactorSettings } from './two-factor-settings';

const OFF: TwoFactorStatus = { totp: false, passkeys: [], recoveryCodesLeft: 0, required: true };
const CODES = Array.from({ length: 10 }, (_, i) => `code-${i}`);

async function setup(enable: (code: string) => Promise<string[]>) {
  let current = OFF;
  const calls: string[] = [];
  const twoFactor = {
    status: async () => current,
    totpSetup: async (password: string) => {
      calls.push(`setup:${password}`);
      return {
        secret: 'JBSWY3DPEHPK3PXP',
        otpauthUrl: 'otpauth://totp/Verdin:ada?secret=JBSWY3DPEHPK3PXP&issuer=Verdin',
      };
    },
    totpEnable: async (code: string) => {
      calls.push(`enable:${code}`);
      const codes = await enable(code);
      current = { ...OFF, totp: true, recoveryCodesLeft: 10 };
      return codes;
    },
  };
  let reloads = 0;
  TestBed.configureTestingModule({
    providers: [
      provideIcons(ICONS),
      { provide: TwoFactor, useValue: twoFactor },
      {
        provide: Auth,
        useValue: {
          reload: async () => {
            reloads++;
          },
          user: () => ({ email: 'ada@example.com' }),
        },
      },
      {
        provide: I18n,
        useValue: {
          t: (key: string) => key,
          formatDate: () => '',
          formatRelative: () => '',
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(TwoFactorSettings);
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  };
  await settle();
  const element = fixture.nativeElement as HTMLElement;
  /** The dialog renders in an overlay outside the component. */
  const find = <T extends Element = HTMLElement>(selector: string) =>
    document.querySelector<T>(selector);
  const type = async (selector: string, value: string) => {
    const input = find<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  };
  const click = async (selector: string) => {
    find<HTMLButtonElement>(selector)!.click();
    await settle();
  };
  return { fixture, element, find, type, click, settle, calls, reloads: () => reloads };
}

describe('TwoFactorSettings', () => {
  afterEach(() =>
    document.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove()),
  );

  it('sets up an authenticator app and shows the recovery codes once', async () => {
    const page = await setup(async () => CODES);
    expect(page.element.querySelector('[data-testid="two-factor-required"]')).not.toBeNull();
    await page.click('[data-testid="totp-setup"]');
    await page.type('#two-factor-password', 'secret password');
    await page.click('[data-testid="two-factor-confirm"]');
    expect(page.calls).toEqual(['setup:secret password']);
    expect(page.find('[data-testid="totp-qr"] path')!.getAttribute('d')).toMatch(/^M\d/);
    expect(page.find<HTMLInputElement>('[data-testid="totp-secret"]')!.value).toBe(
      'JBSW Y3DP EHPK 3PXP',
    );
    await page.type('#totp-code', '123456');
    expect(page.calls).toEqual(['setup:secret password', 'enable:123456']);
    const codes = [...page.find('[data-testid="recovery-codes"]')!.querySelectorAll('li')].map(
      (item) => item.textContent?.trim(),
    );
    expect(codes).toEqual(CODES);
    expect(page.reloads()).toBe(1);
    await page.click('[data-testid="recovery-done"]');
    expect(page.find('[data-testid="recovery-codes"]')).toBeNull();
    expect(page.element.querySelector('[data-testid="totp-disable"]')).not.toBeNull();
  });

  it('explains a wrong code and keeps the QR code', async () => {
    const page = await setup(async () => {
      throw new ApiFailure(400, 'ValidationError', 'the code is not valid');
    });
    await page.click('[data-testid="totp-setup"]');
    await page.type('#two-factor-password', 'secret password');
    await page.click('[data-testid="two-factor-confirm"]');
    await page.type('#totp-code', '000000');
    expect(page.find('#two-factor-flow-error')!.textContent).toContain('twoFactor.invalidCode');
    expect(page.find('[data-testid="totp-qr"]')).not.toBeNull();
    expect(page.find<HTMLInputElement>('#totp-code')!.value).toBe('');
  });
});
