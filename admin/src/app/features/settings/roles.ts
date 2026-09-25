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
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmTableImports } from '@spartan-ng/helm/table';

import { Api, ApiFailure } from '../../core/api';
import { Schema } from '../../core/schema';
import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/keys';
import {
  ADMIN_CONTENT_ACTIONS,
  ADMIN_SETTINGS_ACTIONS,
  MEDIA_ACTIONS,
  Permission,
  Role,
} from '../../core/types';
import { PageHeader } from '../../shared/components/page-header';

type Level = 'none' | 'own' | 'all';
type MediaAction = (typeof MEDIA_ACTIONS)[number];
type Coverage = 'none' | 'some' | 'all';

/** Content actions that can be limited to some fields of a content type. */
const FIELD_ACTIONS = ['content.read', 'content.create', 'content.update'] as const;
type FieldAction = (typeof FIELD_ACTIONS)[number];

/** How a role grants a field action on one content type. */
type FieldGrant = 'type' | 'wildcard' | 'none';

/** The field permissions dialog: the attributes of one type and the pending selection. */
interface FieldsEditor {
  uid: string;
  name: string;
  attributes: string[];
  /** `null` means every field. */
  selection: Record<FieldAction, string[] | null>;
}

/** Media actions that can be limited to the files the user uploaded. */
const MEDIA_SCOPED = new Set<MediaAction>(['media.update', 'media.delete']);

const ACTION_LABELS: Record<
  (typeof ADMIN_CONTENT_ACTIONS)[number] | (typeof ADMIN_SETTINGS_ACTIONS)[number] | MediaAction,
  MessageKey
> = {
  'content.read': 'settings.roles.action.content.read',
  'content.create': 'settings.roles.action.content.create',
  'content.update': 'settings.roles.action.content.update',
  'content.delete': 'settings.roles.action.content.delete',
  'content.publish': 'settings.roles.action.content.publish',
  'features.manage': 'settings.roles.action.features.manage',
  'media.read': 'settings.roles.action.media.read',
  'media.create': 'settings.roles.action.media.create',
  'media.update': 'settings.roles.action.media.update',
  'media.delete': 'settings.roles.action.media.delete',
  'users.manage': 'settings.roles.action.users.manage',
  'roles.manage': 'settings.roles.action.roles.manage',
  'tokens.manage': 'settings.roles.action.tokens.manage',
  'schema.manage': 'settings.roles.action.schema.manage',
  'webhooks.manage': 'settings.roles.action.webhooks.manage',
  'locales.manage': 'settings.roles.action.locales.manage',
};

