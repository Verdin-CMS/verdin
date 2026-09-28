import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';

import { ApiFailure } from '../../core/api';
import { Auth } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/keys';
import { encodeQr, qrPath } from '../../core/qr';
import {
  Passkey,
  TotpSetup,
  TwoFactor,
  TwoFactorStatus,
  passkeyIsLastFactor,
  recoveryCodesFile,
  totpDigits,
  totpIsLastFactor,
} from '../../core/two-factor';
import { createPasskey, isCancelled, passkeysSupported } from '../../core/webauthn';
import { PasswordField } from '../auth/password-field';

/** What the password confirmation is for. */
export type TwoFactorAction =
  'totpSetup' | 'totpDisable' | 'recovery' | 'passkeyAdd' | 'passkeyRemove';

/** The step shown in the dialog. */
type Flow =
  | { kind: 'password'; action: TwoFactorAction; passkey?: Passkey }
  | { kind: 'totp'; setup: TotpSetup; path: string; size: number }
  | { kind: 'codes'; codes: string[] };

const CONFIRM: Record<TwoFactorAction, { title: MessageKey; description: MessageKey }> = {
  totpSetup: {
    title: 'twoFactor.confirm.totpSetup.title',
    description: 'twoFactor.confirm.totpSetup.description',
  },
  totpDisable: {
    title: 'twoFactor.confirm.totpDisable.title',
    description: 'twoFactor.confirm.totpDisable.description',
  },
  recovery: {
    title: 'twoFactor.confirm.recovery.title',
    description: 'twoFactor.confirm.recovery.description',
  },
  passkeyAdd: {
    title: 'twoFactor.confirm.passkeyAdd.title',
    description: 'twoFactor.confirm.passkeyAdd.description',
  },
  passkeyRemove: {
    title: 'twoFactor.confirm.passkeyRemove.title',
    description: 'twoFactor.confirm.passkeyRemove.description',
  },
};

