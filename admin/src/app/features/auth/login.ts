import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormField, FormRoot, email, form, required, submit } from '@angular/forms/signals';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';

import { ApiFailure, RUNTIME_CONFIG } from '../../core/api';
import { Auth } from '../../core/auth';
import { ssoStartUrl } from '../../core/feature-settings';
import { I18n } from '../../core/i18n/i18n';
import { AuthFrame } from './auth-frame';

@Component({
  selector: 'vd-login',
  imports: [
    FormRoot,
    FormField,
    NgIcon,
    HlmCardImports,
    HlmFieldImports,
    HlmInputImports,
    HlmButtonImports,
    HlmAlertImports,
    HlmSpinnerImports,
    HlmInputGroupImports,
    RouterLink,
    AuthFrame,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <vd-auth-frame>
      @if (notice(); as message) {
        <div hlmAlert role="status">
          <ng-icon name="lucideCircleCheck" />
          <p hlmAlertDescription>{{ message }}</p>
        </div>
      }
      <section hlmCard>
        <div hlmCardHeader>
          <h1 hlmCardTitle class="text-xl">{{ t('auth.login.title') }}</h1>
          <p hlmCardDescription>{{ t('auth.login.description') }}</p>
        </div>
        <div hlmCardContent class="flex flex-col gap-6">
          @if (ssoError()) {
            <div hlmAlert variant="destructive" role="alert">
              <ng-icon name="lucideCircleAlert" />
              <p hlmAlertTitle>{{ t('auth.sso.failed') }}</p>
              <p hlmAlertDescription>{{ ssoError() }}</p>
            </div>
          }
          @if (providers().length) {
            <div class="flex flex-col gap-2" role="group" [attr.aria-label]="t('auth.sso.group')">
              @for (provider of providers(); track provider.id) {
                <a hlmBtn variant="outline" class="w-full" [href]="startUrl(provider.id)">
                  <ng-icon name="lucideKeyRound" aria-hidden="true" />
                  {{ t('auth.sso.continue', { name: provider.name }) }}
                </a>
              }
            </div>
            <div class="text-muted-foreground flex items-center gap-3 text-xs" aria-hidden="true">
              <span class="bg-border h-px flex-1"></span>
              {{ t('auth.sso.or') }}
              <span class="bg-border h-px flex-1"></span>
            </div>
          }
          <form
            [formRoot]="loginForm"
            (submit)="$event.preventDefault(); login()"
            class="flex flex-col gap-4"
          >
            <div hlmField>
              <label hlmFieldLabel for="email">{{ t('common.email') }}</label>
              <input
                dir="ltr"
                hlmInput
                id="email"
                type="email"
                autocomplete="username"
                [formField]="loginForm.email"
              />
            </div>
            <div hlmField>
              <div class="flex items-center justify-between gap-2">
                <label hlmFieldLabel for="password">{{ t('common.password') }}</label>
                <a
                  routerLink="/auth/forgot-password"
                  class="text-muted-foreground hover:text-foreground text-sm underline-offset-4 hover:underline"
                  >{{ t('auth.forgot.link') }}</a
                >
              </div>
              <div hlmInputGroup>
                <input
                  hlmInputGroupInput
                  id="password"
                  [type]="showPassword() ? 'text' : 'password'"
                  autocomplete="current-password"
                  [formField]="loginForm.password"
                />
                <div hlmInputGroupAddon align="inline-end">
                  <button
                    hlmInputGroupButton
                    size="icon-xs"
                    [attr.aria-label]="
                      showPassword() ? t('auth.password.hide') : t('auth.password.show')
                    "
                    [attr.aria-pressed]="showPassword()"
                    (click)="showPassword.set(!showPassword())"
                  >
                    <ng-icon [name]="showPassword() ? 'lucideEyeOff' : 'lucideEye'" />
                  </button>
                </div>
              </div>
            </div>
            @if (error()) {
              <div hlmAlert variant="destructive">
                <ng-icon name="lucideCircleAlert" />
                <p hlmAlertDescription>{{ error() }}</p>
              </div>
            }
            <button hlmBtn type="submit" class="mt-2" [disabled]="busy() || loginForm().invalid()">
              @if (busy()) {
                <hlm-spinner />
              }
              {{ t('auth.login.submit') }}
            </button>
          </form>
        </div>
      </section>
    </vd-auth-frame>
  `,
})
export class LoginPage implements OnInit {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly showPassword = signal(false);

  protected readonly model = signal({ email: '', password: '' });
  protected readonly loginForm = form(this.model, (path) => {
    required(path.email);
    email(path.email);
    required(path.password);
  });
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly config = inject(RUNTIME_CONFIG);
  /** Single sign-on providers (the `sso` feature). */
  protected readonly providers = signal<{ id: string; name: string }[]>([]);
  /** A message from the page that sent here (`?reset=1` after a password reset). */
  protected readonly notice = signal<string | null>(
    this.route.snapshot.queryParamMap.get('reset') ? this.t('auth.reset.done') : null,
  );
  /** Why the last single sign-on failed (`?ssoError=` from the server). */
  protected readonly ssoError = signal<string | null>(
    this.route.snapshot.queryParamMap.get('ssoError'),
  );

  async ngOnInit(): Promise<void> {
    void this.auth.ssoProviders().then((providers) => this.providers.set(providers));
    if (!(await this.auth.hasAdmin())) await this.router.navigateByUrl('/register');
  }

  protected startUrl(id: string): string {
    return ssoStartUrl(this.config.apiBase, id);
  }

  protected async login(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    await submit(this.loginForm, async () => {
      try {
        await this.auth.login(this.model().email, this.model().password);
        await this.router.navigateByUrl(this.route.snapshot.queryParamMap.get('next') ?? '/');
      } catch (error) {
        const failure = ApiFailure.from(error);
        this.error.set(
          failure.status === 429 ? this.t('auth.login.tooManyAttempts') : failure.message,
        );
      }
      return undefined;
    });
    this.busy.set(false);
  }
}
