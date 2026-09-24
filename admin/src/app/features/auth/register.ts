import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormField, FormRoot, email, form, minLength, required } from '@angular/forms/signals';
import { Router } from '@angular/router';
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
import { Logo } from '../../shared/components/logo';
import { PreferencesMenu } from '../../shared/components/preferences-menu';
import { AUTH_FEATURES } from './login';

@Component({
  selector: 'vd-register',
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
        <div class="flex w-full max-w-md flex-col gap-6">
          <vd-logo size="lg" class="self-center lg:hidden" />
          <section hlmCard>
            <div hlmCardHeader>
              <h1 hlmCardTitle class="text-xl">{{ t('auth.register.title') }}</h1>
              <p hlmCardDescription>{{ t('auth.register.description') }}</p>
            </div>
            <div hlmCardContent>
              <form
                [formRoot]="registerForm"
                (submit)="$event.preventDefault(); register()"
                class="flex flex-col gap-4"
              >
                <div class="grid gap-4 sm:grid-cols-2">
                  <div hlmField>
                    <label hlmFieldLabel for="firstname">{{ t('auth.register.firstname') }}</label>
                    <input
                      hlmInput
                      id="firstname"
                      autocomplete="given-name"
                      [formField]="registerForm.firstname"
                    />
                  </div>
                  <div hlmField>
                    <label hlmFieldLabel for="lastname">{{ t('auth.register.lastname') }}</label>
                    <input
                      hlmInput
                      id="lastname"
                      autocomplete="family-name"
                      [formField]="registerForm.lastname"
                    />
                  </div>
                </div>
                <div hlmField>
                  <label hlmFieldLabel for="email">{{ t('common.email') }}</label>
                  <input
                    hlmInput
                    id="email"
                    type="email"
                    autocomplete="username"
                    [formField]="registerForm.email"
                  />
                  @if (registerForm.email().touched()) {
                    @for (error of registerForm.email().errors(); track error.kind) {
                      <hlm-field-error>{{ errorText(error) }}</hlm-field-error>
                    }
                  }
                </div>
                <div hlmField>
                  <label hlmFieldLabel for="password">{{ t('common.password') }}</label>
                  <div hlmInputGroup>
                    <input
                      hlmInputGroupInput
                      id="password"
                      [type]="showPassword() ? 'text' : 'password'"
                      autocomplete="new-password"
                      [formField]="registerForm.password"
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
                  <p hlmFieldDescription>{{ t('auth.register.passwordHint') }}</p>
                  @if (registerForm.password().touched()) {
                    @for (error of registerForm.password().errors(); track error.kind) {
                      <hlm-field-error>{{ errorText(error) }}</hlm-field-error>
                    }
                  }
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
                  [disabled]="busy() || registerForm().invalid()"
                >
                  @if (busy()) {
                    <hlm-spinner />
                  }
                  {{ t('auth.register.submit') }}
                </button>
              </form>
            </div>
          </section>
        </div>
      </main>
    </div>
  `,
})
export class RegisterPage {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly features = AUTH_FEATURES;
  protected readonly showPassword = signal(false);

  protected readonly model = signal({ firstname: '', lastname: '', email: '', password: '' });
  protected readonly registerForm = form(this.model, (path) => {
    required(path.email);
    email(path.email);
    required(path.password);
    minLength(path.password, 8);
  });
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Validation messages are built here so they follow the interface language. */
  protected errorText(error: { kind: string; message?: string }): string {
    switch (error.kind) {
      case 'required':
        return this.t('common.required');
      case 'email':
        return this.t('auth.register.invalidEmail');
      case 'minLength':
        return this.t('auth.register.passwordTooShort');
      default:
        return error.message ?? '';
    }
  }

  protected async register(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const { firstname, lastname, email, password } = this.model();
      await this.auth.register({
        email,
        password,
        firstname: firstname || undefined,
        lastname: lastname || undefined,
      });
      await this.router.navigateByUrl('/');
    } catch (error) {
      const failure = ApiFailure.from(error);
      this.error.set(
        failure.status === 403 ? this.t('auth.register.adminExists') : failure.message,
      );
    } finally {
      this.busy.set(false);
    }
  }
}
