import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';

import { Account, InvitationInfo, isLinkError } from '../../core/account';
import { ApiFailure } from '../../core/api';
import { Auth } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import { AuthFrame } from './auth-frame';
import { NewPassword } from './new-password';

/** `/auth/accept-invitation?token=`: an invited admin picks a password and signs in. */
@Component({
  selector: 'vd-accept-invitation',
  imports: [
    NgIcon,
    RouterLink,
    HlmAlertImports,
    HlmButtonImports,
    HlmCardImports,
    HlmFieldImports,
    HlmInputImports,
    HlmSkeletonImports,
    HlmSpinnerImports,
    AuthFrame,
    NewPassword,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <vd-auth-frame>
      <section hlmCard>
        <div hlmCardHeader>
          <h1 hlmCardTitle class="text-xl">{{ t('auth.invite.title') }}</h1>
          <p hlmCardDescription>{{ t('auth.invite.description') }}</p>
        </div>
        <div hlmCardContent class="flex flex-col gap-4">
          @if (invalid()) {
            <div hlmAlert variant="destructive" role="alert" data-testid="link-invalid">
              <ng-icon name="lucideCircleAlert" />
              <p hlmAlertTitle>{{ t('auth.link.invalidTitle') }}</p>
              <p hlmAlertDescription>{{ t('auth.invite.invalid') }}</p>
            </div>
            <a hlmBtn variant="outline" routerLink="/login">{{ t('auth.backToLogin') }}</a>
          } @else if (!invitation()) {
            @if (loadError()) {
              <div hlmAlert variant="destructive" role="alert">
                <ng-icon name="lucideCircleAlert" />
                <p hlmAlertDescription>{{ loadError() }}</p>
              </div>
            } @else {
              <hlm-skeleton class="h-48 w-full" />
            }
          } @else {
            <form class="flex flex-col gap-4" (submit)="$event.preventDefault(); accept()">
              <div hlmField>
                <label hlmFieldLabel for="invite-email">{{ t('common.email') }}</label>
                <input
                  dir="ltr"
                  hlmInput
                  id="invite-email"
                  type="email"
                  autocomplete="username"
                  readonly
                  [value]="invitation()!.email"
                />
              </div>
              <div class="grid gap-4 sm:grid-cols-2">
                <div hlmField>
                  <label hlmFieldLabel for="invite-firstname">{{
                    t('auth.register.firstname')
                  }}</label>
                  <input
                    hlmInput
                    id="invite-firstname"
                    autocomplete="given-name"
                    [value]="firstname()"
                    (input)="firstname.set($any($event.target).value)"
                  />
                </div>
                <div hlmField>
                  <label hlmFieldLabel for="invite-lastname">{{
                    t('auth.register.lastname')
                  }}</label>
                  <input
                    hlmInput
                    id="invite-lastname"
                    autocomplete="family-name"
                    [value]="lastname()"
                    (input)="lastname.set($any($event.target).value)"
                  />
                </div>
              </div>
              <vd-new-password idPrefix="invite" (changed)="password.set($event)" />
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
                {{ t('auth.invite.submit') }}
              </button>
            </form>
          }
        </div>
      </section>
    </vd-auth-frame>
  `,
})
export class AcceptInvitationPage implements OnInit {
  private readonly account = inject(Account);
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  protected readonly t = inject(I18n).t;
  /** `?token=`. */
  readonly token = input<string>();
  protected readonly invitation = signal<InvitationInfo | null>(null);
  protected readonly firstname = signal('');
  protected readonly lastname = signal('');
  protected readonly password = signal<string | null>(null);
  protected readonly invalid = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  async ngOnInit(): Promise<void> {
    const token = this.token();
    if (!token) {
      this.invalid.set(true);
      return;
    }
    try {
      const invitation = await this.account.invitation(token);
      this.invitation.set(invitation);
      this.firstname.set(invitation.firstname ?? '');
      this.lastname.set(invitation.lastname ?? '');
    } catch (error) {
      const failure = ApiFailure.from(error);
      if (isLinkError(failure)) this.invalid.set(true);
      else this.loadError.set(failure.message);
    }
  }

  protected async accept(): Promise<void> {
    const token = this.token();
    const password = this.password();
    if (!token || !password || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.acceptInvitation({
        token,
        password,
        firstname: this.firstname().trim() || null,
        lastname: this.lastname().trim() || null,
      });
      await this.router.navigateByUrl('/');
    } catch (error) {
      const failure = ApiFailure.from(error);
      if (isLinkError(failure)) this.invalid.set(true);
      else
        this.error.set(
          failure.status === 429 ? this.t('auth.login.tooManyAttempts') : failure.message,
        );
    } finally {
      this.busy.set(false);
    }
  }
}
