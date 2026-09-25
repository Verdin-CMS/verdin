import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmAvatarImports } from '@spartan-ng/helm/avatar';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { HlmTableImports } from '@spartan-ng/helm/table';

import { ApiFailure } from '../../core/api';
import {
  AUTHENTICATED_ROLE,
  EndUser,
  EndUserInput,
  EndUserRole,
  EndUsers,
} from '../../core/end-users';
import { I18n } from '../../core/i18n/i18n';
import { PageMeta } from '../../core/types';
import { PageHeader } from '../../shared/components/page-header';
import { EndUsersNav } from './end-users-nav';

const PAGE_SIZE = 20;

interface Draft {
  id: number | null;
  username: string;
  email: string;
  password: string;
  /** A role id, as the select holds it. */
  role: string;
  confirmed: boolean;
  blocked: boolean;
}

/** Settings → End users → Users: the accounts of the content API. */
@Component({
  selector: 'vd-end-users',
  imports: [
    NgIcon,
    EndUsersNav,
    HlmAlertImports,
    HlmAlertDialogImports,
    HlmAvatarImports,
    HlmBadgeImports,
    HlmButtonImports,
    HlmDialogImports,
    HlmEmptyImports,
    HlmFieldImports,
    HlmInputImports,
    HlmInputGroupImports,
    HlmNativeSelectImports,
    HlmSkeletonImports,
    HlmSpinnerImports,
    HlmSwitchImports,
    HlmTableImports,
    PageHeader,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <vd-page-header [title]="t('endUsers.title')" [description]="t('endUsers.description')">
        <span eyebrow class="text-primary flex items-center gap-1.5 text-xs font-medium">
          <ng-icon name="lucideContactRound" size="14" /> {{ t('shell.settings') }}
        </span>
        <div actions>
          <button hlmBtn (click)="edit(null)">
            <ng-icon name="lucideUserPlus" /> {{ t('endUsers.users.add') }}
          </button>
        </div>
      </vd-page-header>
      <vd-end-users-nav />

      <div hlmInputGroup class="w-full sm:max-w-xs">
        <div hlmInputGroupAddon><ng-icon name="lucideSearch" /></div>
        <input
          hlmInputGroupInput
          type="search"
          [attr.aria-label]="t('common.search')"
          [placeholder]="t('endUsers.users.search')"
          [value]="searchText()"
          (input)="setSearch($any($event.target).value)"
        />
      </div>

      @if (error()) {
        <div hlmAlert variant="destructive">
          <ng-icon hlmAlertIcon name="lucideCircleAlert" />
          <p hlmAlertTitle>{{ t('endUsers.users.loadError') }}</p>
          <p hlmAlertDescription>{{ error() }}</p>
        </div>
      } @else if (users() === null) {
        <hlm-skeleton class="h-64 rounded-xl" />
      } @else if (users()!.length === 0) {
        <div hlmEmpty class="rounded-xl border border-dashed py-16">
          <div hlmEmptyHeader>
            <div hlmEmptyMedia variant="icon">
              <ng-icon [name]="search() ? 'lucideSearch' : 'lucideContactRound'" />
            </div>
            <h2 hlmEmptyTitle>
              {{ search() ? t('endUsers.users.noMatches') : t('endUsers.users.emptyTitle') }}
            </h2>
            <p hlmEmptyDescription>
              {{
                search()
                  ? t('endUsers.users.noMatchesHint', { search: search() })
                  : t('endUsers.users.emptyHint')
              }}
            </p>
          </div>
        </div>
      } @else {
        <div class="bg-card overflow-hidden rounded-xl border">
          <div hlmTableContainer>
            <table hlmTable>
              <thead hlmTHead class="bg-muted/50">
                <tr hlmTr class="hover:bg-transparent">
                  <th hlmTh class="ps-4">{{ t('endUsers.users.user') }}</th>
                  <th hlmTh>{{ t('endUsers.users.role') }}</th>
                  <th hlmTh>{{ t('endUsers.users.provider') }}</th>
                  <th hlmTh>{{ t('endUsers.users.status') }}</th>
                  <th hlmTh>{{ t('endUsers.users.createdAt') }}</th>
                  <th hlmTh class="pe-4">
                    <span class="sr-only">{{ t('common.actions') }}</span>
                  </th>
                </tr>
              </thead>
              <tbody hlmTBody>
                @for (user of users(); track user.id) {
                  <tr hlmTr [class.opacity-70]="user.blocked">
                    <td hlmTd class="ps-4">
                      <button
                        type="button"
                        class="group flex items-center gap-3 text-start"
                        (click)="edit(user)"
                      >
                        <hlm-avatar>
                          <span
                            hlmAvatarFallback
                            class="bg-primary/10 text-primary text-xs font-medium"
                            >{{ initials(user) }}</span
                          >
                        </hlm-avatar>
                        <span class="flex min-w-0 flex-col">
                          <span class="font-medium group-hover:underline">{{ user.username }}</span>
                          <span class="text-muted-foreground text-xs">{{ user.email }}</span>
                        </span>
                      </button>
                    </td>
                    <td hlmTd>
                      @if (user.role; as role) {
                        <span hlmBadge variant="secondary">
                          <ng-icon name="lucideShieldCheck" /> {{ role.name }}
                        </span>
                      } @else {
                        <span class="text-muted-foreground">—</span>
                      }
                    </td>
                    <td hlmTd>
                      <span
                        hlmBadge
                        [variant]="user.provider === 'local' ? 'outline' : 'secondary'"
                        class="font-normal"
                      >
                        <ng-icon
                          [name]="user.provider === 'local' ? 'lucideMail' : 'lucideLogIn'"
                        />
                        {{
                          user.provider === 'local'
                            ? t('endUsers.users.providerLocal')
                            : user.provider
                        }}
                      </span>
                    </td>
                    <td hlmTd>
                      <div class="flex flex-wrap gap-1">
                        @if (user.blocked) {
                          <span hlmBadge variant="destructive">
                            <ng-icon name="lucideBan" /> {{ t('endUsers.users.blocked') }}
                          </span>
                        }
                        <span hlmBadge variant="outline" class="gap-1.5">
                          <span
                            class="size-1.5 rounded-full"
                            [class]="user.confirmed ? 'bg-emerald-500' : 'bg-amber-500'"
                          ></span>
                          {{
                            user.confirmed
                              ? t('endUsers.users.confirmed')
                              : t('endUsers.users.unconfirmed')
                          }}
                        </span>
                      </div>
                    </td>
                    <td hlmTd>
                      @if (user.createdAt) {
                        <span
                          class="text-muted-foreground text-xs"
                          [attr.title]="i18n.formatDate(user.createdAt, 'long')"
                          >{{ i18n.formatRelative(user.createdAt) }}</span
                        >
                      }
                    </td>
                    <td hlmTd class="pe-4">
                      <div class="flex justify-end gap-1">
                        <button
                          hlmBtn
                          size="icon-sm"
                          variant="ghost"
                          class="text-muted-foreground"
                          [disabled]="busy() === user.id"
                          [attr.aria-label]="
                            t(
                              user.blocked
                                ? 'endUsers.users.unblockLabel'
                                : 'endUsers.users.blockLabel',
                              {
                                name: user.username,
                              }
                            )
                          "
                          [attr.title]="
                            t(user.blocked ? 'endUsers.users.unblock' : 'endUsers.users.block')
                          "
                          (click)="setBlocked(user, !user.blocked)"
                        >
                          @if (busy() === user.id) {
                            <hlm-spinner class="size-4" />
                          } @else {
                            <ng-icon [name]="user.blocked ? 'lucideCircleCheck' : 'lucideBan'" />
                          }
                        </button>
                        <button
                          hlmBtn
                          size="icon-sm"
                          variant="ghost"
                          class="text-muted-foreground"
                          [attr.aria-label]="t('endUsers.users.editLabel', { name: user.username })"
                          [attr.title]="t('common.edit')"
                          (click)="edit(user)"
                        >
                          <ng-icon name="lucidePencil" />
                        </button>
                        <hlm-alert-dialog>
                          <button
                            hlmAlertDialogTrigger
                            hlmBtn
                            size="icon-sm"
                            variant="ghost"
                            class="text-muted-foreground hover:text-destructive"
                            [attr.aria-label]="
                              t('endUsers.users.deleteLabel', { name: user.username })
                            "
                            [attr.title]="t('common.delete')"
                          >
                            <ng-icon name="lucideTrash2" />
                          </button>
                          <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
                            <hlm-alert-dialog-header>
                              <h2 hlmAlertDialogTitle>
                                {{ t('endUsers.users.deleteTitle', { name: user.username }) }}
                              </h2>
                              <p hlmAlertDialogDescription>
                                {{ t('endUsers.users.deleteHint') }}
                              </p>
                            </hlm-alert-dialog-header>
                            <hlm-alert-dialog-footer>
                              <button hlmAlertDialogCancel (click)="ctx.close()">
                                {{ t('common.cancel') }}
                              </button>
                              <button
                                hlmAlertDialogAction
                                variant="destructive"
                                (click)="ctx.close(); remove(user)"
                              >
                                {{ t('common.delete') }}
                              </button>
                            </hlm-alert-dialog-footer>
                          </hlm-alert-dialog-content>
                        </hlm-alert-dialog>
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <div
            class="text-muted-foreground bg-muted/30 flex flex-wrap items-center justify-end gap-2 border-t px-4 py-2 text-xs"
          >
            <span class="me-auto tabular-nums">
              {{ t('endUsers.users.count', { count: meta().total ?? users()!.length }) }}
              @if (pageCount() > 1) {
                · {{ t('common.page', { page: page(), count: pageCount() }) }}
              }
            </span>
            @if (pageCount() > 1) {
              <button
                hlmBtn
                variant="outline"
                size="sm"
                [disabled]="page() <= 1 || loading()"
                (click)="page.set(page() - 1)"
              >
                <ng-icon name="lucideArrowLeft" /> {{ t('common.previous') }}
              </button>
              <button
                hlmBtn
                variant="outline"
                size="sm"
                [disabled]="page() >= pageCount() || loading()"
                (click)="page.set(page() + 1)"
              >
                {{ t('common.next') }} <ng-icon name="lucideChevronRight" />
              </button>
            }
          </div>
        </div>
      }
    </div>

    <hlm-dialog [state]="draft() ? 'open' : 'closed'" (closed)="draft.set(null)">
      <hlm-dialog-content *hlmDialogPortal="let ctx" class="sm:max-w-lg">
        @if (draft(); as draft) {
          <hlm-dialog-header>
            <h2 hlmDialogTitle>
              {{ draft.id ? t('endUsers.users.edit') : t('endUsers.users.add') }}
            </h2>
            <p hlmDialogDescription>
              {{
                draft.id ? t('endUsers.users.editDescription') : t('endUsers.users.addDescription')
              }}
            </p>
          </hlm-dialog-header>
          <div class="flex flex-col gap-4">
            <div hlmField>
              <label hlmFieldLabel for="end-user-username">{{ t('endUsers.users.username') }}</label
              ><input
                hlmInput
                id="end-user-username"
                autocomplete="off"
                [value]="draft.username"
                (input)="patch({ username: $any($event.target).value })"
              />
            </div>
            <div hlmField>
              <label hlmFieldLabel for="end-user-email">{{ t('common.email') }}</label
              ><input
                hlmInput
                id="end-user-email"
                type="email"
                autocomplete="off"
                [value]="draft.email"
                (input)="patch({ email: $any($event.target).value })"
              />
            </div>
            <div hlmField>
              <label hlmFieldLabel for="end-user-password">{{ t('common.password') }}</label
              ><input
                hlmInput
                id="end-user-password"
                type="password"
                autocomplete="new-password"
                [value]="draft.password"
                (input)="patch({ password: $any($event.target).value })"
              />
              @if (draft.id) {
                <p hlmFieldDescription>{{ t('endUsers.users.passwordKeep') }}</p>
              }
            </div>
            <div hlmField>
              <label hlmFieldLabel for="end-user-role">{{ t('endUsers.users.role') }}</label>
              <hlm-native-select
                selectId="end-user-role"
                [value]="draft.role"
                (valueChange)="patch({ role: $event ?? '' })"
              >
                @for (role of roles(); track role.id) {
                  <option hlmNativeSelectOption [value]="'' + role.id">{{ role.name }}</option>
                }
              </hlm-native-select>
            </div>
            <div hlmField orientation="horizontal">
              <hlm-switch
                inputId="end-user-confirmed"
                [checked]="draft.confirmed"
                (checkedChange)="patch({ confirmed: $event })"
              />
              <div class="flex flex-col gap-0.5">
                <label hlmFieldLabel for="end-user-confirmed">{{
                  t('endUsers.users.confirmed')
                }}</label>
                <p hlmFieldDescription>{{ t('endUsers.users.confirmedHint') }}</p>
              </div>
            </div>
            <div hlmField orientation="horizontal">
              <hlm-switch
                inputId="end-user-blocked"
                [checked]="draft.blocked"
                (checkedChange)="patch({ blocked: $event })"
              />
              <div class="flex flex-col gap-0.5">
                <label hlmFieldLabel for="end-user-blocked">{{
                  t('endUsers.users.blocked')
                }}</label>
                <p hlmFieldDescription>{{ t('endUsers.users.blockedHint') }}</p>
              </div>
            </div>
            @if (draftError()) {
              <div hlmAlert variant="destructive">
                <ng-icon hlmAlertIcon name="lucideCircleAlert" />
                <p hlmAlertDescription>{{ draftError() }}</p>
              </div>
            }
          </div>
          <hlm-dialog-footer>
            <button hlmBtn variant="outline" (click)="closeDraft()">
              {{ t('common.cancel') }}
            </button>
            <button hlmBtn [disabled]="saving() || !valid()" (click)="save()">
              @if (saving()) {
                <hlm-spinner class="size-4" />
              }
              {{ draft.id ? t('common.save') : t('common.create') }}
            </button>
          </hlm-dialog-footer>
        }
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class EndUsersPage implements OnDestroy {
  private readonly service = inject(EndUsers);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  protected readonly users = signal<EndUser[] | null>(null);
  protected readonly roles = signal<EndUserRole[]>([]);
  protected readonly meta = signal<PageMeta>({});
  protected readonly page = signal(1);
  protected readonly pageCount = computed(() => this.meta().pageCount ?? 1);
  protected readonly searchText = signal('');
  protected readonly search = signal('');
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal<number | null>(null);
  protected readonly draft = signal<Draft | null>(null);
  protected readonly draftError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly valid = computed(() => {
    const draft = this.draft();
    return (
      !!draft && !!draft.username.trim() && !!draft.email.trim() && (!!draft.id || !!draft.password)
    );
  });

  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    effect(() => {
      this.page();
      this.search();
      untracked(() => void this.load());
    });
    void this.loadRoles();
  }

  ngOnDestroy(): void {
    clearTimeout(this.searchTimer);
  }

  private async loadRoles(): Promise<void> {
    try {
      this.roles.set(await this.service.roles());
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const response = await this.service.list(this.page(), PAGE_SIZE, this.search());
      this.users.set(response.data);
      this.meta.set(response.meta.pagination ?? {});
      this.error.set(null);
    } catch (error) {
      this.error.set(ApiFailure.from(error).message);
    } finally {
      this.loading.set(false);
    }
  }

  protected setSearch(value: string): void {
    this.searchText.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.page.set(1);
      this.search.set(value.trim());
    }, 250);
  }

  protected initials(user: EndUser): string {
    return (user.username || user.email).trim().slice(0, 2).toLocaleUpperCase(this.i18n.locale());
  }

  protected edit(user: EndUser | null): void {
    this.draftError.set(null);
    const fallback = this.roles().find((role) => role.type === AUTHENTICATED_ROLE);
    this.draft.set(
      user
        ? {
            id: user.id,
            username: user.username,
            email: user.email,
            password: '',
            role: user.role ? String(user.role.id) : fallback ? String(fallback.id) : '',
            confirmed: user.confirmed,
            blocked: user.blocked,
          }
        : {
            id: null,
            username: '',
            email: '',
            password: '',
            role: fallback ? String(fallback.id) : '',
            confirmed: true,
            blocked: false,
          },
    );
  }

  protected closeDraft(): void {
    this.draft.set(null);
  }

  protected patch(changes: Partial<Draft>): void {
    this.draft.update((draft) => (draft ? { ...draft, ...changes } : draft));
  }

  protected async save(): Promise<void> {
    const draft = this.draft();
    if (!draft || !this.valid()) return;
    this.draftError.set(null);
    this.saving.set(true);
    const body: EndUserInput = {
      username: draft.username.trim(),
      email: draft.email.trim(),
      confirmed: draft.confirmed,
      blocked: draft.blocked,
    };
    if (draft.role) body.role = Number(draft.role);
    if (draft.password) body.password = draft.password;
    try {
      if (draft.id) await this.service.update(draft.id, body);
      else await this.service.create(body);
      toast.success(
        this.t(draft.id ? 'endUsers.users.saved' : 'endUsers.users.created', {
          name: body.username,
        }),
      );
      this.draft.set(null);
      await this.load();
    } catch (error) {
      this.draftError.set(ApiFailure.from(error).message);
    } finally {
      this.saving.set(false);
    }
  }

  protected async setBlocked(user: EndUser, blocked: boolean): Promise<void> {
    this.busy.set(user.id);
    try {
      const updated = await this.service.update(user.id, { blocked });
      this.users.update((list) =>
        (list ?? []).map((item) =>
          item.id === user.id ? { ...item, ...(updated ?? {}), blocked } : item,
        ),
      );
      toast.success(
        this.t(blocked ? 'endUsers.users.blockedToast' : 'endUsers.users.unblockedToast', {
          name: user.username,
        }),
      );
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    } finally {
      this.busy.set(null);
    }
  }

  protected async remove(user: EndUser): Promise<void> {
    try {
      await this.service.remove(user.id);
      toast.success(this.t('endUsers.users.deleted', { name: user.username }));
      // Step back when the last row of a page goes.
      if (this.users()?.length === 1 && this.page() > 1) this.page.set(this.page() - 1);
      else await this.load();
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    }
  }
}