@Component({
  selector: 'vd-roles',
  imports: [
    NgIcon,
    HlmTableImports,
    HlmButtonImports,
    HlmBadgeImports,
    HlmCheckboxImports,
    HlmDialogImports,
    HlmFieldImports,
    HlmInputImports,
    HlmNativeSelectImports,
    HlmAlertImports,
    PageHeader,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <vd-page-header
        [title]="t('settings.roles.title')"
        [description]="t('settings.roles.description')"
      >
        <span eyebrow class="text-primary flex items-center gap-1.5 text-xs font-medium">
          <ng-icon name="lucideShieldCheck" size="14" /> {{ t('shell.settings') }}
        </span>
      </vd-page-header>

      <div class="grid items-start gap-6 lg:grid-cols-[16rem_1fr]">
        <aside class="flex flex-col gap-4">
          <nav class="bg-card flex flex-col gap-1 rounded-xl border p-2">
            @for (role of roles(); track role.id) {
              <button
                hlmBtn
                [variant]="selected()?.id === role.id ? 'secondary' : 'ghost'"
                class="h-auto justify-start py-2"
                [attr.aria-current]="selected()?.id === role.id ? 'true' : null"
                (click)="select(role)"
              >
                <span class="flex min-w-0 flex-col items-start">
                  <span class="truncate">{{ role.name }}</span>
                  @if (role.code !== 'super-admin') {
                    <span class="text-muted-foreground text-xs font-normal">{{
                      t('settings.roles.permissions', { count: role.permissions.length })
                    }}</span>
                  }
                </span>
                @if (role.builtin) {
                  <span hlmBadge variant="outline" class="ms-auto">{{
                    t('settings.roles.builtin')
                  }}</span>
                }
              </button>
            }
          </nav>
          <div class="bg-card flex flex-col gap-2 rounded-xl border p-3">
            <span class="text-sm font-medium">{{ t('settings.roles.newRole') }}</span>
            <input
              hlmInput
              [placeholder]="t('common.name')"
              [value]="newName()"
              (input)="newName.set($any($event.target).value)"
              (keydown.enter)="newName().trim() && create()"
              [attr.aria-label]="t('settings.roles.newRoleName')"
            />
            <button
              hlmBtn
              variant="outline"
              size="sm"
              [disabled]="!newName().trim()"
              (click)="create()"
            >
              <ng-icon name="lucidePlus" /> {{ t('common.create') }}
            </button>
          </div>
        </aside>

        @if (selected(); as role) {
          <section class="flex min-w-0 flex-col gap-6">
            <div class="flex flex-wrap items-center gap-3">
              <div class="flex min-w-0 flex-col gap-1">
                <h2 class="flex items-center gap-2 text-xl font-semibold tracking-tight">
                  {{ role.name }}
                  @if (role.builtin) {
                    <span hlmBadge variant="outline">{{ t('settings.roles.builtin') }}</span>
                  }
                </h2>
                @if (role.description) {
                  <p class="text-muted-foreground text-sm">{{ role.description }}</p>
                }
              </div>
              <div class="ms-auto flex gap-2">
                @if (!role.builtin) {
                  <button
                    hlmBtn
                    variant="ghost"
                    class="text-destructive hover:text-destructive"
                    (click)="remove(role)"
                  >
                    <ng-icon name="lucideTrash2" /> {{ t('common.delete') }}
                  </button>
                }
                @if (!superAdmin()) {
                  <button hlmBtn (click)="save()">
                    <ng-icon name="lucideSave" /> {{ t('common.save') }}
                  </button>
                }
              </div>
            </div>
            @if (superAdmin()) {
              <div hlmAlert>
                <ng-icon name="lucideShieldCheck" />
                <p hlmAlertDescription>{{ t('settings.roles.superAdmin') }}</p>
              </div>
            } @else {
              <div class="flex flex-col gap-3">
                <div class="flex flex-col gap-0.5">
                  <h3 class="text-sm font-medium">{{ t('settings.roles.content') }}</h3>
                  <p class="text-muted-foreground text-xs">{{ t('settings.roles.contentHint') }}</p>
                </div>
                <div class="bg-card overflow-hidden rounded-xl border">
                  <div hlmTableContainer class="max-h-[60vh] overflow-y-auto">
                    <table hlmTable>
                      <thead hlmTHead>
                        <tr hlmTr class="hover:bg-transparent">
                          <th hlmTh class="bg-muted sticky top-0 z-10 ps-4">
                            {{ t('settings.grants.contentType') }}
                          </th>
                          @for (action of contentActions; track action) {
                            <th hlmTh class="bg-muted sticky top-0 z-10">
                              {{ t(actionLabels[action]) }}
                            </th>
                          }
                          <th hlmTh class="bg-muted sticky top-0 z-10 pe-4">
                            {{ t('settings.roles.fields') }}
                          </th>
                        </tr>
                      </thead>
                      <tbody hlmTBody>
                        @for (subject of subjects(); track subject.uid) {
                          <tr hlmTr [class.bg-muted/30]="subject.uid === '*'">
                            <td hlmTd class="ps-4">
                              <div class="flex flex-col">
                                <span class="font-medium">{{ subject.name }}</span>
                                @if (subject.uid !== '*') {
                                  <span class="text-muted-foreground font-mono text-xs">{{
                                    subject.uid
                                  }}</span>
                                }
                              </div>
                            </td>
                            @for (action of contentActions; track action) {
                              @let restriction = fieldRestriction(action, subject.uid);
                              <td hlmTd>
                                <hlm-native-select
                                  size="sm"
                                  [value]="level(action, subject.uid)"
                                  (valueChange)="setLevel(action, subject.uid, $any($event))"
                                  [attr.aria-label]="subject.name + ' ' + t(actionLabels[action])"
                                >
                                  <option hlmNativeSelectOption value="none">
                                    {{ t('settings.roles.level.none') }}
                                  </option>
                                  <option hlmNativeSelectOption value="own">
                                    {{ t('settings.roles.level.own') }}
                                  </option>
                                  <option hlmNativeSelectOption value="all">
                                    {{ t('settings.roles.level.all') }}
                                  </option>
                                </hlm-native-select>
                                @if (restriction) {
                                  <span hlmBadge variant="secondary" class="mt-1.5">{{
                                    t('settings.roles.fieldsCount', { count: restriction.length })
                                  }}</span>
                                }
                              </td>
                            }
                            <td hlmTd class="pe-4">
                              @if (subject.uid === '*') {
                                <span class="text-muted-foreground/60 text-sm">—</span>
                              } @else {
                                <button
                                  hlmBtn
                                  variant="outline"
                                  size="sm"
                                  [disabled]="!canRestrict(subject.uid)"
                                  [attr.aria-label]="
                                    t('settings.roles.fieldsFor', { type: subject.name })
                                  "
                                  (click)="openFields(subject.uid, subject.name)"
                                >
                                  <ng-icon name="lucideListChecks" />
                                  {{ t('settings.roles.fields') }}
                                </button>
                              }
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
              <fieldset hlmFieldSet class="bg-card rounded-xl border p-4">
                <legend hlmFieldLegend class="sr-only">{{ t('settings.roles.media') }}</legend>
                <div class="flex flex-col gap-0.5">
                  <h3 class="flex items-center gap-1.5 text-sm font-medium">
                    <ng-icon name="lucideImage" size="14" class="text-muted-foreground" />
                    {{ t('settings.roles.media') }}
                  </h3>
                  <p class="text-muted-foreground text-xs">{{ t('settings.roles.mediaHint') }}</p>
                </div>
                <div class="grid gap-3 sm:grid-cols-2">
                  @for (action of mediaActions; track action) {
                    @let granted = hasMedia(action);
                    <div
                      hlmField
                      orientation="horizontal"
                      class="hover:bg-muted/50 items-center rounded-lg border p-3 transition-colors"
                    >
                      <hlm-checkbox
                        [inputId]="action"
                        [checked]="granted"
                        (checkedChange)="toggleMedia(action, $event === true)"
                      />
                      <label
                        hlmFieldLabel
                        [for]="action"
                        class="flex min-w-0 flex-1 flex-col items-start gap-0.5"
                      >
                        <span>{{ t(actionLabels[action]) }}</span>
                        <span class="text-muted-foreground font-mono text-xs font-normal">{{
                          action
                        }}</span>
                      </label>
                      @if (mediaScoped.has(action)) {
                        <hlm-native-select
                          size="sm"
                          class="w-auto shrink-0"
                          [value]="mediaOwn(action) ? 'own' : 'all'"
                          [disabled]="!granted"
                          (valueChange)="setMediaScope(action, $event === 'own')"
                          [attr.aria-label]="
                            t('settings.roles.mediaScope', { action: t(actionLabels[action]) })
                          "
                        >
                          <option hlmNativeSelectOption value="all">
                            {{ t('settings.roles.mediaScope.all') }}
                          </option>
                          <option hlmNativeSelectOption value="own">
                            {{ t('settings.roles.mediaScope.own') }}
                          </option>
                        </hlm-native-select>
                      }
                    </div>
                  }
                </div>
              </fieldset>
              <fieldset hlmFieldSet class="bg-card rounded-xl border p-4">
                <legend hlmFieldLegend class="sr-only">{{ t('settings.roles.settings') }}</legend>
                <div class="flex flex-col gap-0.5">
                  <h3 class="text-sm font-medium">{{ t('settings.roles.settings') }}</h3>
                  <p class="text-muted-foreground text-xs">
                    {{ t('settings.roles.settingsHint') }}
                  </p>
                </div>
                <div class="grid gap-3 sm:grid-cols-2">
                  @for (action of settingsActions; track action) {
                    <div
                      hlmField
                      orientation="horizontal"
                      class="hover:bg-muted/50 rounded-lg border p-3 transition-colors"
                    >
                      <hlm-checkbox
                        [inputId]="action"
                        [checked]="hasSetting(action)"
                        (checkedChange)="toggleSetting(action, $event === true)"
                      />
                      <label hlmFieldLabel [for]="action" class="flex flex-col items-start gap-0.5">
                        <span>{{ t(actionLabels[action]) }}</span>
                        <span class="text-muted-foreground font-mono text-xs font-normal">{{
                          action
                        }}</span>
                      </label>
                    </div>
                  }
                </div>
              </fieldset>
            }
          </section>
        }
      </div>
    </div>

    <hlm-dialog [state]="fieldsEditor() ? 'open' : 'closed'" (closed)="fieldsEditor.set(null)">
      <hlm-dialog-content
        *hlmDialogPortal="let ctx"
        class="max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-2xl"
        [closeLabel]="t('common.close')"
      >
        @if (fieldsEditor(); as editor) {
          <hlm-dialog-header>
            <h2 hlmDialogTitle>{{ t('settings.roles.fieldsTitle', { type: editor.name }) }}</h2>
            <p hlmDialogDescription>{{ t('settings.roles.fieldsDescription') }}</p>
          </hlm-dialog-header>
          <div class="-mx-6 flex flex-col gap-4 overflow-y-auto px-6">
            @for (action of fieldActions; track action) {
              @if (fieldGrant(action, editor.uid) === 'wildcard') {
                <div hlmAlert>
                  <ng-icon name="lucideInfo" />
                  <h4 hlmAlertTitle>
                    {{ t('settings.roles.fieldsWildcard', { action: t(actionLabels[action]) }) }}
                  </h4>
                  <div hlmAlertDescription class="flex flex-col items-start gap-2">
                    <p>
                      {{
                        t('settings.roles.fieldsConvertHint', { action: t(actionLabels[action]) })
                      }}
                    </p>
                    <button hlmBtn variant="outline" size="sm" (click)="convertWildcard(action)">
                      {{ t('settings.roles.fieldsConvert') }}
                    </button>
                  </div>
                </div>
              }
            }
            @if (editor.attributes.length === 0) {
              <p class="text-muted-foreground text-sm">{{ t('settings.roles.fieldsEmpty') }}</p>
            } @else {
              <div class="overflow-hidden rounded-lg border">
                <table hlmTable>
                  <thead hlmTHead>
                    <tr hlmTr class="hover:bg-transparent">
                      <th hlmTh class="bg-muted ps-4">{{ t('settings.roles.fieldsField') }}</th>
                      @for (action of fieldActions; track action) {
                        @let editable = fieldGrant(action, editor.uid) === 'type';
                        @let cover = coverage(editor, action);
                        <th hlmTh class="bg-muted h-auto py-2 text-center">
                          <div class="flex flex-col items-center gap-1.5">
                            <span>{{ t(actionLabels[action]) }}</span>
                            @if (editable) {
                              <label class="flex items-center gap-1.5 text-xs font-normal">
                                <hlm-checkbox
                                  [checked]="cover === 'all'"
                                  [indeterminate]="cover === 'some'"
                                  (checkedChange)="setAllFields(action, $event === true)"
                                />
                                {{ t('settings.roles.fieldsAll') }}
                              </label>
                            } @else {
                              <span class="text-muted-foreground text-xs font-normal">{{
                                t('settings.roles.fieldsNotGranted')
                              }}</span>
                            }
                          </div>
                        </th>
                      }
                    </tr>
                  </thead>
                  <tbody hlmTBody>
                    @for (attribute of editor.attributes; track attribute) {
                      <tr hlmTr>
                        <td hlmTd class="ps-4 font-mono text-xs">{{ attribute }}</td>
                        @for (action of fieldActions; track action) {
                          <td hlmTd class="text-center">
                            @if (fieldGrant(action, editor.uid) === 'type') {
                              <div class="flex justify-center">
                                <hlm-checkbox
                                  [aria-label]="attribute + ' ' + t(actionLabels[action])"
                                  [checked]="isFieldSelected(editor, action, attribute)"
                                  (checkedChange)="toggleField(action, attribute, $event === true)"
                                />
                              </div>
                            } @else {
                              <span class="text-muted-foreground/60 text-sm">—</span>
                            }
                          </td>
                        }
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </div>
          <hlm-dialog-footer>
            <button hlmBtn variant="outline" (click)="fieldsEditor.set(null)">
              {{ t('common.cancel') }}
            </button>
            <button hlmBtn (click)="applyFields()">
              <ng-icon name="lucideCheck" /> {{ t('settings.roles.fieldsApply') }}
            </button>
          </hlm-dialog-footer>
        }
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class RolesPage implements OnInit {
  private readonly api = inject(Api);
  private readonly schema = inject(Schema);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly actionLabels = ACTION_LABELS;
  protected readonly contentActions = ADMIN_CONTENT_ACTIONS;
  protected readonly settingsActions = ADMIN_SETTINGS_ACTIONS;
  protected readonly mediaActions = MEDIA_ACTIONS;
  protected readonly mediaScoped = MEDIA_SCOPED;
  protected readonly fieldActions = FIELD_ACTIONS;
  protected readonly fieldsEditor = signal<FieldsEditor | null>(null);
  protected readonly roles = signal<Role[]>([]);
  protected readonly selected = signal<Role | null>(null);
  protected readonly permissions = signal<Permission[]>([]);
  protected readonly newName = signal('');
  protected readonly superAdmin = computed(() => this.selected()?.code === 'super-admin');
  protected readonly subjects = computed(() => [
    { uid: '*', name: this.t('settings.roles.allTypes') },
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

  /** Changing the level keeps the field restriction. */
  protected setLevel(action: string, subject: string, level: Level): void {
    const fields = this.contentPermission(action, subject)?.fields;
    const rest = this.permissions().filter(
      (item) => !(item.action === action && item.subject === subject),
    );
    if (level === 'none') this.permissions.set(rest);
    else
      this.permissions.set([
        ...rest,
        {
          action,
          subject,
          conditions: level === 'own' ? ['is-creator'] : [],
          ...(fields ? { fields } : {}),
        },
      ]);
  }

  private contentPermission(action: string, subject: string): Permission | undefined {
    return this.permissions().find((item) => item.action === action && item.subject === subject);
  }

  /** The fields an action is limited to on a type, or `null` for every field. */
  protected fieldRestriction(action: string, subject: string): string[] | null {
    return this.contentPermission(action, subject)?.fields ?? null;
  }

  protected fieldGrant(action: FieldAction, uid: string): FieldGrant {
    if (this.contentPermission(action, uid)) return 'type';
    return this.contentPermission(action, '*') ? 'wildcard' : 'none';
  }

  protected canRestrict(uid: string): boolean {
    return FIELD_ACTIONS.some((action) => this.fieldGrant(action, uid) !== 'none');
  }

  protected openFields(uid: string, name: string): void {
    const attributes = Object.keys(this.schema.type(uid)?.attributes ?? {});
    const selection = {} as Record<FieldAction, string[] | null>;
    for (const action of FIELD_ACTIONS) {
      const fields = this.fieldRestriction(action, uid);
      selection[action] = fields ? attributes.filter((item) => fields.includes(item)) : null;
    }
    this.fieldsEditor.set({ uid, name, attributes, selection });
  }

  protected isFieldSelected(editor: FieldsEditor, action: FieldAction, attribute: string): boolean {
    const fields = editor.selection[action];
    return !fields || fields.includes(attribute);
  }

  protected coverage(editor: FieldsEditor, action: FieldAction): Coverage {
    const fields = editor.selection[action];
    if (!fields || fields.length === editor.attributes.length) return 'all';
    return fields.length ? 'some' : 'none';
  }

  private setSelection(action: FieldAction, fields: string[] | null): void {
    this.fieldsEditor.update((editor) => {
      if (!editor) return editor;
      const all = fields && fields.length === editor.attributes.length;
      return { ...editor, selection: { ...editor.selection, [action]: all ? null : fields } };
    });
  }

  protected toggleField(action: FieldAction, attribute: string, checked: boolean): void {
    const editor = this.fieldsEditor();
    if (!editor) return;
    const current = editor.selection[action] ?? editor.attributes;
    this.setSelection(
      action,
      editor.attributes.filter((item) => (item === attribute ? checked : current.includes(item))),
    );
  }

  protected setAllFields(action: FieldAction, checked: boolean): void {
    this.setSelection(action, checked ? null : []);
  }

  /** Replaces the `*` permission of an action with one permission per content type. */
  protected convertWildcard(action: FieldAction): void {
    const wildcard = this.contentPermission(action, '*');
    if (!wildcard) return;
    const rest = this.permissions().filter((item) => item !== wildcard);
    const additions = this.schema
      .contentTypes()
      .filter((type) => !rest.some((item) => item.action === action && item.subject === type.uid))
      .map((type) => ({
        action,
        subject: type.uid,
        conditions: [...(wildcard.conditions ?? [])],
      }));
    this.permissions.set([...rest, ...additions]);
  }

  /** Writes the selection into the role's permissions (saved with the role). */
  protected applyFields(): void {
    const editor = this.fieldsEditor();
    if (!editor) return;
    this.permissions.update((permissions) =>
      permissions.map((item) => {
        if (item.subject !== editor.uid || !FIELD_ACTIONS.includes(item.action as FieldAction))
          return item;
        const { fields: _previous, ...permission } = item;
        const fields = editor.selection[item.action as FieldAction];
        return fields ? { ...permission, fields } : permission;
      }),
    );
    this.fieldsEditor.set(null);
  }

  protected hasSetting(action: string): boolean {
    return this.permissions().some((item) => item.action === action);
  }

  protected toggleSetting(action: string, checked: boolean): void {
    const rest = this.permissions().filter((item) => item.action !== action);
    this.permissions.set(checked ? [...rest, { action }] : rest);
  }

  private mediaPermission(action: MediaAction): Permission | undefined {
    return this.permissions().find((item) => item.action === action && !item.subject);
  }

  protected hasMedia(action: MediaAction): boolean {
    return !!this.mediaPermission(action);
  }

  protected mediaOwn(action: MediaAction): boolean {
    return !!this.mediaPermission(action)?.conditions?.includes('is-creator');
  }

  /** Media permissions have no subject; granting keeps the current scope. */
  protected toggleMedia(action: MediaAction, checked: boolean): void {
    const own = this.mediaOwn(action);
    this.writeMedia(action, checked ? own : null);
  }

  protected setMediaScope(action: MediaAction, own: boolean): void {
    if (this.hasMedia(action)) this.writeMedia(action, own);
  }

  /** `own === null` revokes the action. */
  private writeMedia(action: MediaAction, own: boolean | null): void {
    const rest = this.permissions().filter((item) => !(item.action === action && !item.subject));
    if (own === null) this.permissions.set(rest);
    else
      this.permissions.set([
        ...rest,
        own && MEDIA_SCOPED.has(action) ? { action, conditions: ['is-creator'] } : { action },
      ]);
  }

  protected async save(): Promise<void> {
    const role = this.selected();
    if (!role) return;
    try {
      await this.api.put(`/roles/${role.id}`, { permissions: this.permissions() });
      await this.reload(role.id);
      toast.success(this.t('settings.roles.saved'));
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
      toast.success(this.t('settings.roles.created'));
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    }
  }

  protected async remove(role: Role): Promise<void> {
    if (!confirm(this.t('settings.roles.confirmDelete', { name: role.name }))) return;
    try {
      await this.api.delete(`/roles/${role.id}`);
      this.selected.set(null);
      await this.reload();
      toast.success(this.t('settings.roles.deleted'));
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    }
  }
}
