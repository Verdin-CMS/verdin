import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormField, FormRoot, email, form, required, submit } from '@angular/forms/signals';
import { ActivatedRoute, Router } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';

import { ApiFailure } from '../../core/api';
import { Auth } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/messages/en';
import { Logo } from '../../shared/components/logo';
import { PreferencesMenu } from '../../shared/components/preferences-menu';

/** Selling points on the brand panel of the auth pages. */
export const AUTH_FEATURES: readonly { icon: string; text: MessageKey }[] = [
  { icon: 'lucideBlocks', text: 'auth.feature.model' },
  { icon: 'lucideRocket', text: 'auth.feature.api' },
  { icon: 'lucideShieldCheck', text: 'auth.feature.access' },
];

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
    Logo,
    PreferencesMenu,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bg-background relative grid min-h-svh lg:grid-cols-2">
      <div class="absolute end-4 top-4 z-10"><vd-preferences-menu /></div>

      <aside
        class="from-primary/15 via-primary/5 to-background relative hidden flex-col overflow-hidden border-e bg-linear-to-br p-10 lg:flex"
      >
        <vd-logo size="lg" />
        <div class="mt-auto flex max-w-md flex-col gap-8">
          <h2 class="text-3xl font-semibold tracking-tight text-balance">
            {{ t('auth.tagline') }}
          </h2>
          <ul class="flex flex-col gap-4">
            @for (feature of features; track feature.text) {
              <li class="flex items-start gap-3">
                <span
                  class="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-lg"
                >
                  <ng-icon [name]="feature.icon" size="16" />
                </span>
                <span class="text-muted-foreground pt-1.5 text-sm">{{ t(feature.text) }}</span>
              </li>
            }
          </ul>
        </div>
      </aside>

      <main class="flex items-center justify-center p-6 sm:p-10">
        <div class="flex w-full max-w-sm flex-col gap-6">
          <vd-logo size="lg" class="self-center lg:hidden" />
          <section hlmCard>
            <div hlmCardHeader>
              <h1 hlmCardTitle class="text-xl">{{ t('auth.login.title') }}</h1>
              <p hlmCardDescription>{{ t('auth.login.description') }}</p>
            </div>
            <div hlmCardContent>
              <form
                [formRoot]="loginForm"
                (submit)="$event.preventDefault(); login()"
                class="flex flex-col gap-4"
              >
                <div hlmField>
                  <label hlmFieldLabel for="email">{{ t('common.email') }}</label>
                  <input
                    hlmInput
                    id="email"
                    type="email"
                    autocomplete="username"
                    [formField]="loginForm.email"
                  />
                </div>
                <div hlmField>
                  <label hlmFieldLabel for="password">{{ t('common.password') }}</label>
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
                <button
                  hlmBtn
                  type="submit"
                  class="mt-2"
                  [disabled]="busy() || loginForm().invalid()"
                >
                  @if (busy()) {
                    <hlm-spinner />
                  }
                  {{ t('auth.login.submit') }}
                </button>
              </form>
            </div>
          </section>
        </div>
      </main>
    </div>
  `,
})
export class LoginPage implements OnInit {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly features = AUTH_FEATURES;
  protected readonly showPassword = signal(false);

  protected readonly model = signal({ email: '', password: '' });
  protected readonly loginForm = form(this.model, (path) => {
    required(path.email);
    email(path.email);
    required(path.password);
  });
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    if (!(await this.auth.hasAdmin())) await this.router.navigateByUrl('/register');
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
