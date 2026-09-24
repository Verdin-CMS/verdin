import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { HlmTableImports } from '@spartan-ng/helm/table';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';

import { Api, ApiFailure } from '../../core/api';
import { Schema } from '../../core/schema';
import { Attribute, AttributeType, RelationKind, SchemaPlan } from '../../core/types';

type SchemaFile = Record<string, unknown> & { attributes: Record<string, Attribute> };

interface Sources {
  contentTypes: Record<string, SchemaFile>;
  components: Record<string, SchemaFile>;
}

interface Change {
  contentTypes: Record<string, SchemaFile | null>;
  components: Record<string, SchemaFile | null>;
  renameTables: string[];
  renameColumns: string[];
  allow?: string;
}

const TYPES: AttributeType[] = [
  'string',
  'text',
  'richtext',
  'email',
  'uid',
  'integer',
  'biginteger',
  'float',
  'decimal',
  'boolean',
  'date',
  'time',
  'datetime',
  'enumeration',
  'json',
  'relation',
  'component',
  'dynamiczone',
];
const RELATIONS: { kind: RelationKind; label: string; bidirectional: boolean }[] = [
  { kind: 'manyToOne', label: 'Many to one (belongs to)', bidirectional: true },
  { kind: 'oneToMany', label: 'One to many (has many)', bidirectional: true },
  { kind: 'manyToMany', label: 'Many to many', bidirectional: true },
  { kind: 'oneToOne', label: 'One to one', bidirectional: true },
  { kind: 'oneWay', label: 'Has one (one-way)', bidirectional: false },
  { kind: 'manyWay', label: 'Has many (one-way)', bidirectional: false },
];
const INVERSE: Partial<Record<RelationKind, RelationKind>> = {
  manyToOne: 'oneToMany',
  oneToMany: 'manyToOne',
  manyToMany: 'manyToMany',
  oneToOne: 'oneToOne',
};
const LENGTH_TYPES = new Set(['string', 'text', 'richtext', 'email', 'uid']);
const NUMBER_TYPES = new Set(['integer', 'biginteger', 'float', 'decimal']);
const UNIQUE_TYPES = new Set([
  'string',
  'email',
  'integer',
  'biginteger',
  'float',
  'decimal',
  'date',
  'time',
  'datetime',
]);

