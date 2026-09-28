import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';

import { Account } from '../../core/account';
import { ApiFailure } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { AuthFrame } from './auth-frame';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** `/auth/forgot-password`: asks for a password reset link by email. */
@Component({
  selector: 'vd-forgot-password',
  imports: [
    NgIcon,
    RouterLink,
    HlmAlertImports,
    HlmButtonImports,
    HlmCardImports,
    HlmFieldImports,
    HlmInputImports,
    HlmSpinnerImports,
    AuthFrame,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <vd-auth-frame>
      <section hlmCard>
        <div hlmCardHeader>
          <h1 hlmCardTitle class="text-xl">{{ t('auth.forgot.title') }}</h1>
          <p hlmCardDescription>{{ t('auth.forgot.description') }}</p>
        </div>
        <div hlmCardContent class="flex flex-col gap-4">
          @if (sent()) {
            <div hlmAlert role="status" data-testid="forgot-sent">
              <ng-icon name="lucideMailCheck" />
              <p hlmAlertTitle>{{ t('auth.forgot.sentTitle') }}</p>
              <p hlmAlertDescription>{{ t('auth.forgot.sent') }}</p>
            </div>
          } @else {
            <form class="flex flex-col gap-4" (submit)="$event.preventDefault(); send()">
              <div hlmField>
                <label hlmFieldLabel for="forgot-email">{{ t('common.email') }}</label>
                <input
                  dir="ltr"
                  hlmInput
                  id="forgot-email"
                  type="email"
                  autocomplete="username"
                  required
                  [value]="email()"
                  (input)="email.set($any($event.target).value)"
                />
              </div>
              @if (error()) {
                <div hlmAlert variant="destructive" role="alert">
                  <ng-icon name="lucideCircleAlert" />
                  <p hlmAlertDescription>{{ error() }}</p>
                </div>
              }
              <button hlmBtn type="submit" [disabled]="busy() || !valid()">
                @if (busy()) {
                  <hlm-spinner />
                }
                {{ t('auth.forgot.submit') }}
              </button>
            </form>
          }
          <a
            routerLink="/login"
            class="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 self-center text-sm"
          >
            <ng-icon name="lucideArrowLeft" class="rtl:-scale-x-100" />
            {{ t('auth.backToLogin') }}
          </a>
        </div>
      </section>
    </vd-auth-frame>
  `,
})
export class ForgotPasswordPage {
  private readonly account = inject(Account);
  protected readonly t = inject(I18n).t;
  protected readonly email = signal('');
  protected readonly valid = computed(() => EMAIL.test(this.email().trim()));
  protected readonly busy = signal(false);
  protected readonly sent = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async send(): Promise<void> {
    if (!this.valid() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.account.forgotPassword(this.email().trim());
      this.sent.set(true);
    } catch (error) {
      const failure = ApiFailure.from(error);
      this.error.set(
        failure.status === 429 ? this.t('auth.login.tooManyAttempts') : failure.message,
      );
    } finally {
      this.busy.set(false);
    }
  }
}
