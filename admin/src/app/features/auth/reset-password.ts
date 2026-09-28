import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';

import { Account, isLinkError } from '../../core/account';
import { ApiFailure } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { AuthFrame } from './auth-frame';
import { NewPassword } from './new-password';

/** `/auth/reset-password?token=`: chooses a new password from an emailed link. */
@Component({
  selector: 'vd-reset-password',
  imports: [
    NgIcon,
    RouterLink,
    HlmAlertImports,
    HlmButtonImports,
    HlmCardImports,
    HlmSpinnerImports,
    AuthFrame,
    NewPassword,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <vd-auth-frame>
      <section hlmCard>
        <div hlmCardHeader>
          <h1 hlmCardTitle class="text-xl">{{ t('auth.reset.title') }}</h1>
          <p hlmCardDescription>{{ t('auth.reset.description') }}</p>
        </div>
        <div hlmCardContent class="flex flex-col gap-4">
          @if (!token() || invalid()) {
            <div hlmAlert variant="destructive" role="alert" data-testid="link-invalid">
              <ng-icon name="lucideCircleAlert" />
              <p hlmAlertTitle>{{ t('auth.link.invalidTitle') }}</p>
              <p hlmAlertDescription>{{ t('auth.reset.invalid') }}</p>
            </div>
            <a hlmBtn variant="outline" routerLink="/auth/forgot-password">
              {{ t('auth.reset.again') }}
            </a>
          } @else {
            <form class="flex flex-col gap-4" (submit)="$event.preventDefault(); save()">
              <vd-new-password idPrefix="reset" (changed)="password.set($event)" />
              @if (error()) {
                <div hlmAlert variant="destructive" role="alert">
                  <ng-icon name="lucideCircleAlert" />
                  <p hlmAlertDescription>{{ error() }}</p>
                </div>
              }
              <button hlmBtn type="submit" [disabled]="busy() || !password()">
                @if (busy()) {
                  <hlm-spinner />
                }
                {{ t('auth.reset.submit') }}
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
export class ResetPasswordPage {
  private readonly account = inject(Account);
  private readonly router = inject(Router);
  protected readonly t = inject(I18n).t;
  /** `?token=`. */
  readonly token = input<string>();
  protected readonly password = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly invalid = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async save(): Promise<void> {
    const token = this.token();
    const password = this.password();
    if (!token || !password || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.account.resetPassword(token, password);
      await this.router.navigate(['/login'], { queryParams: { reset: 1 } });
    } catch (error) {
      const failure = ApiFailure.from(error);
      if (isLinkError(failure)) {
        this.invalid.set(true);
      } else {
        this.error.set(
          failure.status === 429 ? this.t('auth.login.tooManyAttempts') : failure.message,
        );
      }
    } finally {
      this.busy.set(false);
    }
  }
}
