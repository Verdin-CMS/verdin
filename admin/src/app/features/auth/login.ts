import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
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
import {
  SecondStep,
  TwoFactorMethod,
  firstMethod,
  secondStepProblem,
  totpDigits,
} from '../../core/two-factor';
import { getPasskey, isCancelled, passkeysSupported } from '../../core/webauthn';
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
      @if (step(); as step) {
        <section hlmCard data-testid="two-factor-step">
          <div hlmCardHeader>
            <h1 hlmCardTitle class="text-xl" tabindex="-1" #stepHeading>
              {{ t('twoFactor.login.title') }}
            </h1>
            <p hlmCardDescription>
              {{
                method() === 'recovery'
                  ? t('twoFactor.login.recoveryDescription')
                  : method() === 'passkey'
                    ? t('twoFactor.login.passkeyDescription')
                    : t('twoFactor.login.totpDescription')
              }}
            </p>
          </div>
          <div hlmCardContent class="flex flex-col gap-4">
            @if (method() === 'passkey') {
              <button
                hlmBtn
                type="button"
                class="w-full"
                data-testid="use-passkey"
                [disabled]="busy() || !passkeys"
                (click)="usePasskey()"
              >
                @if (busy()) {
                  <hlm-spinner />
                } @else {
                  <ng-icon name="lucideFingerprint" aria-hidden="true" />
                }
                {{ t('twoFactor.login.usePasskey') }}
              </button>
              @if (!passkeys) {
                <p class="text-muted-foreground text-sm">{{ t('twoFactor.passkeyUnsupported') }}</p>
              }
            } @else {
              <form class="flex flex-col gap-4" (submit)="$event.preventDefault(); submitCode()">
                <div hlmField>
                  <label hlmFieldLabel for="two-factor-code">{{
                    method() === 'recovery'
                      ? t('twoFactor.login.recoveryLabel')
                      : t('twoFactor.login.codeLabel')
                  }}</label>
                  @if (method() === 'recovery') {
                    <input
                      #codeInput
                      dir="ltr"
                      hlmInput
                      id="two-factor-code"
                      class="font-mono"
                      autocomplete="off"
                      autocapitalize="off"
                      spellcheck="false"
                      [attr.aria-invalid]="!!error() || null"
                      [attr.aria-describedby]="error() ? 'two-factor-error' : null"
                      [value]="code()"
                      (input)="code.set($any($event.target).value)"
                    />
                  } @else {
                    <input
                      #codeInput
                      dir="ltr"
                      hlmInput
                      id="two-factor-code"
                      class="text-center font-mono text-lg tracking-[0.5em]"
                      inputmode="numeric"
                      autocomplete="one-time-code"
                      maxlength="6"
                      [attr.aria-invalid]="!!error() || null"
                      [attr.aria-describedby]="error() ? 'two-factor-error' : null"
                      [value]="code()"
                      (input)="typeTotp($event)"
                    />
                  }
                </div>
                @if (error()) {
                  <div hlmAlert variant="destructive" role="alert" id="two-factor-error">
                    <ng-icon name="lucideCircleAlert" />
                    <p hlmAlertDescription>{{ error() }}</p>
                  </div>
                }
                <button hlmBtn type="submit" [disabled]="busy() || !codeReady()">
                  @if (busy()) {
                    <hlm-spinner />
                  }
                  {{ t('twoFactor.login.verify') }}
                </button>
              </form>
            }
            @if (method() === 'passkey' && error()) {
              <div hlmAlert variant="destructive" role="alert" id="two-factor-error">
                <ng-icon name="lucideCircleAlert" />
                <p hlmAlertDescription>{{ error() }}</p>
              </div>
            }
            <div class="flex flex-col items-start gap-1 text-sm">
              @if (method() !== 'passkey' && step.methods.includes('passkey')) {
                <button
                  hlmBtn
                  variant="outline"
                  type="button"
                  class="w-full"
                  data-testid="switch-passkey"
                  [disabled]="busy() || !passkeys"
                  (click)="usePasskey()"
                >
                  <ng-icon name="lucideFingerprint" aria-hidden="true" />
                  {{ t('twoFactor.login.usePasskey') }}
                </button>
              }
              @if (method() !== 'totp' && step.methods.includes('totp')) {
                <button
                  hlmBtn
                  variant="link"
                  type="button"
                  class="h-auto px-0"
                  (click)="switchTo('totp')"
                >
                  {{ t('twoFactor.login.useApp') }}
                </button>
              }
              @if (method() !== 'recovery' && step.methods.includes('recovery')) {
                <button
                  hlmBtn
                  variant="link"
                  type="button"
                  class="h-auto px-0"
                  data-testid="use-recovery"
                  (click)="switchTo('recovery')"
                >
                  {{ t('twoFactor.login.useRecovery') }}
                </button>
              }
              <button
                hlmBtn
                variant="link"
                type="button"
                class="text-muted-foreground h-auto px-0"
                (click)="backToPassword()"
              >
                <ng-icon name="lucideArrowLeft" class="rtl:-scale-x-100" aria-hidden="true" />
                {{ t('twoFactor.login.back') }}
              </button>
            </div>
          </div>
        </section>
      } @else {
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
      }
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
    // Single sign-on for an account with a second factor lands here to finish.
    const params = this.route.snapshot.queryParamMap;
    const token = params.get('twoFactorToken');
    if (token) {
      const known: TwoFactorMethod[] = ['totp', 'passkey', 'recovery'];
      const methods = (params.get('methods') ?? '')
        .split(',')
        .filter((method): method is TwoFactorMethod => known.includes(method as TwoFactorMethod));
      if (methods.length) this.startSecondStep({ twoFactorToken: token, methods });
    }
  }

  /** The second sign-in step, once the password was accepted. */
  protected readonly step = signal<SecondStep | null>(null);
  protected readonly method = signal<TwoFactorMethod>('totp');
  protected readonly code = signal('');
  protected readonly codeReady = computed(() =>
    this.method() === 'recovery' ? this.code().trim().length > 0 : this.code().length === 6,
  );
  protected readonly passkeys = passkeysSupported();
  private readonly injector = inject(Injector);
  private readonly codeInput = viewChild<ElementRef<HTMLInputElement>>('codeInput');
  private readonly stepHeading = viewChild<ElementRef<HTMLElement>>('stepHeading');

  protected startUrl(id: string): string {
    return ssoStartUrl(this.config.apiBase, id);
  }

  protected async login(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    await submit(this.loginForm, async () => {
      try {
        const step = await this.auth.login(this.model().email, this.model().password);
        if (step) this.startSecondStep(step);
        else await this.enter();
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

  private async enter(): Promise<void> {
    await this.router.navigateByUrl(this.route.snapshot.queryParamMap.get('next') ?? '/');
  }

  private startSecondStep(step: SecondStep): void {
    this.step.set(step);
    this.model.update((model) => ({ ...model, password: '' }));
    this.switchTo(firstMethod(step.methods, this.passkeys));
  }

  /** Shows another method and moves the focus to its code field (or the heading). */
  protected switchTo(method: TwoFactorMethod): void {
    this.method.set(method);
    this.code.set('');
    this.error.set(null);
    afterNextRender(() => (this.codeInput() ?? this.stepHeading())?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  protected backToPassword(message: string | null = null): void {
    this.step.set(null);
    this.code.set('');
    this.error.set(message);
    afterNextRender(() => document.getElementById('password')?.focus(), {
      injector: this.injector,
    });
  }

  /** Keeps the digits; six of them send the code. */
  protected typeTotp(event: Event): void {
    const input = event.target as HTMLInputElement;
    const digits = totpDigits(input.value);
    input.value = digits;
    this.code.set(digits);
    if (digits.length === 6 && !this.busy()) void this.submitCode();
  }

  protected async submitCode(): Promise<void> {
    const step = this.step();
    if (!step || !this.codeReady() || this.busy()) return;
    await this.verify(() => this.auth.loginTwoFactor(step.twoFactorToken, { code: this.code() }));
  }

  protected async usePasskey(): Promise<void> {
    const step = this.step();
    if (!step || this.busy()) return;
    if (this.method() !== 'passkey') this.switchTo('passkey');
    await this.verify(async () => {
      const options = await this.auth.passkeyLoginOptions(step.twoFactorToken);
      const credential = await getPasskey(options.publicKey);
      await this.auth.loginTwoFactor(step.twoFactorToken, {
        challengeToken: options.challengeToken,
        credential,
      });
    });
  }

  private async verify(attempt: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await attempt();
      await this.enter();
    } catch (error) {
      if (isCancelled(error)) {
        this.error.set(this.t('twoFactor.passkeyCancelled'));
        return;
      }
      const failure = ApiFailure.from(error);
      switch (secondStepProblem(failure)) {
        case 'expired':
          this.backToPassword(this.t('twoFactor.login.expired'));
          return;
        case 'tooMany':
          this.error.set(this.t('auth.login.tooManyAttempts'));
          break;
        case 'invalid':
          this.error.set(
            this.t(
              this.method() === 'passkey'
                ? 'twoFactor.login.invalidPasskey'
                : this.method() === 'recovery'
                  ? 'twoFactor.login.invalidRecovery'
                  : 'twoFactor.login.invalidCode',
            ),
          );
          break;
        default:
          this.error.set(failure.message);
      }
      if (this.method() === 'totp') this.code.set('');
      afterNextRender(() => this.codeInput()?.nativeElement.select(), {
        injector: this.injector,
      });
    } finally {
      this.busy.set(false);
    }
  }
}
