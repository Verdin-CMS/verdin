import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';

import {
  Account,
  AdminSession,
  DeviceInfo,
  describeUserAgent,
  sortSessions,
} from '../../core/account';
import { ApiFailure } from '../../core/api';
import { Auth } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import { LocaleTag } from '../../core/i18n/locales';
import { Theme, ThemeChoice } from '../../core/theme';
import { Unseen } from '../../core/unseen';
import { UserPreferences } from '../../core/user-preferences';
import { PageHeader } from '../../shared/components/page-header';
import { NewPassword } from '../auth/new-password';
import { PasswordField } from '../auth/password-field';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** `/profile`: the signed-in admin's details, password, sessions and preferences. */
@Component({
  selector: 'vd-profile',
  imports: [
    NgIcon,
    HlmAlertImports,
    HlmAlertDialogImports,
    HlmBadgeImports,
    HlmButtonImports,
    HlmCardImports,
    HlmFieldImports,
    HlmInputImports,
    HlmNativeSelectImports,
    HlmSkeletonImports,
    HlmSpinnerImports,
    HlmSwitchImports,
    NewPassword,
    PageHeader,
    PasswordField,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <vd-page-header [title]="t('account.title')" [description]="t('account.description')">
        <span eyebrow class="text-primary flex items-center gap-1.5 text-xs font-medium">
          <ng-icon name="lucideUserRound" size="14" /> {{ auth.user()?.email }}
        </span>
      </vd-page-header>

      <div class="grid items-start gap-6 lg:grid-cols-2">
        <section hlmCard>
          <div hlmCardHeader>
            <h2 hlmCardTitle>{{ t('account.details') }}</h2>
            <p hlmCardDescription>{{ t('account.detailsHint') }}</p>
          </div>
          <form
            hlmCardContent
            class="flex flex-col gap-4"
            (submit)="$event.preventDefault(); saveDetails()"
          >
            <div class="grid gap-4 sm:grid-cols-2">
              <div hlmField>
                <label hlmFieldLabel for="profile-firstname">{{
                  t('settings.users.firstname')
                }}</label>
                <input
                  hlmInput
                  id="profile-firstname"
                  autocomplete="given-name"
                  [value]="firstname()"
                  (input)="firstname.set($any($event.target).value)"
                />
              </div>
              <div hlmField>
                <label hlmFieldLabel for="profile-lastname">{{
                  t('settings.users.lastname')
                }}</label>
                <input
                  hlmInput
                  id="profile-lastname"
                  autocomplete="family-name"
                  [value]="lastname()"
                  (input)="lastname.set($any($event.target).value)"
                />
              </div>
            </div>
            <div hlmField>
              <label hlmFieldLabel for="profile-email">{{ t('common.email') }}</label>
              <input
                dir="ltr"
                hlmInput
                id="profile-email"
                type="email"
                autocomplete="username"
                [attr.aria-invalid]="!emailValid() || null"
                [value]="email()"
                (input)="email.set($any($event.target).value)"
              />
            </div>
            @if (emailChanged()) {
              <div hlmField>
                <label hlmFieldLabel for="profile-email-password">{{
                  t('account.currentPassword')
                }}</label>
                <vd-password-field
                  inputId="profile-email-password"
                  autocomplete="current-password"
                  describedBy="profile-email-password-hint"
                  [(value)]="emailPassword"
                />
                <p hlmFieldDescription id="profile-email-password-hint">
                  {{ t('account.emailNeedsPassword') }}
                </p>
              </div>
            }
            @if (detailsError()) {
              <div hlmAlert variant="destructive" role="alert">
                <ng-icon name="lucideCircleAlert" />
                <p hlmAlertDescription>{{ detailsError() }}</p>
              </div>
            }
            <button hlmBtn type="submit" class="self-start" [disabled]="!canSaveDetails()">
              @if (savingDetails()) {
                <hlm-spinner class="size-4" />
              } @else {
                <ng-icon name="lucideSave" />
              }
              {{ t('common.save') }}
            </button>
          </form>
        </section>

        <section hlmCard>
          <div hlmCardHeader>
            <h2 hlmCardTitle>{{ t('account.password.title') }}</h2>
            <p hlmCardDescription>{{ t('account.password.description') }}</p>
          </div>
          <form
            hlmCardContent
            class="flex flex-col gap-4"
            (submit)="$event.preventDefault(); savePassword()"
          >
            <div hlmField>
              <label hlmFieldLabel for="profile-current-password">{{
                t('account.currentPassword')
              }}</label>
              <vd-password-field
                inputId="profile-current-password"
                autocomplete="current-password"
                [(value)]="currentPassword"
              />
            </div>
            <vd-new-password idPrefix="profile" (changed)="newPassword.set($event)" />
            @if (passwordError()) {
              <div hlmAlert variant="destructive" role="alert">
                <ng-icon name="lucideCircleAlert" />
                <p hlmAlertDescription>{{ passwordError() }}</p>
              </div>
            }
            <button
              hlmBtn
              type="submit"
              class="self-start"
              [disabled]="savingPassword() || !newPassword() || !currentPassword()"
            >
              @if (savingPassword()) {
                <hlm-spinner class="size-4" />
              } @else {
                <ng-icon name="lucideLockKeyhole" />
              }
              {{ t('account.password.submit') }}
            </button>
          </form>
        </section>

        <section hlmCard class="lg:col-span-2">
          <div hlmCardHeader>
            <h2 hlmCardTitle>{{ t('account.sessions.title') }}</h2>
            <p hlmCardDescription>{{ t('account.sessions.description') }}</p>
          </div>
          <div hlmCardContent class="flex flex-col gap-3">
            @if (sessionsError()) {
              <div hlmAlert variant="destructive" role="alert">
                <ng-icon name="lucideCircleAlert" />
                <p hlmAlertDescription>{{ sessionsError() }}</p>
              </div>
            } @else if (sessions() === null) {
              <hlm-skeleton class="h-16 w-full" />
            } @else {
              <ul class="flex flex-col divide-y rounded-lg border" data-testid="sessions">
                @for (session of sessions(); track session.id) {
                  @let device = deviceOf(session);
                  <li class="flex flex-wrap items-center gap-3 p-3" data-testid="session">
                    <span
                      class="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg"
                      aria-hidden="true"
                    >
                      <ng-icon [name]="device.mobile ? 'lucideSmartphone' : 'lucideLaptop'" />
                    </span>
                    <div class="flex min-w-0 flex-1 flex-col">
                      <span class="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {{ deviceLabel(device) }}
                        @if (session.current) {
                          <span hlmBadge variant="secondary">{{
                            t('account.sessions.thisDevice')
                          }}</span>
                        }
                      </span>
                      <span class="text-muted-foreground text-xs">
                        {{
                          t('account.sessions.meta', {
                            used: i18n.formatRelative(session.lastUsedAt),
                            created: i18n.formatDate(session.createdAt, 'date'),
                          })
                        }}
                      </span>
                    </div>
                    @if (session.current) {
                      <button hlmBtn variant="outline" size="sm" (click)="auth.logout()">
                        <ng-icon name="lucideLogOut" class="rtl:-scale-x-100" />
                        {{ t('account.sessions.signOut') }}
                      </button>
                    } @else {
                      <button
                        hlmBtn
                        variant="outline"
                        size="sm"
                        [disabled]="revoking().has(session.id)"
                        [attr.aria-label]="
                          t('account.sessions.signOutLabel', { device: deviceLabel(device) })
                        "
                        (click)="revoke([session])"
                      >
                        <ng-icon name="lucideLogOut" class="rtl:-scale-x-100" />
                        {{ t('account.sessions.signOut') }}
                      </button>
                    }
                  </li>
                }
              </ul>
              @if (others().length) {
                <button
                  hlmBtn
                  variant="outline"
                  class="text-destructive hover:text-destructive self-start"
                  (click)="confirmOthers.set(true)"
                >
                  <ng-icon name="lucideLogOut" class="rtl:-scale-x-100" />
                  {{ t('account.sessions.signOutOthers', { count: others().length }) }}
                </button>
              }
            }
          </div>
        </section>

        <section hlmCard class="lg:col-span-2">
          <div hlmCardHeader>
            <h2 hlmCardTitle>{{ t('account.preferences.title') }}</h2>
            <p hlmCardDescription>{{ t('account.preferences.description') }}</p>
          </div>
          <div hlmCardContent class="grid gap-4 sm:grid-cols-2">
            <div hlmField>
              <label hlmFieldLabel for="profile-language">{{ t('prefs.language') }}</label>
              <hlm-native-select
                selectId="profile-language"
                [value]="i18n.locale()"
                (valueChange)="setLanguage($event)"
              >
                @for (locale of i18n.locales; track locale.tag) {
                  <option hlmNativeSelectOption [value]="locale.tag" [attr.lang]="locale.tag">
                    {{ locale.name }}
                  </option>
                }
              </hlm-native-select>
            </div>
            <div hlmField>
              <label hlmFieldLabel for="profile-theme">{{ t('prefs.theme') }}</label>
              <hlm-native-select
                selectId="profile-theme"
                [value]="theme.choice()"
                (valueChange)="theme.set($any($event) || 'system')"
              >
                @for (option of themes; track option.value) {
                  <option hlmNativeSelectOption [value]="option.value">
                    {{ t(option.label) }}
                  </option>
                }
              </hlm-native-select>
            </div>
            <label class="flex items-start gap-3">
              <hlm-switch
                [checked]="unseen.enabled()"
                (checkedChange)="unseen.setEnabled($event)"
              />
              <span class="text-sm font-medium">{{ t('prefs.unseenBadges') }}</span>
            </label>
            <label class="flex items-start gap-3">
              <hlm-switch
                [checked]="digest()"
                [disabled]="!userPreferences.loaded()"
                (checkedChange)="setDigest($event)"
              />
              <span class="text-sm font-medium">{{ t('prefs.digest') }}</span>
            </label>
          </div>
        </section>
      </div>
    </div>

    <hlm-alert-dialog
      [state]="confirmOthers() ? 'open' : 'closed'"
      (closed)="confirmOthers.set(false)"
    >
      <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
        <hlm-alert-dialog-header>
          <h2 hlmAlertDialogTitle>
            {{ t('account.sessions.signOutOthers', { count: others().length }) }}
          </h2>
          <p hlmAlertDialogDescription>{{ t('account.sessions.signOutOthersHint') }}</p>
        </hlm-alert-dialog-header>
        <hlm-alert-dialog-footer>
          <button hlmAlertDialogCancel (click)="ctx.close()">{{ t('common.cancel') }}</button>
          <button
            hlmAlertDialogAction
            variant="destructive"
            (click)="ctx.close(); revoke(others())"
          >
            {{ t('account.sessions.signOut') }}
          </button>
        </hlm-alert-dialog-footer>
      </hlm-alert-dialog-content>
    </hlm-alert-dialog>
  `,
})
export class ProfilePage implements OnInit {
  private readonly account = inject(Account);
  protected readonly auth = inject(Auth);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly theme = inject(Theme);
  protected readonly unseen = inject(Unseen);
  protected readonly userPreferences = inject(UserPreferences);
  private readonly newPasswordInput = viewChild(NewPassword);

  protected readonly themes: {
    value: ThemeChoice;
    label: 'prefs.light' | 'prefs.dark' | 'prefs.system';
  }[] = [
    { value: 'system', label: 'prefs.system' },
    { value: 'light', label: 'prefs.light' },
    { value: 'dark', label: 'prefs.dark' },
  ];

  protected readonly firstname = signal('');
  protected readonly lastname = signal('');
  protected readonly email = signal('');
  protected readonly emailPassword = signal('');
  protected readonly savingDetails = signal(false);
  protected readonly detailsError = signal<string | null>(null);
  protected readonly emailValid = computed(() => EMAIL.test(this.email().trim()));
  protected readonly emailChanged = computed(
    () => this.email().trim().toLowerCase() !== (this.auth.user()?.email ?? '').toLowerCase(),
  );
  protected readonly canSaveDetails = computed(
    () =>
      !this.savingDetails() &&
      this.emailValid() &&
      (!this.emailChanged() || !!this.emailPassword()),
  );

  protected readonly currentPassword = signal('');
  protected readonly newPassword = signal<string | null>(null);
  protected readonly savingPassword = signal(false);
  protected readonly passwordError = signal<string | null>(null);

  protected readonly sessions = signal<AdminSession[] | null>(null);
  protected readonly sessionsError = signal<string | null>(null);
  protected readonly revoking = signal<ReadonlySet<string>>(new Set());
  /** The other devices; unknown while the server cannot tell which session is this one. */
  protected readonly others = computed(() => {
    const sessions = this.sessions() ?? [];
    return sessions.some((session) => session.current)
      ? sessions.filter((session) => !session.current)
      : [];
  });
  protected readonly confirmOthers = signal(false);

  protected readonly digest = computed(() => this.userPreferences.value()['digest'] === 'daily');

  async ngOnInit(): Promise<void> {
    void this.userPreferences.load();
    this.fill();
    void this.loadSessions();
    try {
      const user = await this.account.profile();
      this.auth.user.set(user);
      this.fill();
    } catch {
      // The session's copy of the user is shown instead.
    }
  }

  private fill(): void {
    const user = this.auth.user();
    this.firstname.set(user?.firstname ?? '');
    this.lastname.set(user?.lastname ?? '');
    this.email.set(user?.email ?? '');
    this.emailPassword.set('');
  }

  private async loadSessions(): Promise<void> {
    try {
      this.sessions.set(sortSessions(await this.account.sessions()));
      this.sessionsError.set(null);
    } catch (error) {
      this.sessionsError.set(ApiFailure.from(error).message);
    }
  }

  protected deviceOf(session: AdminSession): DeviceInfo {
    return describeUserAgent(session.userAgent);
  }

  protected deviceLabel(device: DeviceInfo): string {
    if (device.browser && device.os)
      return this.t('account.sessions.device', { browser: device.browser, os: device.os });
    return device.browser ?? device.os ?? this.t('account.sessions.unknownDevice');
  }

  protected async saveDetails(): Promise<void> {
    if (!this.canSaveDetails()) return;
    this.savingDetails.set(true);
    this.detailsError.set(null);
    try {
      await this.account.updateProfile({
        firstname: this.firstname().trim() || null,
        lastname: this.lastname().trim() || null,
        email: this.email().trim(),
        ...(this.emailChanged() ? { currentPassword: this.emailPassword() } : {}),
      });
      this.fill();
      toast.success(this.t('account.saved'));
    } catch (error) {
      this.detailsError.set(this.message(error));
    } finally {
      this.savingDetails.set(false);
    }
  }

  protected async savePassword(): Promise<void> {
    const password = this.newPassword();
    if (!password || !this.currentPassword() || this.savingPassword()) return;
    this.savingPassword.set(true);
    this.passwordError.set(null);
    try {
      await this.account.updateProfile({ password, currentPassword: this.currentPassword() });
      this.currentPassword.set('');
      this.newPasswordInput()?.reset();
      toast.success(this.t('account.password.changed'));
      await this.loadSessions();
    } catch (error) {
      this.passwordError.set(this.message(error));
    } finally {
      this.savingPassword.set(false);
    }
  }

  protected async revoke(sessions: readonly AdminSession[]): Promise<void> {
    const ids = sessions.map((session) => session.id);
    this.revoking.update((current) => new Set([...current, ...ids]));
    const results = await Promise.allSettled(ids.map((id) => this.account.revokeSession(id)));
    this.revoking.update((current) => new Set([...current].filter((id) => !ids.includes(id))));
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) toast.error(ApiFailure.from((failed as PromiseRejectedResult).reason).message);
    else toast.success(this.t('account.sessions.signedOut', { count: ids.length }));
    await this.loadSessions();
  }

  protected async setLanguage(tag: string | null | undefined): Promise<void> {
    if (tag && this.i18n.locales.some((locale) => locale.tag === tag))
      await this.i18n.setLocale(tag as LocaleTag);
  }

  protected async setDigest(on: boolean): Promise<void> {
    try {
      await this.userPreferences.set(['digest'], on ? 'daily' : undefined);
      toast.success(this.t(on ? 'prefs.digestOn' : 'prefs.digestOff'));
    } catch {
      toast.error(this.t('prefs.digestFailed'));
    }
  }

  private message(error: unknown): string {
    const failure = ApiFailure.from(error);
    if (failure.status === 429) return this.t('auth.login.tooManyAttempts');
    if (/current password/i.test(failure.message)) return this.t('account.wrongPassword');
    return failure.message;
  }
}