function kebab(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function camel(text: string): string {
  const words = kebab(text).split('-').filter(Boolean);
  return words
    .map((word, index) => (index ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join('');
}

/** Naive English plural, editable by the user. */
function plural(name: string): string {
  if (/(s|x|z|ch|sh)$/.test(name)) return `${name}es`;
  if (/[^aeiou]y$/.test(name)) return `${name.slice(0, -1)}ies`;
  return `${name}s`;
}

interface AttributeDraft {
  originalName: string | null;
  name: string;
  attribute: Attribute;
  /** For bidirectional relations: the attribute to create on the target. */
  inverseName: string;
}

@Component({
  selector: 'vd-builder',
  imports: [
    RouterLink,
    NgIcon,
    HlmButtonImports,
    HlmBadgeImports,
    HlmCardImports,
    HlmFieldImports,
    HlmInputImports,
    HlmNativeSelectImports,
    HlmSwitchImports,
    HlmCheckboxImports,
    HlmToggleGroupImports,
    HlmTableImports,
    HlmDialogImports,
    HlmAlertImports,
    HlmSpinnerImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!schema.devMode()) {
      <div hlmAlert>
        <p hlmAlertTitle>The content-type builder is only available in development mode</p>
        <p hlmAlertDescription>
          Run <code>verdin dev</code>, edit the schema, commit the files in <code>schema/</code> and
          deploy.
        </p>
      </div>
    } @else if (!sources()) {
      <hlm-spinner />
    } @else {
      <div class="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <aside class="flex flex-col gap-4">
          <div class="flex flex-col gap-1">
            <div class="flex items-center justify-between">
              <h2 class="text-sm font-semibold">Content types</h2>
              <a
                hlmBtn
                size="icon-sm"
                variant="ghost"
                routerLink="/builder/new"
                aria-label="New content type"
                ><ng-icon name="lucidePlus"
              /></a>
            </div>
            @for (entry of typeEntries(); track entry.key) {
              <a
                hlmBtn
                [variant]="name() === entry.key ? 'secondary' : 'ghost'"
                class="justify-start"
                [routerLink]="['/builder', entry.key]"
                >{{ entry.label }}</a
              >
            }
          </div>
          <div class="flex flex-col gap-1">
            <div class="flex items-center justify-between">
              <h2 class="text-sm font-semibold">Components</h2>
              <a
                hlmBtn
                size="icon-sm"
                variant="ghost"
                routerLink="/builder/new-component"
                aria-label="New component"
                ><ng-icon name="lucidePlus"
              /></a>
            </div>
            @for (entry of componentEntries(); track entry.key) {
              <a
                hlmBtn
                [variant]="name() === entry.key ? 'secondary' : 'ghost'"
                class="justify-start"
                [routerLink]="['/builder', entry.key]"
                >{{ entry.label }}</a
              >
            }
          </div>
        </aside>

        @if (draft(); as file) {
          <section class="flex flex-col gap-4">
            <div class="flex flex-wrap items-center gap-3">
              <h1 class="text-2xl font-semibold">
                {{ file['displayName'] || (isComponent() ? 'New component' : 'New content type') }}
              </h1>
              <div class="ms-auto flex gap-2">
                @if (!isNew()) {
                  <button hlmBtn variant="ghost" (click)="remove()">
                    <ng-icon name="lucideTrash2" /> Delete
                  </button>
                }
                <button hlmBtn (click)="plan()" [disabled]="busy()">
                  @if (busy()) {
                    <hlm-spinner />
                  } @else {
                    <ng-icon name="lucideSave" />
                  }
                  Save
                </button>
              </div>
            </div>

            <section hlmCard>
              <div hlmCardContent class="grid gap-4 sm:grid-cols-2">
                <div hlmField>
                  <label hlmFieldLabel for="display-name">Display name</label>
                  <input
                    hlmInput
                    id="display-name"
                    [value]="file['displayName'] ?? ''"
                    (input)="setDisplayName($any($event.target).value)"
                  />
                </div>
                @if (isComponent()) {
                  <div hlmField>
                    <label hlmFieldLabel for="component-uid">Category.name</label>
                    <input
                      hlmInput
                      id="component-uid"
                      [value]="componentUid()"
                      [disabled]="!isNew()"
                      (input)="componentUid.set($any($event.target).value)"
                    />
                    <p hlmFieldDescription>For example <code>shared.seo</code>.</p>
                  </div>
                } @else {
                  <div hlmField>
                    <label hlmFieldLabel for="singular">Singular name (API id)</label>
                    <input
                      hlmInput
                      id="singular"
                      [value]="file['singularName'] ?? ''"
                      [disabled]="!isNew()"
                      (input)="setFileValue('singularName', kebab($any($event.target).value))"
                    />
                  </div>
                  <div hlmField>
                    <label hlmFieldLabel for="plural">Plural name (route)</label>
                    <input
                      hlmInput
                      id="plural"
                      [value]="file['pluralName'] ?? ''"
                      [disabled]="!isNew()"
                      (input)="setFileValue('pluralName', kebab($any($event.target).value))"
                    />
                  </div>
                  <div hlmField>
                    <span hlmFieldLabel>Kind</span>
                    <hlm-toggle-group
                      type="single"
                      variant="outline"
                      [value]="file['kind']"
                      (valueChange)="$event && setFileValue('kind', $event)"
                    >
                      <button hlmToggleGroupItem value="collectionType">Collection</button>
                      <button hlmToggleGroupItem value="singleType">Single</button>
                    </hlm-toggle-group>
                  </div>
                  <div hlmField orientation="horizontal">
                    <hlm-switch
                      inputId="dp"
                      [checked]="draftAndPublish()"
                      (checkedChange)="setDraftAndPublish($event)"
                    />
                    <label hlmFieldLabel for="dp">Draft &amp; publish</label>
                  </div>
                }
              </div>
            </section>

            <section hlmCard>
              <div hlmCardHeader>
                <h2 hlmCardTitle>Fields</h2>
                <div hlmCardAction>
                  <button hlmBtn size="sm" variant="outline" (click)="editAttribute(null)">
                    <ng-icon name="lucidePlus" /> Add field
                  </button>
                </div>
              </div>
              <div hlmCardContent>
                <div hlmTableContainer>
                  <table hlmTable>
                    <thead hlmTHead>
                      <tr hlmTr>
                        <th hlmTh>Name</th>
                        <th hlmTh>Type</th>
                        <th hlmTh>Options</th>
                        <th hlmTh></th>
                      </tr>
                    </thead>
                    <tbody hlmTBody>
                      @for (entry of attributeEntries(); track entry.name; let index = $index) {
                        <tr hlmTr>
                          <td hlmTd class="font-medium">{{ entry.name }}</td>
                          <td hlmTd>
                            <span hlmBadge variant="secondary">{{ entry.attribute.type }}</span>
                          </td>
                          <td hlmTd class="text-muted-foreground text-sm">
                            {{ summary(entry.attribute) }}
                          </td>
                          <td hlmTd class="text-end whitespace-nowrap">
                            <button
                              hlmBtn
                              size="icon-xs"
                              variant="ghost"
                              aria-label="Move up"
                              [disabled]="index === 0"
                              (click)="moveAttribute(index, -1)"
                            >
                              <ng-icon name="lucideArrowUp" />
                            </button>
                            <button
                              hlmBtn
                              size="icon-xs"
                              variant="ghost"
                              aria-label="Move down"
                              [disabled]="index === attributeEntries().length - 1"
                              (click)="moveAttribute(index, 1)"
                            >
                              <ng-icon name="lucideArrowDown" />
                            </button>
                            <button
                              hlmBtn
                              size="icon-xs"
                              variant="ghost"
                              [attr.aria-label]="'Edit ' + entry.name"
                              (click)="editAttribute(entry.name)"
                            >
                              <ng-icon name="lucidePencil" />
                            </button>
                            <button
                              hlmBtn
                              size="icon-xs"
                              variant="ghost"
                              [attr.aria-label]="'Remove ' + entry.name"
                              (click)="removeAttribute(entry.name)"
                            >
                              <ng-icon name="lucideTrash2" />
                            </button>
                          </td>
                        </tr>
                      } @empty {
                        <tr hlmTr>
                          <td hlmTd colspan="4" class="text-muted-foreground">No fields yet.</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </section>
        }
      </div>
    }

    <!-- Field dialog -->
    <hlm-dialog [state]="attributeDraft() ? 'open' : 'closed'" (closed)="attributeDraft.set(null)">
      <hlm-dialog-content *hlmDialogPortal="let ctx" class="sm:max-w-lg">
        @if (attributeDraft(); as field) {
          <hlm-dialog-header>
            <h2 hlmDialogTitle>{{ field.originalName ? 'Edit field' : 'Add field' }}</h2>
          </hlm-dialog-header>
          <div class="flex flex-col gap-4">
            <div class="grid grid-cols-2 gap-4">
              <div hlmField>
                <label hlmFieldLabel for="field-name">Name</label>
                <input
                  hlmInput
                  id="field-name"
                  [value]="field.name"
                  (input)="patchField({ name: camel($any($event.target).value) })"
                />
              </div>
              <div hlmField>
                <label hlmFieldLabel for="field-type">Type</label>
                <hlm-native-select
                  selectId="field-type"
                  [value]="field.attribute.type"
                  (valueChange)="setType($any($event))"
                >
                  @for (type of types; track type) {
                    <option hlmNativeSelectOption [value]="type">{{ type }}</option>
                  }
                </hlm-native-select>
              </div>
            </div>
            @let attr = field.attribute;
            @if (attr.type === 'relation') {
              <div hlmField>
                <label hlmFieldLabel for="relation-kind">Relation</label>
                <hlm-native-select
                  selectId="relation-kind"
                  [value]="attr.relation ?? 'manyToOne'"
                  (valueChange)="patchAttribute({ relation: $any($event) })"
                >
                  @for (relation of relations; track relation.kind) {
                    <option hlmNativeSelectOption [value]="relation.kind">
                      {{ relation.label }}
                    </option>
                  }
                </hlm-native-select>
              </div>
              <div hlmField>
                <label hlmFieldLabel for="relation-target">Target</label>
                <hlm-native-select
                  selectId="relation-target"
                  [value]="attr.target ?? ''"
                  (valueChange)="patchAttribute({ target: $any($event) })"
                >
                  <option hlmNativeSelectOption value="">Choose…</option>
                  @for (entry of typeEntries(); track entry.key) {
                    <option hlmNativeSelectOption [value]="'api::' + entry.key">
                      {{ entry.label }}
                    </option>
                  }
                </hlm-native-select>
              </div>
              @if (isBidirectional(attr) && !attr.mappedBy) {
                <div hlmField>
                  <label hlmFieldLabel for="inverse-name">Field on the target (optional)</label>
                  <input
                    hlmInput
                    id="inverse-name"
                    [value]="field.inverseName"
                    (input)="patchField({ inverseName: camel($any($event.target).value) })"
                  />
                  <p hlmFieldDescription>
                    Creates the other side of the relation on the target type.
                  </p>
                </div>
              }
            }
            @if (attr.type === 'component') {
              <div hlmField>
                <label hlmFieldLabel for="field-component">Component</label>
                <hlm-native-select
                  selectId="field-component"
                  [value]="attr.component ?? ''"
                  (valueChange)="patchAttribute({ component: $any($event) })"
                >
                  <option hlmNativeSelectOption value="">Choose…</option>
                  @for (entry of componentEntries(); track entry.key) {
                    <option hlmNativeSelectOption [value]="entry.uid">{{ entry.label }}</option>
                  }
                </hlm-native-select>
              </div>
              <div hlmField orientation="horizontal">
                <hlm-switch
                  inputId="field-repeatable"
                  [checked]="!!attr.repeatable"
                  (checkedChange)="patchAttribute({ repeatable: $event || undefined })"
                />
                <label hlmFieldLabel for="field-repeatable">Repeatable</label>
              </div>
            }
            @if (attr.type === 'dynamiczone') {
              <fieldset hlmFieldSet>
                <legend hlmFieldLegend>Allowed components</legend>
                <div hlmFieldGroup>
                  @for (entry of componentEntries(); track entry.key) {
                    <div hlmField orientation="horizontal">
                      <hlm-checkbox
                        [inputId]="'dz-' + entry.uid"
                        [checked]="(attr.components ?? []).includes(entry.uid)"
                        (checkedChange)="toggleZoneComponent(entry.uid, $event === true)"
                      />
                      <label hlmFieldLabel [for]="'dz-' + entry.uid">{{ entry.label }}</label>
                    </div>
                  } @empty {
                    <p class="text-muted-foreground text-sm">Create a component first.</p>
                  }
                </div>
              </fieldset>
            }
            @if (attr.type === 'enumeration') {
              <div hlmField>
                <label hlmFieldLabel for="field-enum">Values (comma-separated)</label>
                <input
                  hlmInput
                  id="field-enum"
                  [value]="(attr.enum ?? []).join(', ')"
                  (change)="setEnum($any($event.target).value)"
                />
              </div>
            }
            @if (attr.type === 'uid') {
              <div hlmField>
                <label hlmFieldLabel for="field-target">Generated from</label>
                <hlm-native-select
                  selectId="field-target"
                  [value]="attr.targetField ?? ''"
                  (valueChange)="patchAttribute({ targetField: $any($event) || undefined })"
                >
                  <option hlmNativeSelectOption value="">—</option>
                  @for (entry of attributeEntries(); track entry.name) {
                    @if (entry.attribute.type === 'string' || entry.attribute.type === 'text') {
                      <option hlmNativeSelectOption [value]="entry.name">{{ entry.name }}</option>
                    }
                  }
                </hlm-native-select>
              </div>
            }
            @if (lengthTypes.has(attr.type)) {
              <div class="grid grid-cols-2 gap-4">
                <div hlmField>
                  <label hlmFieldLabel for="min-length">Min length</label
                  ><input
                    hlmInput
                    id="min-length"
                    inputmode="numeric"
                    [value]="attr.minLength ?? ''"
                    (change)="setNumber('minLength', $any($event.target).value)"
                  />
                </div>
                <div hlmField>
                  <label hlmFieldLabel for="max-length">Max length</label
                  ><input
                    hlmInput
                    id="max-length"
                    inputmode="numeric"
                    [value]="attr.maxLength ?? ''"
                    (change)="setNumber('maxLength', $any($event.target).value)"
                  />
                </div>
              </div>
            }
            @if (numberTypes.has(attr.type)) {
              <div class="grid grid-cols-2 gap-4">
                <div hlmField>
                  <label hlmFieldLabel for="min">Min</label
                  ><input
                    hlmInput
                    id="min"
                    inputmode="decimal"
                    [value]="attr.min ?? ''"
                    (change)="setNumber('min', $any($event.target).value)"
                  />
                </div>
                <div hlmField>
                  <label hlmFieldLabel for="max">Max</label
                  ><input
                    hlmInput
                    id="max"
                    inputmode="decimal"
                    [value]="attr.max ?? ''"
                    (change)="setNumber('max', $any($event.target).value)"
                  />
                </div>
              </div>
            }
            <div class="flex flex-wrap gap-6">
              <div hlmField orientation="horizontal">
                <hlm-switch
                  inputId="field-required"
                  [checked]="!!attr.required"
                  (checkedChange)="patchAttribute({ required: $event || undefined })"
                />
                <label hlmFieldLabel for="field-required">Required</label>
              </div>
              @if (uniqueTypes.has(attr.type)) {
                <div hlmField orientation="horizontal">
                  <hlm-switch
                    inputId="field-unique"
                    [checked]="!!attr.unique"
                    (checkedChange)="patchAttribute({ unique: $event || undefined })"
                  />
                  <label hlmFieldLabel for="field-unique">Unique</label>
                </div>
              }
              @if (!isComponent()) {
                <div hlmField orientation="horizontal">
                  <hlm-switch
                    inputId="field-private"
                    [checked]="!!attr.private"
                    (checkedChange)="patchAttribute({ private: $event || undefined })"
                  />
                  <label hlmFieldLabel for="field-private">Private</label>
                </div>
              }
            </div>
          </div>
          <hlm-dialog-footer>
            <button hlmBtn variant="outline" (click)="attributeDraft.set(null)">Cancel</button>
            <button hlmBtn [disabled]="!field.name" (click)="commitAttribute()">Done</button>
          </hlm-dialog-footer>
        }
      </hlm-dialog-content>
    </hlm-dialog>

    <!-- Plan dialog -->
    <hlm-dialog [state]="planResult() ? 'open' : 'closed'" (closed)="planResult.set(null)">
      <hlm-dialog-content *hlmDialogPortal="let ctx" class="sm:max-w-3xl">
        @if (planResult(); as result) {
          <hlm-dialog-header>
            <h2 hlmDialogTitle>
              {{ result.valid ? 'Review the migration' : 'The schema is invalid' }}
            </h2>
            <p hlmDialogDescription>
              @if (result.valid) {
                {{
                  result.steps?.length
                    ? 'Applying writes the schema files and runs these steps.'
                    : 'No database changes needed.'
                }}
              } @else {
                Fix these problems first.
              }
            </p>
          </hlm-dialog-header>
          <div class="flex max-h-[60vh] flex-col gap-3 overflow-auto">
            @for (error of result.errors ?? []; track $index) {
              <div hlmAlert variant="destructive">
                <p hlmAlertDescription>
                  <code>{{ error.path }}</code> {{ error.message }}
                </p>
              </div>
            }
            @for (hint of result.hints ?? []; track hint) {
              <div hlmField orientation="horizontal">
                <hlm-checkbox
                  [inputId]="'hint-' + $index"
                  [checked]="acceptedHints().includes(hint)"
                  (checkedChange)="toggleHint(hint, $event === true)"
                />
                <label hlmFieldLabel [for]="'hint-' + $index"
                  >Treat as a rename (keeps the data):
                  <code>{{
                    hint.replace('--rename-column ', '').replace('--rename-table ', '')
                  }}</code></label
                >
              </div>
            }
            @for (step of result.steps ?? []; track $index) {
              <div class="rounded-md border p-3">
                <div class="flex items-center gap-2">
                  <span
                    hlmBadge
                    [variant]="
                      step.risk === 'destructive'
                        ? 'destructive'
                        : step.risk === 'risky'
                          ? 'outline'
                          : 'secondary'
                    "
                    >{{ step.risk }}</span
                  >
                  <span class="text-sm">{{ step.description }}</span>
                </div>
                <details class="mt-2">
                  <summary class="text-muted-foreground cursor-pointer text-xs">SQL</summary>
                  <pre class="bg-muted mt-1 overflow-auto rounded p-2 text-xs">{{
                    step.statements.join(
                      ';
'
                    )
                  }}</pre>
                </details>
              </div>
            }
          </div>
          <hlm-dialog-footer>
            <button hlmBtn variant="outline" (click)="planResult.set(null)">Cancel</button>
            @if (result.valid) {
              @if (acceptedHints().length) {
                <button hlmBtn variant="secondary" (click)="plan()">Re-plan with renames</button>
              }
              <button
                hlmBtn
                [variant]="result.requires === 'destructive' ? 'destructive' : 'default'"
                [disabled]="busy()"
                (click)="apply(result)"
              >
                @if (busy()) {
                  <hlm-spinner />
                }
                Apply
              </button>
            }
          </hlm-dialog-footer>
        }
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class Builder {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  protected readonly schema = inject(Schema);

  /** A content type's singularName, `component:category.name`, `new` or `new-component`. */
  readonly name = input<string>();

  protected readonly types = TYPES;
  protected readonly relations = RELATIONS;
  protected readonly lengthTypes = LENGTH_TYPES;
  protected readonly numberTypes = NUMBER_TYPES;
  protected readonly uniqueTypes = UNIQUE_TYPES;
  protected readonly kebab = kebab;
  protected readonly camel = camel;

  protected readonly sources = signal<Sources | null>(null);
  protected readonly draft = signal<SchemaFile | null>(null);
  protected readonly componentUid = signal('');
  protected readonly attributeDraft = signal<AttributeDraft | null>(null);
  /** Inverse attributes to add to other types on save: `{ singularName: { name: attribute } }`. */
  private readonly inverseAdditions = signal<Record<string, Record<string, Attribute>>>({});
  protected readonly planResult = signal<SchemaPlan | null>(null);
  protected readonly acceptedHints = signal<string[]>([]);
  protected readonly busy = signal(false);

  protected readonly isComponent = computed(() => {
    const name = this.name() ?? '';
    return name === 'new-component' || name.startsWith('component:');
  });
  protected readonly isNew = computed(() => ['new', 'new-component'].includes(this.name() ?? ''));
  protected readonly draftAndPublish = computed(
    () =>
      !!(this.draft()?.['options'] as { draftAndPublish?: boolean } | undefined)?.draftAndPublish,
  );
  protected readonly typeEntries = computed(() =>
    Object.entries(this.sources()?.contentTypes ?? {}).map(([key, file]) => ({
      key,
      label: String(file['displayName'] ?? key),
    })),
  );
  protected readonly componentEntries = computed(() =>
    Object.entries(this.sources()?.components ?? {}).map(([uid, file]) => ({
      key: `component:${uid}`,
      uid,
      label: `${file['displayName'] ?? uid} (${uid})`,
    })),
  );
  protected readonly attributeEntries = computed(() =>
    Object.entries(this.draft()?.attributes ?? {}).map(([name, attribute]) => ({
      name,
      attribute,
    })),
  );

  constructor() {
    void this.reloadSources();
    effect(() => {
      const name = this.name();
      const sources = this.sources();
      untracked(() => this.open(name, sources));
    });
  }

  private async reloadSources(): Promise<void> {
    try {
      this.sources.set(await this.api.get<Sources>('/schema'));
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    }
  }

  private open(name: string | undefined, sources: Sources | null): void {
    this.inverseAdditions.set({});
    this.acceptedHints.set([]);
    if (!sources) return;
    if (!name) {
      const first = Object.keys(sources.contentTypes)[0];
      if (first) void this.router.navigate(['/builder', first], { replaceUrl: true });
      else void this.router.navigate(['/builder', 'new'], { replaceUrl: true });
      return;
    }
    if (name === 'new') {
      this.draft.set({
        kind: 'collectionType',
        displayName: '',
        singularName: '',
        pluralName: '',
        options: { draftAndPublish: true },
        attributes: {},
      });
    } else if (name === 'new-component') {
      this.componentUid.set('');
      this.draft.set({ displayName: '', attributes: {} });
    } else if (name.startsWith('component:')) {
      const uid = name.slice('component:'.length);
      this.componentUid.set(uid);
      this.draft.set(structuredClone(sources.components[uid] ?? null));
    } else {
      this.draft.set(structuredClone(sources.contentTypes[name] ?? null));
    }
  }

  protected setFileValue(key: string, value: unknown): void {
    this.draft.update((file) => (file ? { ...file, [key]: value } : file));
  }

  protected setDisplayName(value: string): void {
    this.setFileValue('displayName', value);
    if (!this.isNew()) return;
    if (this.isComponent()) {
      const current = this.componentUid();
      const category = current.includes('.') ? current.split('.')[0] : 'shared';
      this.componentUid.set(`${category}.${kebab(value)}`);
    } else {
      const singular = kebab(value);
      this.setFileValue('singularName', singular);
      this.setFileValue('pluralName', singular ? plural(singular) : '');
    }
  }

  protected setDraftAndPublish(value: boolean): void {
    const file = this.draft();
    if (file)
      this.setFileValue('options', {
        ...((file['options'] as object) ?? {}),
        draftAndPublish: value,
      });
  }

  protected summary(attribute: Attribute): string {
    const parts: string[] = [];
    if (attribute.required) parts.push('required');
    if (attribute.unique) parts.push('unique');
    if (attribute.private) parts.push('private');
    if (attribute.relation)
      parts.push(
        `${attribute.relation} → ${attribute.target}${attribute.mappedBy ? ` (via ${attribute.mappedBy})` : ''}`,
      );
    if (attribute.component)
      parts.push(`${attribute.component}${attribute.repeatable ? ' ×n' : ''}`);
    if (attribute.components) parts.push(attribute.components.join(', '));
    if (attribute.enum) parts.push(attribute.enum.join(' | '));
    if (attribute.maxLength !== undefined) parts.push(`≤ ${attribute.maxLength} chars`);
    if (attribute.targetField) parts.push(`from ${attribute.targetField}`);
    return parts.join(' · ');
  }

  protected editAttribute(name: string | null): void {
    const attribute = name ? this.draft()?.attributes[name] : undefined;
    this.attributeDraft.set({
      originalName: name,
      name: name ?? '',
      attribute: attribute ? structuredClone(attribute) : { type: 'string' },
      inverseName: '',
    });
  }

  protected patchField(changes: Partial<AttributeDraft>): void {
    this.attributeDraft.update((field) => (field ? { ...field, ...changes } : field));
  }

  protected patchAttribute(changes: Partial<Attribute>): void {
    this.attributeDraft.update((field) => {
      if (!field) return field;
      const attribute = { ...field.attribute, ...changes };
      for (const key of Object.keys(attribute) as (keyof Attribute)[])
        if (attribute[key] === undefined) delete attribute[key];
      return { ...field, attribute };
    });
  }

  protected setType(type: AttributeType): void {
    const base: Attribute = { type };
    if (type === 'relation') Object.assign(base, { relation: 'manyToOne', target: '' });
    if (type === 'enumeration') base.enum = ['option-a', 'option-b'];
    if (type === 'dynamiczone') base.components = [];
    this.attributeDraft.update((field) =>
      field ? { ...field, attribute: { ...base, required: field.attribute.required } } : field,
    );
  }

  protected setEnum(text: string): void {
    this.patchAttribute({
      enum: text
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    });
  }

  protected setNumber(key: 'min' | 'max' | 'minLength' | 'maxLength', text: string): void {
    const value = text.trim() === '' ? undefined : Number(text);
    this.patchAttribute({
      [key]: value !== undefined && Number.isFinite(value) ? value : undefined,
    });
  }

  protected toggleZoneComponent(uid: string, checked: boolean): void {
    const current = this.attributeDraft()?.attribute.components ?? [];
    this.patchAttribute({
      components: checked ? [...current, uid] : current.filter((item) => item !== uid),
    });
  }

  protected isBidirectional(attribute: Attribute): boolean {
    return (
      RELATIONS.find((relation) => relation.kind === attribute.relation)?.bidirectional ?? false
    );
  }

  /** Writes the field into the draft (renames keep position), and plans its inverse side. */
  protected commitAttribute(): void {
    const field = this.attributeDraft();
    const file = this.draft();
    if (!field || !file) return;
    const attribute = { ...field.attribute };
    const entries = Object.entries(file.attributes);
    const index = field.originalName
      ? entries.findIndex(([name]) => name === field.originalName)
      : -1;
    if (
      attribute.type === 'relation' &&
      field.inverseName &&
      this.isBidirectional(attribute) &&
      attribute.target
    ) {
      attribute.inversedBy = field.inverseName;
      const targetName = attribute.target.replace(/^api::/, '');
      const selfName = this.isComponent() ? '' : String(file['singularName']);
      this.inverseAdditions.update((additions) => ({
        ...additions,
        [targetName]: {
          ...(additions[targetName] ?? {}),
          [field.inverseName]: {
            type: 'relation',
            relation: INVERSE[attribute.relation as RelationKind],
            target: `api::${selfName}`,
            mappedBy: field.name,
          },
        },
      }));
    }
    if (index >= 0) entries[index] = [field.name, attribute];
    else entries.push([field.name, attribute]);
    this.setFileValue('attributes', Object.fromEntries(entries));
    this.attributeDraft.set(null);
  }

  protected removeAttribute(name: string): void {
    const file = this.draft();
    if (!file) return;
    const { [name]: _removed, ...rest } = file.attributes;
    this.setFileValue('attributes', rest);
  }

  protected moveAttribute(index: number, delta: number): void {
    const file = this.draft();
    if (!file) return;
    const entries = Object.entries(file.attributes);
    const [entry] = entries.splice(index, 1);
    entries.splice(index + delta, 0, entry);
    this.setFileValue('attributes', Object.fromEntries(entries));
  }

  protected toggleHint(hint: string, checked: boolean): void {
    this.acceptedHints.update((hints) =>
      checked ? [...hints, hint] : hints.filter((item) => item !== hint),
    );
  }

  private change(remove = false): Change {
    const file = this.draft();
    const sources = this.sources();
    const change: Change = {
      contentTypes: {},
      components: {},
      renameTables: [],
      renameColumns: [],
    };
    for (const hint of this.acceptedHints()) {
      if (hint.startsWith('--rename-column '))
        change.renameColumns.push(hint.slice('--rename-column '.length));
      if (hint.startsWith('--rename-table '))
        change.renameTables.push(hint.slice('--rename-table '.length));
    }
    if (!file || !sources) return change;
    if (this.isComponent()) {
      change.components[this.componentUid()] = remove ? null : file;
    } else {
      change.contentTypes[String(file['singularName'])] = remove ? null : file;
    }
    for (const [target, attributes] of Object.entries(this.inverseAdditions())) {
      const existing = change.contentTypes[target] ?? sources.contentTypes[target];
      if (existing)
        change.contentTypes[target] = {
          ...existing,
          attributes: { ...existing.attributes, ...attributes },
        };
    }
    return change;
  }

  private pendingRemoval = false;

  protected async plan(remove = this.pendingRemoval): Promise<void> {
    this.pendingRemoval = remove;
    this.busy.set(true);
    try {
      this.planResult.set(await this.api.post<SchemaPlan>('/schema/plan', this.change(remove)));
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected remove(): void {
    void this.plan(true);
  }

  protected async apply(result: SchemaPlan): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.post('/schema/apply', {
        ...this.change(this.pendingRemoval),
        allow: result.requires ?? 'safe',
      });
      toast.success('Schema updated');
      const removed = this.pendingRemoval;
      this.pendingRemoval = false;
      this.planResult.set(null);
      await Promise.all([this.schema.load(), this.reloadSources()]);
      const file = this.draft();
      if (removed) await this.router.navigate(['/builder']);
      else if (this.isComponent())
        await this.router.navigate(['/builder', `component:${this.componentUid()}`]);
      else if (file) await this.router.navigate(['/builder', String(file['singularName'])]);
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
