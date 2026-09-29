import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmAvatarImports } from '@spartan-ng/helm/avatar';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { HlmTableImports } from '@spartan-ng/helm/table';

import { Account, Invitation } from '../../core/account';
import { Api, ApiFailure } from '../../core/api';
import { Auth } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import { TwoFactor } from '../../core/two-factor';
import { AdminUser, Role } from '../../core/types';
import { LoadError } from '../../shared/components/load-error';
import { PageHeader } from '../../shared/components/page-header';

interface Draft {
  id: number | null;
  email: string;
  /** New users: set a password now instead of inviting them by email. */
  setPassword: boolean;
  password: string;
  firstname: string;
  lastname: string;
  roles: number[];
  isActive: boolean;
}

@Component({
  selector: 'vd-users',
  imports: [
    NgIcon,
    HlmTableImports,
    HlmButtonImports,
    HlmBadgeImports,
    HlmDialogImports,
    HlmFieldImports,
    HlmInputImports,
    HlmCheckboxImports,
    HlmSwitchImports,
    HlmAlertImports,
    HlmAlertDialogImports,
    HlmAvatarImports,
    HlmEmptyImports,
    HlmSkeletonImports,
    LoadError,
    PageHeader,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <vd-page-header
        [title]="t('settings.users.title')"
        [description]="t('settings.users.description')"
      >
        <span eyebrow class="text-primary flex items-center gap-1.5 text-xs font-medium">
          <ng-icon name="lucideUsers" size="14" /> {{ t('shell.settings') }}
        </span>
        <div actions>
          <button hlmBtn (click)="edit(null)">
            <ng-icon name="lucidePlus" /> {{ t('settings.users.add') }}
          </button>
        </div>
      </vd-page-header>
      @if (loadError(); as message) {
        <vd-load-error [message]="message" (retry)="load()" />
      } @else if (loading()) {
        <hlm-skeleton
          class="h-48 rounded-xl"
          role="status"
          [attr.aria-label]="t('common.loading')"
        />
      } @else if (users().length === 0) {
        <div hlmEmpty class="rounded-xl border border-dashed py-16">
          <div hlmEmptyHeader>
            <div hlmEmptyMedia variant="icon"><ng-icon name="lucideUsers" /></div>
            <h2 hlmEmptyTitle>{{ t('settings.users.emptyTitle') }}</h2>
            <p hlmEmptyDescription>{{ t('settings.users.description') }}</p>
          </div>
        </div>
      } @else {
        <div class="bg-card overflow-hidden rounded-xl border">
          <div hlmTableContainer>
            <table hlmTable>
              <thead hlmTHead class="bg-muted/50">
                <tr hlmTr class="hover:bg-transparent">
                  <th hlmTh class="ps-4">{{ t('settings.users.user') }}</th>
                  <th hlmTh>{{ t('settings.users.roles') }}</th>
                  <th hlmTh>{{ t('settings.users.status') }}</th>
                  <th hlmTh class="pe-4">
                    <span class="sr-only">{{ t('common.actions') }}</span>
                  </th>
                </tr>
              </thead>
              <tbody hlmTBody>
                @for (user of users(); track user.id) {
                  <tr hlmTr>
                    <td hlmTd class="ps-4">
                      <div class="flex items-center gap-3">
                        <hlm-avatar>
                          <span
                            hlmAvatarFallback
                            class="bg-primary/10 text-primary text-xs font-medium"
                            >{{ initials(user) }}</span
                          >
                        </hlm-avatar>
                        <div class="flex min-w-0 flex-col">
                          <span class="flex items-center gap-2 font-medium">
                            {{ hasName(user) ? fullName(user) : user.email }}
                            @if (user.id === auth.user()?.id) {
                              <span hlmBadge variant="outline">{{ t('settings.users.you') }}</span>
                            }
                          </span>
                          @if (hasName(user)) {
                            <span class="text-muted-foreground text-xs">{{ user.email }}</span>
                          }
                        </div>
                      </div>
                    </td>
                    <td hlmTd>
                      <div class="flex flex-wrap gap-1">
                        @for (role of user.roles; track role.id) {
                          <span hlmBadge variant="secondary">
                            <ng-icon name="lucideShieldCheck" />
                            {{ role.name }}
                          </span>
                        }
                      </div>
                    </td>
                    <td hlmTd>
                      <div class="flex flex-wrap gap-1">
                        <span hlmBadge variant="outline" class="gap-1.5">
                          <span
                            class="size-1.5 rounded-full"
                            [class]="user.isActive ? 'bg-emerald-500' : 'bg-muted-foreground/50'"
                          ></span>
                          {{
                            user.isActive
                              ? t('settings.users.active')
                              : t('settings.users.inactive')
                          }}
                        </span>
                        @if (user.twoFactor) {
                          <span
                            hlmBadge
                            variant="secondary"
                            data-testid="user-two-factor"
                            [attr.title]="t('twoFactor.user.onHint')"
                          >
                            <ng-icon name="lucideShieldCheck" aria-hidden="true" />
                            {{ t('twoFactor.user.on') }}
                          </span>
                        } @else if (user.twoFactorRequired) {
                          <span
                            hlmBadge
                            variant="outline"
                            class="text-destructive"
                            data-testid="user-two-factor-missing"
                            [attr.title]="t('twoFactor.user.missingHint')"
                          >
                            <ng-icon name="lucideShieldAlert" aria-hidden="true" />
                            {{ t('twoFactor.user.missing') }}
                          </span>
                        }
                      </div>
                    </td>
                    <td hlmTd class="pe-4 text-end">
                      <div class="flex justify-end gap-1">
                        @if (user.id !== auth.user()?.id) {
                          <button
                            hlmBtn
                            size="icon-sm"
                            variant="ghost"
                            class="text-muted-foreground"
                            [attr.aria-label]="
                              t('settings.users.reinviteLabel', { email: user.email })
                            "
                            [attr.title]="t('settings.users.reinvite')"
                            [disabled]="inviting() === user.id"
                            (click)="reinvite(user)"
                          >
                            <ng-icon name="lucideSend" class="rtl:-scale-x-100" />
                          </button>
                        }
                        @if (canResetTwoFactor(user)) {
                          <button
                            hlmBtn
                            size="icon-sm"
                            variant="ghost"
                            class="text-muted-foreground"
                            data-testid="reset-two-factor"
                            [attr.aria-label]="
                              t('twoFactor.user.resetLabel', { email: user.email })
                            "
                            [attr.title]="t('twoFactor.user.reset')"
                            (click)="resetting.set(user)"
                          >
                            <ng-icon name="lucideShieldOff" />
                          </button>
                        }
                        <button
                          hlmBtn
                          size="icon-sm"
                          variant="ghost"
                          class="text-muted-foreground"
                          [attr.aria-label]="t('settings.users.editLabel', { email: user.email })"
                          (click)="edit(user)"
                        >
                          <ng-icon name="lucidePencil" />
                        </button>
                        @if (user.id !== auth.user()?.id) {
                          <button
                            hlmBtn
                            size="icon-sm"
                            variant="ghost"
                            class="text-muted-foreground hover:text-destructive"
                            [attr.aria-label]="
                              t('settings.users.deleteLabel', { email: user.email })
                            "
                            (click)="remove(user)"
                          >
                            <ng-icon name="lucideTrash2" />
                          </button>
                        }
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <div class="text-muted-foreground bg-muted/30 border-t px-4 py-2 text-xs">
            {{ t('settings.users.count', { count: users().length }) }}
          </div>
        </div>
      }
    </div>

    <hlm-dialog [state]="draft() ? 'open' : 'closed'" (closed)="draft.set(null)">
      <hlm-dialog-content *hlmDialogPortal="let ctx" class="sm:max-w-lg">
        @if (draft(); as draft) {
          <hlm-dialog-header>
            <h2 hlmDialogTitle>
              {{ draft.id ? t('settings.users.edit') : t('settings.users.add') }}
            </h2>
            <p hlmDialogDescription>
              {{
                draft.id
                  ? t('settings.users.editDescription')
                  : t('settings.users.addInviteDescription')
              }}
            </p>
          </hlm-dialog-header>
          <div class="flex flex-col gap-4">
            <div class="grid gap-4 sm:grid-cols-2">
              <div hlmField>
                <label hlmFieldLabel for="user-firstname">{{ t('settings.users.firstname') }}</label
                ><input
                  hlmInput
                  id="user-firstname"
                  [value]="draft.firstname"
                  (input)="patch({ firstname: $any($event.target).value })"
                />
              </div>
              <div hlmField>
                <label hlmFieldLabel for="user-lastname">{{ t('settings.users.lastname') }}</label
                ><input
                  hlmInput
                  id="user-lastname"
                  [value]="draft.lastname"
                  (input)="patch({ lastname: $any($event.target).value })"
                />
              </div>
            </div>
            <div hlmField>
              <label hlmFieldLabel for="user-email">{{ t('common.email') }}</label
              ><input
                dir="ltr"
                hlmInput
                id="user-email"
                type="email"
                [value]="draft.email"
                (input)="patch({ email: $any($event.target).value })"
              />
            </div>
            @if (!draft.id) {
              <div hlmField orientation="horizontal">
                <hlm-switch
                  inputId="user-set-password"
                  [checked]="draft.setPassword"
                  (checkedChange)="patch({ setPassword: $event, password: '' })"
                />
                <div class="flex flex-col gap-0.5">
                  <label hlmFieldLabel for="user-set-password">{{
                    t('settings.users.setPassword')
                  }}</label>
                  <p hlmFieldDescription>{{ t('settings.users.setPasswordHint') }}</p>
                </div>
              </div>
            }
            @if (draft.id || draft.setPassword) {
              <div hlmField>
                <label hlmFieldLabel for="user-password">{{ t('common.password') }}</label
                ><input
                  hlmInput
                  id="user-password"
                  type="password"
                  autocomplete="new-password"
                  [value]="draft.password"
                  (input)="patch({ password: $any($event.target).value })"
                />
              </div>
            }
            <fieldset hlmFieldSet>
              <legend hlmFieldLegend>{{ t('settings.users.roles') }}</legend>
              <div hlmFieldGroup>
                @for (role of roles(); track role.id) {
                  <div hlmField orientation="horizontal">
                    <hlm-checkbox
                      [inputId]="'role-' + role.id"
                      [checked]="draft.roles.includes(role.id)"
                      (checkedChange)="toggleRole(role.id, $event === true)"
                    />
                    <label hlmFieldLabel [for]="'role-' + role.id">{{ role.name }}</label>
                  </div>
                }
              </div>
            </fieldset>
            <div hlmField orientation="horizontal">
              <hlm-switch
                inputId="user-active"
                [checked]="draft.isActive"
                (checkedChange)="patch({ isActive: $event })"
              />
              <div class="flex flex-col gap-0.5">
                <label hlmFieldLabel for="user-active">{{ t('settings.users.active') }}</label>
                <p hlmFieldDescription>{{ t('settings.users.activeHint') }}</p>
              </div>
            </div>
            @if (error()) {
              <div hlmAlert variant="destructive">
                <ng-icon name="lucideCircleAlert" />
                <p hlmAlertDescription>{{ error() }}</p>
              </div>
            }
          </div>
          <hlm-dialog-footer>
            @if (draft.id && draft.id !== auth.user()?.id) {
              <button
                hlmBtn
                variant="ghost"
                class="sm:me-auto"
                [disabled]="inviting() === draft.id"
                (click)="reinviteDraft(draft)"
              >
                <ng-icon name="lucideSend" class="rtl:-scale-x-100" />
                {{ t('settings.users.reinvite') }}
              </button>
            }
            <button hlmBtn variant="outline" (click)="closeDraft()">
              {{ t('common.cancel') }}
            </button>
            <button hlmBtn [disabled]="saving()" (click)="save()">
              @if (!draft.id && !draft.setPassword) {
                <ng-icon name="lucideSend" class="rtl:-scale-x-100" />
                {{ t('settings.users.invite') }}
              } @else {
                {{ t('common.save') }}
              }
            </button>
          </hlm-dialog-footer>
        }
      </hlm-dialog-content>
    </hlm-dialog>

    <hlm-alert-dialog [state]="resetting() ? 'open' : 'closed'" (closed)="resetting.set(null)">
      <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
        @if (resetting(); as user) {
          <hlm-alert-dialog-header>
            <h2 hlmAlertDialogTitle>
              {{ t('twoFactor.user.resetTitle', { email: user.email }) }}
            </h2>
            <p hlmAlertDialogDescription>{{ t('twoFactor.user.resetDescription') }}</p>
          </hlm-alert-dialog-header>
          <hlm-alert-dialog-footer>
            <button hlmAlertDialogCancel (click)="ctx.close()">{{ t('common.cancel') }}</button>
            <button
              hlmAlertDialogAction
              variant="destructive"
              data-testid="reset-two-factor-confirm"
              (click)="ctx.close(); resetTwoFactor(user)"
            >
              {{ t('twoFactor.user.reset') }}
            </button>
          </hlm-alert-dialog-footer>
        }
      </hlm-alert-dialog-content>
    </hlm-alert-dialog>

    <hlm-dialog [state]="invitation() ? 'open' : 'closed'" (closed)="invitation.set(null)">
      <hlm-dialog-content *hlmDialogPortal="let ctx" class="sm:max-w-lg">
        @if (invitation(); as sent) {
          <hlm-dialog-header>
            <h2 hlmDialogTitle>{{ t('settings.users.inviteTitle') }}</h2>
            <p hlmDialogDescription>
              {{ t('settings.users.inviteDescription', { email: sent.email }) }}
            </p>
          </hlm-dialog-header>
          <div class="flex flex-col gap-4">
            @if (sent.invitation.emailed) {
              <div hlmAlert role="status">
                <ng-icon name="lucideMailCheck" />
                <p hlmAlertDescription>
                  {{ t('settings.users.inviteEmailed', { email: sent.email }) }}
                </p>
              </div>
            } @else {
              <div hlmAlert role="status">
                <ng-icon name="lucideInfo" />
                <p hlmAlertDescription>{{ t('settings.users.inviteNotEmailed') }}</p>
              </div>
            }
            <div hlmField>
              <label hlmFieldLabel for="invite-url">{{ t('settings.users.inviteLink') }}</label>
              <div class="flex items-center gap-2">
                <input
                  dir="ltr"
                  hlmInput
                  readonly
                  id="invite-url"
                  class="font-mono text-xs"
                  data-testid="invite-url"
                  [value]="sent.invitation.inviteUrl"
                  (focus)="$any($event.target).select()"
                />
                <button hlmBtn variant="outline" (click)="copy(sent.invitation.inviteUrl)">
                  <ng-icon name="lucideCopy" /> {{ t('common.copy') }}
                </button>
              </div>
              <p hlmFieldDescription>{{ t('settings.users.inviteExpiry') }}</p>
            </div>
          </div>
          <hlm-dialog-footer>
            <button hlmBtn (click)="invitation.set(null)">{{ t('settings.tokens.done') }}</button>
          </hlm-dialog-footer>
        }
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class UsersPage implements OnInit {
  private readonly api = inject(Api);
  private readonly account = inject(Account);
  private readonly twoFactor = inject(TwoFactor);
  protected readonly auth = inject(Auth);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly users = signal<AdminUser[]>([]);
  protected readonly roles = signal<Role[]>([]);
  protected readonly draft = signal<Draft | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);
  /** The invitation link just created, shown once with its delivery. */
  protected readonly invitation = signal<{ email: string; invitation: Invitation } | null>(null);
  /** The user a new invitation link is being made for. */
  protected readonly inviting = signal<number | null>(null);
  /** The user whose second factors are about to be reset (confirm dialog). */
  protected readonly resetting = signal<AdminUser | null>(null);

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const [users, roles] = await Promise.all([
        this.api.get<AdminUser[]>('/users'),
        this.api.get<Role[]>('/roles'),
      ]);
      this.users.set(users);
      this.roles.set(roles);
    } catch (error) {
      this.loadError.set(ApiFailure.from(error).message);
    } finally {
      this.loading.set(false);
    }
  }

  protected edit(user: AdminUser | null): void {
    this.error.set(null);
    const defaultRole = this.roles().find((role) => role.code === 'editor')?.id;
    this.draft.set(
      user
        ? {
            id: user.id,
            email: user.email,
            setPassword: true,
            password: '',
            firstname: user.firstname ?? '',
            lastname: user.lastname ?? '',
            roles: user.roles.map((role) => role.id),
            isActive: user.isActive,
          }
        : {
            id: null,
            email: '',
            setPassword: false,
            password: '',
            firstname: '',
            lastname: '',
            roles: defaultRole ? [defaultRole] : [],
            isActive: true,
          },
    );
  }

  /**
   * Another admin with a second factor; a Super Admin's only yield to a Super Admin (the
   * admin resets their own from their profile).
   */
  protected canResetTwoFactor(user: AdminUser): boolean {
    if (!user.twoFactor || user.id === this.auth.user()?.id) return false;
    const superAdmin = user.roles.some((role) => role.code === 'super-admin');
    return !superAdmin || this.auth.permissions().superAdmin;
  }

  protected async resetTwoFactor(user: AdminUser): Promise<void> {
    try {
      await this.twoFactor.reset(user.id);
      this.users.set(await this.api.get<AdminUser[]>('/users'));
      toast.success(this.t('twoFactor.user.resetDone', { email: user.email }));
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    }
  }

  protected hasName(user: AdminUser): boolean {
    return !!(user.firstname || user.lastname);
  }

  protected fullName(user: AdminUser): string {
    return [user.firstname, user.lastname].filter((part) => !!part).join(' ') || '—';
  }

  protected initials(user: AdminUser): string {
    const parts = [user.firstname, user.lastname].filter((part): part is string => !!part);
    const source = parts.length ? parts : [user.email];
    return source
      .map((part) => part.trim().charAt(0))
      .join('')
      .slice(0, 2)
      .toLocaleUpperCase(this.i18n.locale());
  }

  protected closeDraft(): void {
    this.draft.set(null);
  }

  protected patch(changes: Partial<Draft>): void {
    this.draft.update((draft) => (draft ? { ...draft, ...changes } : draft));
  }

  protected toggleRole(id: number, checked: boolean): void {
    const draft = this.draft();
    if (!draft) return;
    this.patch({
      roles: checked ? [...draft.roles, id] : draft.roles.filter((role) => role !== id),
    });
  }

  protected async save(): Promise<void> {
    const draft = this.draft();
    if (!draft) return;
    this.error.set(null);
    const body: Record<string, unknown> = {
      email: draft.email,
      firstname: draft.firstname || null,
      lastname: draft.lastname || null,
      roles: draft.roles,
      isActive: draft.isActive,
    };
    // New users without a password get an invitation link.
    if (draft.password || (!draft.id && draft.setPassword)) body['password'] = draft.password;
    this.saving.set(true);
    try {
      if (draft.id) {
        await this.api.put(`/users/${draft.id}`, body);
        toast.success(this.t('settings.users.saved'));
      } else {
        const { invitation } = await this.account.createUser(body);
        if (invitation) this.invitation.set({ email: draft.email, invitation });
        else toast.success(this.t('settings.users.saved'));
      }
      this.users.set(await this.api.get<AdminUser[]>('/users'));
      this.draft.set(null);
    } catch (error) {
      this.error.set(ApiFailure.from(error).message);
    } finally {
      this.saving.set(false);
    }
  }

  /** A new invitation link (earlier ones stop working), shown like on creation. */
  protected async reinvite(user: Pick<AdminUser, 'id' | 'email'>): Promise<void> {
    this.inviting.set(user.id);
    try {
      const invitation = await this.account.reinvite(user.id);
      this.draft.set(null);
      this.invitation.set({ email: user.email, invitation });
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    } finally {
      this.inviting.set(null);
    }
  }

  protected reinviteDraft(draft: Draft): void {
    if (draft.id) void this.reinvite({ id: draft.id, email: draft.email });
  }

  protected async copy(value: string): Promise<void> {
    await navigator.clipboard.writeText(value);
    toast.success(this.t('common.copied'));
  }

  protected async remove(user: AdminUser): Promise<void> {
    if (!confirm(this.t('settings.users.confirmDelete', { email: user.email }))) return;
    try {
      await this.api.delete(`/users/${user.id}`);
      this.users.set(await this.api.get<AdminUser[]>('/users'));
      toast.success(this.t('settings.users.deleted'));
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    }
  }
}
