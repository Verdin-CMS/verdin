import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmTableImports } from '@spartan-ng/helm/table';

import { Api, ApiFailure } from '../../core/api';
import { Schema } from '../../core/schema';
import { ADMIN_CONTENT_ACTIONS, ADMIN_SETTINGS_ACTIONS, Permission, Role } from '../../core/types';

type Level = 'none' | 'own' | 'all';

@Component({
  selector: 'vd-roles',
  imports: [
    NgIcon,
    HlmTableImports,
    HlmButtonImports,
    HlmBadgeImports,
    HlmCheckboxImports,
    HlmFieldImports,
    HlmInputImports,
    HlmNativeSelectImports,
    HlmAlertImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="grid gap-6 lg:grid-cols-[16rem_1fr]">
      <aside class="flex flex-col gap-2">
        <h1 class="text-2xl font-semibold">Roles</h1>
        @for (role of roles(); track role.id) {
          <button
            hlmBtn
            [variant]="selected()?.id === role.id ? 'secondary' : 'ghost'"
            class="justify-start"
            (click)="select(role)"
          >
            {{ role.name }}
            @if (role.builtin) {
              <span hlmBadge variant="outline" class="ms-auto">built-in</span>
            }
          </button>
        }
        <div class="mt-4 flex flex-col gap-2 rounded-md border p-3">
          <span class="text-sm font-medium">New role</span>
          <input
            hlmInput
            placeholder="Name"
            [value]="newName()"
            (input)="newName.set($any($event.target).value)"
            aria-label="New role name"
          />
          <button
            hlmBtn
            variant="outline"
            size="sm"
            [disabled]="!newName().trim()"
            (click)="create()"
          >
            <ng-icon name="lucidePlus" /> Create
          </button>
        </div>
      </aside>

      @if (selected(); as role) {
        <section class="flex flex-col gap-4">
          <div class="flex flex-wrap items-center gap-3">
            <div>
              <h2 class="text-xl font-semibold">{{ role.name }}</h2>
              <p class="text-muted-foreground text-sm">{{ role.description }}</p>
            </div>
            <div class="ms-auto flex gap-2">
              @if (!role.builtin) {
                <button hlmBtn variant="ghost" (click)="remove(role)">
                  <ng-icon name="lucideTrash2" /> Delete
                </button>
              }
              @if (!superAdmin()) {
                <button hlmBtn (click)="save()"><ng-icon name="lucideSave" /> Save</button>
              }
            </div>
          </div>
          @if (superAdmin()) {
            <div hlmAlert>
              <p hlmAlertDescription>
                Super Admins can do everything; their permissions cannot be changed.
              </p>
            </div>
          } @else {
            <div hlmTableContainer class="rounded-md border">
              <table hlmTable>
                <thead hlmTHead>
                  <tr hlmTr>
                    <th hlmTh>Content type</th>
                    @for (action of contentActions; track action) {
                      <th hlmTh>{{ action.replace('content.', '') }}</th>
                    }
                  </tr>
                </thead>
                <tbody hlmTBody>
                  @for (subject of subjects(); track subject.uid) {
                    <tr hlmTr>
                      <td hlmTd>{{ subject.name }}</td>
                      @for (action of contentActions; track action) {
                        <td hlmTd>
                          <hlm-native-select
                            size="sm"
                            [value]="level(action, subject.uid)"
                            (valueChange)="setLevel(action, subject.uid, $any($event))"
                            [attr.aria-label]="subject.name + ' ' + action"
                          >
                            <option hlmNativeSelectOption value="none">—</option>
                            <option hlmNativeSelectOption value="own">Own</option>
                            <option hlmNativeSelectOption value="all">All</option>
                          </hlm-native-select>
                        </td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <fieldset hlmFieldSet>
              <legend hlmFieldLegend>Settings</legend>
              <div hlmFieldGroup>
                @for (action of settingsActions; track action) {
                  <div hlmField orientation="horizontal">
                    <hlm-checkbox
                      [inputId]="action"
                      [checked]="hasSetting(action)"
                      (checkedChange)="toggleSetting(action, $event === true)"
                    />
                    <label hlmFieldLabel [for]="action">{{ action }}</label>
                  </div>
                }
              </div>
            </fieldset>
          }
        </section>
      }
    </div>
  `,
})
export class RolesPage implements OnInit {
  private readonly api = inject(Api);
  private readonly schema = inject(Schema);
  protected readonly contentActions = ADMIN_CONTENT_ACTIONS;
  protected readonly settingsActions = ADMIN_SETTINGS_ACTIONS;
  protected readonly roles = signal<Role[]>([]);
  protected readonly selected = signal<Role | null>(null);
  protected readonly permissions = signal<Permission[]>([]);
  protected readonly newName = signal('');
  protected readonly superAdmin = computed(() => this.selected()?.code === 'super-admin');
  protected readonly subjects = computed(() => [
    { uid: '*', name: 'All content types' },
    ...this.schema.contentTypes().map((type) => ({ uid: type.uid, name: type.displayName })),
  ]);

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(select?: number): Promise<void> {
    const roles = await this.api.get<Role[]>('/roles');
    this.roles.set(roles);
    const role =
      roles.find((candidate) => candidate.id === (select ?? this.selected()?.id)) ??
      roles[0] ??
      null;
    if (role) this.select(role);
  }

  protected select(role: Role): void {
    this.selected.set(role);
    this.permissions.set(role.permissions.map((permission) => ({ ...permission })));
  }

  protected level(action: string, subject: string): Level {
    const permission = this.permissions().find(
      (item) => item.action === action && item.subject === subject,
    );
    if (!permission) return 'none';
    return permission.conditions?.includes('is-creator') ? 'own' : 'all';
  }

  protected setLevel(action: string, subject: string, level: Level): void {
    const rest = this.permissions().filter(
      (item) => !(item.action === action && item.subject === subject),
    );
    if (level === 'none') this.permissions.set(rest);
    else
      this.permissions.set([
        ...rest,
        { action, subject, conditions: level === 'own' ? ['is-creator'] : [] },
      ]);
  }

  protected hasSetting(action: string): boolean {
    return this.permissions().some((item) => item.action === action);
  }

  protected toggleSetting(action: string, checked: boolean): void {
    const rest = this.permissions().filter((item) => item.action !== action);
    this.permissions.set(checked ? [...rest, { action }] : rest);
  }

  protected async save(): Promise<void> {
    const role = this.selected();
    if (!role) return;
    try {
      await this.api.put(`/roles/${role.id}`, { permissions: this.permissions() });
      await this.reload(role.id);
      toast.success('Role saved');
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    }
  }

  protected async create(): Promise<void> {
    const name = this.newName().trim();
    const code = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    try {
      const role = await this.api.post<Role>('/roles', { code, name, permissions: [] });
      this.newName.set('');
      await this.reload(role.id);
      toast.success('Role created');
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    }
  }

  protected async remove(role: Role): Promise<void> {
    if (!confirm(`Delete the role ${role.name}?`)) return;
    try {
      await this.api.delete(`/roles/${role.id}`);
      this.selected.set(null);
      await this.reload();
      toast.success('Role deleted');
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    }
  }
}