/** The profile's "Two-factor authentication" card: authenticator app, passkeys, codes. */
@Component({
  selector: 'vd-two-factor-settings',
  imports: [
    NgIcon,
    HlmAlertImports,
    HlmBadgeImports,
    HlmButtonImports,
    HlmCardImports,
    HlmDialogImports,
    HlmFieldImports,
    HlmInputImports,
    HlmSkeletonImports,
    HlmSpinnerImports,
    PasswordField,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section hlmCard id="two-factor" aria-labelledby="two-factor-title" data-testid="two-factor">
      <div hlmCardHeader>
        <h2 hlmCardTitle id="two-factor-title" tabindex="-1" class="flex items-center gap-2">
          {{ t('twoFactor.title') }}
          @if (status(); as status) {
            @if (enabled()) {
              <span hlmBadge variant="secondary" class="gap-1">
                <ng-icon name="lucideShieldCheck" aria-hidden="true" />{{ t('twoFactor.on') }}
              </span>
            } @else {
              <span hlmBadge variant="outline">{{ t('twoFactor.off') }}</span>
            }
            @if (status.required) {
              <span hlmBadge variant="outline" data-testid="two-factor-required">
                {{ t('twoFactor.requiredByRole') }}
              </span>
            }
          }
        </h2>
        <p hlmCardDescription>{{ t('twoFactor.description') }}</p>
      </div>
      <div hlmCardContent class="flex flex-col gap-4">
        @if (loadError()) {
          <div hlmAlert variant="destructive" role="alert">
            <ng-icon name="lucideCircleAlert" />
            <p hlmAlertDescription>{{ loadError() }}</p>
          </div>
        } @else if (status(); as status) {
          <div class="flex flex-wrap items-start gap-3 rounded-lg border p-3">
            <span
              class="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg"
              aria-hidden="true"
            >
              <ng-icon name="lucideSmartphone" />
            </span>
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
              <h3 class="flex items-center gap-2 text-sm font-medium">
                {{ t('twoFactor.totp.title') }}
                @if (status.totp) {
                  <span hlmBadge variant="secondary">{{ t('twoFactor.on') }}</span>
                }
              </h3>
              <p class="text-muted-foreground text-xs">
                {{ status.totp ? t('twoFactor.totp.onHint') : t('twoFactor.totp.offHint') }}
              </p>
              @if (status.totp && totpLast()) {
                <p class="text-muted-foreground text-xs">{{ t('twoFactor.totp.lastFactor') }}</p>
              }
            </div>
            @if (status.totp) {
              <button
                hlmBtn
                variant="outline"
                size="sm"
                data-testid="totp-disable"
                [disabled]="totpLast()"
                (click)="confirm('totpDisable')"
              >
                {{ t('twoFactor.totp.disable') }}
              </button>
            } @else {
              <button hlmBtn size="sm" data-testid="totp-setup" (click)="confirm('totpSetup')">
                {{ t('twoFactor.totp.setup') }}
              </button>
            }
          </div>

          <div class="flex flex-col gap-3 rounded-lg border p-3">
            <div class="flex flex-wrap items-start gap-3">
              <span
                class="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg"
                aria-hidden="true"
              >
                <ng-icon name="lucideFingerprint" />
              </span>
              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <h3 class="text-sm font-medium">{{ t('twoFactor.passkeys.title') }}</h3>
                <p class="text-muted-foreground text-xs">
                  {{ passkeys ? t('twoFactor.passkeys.hint') : t('twoFactor.passkeyUnsupported') }}
                </p>
              </div>
              <button
                hlmBtn
                variant="outline"
                size="sm"
                data-testid="passkey-add"
                [disabled]="!passkeys"
                (click)="confirm('passkeyAdd')"
              >
                <ng-icon name="lucidePlus" /> {{ t('twoFactor.passkeys.add') }}
              </button>
            </div>
            @if (status.passkeys.length) {
              <ul class="flex flex-col divide-y rounded-md border" data-testid="passkeys">
                @for (passkey of status.passkeys; track passkey.id) {
                  <li class="flex flex-wrap items-center gap-3 px-3 py-2">
                    <ng-icon
                      name="lucideKeyRound"
                      class="text-muted-foreground"
                      aria-hidden="true"
                    />
                    <div class="flex min-w-0 flex-1 flex-col">
                      <span class="truncate text-sm font-medium">{{ passkey.name }}</span>
                      <span class="text-muted-foreground text-xs">{{ passkeyMeta(passkey) }}</span>
                    </div>
                    <button
                      hlmBtn
                      variant="ghost"
                      size="sm"
                      class="text-muted-foreground hover:text-destructive"
                      [disabled]="passkeyLast()"
                      [attr.aria-label]="
                        t('twoFactor.passkeys.removeLabel', { name: passkey.name })
                      "
                      [attr.title]="passkeyLast() ? t('twoFactor.passkeys.lastFactor') : null"
                      (click)="confirm('passkeyRemove', passkey)"
                    >
                      <ng-icon name="lucideTrash2" /> {{ t('twoFactor.passkeys.remove') }}
                    </button>
                  </li>
                }
              </ul>
              @if (passkeyLast()) {
                <p class="text-muted-foreground text-xs">
                  {{ t('twoFactor.passkeys.lastFactor') }}
                </p>
              }
            } @else {
              <p class="text-muted-foreground text-sm">{{ t('twoFactor.passkeys.none') }}</p>
            }
          </div>

          @if (enabled()) {
            <div class="flex flex-wrap items-start gap-3 rounded-lg border p-3">
              <span
                class="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg"
                aria-hidden="true"
              >
                <ng-icon name="lucideListChecks" />
              </span>
              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <h3 class="text-sm font-medium">{{ t('twoFactor.recovery.title') }}</h3>
                <p class="text-muted-foreground text-xs" data-testid="recovery-left">
                  {{ t('twoFactor.recovery.left', { count: status.recoveryCodesLeft }) }}
                  · {{ t('twoFactor.recovery.hint') }}
                </p>
              </div>
              <button
                hlmBtn
                variant="outline"
                size="sm"
                data-testid="recovery-regenerate"
                (click)="confirm('recovery')"
              >
                <ng-icon name="lucideRefreshCw" /> {{ t('twoFactor.recovery.regenerate') }}
              </button>
            </div>
          }
        } @else {
          <hlm-skeleton class="h-16 w-full" />
          <hlm-skeleton class="h-16 w-full" />
        }
      </div>
    </section>

    <hlm-dialog [state]="flow() ? 'open' : 'closed'" (closed)="close()">
      <hlm-dialog-content
        *hlmDialogPortal="let ctx"
        class="sm:max-w-md"
        [closeLabel]="t('common.close')"
      >
        @if (flow(); as flow) {
          @switch (flow.kind) {
            @case ('password') {
              @let texts = confirmTexts(flow.action);
              <form class="flex flex-col gap-4" (submit)="$event.preventDefault(); proceed()">
                <hlm-dialog-header>
                  <h2 hlmDialogTitle>
                    {{ t(texts.title, { name: flow.passkey?.name ?? '' }) }}
                  </h2>
                  <p hlmDialogDescription>{{ t(texts.description) }}</p>
                </hlm-dialog-header>
                @if (flow.action === 'passkeyAdd') {
                  <div hlmField>
                    <label hlmFieldLabel for="passkey-name">{{
                      t('twoFactor.passkeys.nameLabel')
                    }}</label>
                    <input
                      hlmInput
                      id="passkey-name"
                      maxlength="100"
                      autocomplete="off"
                      [placeholder]="t('twoFactor.passkeys.namePlaceholder')"
                      [value]="passkeyName()"
                      (input)="passkeyName.set($any($event.target).value)"
                    />
                  </div>
                }
                <div hlmField>
                  <label hlmFieldLabel for="two-factor-password">{{
                    t('account.currentPassword')
                  }}</label>
                  <vd-password-field
                    inputId="two-factor-password"
                    autocomplete="current-password"
                    [invalid]="!!flowError()"
                    [describedBy]="flowError() ? 'two-factor-flow-error' : null"
                    [(value)]="password"
                  />
                </div>
                @if (flowError()) {
                  <div hlmAlert variant="destructive" role="alert" id="two-factor-flow-error">
                    <ng-icon name="lucideCircleAlert" />
                    <p hlmAlertDescription>{{ flowError() }}</p>
                  </div>
                }
                <hlm-dialog-footer>
                  <button hlmBtn type="button" variant="outline" (click)="close()">
                    {{ t('common.cancel') }}
                  </button>
                  <button
                    hlmBtn
                    type="submit"
                    data-testid="two-factor-confirm"
                    [variant]="
                      flow.action === 'totpDisable' || flow.action === 'passkeyRemove'
                        ? 'destructive'
                        : 'default'
                    "
                    [disabled]="busy() || !password()"
                  >
                    @if (busy()) {
                      <hlm-spinner class="size-4" />
                    }
                    {{ t(confirmLabel(flow.action)) }}
                  </button>
                </hlm-dialog-footer>
              </form>
            }
            @case ('totp') {
              <form class="flex flex-col gap-4" (submit)="$event.preventDefault(); enableTotp()">
                <hlm-dialog-header>
                  <h2 hlmDialogTitle>{{ t('twoFactor.totp.scanTitle') }}</h2>
                  <p hlmDialogDescription>{{ t('twoFactor.totp.scanDescription') }}</p>
                </hlm-dialog-header>
                <svg
                  class="mx-auto size-48 rounded-md bg-white"
                  role="img"
                  shape-rendering="crispEdges"
                  data-testid="totp-qr"
                  [attr.viewBox]="'0 0 ' + flow.size + ' ' + flow.size"
                  [attr.aria-label]="t('twoFactor.totp.qrLabel')"
                >
                  <path fill="#000" [attr.d]="flow.path" />
                </svg>
                <div hlmField>
                  <label hlmFieldLabel for="totp-secret">{{ t('twoFactor.totp.manual') }}</label>
                  <div class="flex items-center gap-2">
                    <input
                      dir="ltr"
                      hlmInput
                      readonly
                      id="totp-secret"
                      class="font-mono text-xs"
                      data-testid="totp-secret"
                      [value]="groupSecret(flow.setup.secret)"
                      (focus)="$any($event.target).select()"
                    />
                    <button
                      hlmBtn
                      type="button"
                      variant="outline"
                      (click)="copy(flow.setup.secret)"
                    >
                      <ng-icon name="lucideCopy" /> {{ t('common.copy') }}
                    </button>
                  </div>
                </div>
                <div hlmField>
                  <label hlmFieldLabel for="totp-code">{{ t('twoFactor.codeLabel') }}</label>
                  <input
                    dir="ltr"
                    hlmInput
                    id="totp-code"
                    class="text-center font-mono text-lg tracking-[0.5em]"
                    inputmode="numeric"
                    autocomplete="one-time-code"
                    maxlength="6"
                    [attr.aria-invalid]="!!flowError() || null"
                    [attr.aria-describedby]="flowError() ? 'two-factor-flow-error' : null"
                    [value]="code()"
                    (input)="typeCode($event)"
                  />
                </div>
                @if (flowError()) {
                  <div hlmAlert variant="destructive" role="alert" id="two-factor-flow-error">
                    <ng-icon name="lucideCircleAlert" />
                    <p hlmAlertDescription>{{ flowError() }}</p>
                  </div>
                }
                <hlm-dialog-footer>
                  <button hlmBtn type="button" variant="outline" (click)="close()">
                    {{ t('common.cancel') }}
                  </button>
                  <button
                    hlmBtn
                    type="submit"
                    data-testid="totp-enable"
                    [disabled]="busy() || code().length !== 6"
                  >
                    @if (busy()) {
                      <hlm-spinner class="size-4" />
                    }
                    {{ t('twoFactor.totp.enable') }}
                  </button>
                </hlm-dialog-footer>
              </form>
            }
            @case ('codes') {
              <hlm-dialog-header>
                <h2 hlmDialogTitle>{{ t('twoFactor.recovery.codesTitle') }}</h2>
                <p hlmDialogDescription>{{ t('twoFactor.recovery.shownOnce') }}</p>
              </hlm-dialog-header>
              <ul
                dir="ltr"
                class="bg-muted/50 grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg border p-4 font-mono text-sm"
                data-testid="recovery-codes"
                [attr.aria-label]="t('twoFactor.recovery.listLabel')"
              >
                @for (code of flow.codes; track $index) {
                  <li>{{ code }}</li>
                }
              </ul>
              <div class="flex flex-wrap gap-2">
                <button hlmBtn variant="outline" size="sm" (click)="copy(flow.codes.join('\\n'))">
                  <ng-icon name="lucideCopy" /> {{ t('common.copy') }}
                </button>
                <button hlmBtn variant="outline" size="sm" (click)="download(flow.codes)">
                  <ng-icon name="lucideDownload" /> {{ t('twoFactor.recovery.download') }}
                </button>
              </div>
              <hlm-dialog-footer>
                <button hlmBtn id="recovery-done" data-testid="recovery-done" (click)="close()">
                  {{ t('twoFactor.recovery.saved') }}
                </button>
              </hlm-dialog-footer>
            }
          }
        }
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class TwoFactorSettings implements OnInit {
  private readonly twoFactor = inject(TwoFactor);
  private readonly auth = inject(Auth);
  private readonly injector = inject(Injector);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  /** The admin's factors changed (the shell may load what their role blocked). */
  readonly changed = output<TwoFactorStatus>();

  protected readonly passkeys = passkeysSupported();
  protected readonly status = signal<TwoFactorStatus | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly enabled = computed(() => {
    const status = this.status();
    return !!status && (status.totp || status.passkeys.length > 0);
  });
  protected readonly totpLast = computed(() => {
    const status = this.status();
    return !!status && totpIsLastFactor(status);
  });
  protected readonly passkeyLast = computed(() => {
    const status = this.status();
    return !!status && passkeyIsLastFactor(status);
  });

  protected readonly flow = signal<Flow | null>(null);
  protected readonly password = signal('');
  protected readonly passkeyName = signal('');
  protected readonly code = signal('');
  protected readonly busy = signal(false);
  protected readonly flowError = signal<string | null>(null);

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.status.set(await this.twoFactor.status());
      this.loadError.set(null);
    } catch (error) {
      this.loadError.set(ApiFailure.from(error).message);
    }
  }

  /** Reloads the status and the admin (their `twoFactor` flag) after a change. */
  private async refresh(): Promise<void> {
    await this.load();
    await this.auth.reload().catch(() => undefined);
    const status = this.status();
    if (status) this.changed.emit(status);
  }

  protected confirmTexts(action: TwoFactorAction): { title: MessageKey; description: MessageKey } {
    return CONFIRM[action];
  }

  protected confirmLabel(action: TwoFactorAction): MessageKey {
    switch (action) {
      case 'totpDisable':
        return 'twoFactor.totp.disable';
      case 'passkeyRemove':
        return 'twoFactor.passkeys.remove';
      case 'recovery':
        return 'twoFactor.recovery.regenerate';
      default:
        return 'twoFactor.continue';
    }
  }

  protected passkeyMeta(passkey: Passkey): string {
    const added = passkey.createdAt
      ? this.t('twoFactor.passkeys.addedOn', {
          date: this.i18n.formatDate(passkey.createdAt, 'date'),
        })
      : null;
    const used = passkey.lastUsedAt
      ? this.t('twoFactor.passkeys.lastUsed', {
          date: this.i18n.formatRelative(passkey.lastUsedAt),
        })
      : this.t('twoFactor.passkeys.neverUsed');
    return [added, used].filter(Boolean).join(' · ');
  }

  /** The secret in groups of four, easier to type. */
  protected groupSecret(secret: string): string {
    return secret.replace(/(.{4})(?=.)/g, '$1 ');
  }

  protected confirm(action: TwoFactorAction, passkey?: Passkey): void {
    this.password.set('');
    this.passkeyName.set('');
    this.flowError.set(null);
    this.flow.set({ kind: 'password', action, passkey });
  }

  protected close(): void {
    this.flow.set(null);
    this.password.set('');
    this.code.set('');
    this.flowError.set(null);
  }

  /** Moves the focus into the new step of the open dialog. */
  private focus(id: string): void {
    afterNextRender(() => document.getElementById(id)?.focus(), { injector: this.injector });
  }

  private show(flow: Flow): void {
    this.password.set('');
    this.code.set('');
    this.flowError.set(null);
    this.flow.set(flow);
    this.focus(flow.kind === 'totp' ? 'totp-code' : 'recovery-done');
  }

  /** The password was entered: does what it confirms. */
  protected async proceed(): Promise<void> {
    const flow = this.flow();
    if (flow?.kind !== 'password' || !this.password() || this.busy()) return;
    const password = this.password();
    await this.run(async () => {
      switch (flow.action) {
        case 'totpSetup': {
          const setup = await this.twoFactor.totpSetup(password);
          const qr = encodeQr(setup.otpauthUrl, 'M');
          this.show({ kind: 'totp', setup, path: qrPath(qr), size: qr.size + 8 });
          return;
        }
        case 'totpDisable':
          await this.twoFactor.totpDisable(password);
          this.done('twoFactor.totp.disabled');
          break;
        case 'recovery':
          this.show({
            kind: 'codes',
            codes: await this.twoFactor.regenerateRecoveryCodes(password),
          });
          break;
        case 'passkeyAdd': {
          const options = await this.twoFactor.passkeyOptions(password);
          const credential = await createPasskey(options.publicKey);
          const added = await this.twoFactor.addPasskey({
            challengeToken: options.challengeToken,
            name: this.passkeyName().trim(),
            credential,
          });
          toast.success(this.t('twoFactor.passkeys.added'));
          if (added.recoveryCodes?.length) this.show({ kind: 'codes', codes: added.recoveryCodes });
          else this.flow.set(null);
          break;
        }
        case 'passkeyRemove':
          if (!flow.passkey) return;
          await this.twoFactor.removePasskey(flow.passkey.id, password);
          this.done('twoFactor.passkeys.removed');
          break;
      }
      await this.refresh();
    });
  }

  private done(message: MessageKey): void {
    this.flow.set(null);
    toast.success(this.t(message));
  }

  protected typeCode(event: Event): void {
    const input = event.target as HTMLInputElement;
    const digits = totpDigits(input.value);
    input.value = digits;
    this.code.set(digits);
    if (digits.length === 6) void this.enableTotp();
  }

  protected async enableTotp(): Promise<void> {
    if (this.flow()?.kind !== 'totp' || this.code().length !== 6 || this.busy()) return;
    const code = this.code();
    await this.run(async () => {
      const codes = await this.twoFactor.totpEnable(code);
      toast.success(this.t('twoFactor.totp.enabled'));
      this.show({ kind: 'codes', codes });
      await this.refresh();
    });
    if (this.flowError()) {
      this.code.set('');
      this.focus('totp-code');
    }
  }

  private async run(step: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.flowError.set(null);
    try {
      await step();
    } catch (error) {
      this.flowError.set(this.message(error));
    } finally {
      this.busy.set(false);
    }
  }

  private message(error: unknown): string {
    if (isCancelled(error)) return this.t('twoFactor.passkeyCancelled');
    if (error instanceof DOMException && error.name === 'InvalidStateError')
      return this.t('twoFactor.passkeyExists');
    const failure = ApiFailure.from(error);
    if (failure.status === 429) return this.t('auth.login.tooManyAttempts');
    if (/password is not correct|current password/i.test(failure.message))
      return this.t('account.wrongPassword');
    if (/code is not valid/i.test(failure.message)) return this.t('twoFactor.invalidCode');
    if (/already registered/i.test(failure.message)) return this.t('twoFactor.passkeyExists');
    return failure.message;
  }

  protected async copy(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(this.t('common.copied'));
    } catch {
      toast.error(this.t('twoFactor.copyFailed'));
    }
  }

  protected download(codes: readonly string[]): void {
    const text = recoveryCodesFile(codes, this.auth.user()?.email ?? '');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'verdin-recovery-codes.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
