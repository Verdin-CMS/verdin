import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmAvatarImports } from '@spartan-ng/helm/avatar';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { HlmTableImports } from '@spartan-ng/helm/table';

import { Api, ApiFailure } from '../../core/api';
import { Auth } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import { AdminUser, Role } from '../../core/types';
import { PageHeader } from '../../shared/components/page-header';

interface Draft {
  id: number | null;
  email: string;
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
    HlmAvatarImports,
    HlmEmptyImports,
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
      @if (users().length === 0) {
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
                      <span hlmBadge variant="outline" class="gap-1.5">
                        <span
                          class="size-1.5 rounded-full"
                          [class]="user.isActive ? 'bg-emerald-500' : 'bg-muted-foreground/50'"
                        ></span>
                        {{
                          user.isActive ? t('settings.users.active') : t('settings.users.inactive')
                        }}
                      </span>
                    </td>
                    <td hlmTd class="pe-4 text-end">
                      <div class="flex justify-end gap-1">
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
                draft.id ? t('settings.users.editDescription') : t('settings.users.addDescription')
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
                hlmInput
                id="user-email"
                type="email"
                [value]="draft.email"
                (input)="patch({ email: $any($event.target).value })"
              />
            </div>
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
            <button hlmBtn variant="outline" (click)="closeDraft()">
              {{ t('common.cancel') }}
            </button>
            <button hlmBtn (click)="save()">{{ t('common.save') }}</button>
          </hlm-dialog-footer>
        }
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class UsersPage implements OnInit {
  private readonly api = inject(Api);
  protected readonly auth = inject(Auth);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly users = signal<AdminUser[]>([]);
  protected readonly roles = signal<Role[]>([]);
  protected readonly draft = signal<Draft | null>(null);
  protected readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    const [users, roles] = await Promise.all([
      this.api.get<AdminUser[]>('/users'),
      this.api.get<Role[]>('/roles'),
    ]);
    this.users.set(users);
    this.roles.set(roles);
  }

  protected edit(user: AdminUser | null): void {
    this.error.set(null);
    const defaultRole = this.roles().find((role) => role.code === 'editor')?.id;
    this.draft.set(
      user
        ? {
            id: user.id,
            email: user.email,
            password: '',
            firstname: user.firstname ?? '',
            lastname: user.lastname ?? '',
            roles: user.roles.map((role) => role.id),
            isActive: user.isActive,
          }
        : {
            id: null,
            email: '',
            password: '',
            firstname: '',
            lastname: '',
            roles: defaultRole ? [defaultRole] : [],
            isActive: true,
          },
    );
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
    if (draft.password || !draft.id) body['password'] = draft.password;
    try {
      if (draft.id) await this.api.put(`/users/${draft.id}`, body);
      else await this.api.post('/users', body);
      this.users.set(await this.api.get<AdminUser[]>('/users'));
      this.draft.set(null);
      toast.success(this.t('settings.users.saved'));
    } catch (error) {
      this.error.set(ApiFailure.from(error).message);
    }
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
