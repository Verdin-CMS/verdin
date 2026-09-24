import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { HlmTableImports } from '@spartan-ng/helm/table';

import { Api, ApiFailure } from '../../core/api';
import { Auth } from '../../core/auth';
import { AdminUser, Role } from '../../core/types';

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
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-3">
        <h1 class="text-2xl font-semibold">Users</h1>
        <button hlmBtn class="ms-auto" (click)="edit(null)">
          <ng-icon name="lucidePlus" /> Add user
        </button>
      </div>
      <div hlmTableContainer class="rounded-md border">
        <table hlmTable>
          <thead hlmTHead>
            <tr hlmTr>
              <th hlmTh>Email</th>
              <th hlmTh>Name</th>
              <th hlmTh>Roles</th>
              <th hlmTh>Status</th>
              <th hlmTh></th>
            </tr>
          </thead>
          <tbody hlmTBody>
            @for (user of users(); track user.id) {
              <tr hlmTr>
                <td hlmTd>{{ user.email }}</td>
                <td hlmTd>{{ fullName(user) }}</td>
                <td hlmTd>
                  <div class="flex flex-wrap gap-1">
                    @for (role of user.roles; track role.id) {
                      <span hlmBadge variant="secondary">{{ role.name }}</span>
                    }
                  </div>
                </td>
                <td hlmTd>
                  <span hlmBadge [variant]="user.isActive ? 'default' : 'outline'">{{
                    user.isActive ? 'Active' : 'Inactive'
                  }}</span>
                </td>
                <td hlmTd class="text-end">
                  <button
                    hlmBtn
                    size="icon-sm"
                    variant="ghost"
                    [attr.aria-label]="'Edit ' + user.email"
                    (click)="edit(user)"
                  >
                    <ng-icon name="lucidePencil" />
                  </button>
                  @if (user.id !== auth.user()?.id) {
                    <button
                      hlmBtn
                      size="icon-sm"
                      variant="ghost"
                      [attr.aria-label]="'Delete ' + user.email"
                      (click)="remove(user)"
                    >
                      <ng-icon name="lucideTrash2" />
                    </button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>

    <hlm-dialog [state]="draft() ? 'open' : 'closed'" (closed)="draft.set(null)">
      <hlm-dialog-content *hlmDialogPortal="let ctx" class="sm:max-w-lg">
        @if (draft(); as draft) {
          <hlm-dialog-header>
            <h2 hlmDialogTitle>{{ draft.id ? 'Edit user' : 'Add user' }}</h2>
            <p hlmDialogDescription>
              {{
                draft.id
                  ? 'Leave the password empty to keep it.'
                  : 'They log in with this email and password.'
              }}
            </p>
          </hlm-dialog-header>
          <div class="flex flex-col gap-4">
            <div class="grid grid-cols-2 gap-4">
              <div hlmField>
                <label hlmFieldLabel for="user-firstname">First name</label
                ><input
                  hlmInput
                  id="user-firstname"
                  [value]="draft.firstname"
                  (input)="patch({ firstname: $any($event.target).value })"
                />
              </div>
              <div hlmField>
                <label hlmFieldLabel for="user-lastname">Last name</label
                ><input
                  hlmInput
                  id="user-lastname"
                  [value]="draft.lastname"
                  (input)="patch({ lastname: $any($event.target).value })"
                />
              </div>
            </div>
            <div hlmField>
              <label hlmFieldLabel for="user-email">Email</label
              ><input
                hlmInput
                id="user-email"
                type="email"
                [value]="draft.email"
                (input)="patch({ email: $any($event.target).value })"
              />
            </div>
            <div hlmField>
              <label hlmFieldLabel for="user-password">Password</label
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
              <legend hlmFieldLegend>Roles</legend>
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
              <label hlmFieldLabel for="user-active">Active</label>
            </div>
            @if (error()) {
              <div hlmAlert variant="destructive">
                <p hlmAlertDescription>{{ error() }}</p>
              </div>
            }
          </div>
          <hlm-dialog-footer>
            <button hlmBtn variant="outline" (click)="closeDraft()">Cancel</button>
            <button hlmBtn (click)="save()">Save</button>
          </hlm-dialog-footer>
        }
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class UsersPage implements OnInit {
  private readonly api = inject(Api);
  protected readonly auth = inject(Auth);
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

  protected fullName(user: AdminUser): string {
    return [user.firstname, user.lastname].filter((part) => !!part).join(' ') || '—';
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
      toast.success('User saved');
    } catch (error) {
      this.error.set(ApiFailure.from(error).message);
    }
  }

  protected async remove(user: AdminUser): Promise<void> {
    if (!confirm(`Delete ${user.email}?`)) return;
    try {
      await this.api.delete(`/users/${user.id}`);
      this.users.set(await this.api.get<AdminUser[]>('/users'));
      toast.success('User deleted');
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    }
  }
}
