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
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';

import { Api, ApiFailure } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/keys';
import { Schema } from '../../core/schema';
import {
  Attribute,
  AttributeType,
  MediaKind,
  PlanStep,
  RelationKind,
  SchemaPlan,
} from '../../core/types';
import { PageHeader } from '../../shared/components/page-header';

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

interface TypeInfo {
  type: AttributeType;
  icon: string;
  label: MessageKey;
  description: MessageKey;
}

/** The attribute types, in picker order, with their icon and message keys. */
const TYPE_INFO: TypeInfo[] = [
  {
    type: 'string',
    icon: 'lucideType',
    label: 'builder.types.string',
    description: 'builder.types.string.description',
  },
  {
    type: 'text',
    icon: 'lucideText',
    label: 'builder.types.text',
    description: 'builder.types.text.description',
  },
  {
    type: 'richtext',
    icon: 'lucideFileText',
    label: 'builder.types.richtext',
    description: 'builder.types.richtext.description',
  },
  {
    type: 'email',
    icon: 'lucideMail',
    label: 'builder.types.email',
    description: 'builder.types.email.description',
  },
  {
    type: 'uid',
    icon: 'lucideFingerprint',
    label: 'builder.types.uid',
    description: 'builder.types.uid.description',
  },
  {
    type: 'integer',
    icon: 'lucideHash',
    label: 'builder.types.integer',
    description: 'builder.types.integer.description',
  },
  {
    type: 'biginteger',
    icon: 'lucideHash',
    label: 'builder.types.biginteger',
    description: 'builder.types.biginteger.description',
  },
  {
    type: 'float',
    icon: 'lucideHash',
    label: 'builder.types.float',
    description: 'builder.types.float.description',
  },
  {
    type: 'decimal',
    icon: 'lucideHash',
    label: 'builder.types.decimal',
    description: 'builder.types.decimal.description',
  },
  {
    type: 'boolean',
    icon: 'lucideToggleLeft',
    label: 'builder.types.boolean',
    description: 'builder.types.boolean.description',
  },
  {
    type: 'date',
    icon: 'lucideCalendar',
    label: 'builder.types.date',
    description: 'builder.types.date.description',
  },
  {
    type: 'time',
    icon: 'lucideClock',
    label: 'builder.types.time',
    description: 'builder.types.time.description',
  },
  {
    type: 'datetime',
    icon: 'lucideCalendarClock',
    label: 'builder.types.datetime',
    description: 'builder.types.datetime.description',
  },
  {
    type: 'enumeration',
    icon: 'lucideList',
    label: 'builder.types.enumeration',
    description: 'builder.types.enumeration.description',
  },
  {
    type: 'json',
    icon: 'lucideBraces',
    label: 'builder.types.json',
    description: 'builder.types.json.description',
  },
  {
    type: 'media',
    icon: 'lucideImage',
    label: 'builder.types.media',
    description: 'builder.types.media.description',
  },
  {
    type: 'relation',
    icon: 'lucideLink',
    label: 'builder.types.relation',
    description: 'builder.types.relation.description',
  },
  {
    type: 'component',
    icon: 'lucideBlocks',
    label: 'builder.types.component',
    description: 'builder.types.component.description',
  },
  {
    type: 'dynamiczone',
    icon: 'lucideLayers',
    label: 'builder.types.dynamiczone',
    description: 'builder.types.dynamiczone.description',
  },
];
const TYPE_BY_NAME = new Map(TYPE_INFO.map((info) => [info.type, info]));
/** Types the server rejects inside components. */
const NOT_IN_COMPONENTS = new Set<AttributeType>(['media']);

const MEDIA_KINDS: { kind: MediaKind; label: MessageKey }[] = [
  { kind: 'images', label: 'builder.field.mediaKind.images' },
  { kind: 'videos', label: 'builder.field.mediaKind.videos' },
  { kind: 'audios', label: 'builder.field.mediaKind.audios' },
  { kind: 'files', label: 'builder.field.mediaKind.files' },
];

const RELATIONS: { kind: RelationKind; label: MessageKey; bidirectional: boolean }[] = [
  { kind: 'manyToOne', label: 'builder.relations.manyToOne', bidirectional: true },
  { kind: 'oneToMany', label: 'builder.relations.oneToMany', bidirectional: true },
  { kind: 'manyToMany', label: 'builder.relations.manyToMany', bidirectional: true },
  { kind: 'oneToOne', label: 'builder.relations.oneToOne', bidirectional: true },
  { kind: 'oneWay', label: 'builder.relations.oneWay', bidirectional: false },
  { kind: 'manyWay', label: 'builder.relations.manyWay', bidirectional: false },
];
const RISK_LABELS: Record<PlanStep['risk'], MessageKey> = {
  safe: 'builder.risk.safe',
  risky: 'builder.risk.risky',
  destructive: 'builder.risk.destructive',
};
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

/** Splits a message on backticks: odd segments are code. */
function segments(text: string): string[] {
  return text.split('`');
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
    PageHeader,
    HlmButtonImports,
    HlmBadgeImports,
    HlmCardImports,
    HlmFieldImports,
    HlmInputImports,
    HlmNativeSelectImports,
    HlmSwitchImports,
    HlmCheckboxImports,
    HlmToggleGroupImports,
    HlmDialogImports,
    HlmAlertImports,
    HlmSpinnerImports,
    HlmEmptyImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!schema.devMode()) {
      <div hlmAlert>
        <ng-icon name="lucideInfo" />
        <p hlmAlertTitle>{{ t('builder.devOnly.title') }}</p>
        <p hlmAlertDescription>
          @for (part of segments(t('builder.devOnly.description')); track $index) {
            @if ($odd) {
              <code class="bg-muted rounded px-1 py-0.5 font-mono text-xs">{{ part }}</code>
            } @else {
              {{ part }}
            }
          }
        </p>
      </div>
    } @else if (!sources()) {
      <div class="flex justify-center py-16"><hlm-spinner /></div>
    } @else {
      <div class="grid items-start gap-6 lg:grid-cols-[16rem_1fr]">
        <aside
          class="bg-card flex flex-col gap-4 rounded-xl border p-3 shadow-xs lg:sticky lg:top-4"
        >
          <nav class="flex flex-col gap-1" [attr.aria-label]="t('builder.sidebar.contentTypes')">
            <div class="flex items-center justify-between gap-2 px-2 pb-1">
              <h2 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {{ t('builder.sidebar.contentTypes') }}
              </h2>
              <a
                hlmBtn
                size="icon-xs"
                variant="ghost"
                routerLink="/builder/new"
                [attr.aria-label]="t('builder.sidebar.newContentType')"
                [attr.title]="t('builder.sidebar.newContentType')"
                ><ng-icon name="lucidePlus"
              /></a>
            </div>
            @for (entry of typeEntries(); track entry.key) {
              <a
                class="hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors"
                [class.bg-primary/10]="name() === entry.key"
                [class.text-primary]="name() === entry.key"
                [class.font-medium]="name() === entry.key"
                [attr.aria-current]="name() === entry.key ? 'page' : null"
                [routerLink]="['/builder', entry.key]"
              >
                <ng-icon
                  [name]="entry.single ? 'lucideFile' : 'lucideDatabase'"
                  size="16"
                  class="shrink-0 opacity-70"
                />
                <span class="truncate">{{ entry.label }}</span>
                @if (entry.single) {
                  <span class="text-muted-foreground ms-auto text-xs">{{
                    t('builder.sidebar.single')
                  }}</span>
                }
              </a>
            } @empty {
              <p class="text-muted-foreground px-2 py-1 text-sm">
                {{ t('builder.sidebar.noContentTypes') }}
              </p>
            }
          </nav>
          <div class="border-t"></div>
          <nav class="flex flex-col gap-1" [attr.aria-label]="t('builder.sidebar.components')">
            <div class="flex items-center justify-between gap-2 px-2 pb-1">
              <h2 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {{ t('builder.sidebar.components') }}
              </h2>
              <a
                hlmBtn
                size="icon-xs"
                variant="ghost"
                routerLink="/builder/new-component"
                [attr.aria-label]="t('builder.sidebar.newComponent')"
                [attr.title]="t('builder.sidebar.newComponent')"
                ><ng-icon name="lucidePlus"
              /></a>
            </div>
            @for (entry of componentEntries(); track entry.key) {
              <a
                class="hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors"
                [class.bg-primary/10]="name() === entry.key"
                [class.text-primary]="name() === entry.key"
                [class.font-medium]="name() === entry.key"
                [attr.aria-current]="name() === entry.key ? 'page' : null"
                [routerLink]="['/builder', entry.key]"
              >
                <ng-icon name="lucideBlocks" size="16" class="shrink-0 opacity-70" />
                <span class="flex min-w-0 flex-col">
                  <span class="truncate">{{ entry.displayName }}</span>
                  <span class="text-muted-foreground truncate font-mono text-xs font-normal">{{
                    entry.uid
                  }}</span>
                </span>
              </a>
            } @empty {
              <p class="text-muted-foreground px-2 py-1 text-sm">
                {{ t('builder.sidebar.noComponents') }}
              </p>
            }
          </nav>
        </aside>

        @if (draft(); as file) {
          <section class="flex min-w-0 flex-col gap-6">
            <vd-page-header [title]="headerTitle()" [description]="headerDescription()">
              <div actions>
                @if (!isNew()) {
                  <button hlmBtn variant="ghost" (click)="remove()" [disabled]="busy()">
                    <ng-icon name="lucideTrash2" /> {{ t('common.delete') }}
                  </button>
                }
                <button hlmBtn (click)="plan()" [disabled]="busy()">
                  @if (busy()) {
                    <hlm-spinner />
                  } @else {
                    <ng-icon name="lucideSave" />
                  }
                  {{ t('common.save') }}
                </button>
              </div>
            </vd-page-header>

            <section hlmCard>
              <div hlmCardHeader>
                <h2 hlmCardTitle>{{ t('builder.settings.title') }}</h2>
              </div>
              <div hlmCardContent class="grid gap-4 sm:grid-cols-2">
                <div hlmField>
                  <label hlmFieldLabel for="display-name">{{
                    t('builder.settings.displayName')
                  }}</label>
                  <input
                    hlmInput
                    id="display-name"
                    [value]="file['displayName'] ?? ''"
                    (input)="setDisplayName($any($event.target).value)"
                  />
                </div>
                @if (isComponent()) {
                  <div hlmField>
                    <label hlmFieldLabel for="component-uid">{{
                      t('builder.settings.componentUid')
                    }}</label>
                    <input
                      hlmInput
                      id="component-uid"
                      class="font-mono"
                      [value]="componentUid()"
                      [disabled]="!isNew()"
                      (input)="componentUid.set($any($event.target).value)"
                    />
                    <p hlmFieldDescription>
                      @for (
                        part of segments(t('builder.settings.componentUidHint'));
                        track $index
                      ) {
                        @if ($odd) {
                          <code>{{ part }}</code>
                        } @else {
                          {{ part }}
                        }
                      }
                    </p>
                  </div>
                } @else {
                  <div hlmField>
                    <label hlmFieldLabel for="singular">{{ t('builder.settings.singular') }}</label>
                    <input
                      hlmInput
                      id="singular"
                      class="font-mono"
                      [value]="file['singularName'] ?? ''"
                      [disabled]="!isNew()"
                      (input)="setFileValue('singularName', kebab($any($event.target).value))"
                    />
                    @if (!isNew()) {
                      <p hlmFieldDescription>{{ t('builder.settings.lockedHint') }}</p>
                    }
                  </div>
                  <div hlmField>
                    <label hlmFieldLabel for="plural">{{ t('builder.settings.plural') }}</label>
                    <input
                      hlmInput
                      id="plural"
                      class="font-mono"
                      [value]="file['pluralName'] ?? ''"
                      [disabled]="!isNew()"
                      (input)="setFileValue('pluralName', kebab($any($event.target).value))"
                    />
                    @if (!isNew()) {
                      <p hlmFieldDescription>{{ t('builder.settings.lockedHint') }}</p>
                    }
                  </div>
                  <div hlmField>
                    <span hlmFieldLabel>{{ t('builder.settings.kind') }}</span>
                    <hlm-toggle-group
                      type="single"
                      variant="outline"
                      [value]="file['kind']"
                      (valueChange)="$event && setFileValue('kind', $event)"
                    >
                      <button hlmToggleGroupItem value="collectionType">
                        <ng-icon name="lucideDatabase" size="16" />
                        {{ t('builder.settings.collection') }}
                      </button>
                      <button hlmToggleGroupItem value="singleType">
                        <ng-icon name="lucideFile" size="16" />
                        {{ t('builder.settings.single') }}
                      </button>
                    </hlm-toggle-group>
                  </div>
                  <div hlmField orientation="horizontal" class="self-end">
                    <hlm-switch
                      inputId="dp"
                      [checked]="draftAndPublish()"
                      (checkedChange)="setDraftAndPublish($event)"
                    />
                    <div hlmFieldContent>
                      <label hlmFieldLabel for="dp">{{
                        t('builder.settings.draftAndPublish')
                      }}</label>
                      <p hlmFieldDescription>{{ t('builder.settings.draftAndPublishHint') }}</p>
                    </div>
                  </div>
                }
              </div>
            </section>

            <section hlmCard>
              <div hlmCardHeader>
                <h2 hlmCardTitle>{{ t('builder.fields.title') }}</h2>
                <p hlmCardDescription>
                  {{ t('builder.fields.count', { count: attributeEntries().length }) }}
                </p>
                <div hlmCardAction>
                  <button hlmBtn size="sm" variant="outline" (click)="editAttribute(null)">
                    <ng-icon name="lucidePlus" /> {{ t('builder.fields.add') }}
                  </button>
                </div>
              </div>
              <div hlmCardContent>
                @if (attributeEntries().length) {
                  <ul class="divide-y rounded-lg border">
                    @for (entry of attributeEntries(); track entry.name; let index = $index) {
                      @let info = typeInfo(entry.attribute.type);
                      <li class="hover:bg-muted/40 flex items-center gap-3 px-3 py-2.5">
                        <span
                          class="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-md"
                        >
                          <ng-icon [name]="info?.icon ?? 'lucideType'" size="16" />
                        </span>
                        <div class="flex min-w-0 flex-1 flex-col">
                          <span class="flex flex-wrap items-center gap-1.5">
                            <span class="truncate font-mono text-sm font-medium">{{
                              entry.name
                            }}</span>
                            <span hlmBadge variant="secondary">{{
                              info ? t(info.label) : entry.attribute.type
                            }}</span>
                            @if (entry.attribute.required) {
                              <span hlmBadge variant="outline">{{
                                t('builder.fields.required')
                              }}</span>
                            }
                            @if (entry.attribute.unique) {
                              <span hlmBadge variant="outline">{{
                                t('builder.fields.unique')
                              }}</span>
                            }
                            @if (entry.attribute.private) {
                              <span hlmBadge variant="outline">
                                <ng-icon name="lucideEyeOff" />
                                {{ t('builder.fields.private') }}
                              </span>
                            }
                            @if (entry.attribute.multiple) {
                              <span hlmBadge variant="outline">{{
                                t('builder.fields.multiple')
                              }}</span>
                            }
                            @if (entry.attribute.repeatable) {
                              <span hlmBadge variant="outline">{{
                                t('builder.fields.repeatable')
                              }}</span>
                            }
                          </span>
                          @if (summary(entry.attribute); as text) {
                            <span class="text-muted-foreground truncate text-xs">{{ text }}</span>
                          }
                        </div>
                        <div class="flex shrink-0 items-center gap-0.5">
                          <button
                            hlmBtn
                            size="icon-xs"
                            variant="ghost"
                            [attr.aria-label]="t('builder.fields.moveUp')"
                            [attr.title]="t('builder.fields.moveUp')"
                            [disabled]="index === 0"
                            (click)="moveAttribute(index, -1)"
                          >
                            <ng-icon name="lucideArrowUp" />
                          </button>
                          <button
                            hlmBtn
                            size="icon-xs"
                            variant="ghost"
                            [attr.aria-label]="t('builder.fields.moveDown')"
                            [attr.title]="t('builder.fields.moveDown')"
                            [disabled]="index === attributeEntries().length - 1"
                            (click)="moveAttribute(index, 1)"
                          >
                            <ng-icon name="lucideArrowDown" />
                          </button>
                          <button
                            hlmBtn
                            size="icon-xs"
                            variant="ghost"
                            [attr.aria-label]="t('builder.fields.edit', { name: entry.name })"
                            [attr.title]="t('builder.fields.edit', { name: entry.name })"
                            (click)="editAttribute(entry.name)"
                          >
                            <ng-icon name="lucidePencil" />
                          </button>
                          <button
                            hlmBtn
                            size="icon-xs"
                            variant="ghost"
                            class="hover:text-destructive"
                            [attr.aria-label]="t('builder.fields.remove', { name: entry.name })"
                            [attr.title]="t('builder.fields.remove', { name: entry.name })"
                            (click)="removeAttribute(entry.name)"
                          >
                            <ng-icon name="lucideTrash2" />
                          </button>
                        </div>
                      </li>
                    }
                  </ul>
                } @else {
                  <div hlmEmpty class="rounded-lg border border-dashed">
                    <div hlmEmptyHeader>
                      <div hlmEmptyMedia variant="icon"><ng-icon name="lucideLayers" /></div>
                      <p hlmEmptyTitle>{{ t('builder.fields.empty') }}</p>
                      <p hlmEmptyDescription>{{ t('builder.fields.emptyHint') }}</p>
                    </div>
                  </div>
                }
              </div>
            </section>
          </section>
        }
      </div>
    }

    <!-- Field dialog -->
    <hlm-dialog [state]="attributeDraft() ? 'open' : 'closed'" (closed)="attributeDraft.set(null)">
      <hlm-dialog-content
        *hlmDialogPortal="let ctx"
        class="max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-2xl"
        [closeLabel]="t('common.close')"
      >
        @if (attributeDraft(); as field) {
          @let attr = field.attribute;
          <hlm-dialog-header>
            <h2 hlmDialogTitle>
              {{ field.originalName ? t('builder.field.editTitle') : t('builder.field.addTitle') }}
            </h2>
            <p hlmDialogDescription>{{ t('builder.field.description') }}</p>
          </hlm-dialog-header>
          <div class="-mx-6 flex flex-col gap-6 overflow-y-auto px-6">
            @if (!field.originalName) {
              <div class="flex flex-col gap-2">
                <h3 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  {{ t('builder.field.chooseKind') }}
                </h3>
                <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  @for (info of availableTypes(); track info.type) {
                    <button
                      type="button"
                      class="hover:bg-muted/60 focus-visible:ring-ring/50 flex items-start gap-2.5 rounded-lg border p-2.5 text-start transition-colors outline-none focus-visible:ring-[3px]"
                      [class.border-primary]="attr.type === info.type"
                      [class.bg-primary/5]="attr.type === info.type"
                      [attr.aria-pressed]="attr.type === info.type"
                      (click)="setType(info.type)"
                    >
                      <span
                        class="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-md"
                      >
                        <ng-icon [name]="info.icon" size="16" />
                      </span>
                      <span class="flex min-w-0 flex-col">
                        <span class="text-sm font-medium">{{ t(info.label) }}</span>
                        <span class="text-muted-foreground text-xs leading-snug">{{
                          t(info.description)
                        }}</span>
                      </span>
                    </button>
                  }
                </div>
                @if (isComponent()) {
                  <p class="text-muted-foreground flex items-center gap-1.5 text-xs">
                    <ng-icon name="lucideInfo" size="14" class="shrink-0" />
                    {{ t('builder.field.mediaInComponent') }}
                  </p>
                }
              </div>
            }

            <div class="flex flex-col gap-4">
              <h3 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {{ t('builder.field.configure') }}
              </h3>
              <div class="grid gap-4 sm:grid-cols-2">
                <div hlmField>
                  <label hlmFieldLabel for="field-name">{{ t('builder.field.name') }}</label>
                  <input
                    hlmInput
                    id="field-name"
                    class="font-mono"
                    [value]="field.name"
                    (input)="patchField({ name: camel($any($event.target).value) })"
                  />
                </div>
                <div hlmField>
                  <label hlmFieldLabel for="field-type">{{ t('builder.field.type') }}</label>
                  <hlm-native-select
                    selectId="field-type"
                    [value]="attr.type"
                    (valueChange)="setType($any($event))"
                  >
                    @for (info of availableTypes(); track info.type) {
                      <option hlmNativeSelectOption [value]="info.type">
                        {{ t(info.label) }}
                      </option>
                    }
                  </hlm-native-select>
                </div>
              </div>
              @if (attr.type === 'relation') {
                <div class="grid gap-4 sm:grid-cols-2">
                  <div hlmField>
                    <label hlmFieldLabel for="relation-kind">{{
                      t('builder.field.relation')
                    }}</label>
                    <hlm-native-select
                      selectId="relation-kind"
                      [value]="attr.relation ?? 'manyToOne'"
                      (valueChange)="patchAttribute({ relation: $any($event) })"
                    >
                      @for (relation of relations; track relation.kind) {
                        <option hlmNativeSelectOption [value]="relation.kind">
                          {{ t(relation.label) }}
                        </option>
                      }
                    </hlm-native-select>
                  </div>
                  <div hlmField>
                    <label hlmFieldLabel for="relation-target">{{
                      t('builder.field.target')
                    }}</label>
                    <hlm-native-select
                      selectId="relation-target"
                      [value]="attr.target ?? ''"
                      (valueChange)="patchAttribute({ target: $any($event) })"
                    >
                      <option hlmNativeSelectOption value="">
                        {{ t('builder.field.choose') }}
                      </option>
                      @for (entry of typeEntries(); track entry.key) {
                        <option hlmNativeSelectOption [value]="'api::' + entry.key">
                          {{ entry.label }}
                        </option>
                      }
                    </hlm-native-select>
                  </div>
                </div>
                @if (isBidirectional(attr) && !attr.mappedBy) {
                  <div hlmField>
                    <label hlmFieldLabel for="inverse-name">{{
                      t('builder.field.inverseName')
                    }}</label>
                    <input
                      hlmInput
                      id="inverse-name"
                      class="font-mono"
                      [value]="field.inverseName"
                      (input)="patchField({ inverseName: camel($any($event.target).value) })"
                    />
                    <p hlmFieldDescription>{{ t('builder.field.inverseHint') }}</p>
                  </div>
                }
              }
              @if (attr.type === 'component') {
                <div hlmField>
                  <label hlmFieldLabel for="field-component">{{
                    t('builder.field.component')
                  }}</label>
                  <hlm-native-select
                    selectId="field-component"
                    [value]="attr.component ?? ''"
                    (valueChange)="patchAttribute({ component: $any($event) })"
                  >
                    <option hlmNativeSelectOption value="">{{ t('builder.field.choose') }}</option>
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
                  <label hlmFieldLabel for="field-repeatable">{{
                    t('builder.field.repeatable')
                  }}</label>
                </div>
              }
              @if (attr.type === 'dynamiczone') {
                <fieldset hlmFieldSet>
                  <legend hlmFieldLegend>{{ t('builder.field.allowedComponents') }}</legend>
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
                      <p class="text-muted-foreground text-sm">
                        {{ t('builder.field.noComponents') }}
                      </p>
                    }
                  </div>
                </fieldset>
              }
              @if (attr.type === 'media') {
                <div hlmField orientation="horizontal">
                  <hlm-switch
                    inputId="field-multiple"
                    [checked]="!!attr.multiple"
                    (checkedChange)="patchAttribute({ multiple: $event || undefined })"
                  />
                  <div hlmFieldContent>
                    <label hlmFieldLabel for="field-multiple">{{
                      t('builder.field.multiple')
                    }}</label>
                    <p hlmFieldDescription>{{ t('builder.field.multipleHint') }}</p>
                  </div>
                </div>
                <fieldset hlmFieldSet>
                  <legend hlmFieldLegend variant="label">
                    {{ t('builder.field.allowedTypes') }}
                  </legend>
                  <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    @for (media of mediaKinds; track media.kind) {
                      @let checked = allowsMedia(attr, media.kind);
                      <div hlmField orientation="horizontal">
                        <hlm-checkbox
                          [inputId]="'media-' + media.kind"
                          [checked]="checked"
                          [disabled]="checked && allowedMediaCount(attr) === 1"
                          (checkedChange)="toggleMediaKind(media.kind, $event === true)"
                        />
                        <label hlmFieldLabel [for]="'media-' + media.kind">{{
                          t(media.label)
                        }}</label>
                      </div>
                    }
                  </div>
                </fieldset>
              }
              @if (attr.type === 'enumeration') {
                <div hlmField>
                  <label hlmFieldLabel for="field-enum">{{ t('builder.field.enum') }}</label>
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
                  <label hlmFieldLabel for="field-target">{{
                    t('builder.field.generatedFrom')
                  }}</label>
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
                    <label hlmFieldLabel for="min-length">{{ t('builder.field.minLength') }}</label
                    ><input
                      hlmInput
                      id="min-length"
                      inputmode="numeric"
                      [value]="attr.minLength ?? ''"
                      (change)="setNumber('minLength', $any($event.target).value)"
                    />
                  </div>
                  <div hlmField>
                    <label hlmFieldLabel for="max-length">{{ t('builder.field.maxLength') }}</label
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
                    <label hlmFieldLabel for="min">{{ t('builder.field.min') }}</label
                    ><input
                      hlmInput
                      id="min"
                      inputmode="decimal"
                      [value]="attr.min ?? ''"
                      (change)="setNumber('min', $any($event.target).value)"
                    />
                  </div>
                  <div hlmField>
                    <label hlmFieldLabel for="max">{{ t('builder.field.max') }}</label
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
              <div class="bg-muted/40 flex flex-wrap gap-x-6 gap-y-3 rounded-lg border p-3">
                <div hlmField orientation="horizontal" class="w-auto">
                  <hlm-switch
                    inputId="field-required"
                    [checked]="!!attr.required"
                    (checkedChange)="patchAttribute({ required: $event || undefined })"
                  />
                  <label hlmFieldLabel for="field-required">{{
                    t('builder.field.required')
                  }}</label>
                </div>
                @if (uniqueTypes.has(attr.type)) {
                  <div hlmField orientation="horizontal" class="w-auto">
                    <hlm-switch
                      inputId="field-unique"
                      [checked]="!!attr.unique"
                      (checkedChange)="patchAttribute({ unique: $event || undefined })"
                    />
                    <label hlmFieldLabel for="field-unique">{{ t('builder.field.unique') }}</label>
                  </div>
                }
                @if (!isComponent()) {
                  <div hlmField orientation="horizontal" class="w-auto">
                    <hlm-switch
                      inputId="field-private"
                      [checked]="!!attr.private"
                      (checkedChange)="patchAttribute({ private: $event || undefined })"
                    />
                    <label hlmFieldLabel for="field-private">{{
                      t('builder.field.private')
                    }}</label>
                  </div>
                }
              </div>
            </div>
          </div>
          <hlm-dialog-footer>
            <button hlmBtn variant="outline" (click)="attributeDraft.set(null)">
              {{ t('common.cancel') }}
            </button>
            <button hlmBtn [disabled]="!field.name" (click)="commitAttribute()">
              <ng-icon name="lucideCheck" /> {{ t('builder.field.done') }}
            </button>
          </hlm-dialog-footer>
        }
      </hlm-dialog-content>
    </hlm-dialog>

    <!-- Plan dialog -->
    <hlm-dialog [state]="planResult() ? 'open' : 'closed'" (closed)="planResult.set(null)">
      <hlm-dialog-content
        *hlmDialogPortal="let ctx"
        class="max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-3xl"
        [closeLabel]="t('common.close')"
      >
        @if (planResult(); as result) {
          <hlm-dialog-header>
            <h2 hlmDialogTitle>
              {{ result.valid ? t('builder.plan.title') : t('builder.plan.invalidTitle') }}
            </h2>
            <p hlmDialogDescription>
              @if (result.valid) {
                {{
                  result.steps?.length ? t('builder.plan.description') : t('builder.plan.noChanges')
                }}
              } @else {
                {{ t('builder.plan.fixFirst') }}
              }
            </p>
          </hlm-dialog-header>
          <div class="-mx-6 flex flex-col gap-4 overflow-y-auto px-6">
            @for (error of result.errors ?? []; track $index) {
              <div hlmAlert variant="destructive">
                <ng-icon name="lucideCircleAlert" />
                <p hlmAlertDescription>
                  <code class="font-mono">{{ error.path }}</code> {{ error.message }}
                </p>
              </div>
            }
            @if (result.hints?.length) {
              <fieldset hlmFieldSet class="rounded-lg border p-3">
                <legend hlmFieldLegend variant="label" class="px-1">
                  {{ t('builder.plan.renames') }}
                </legend>
                <div hlmFieldGroup class="gap-3">
                  @for (hint of result.hints ?? []; track hint) {
                    <div hlmField orientation="horizontal">
                      <hlm-checkbox
                        [inputId]="'hint-' + $index"
                        [checked]="acceptedHints().includes(hint)"
                        (checkedChange)="toggleHint(hint, $event === true)"
                      />
                      <label hlmFieldLabel [for]="'hint-' + $index"
                        >{{ t('builder.plan.rename') }}
                        <code class="bg-muted rounded px-1 py-0.5 font-mono text-xs">{{
                          hint.replace('--rename-column ', '').replace('--rename-table ', '')
                        }}</code></label
                      >
                    </div>
                  }
                </div>
              </fieldset>
            }
            @if (result.valid && result.requires === 'destructive') {
              <div hlmAlert variant="destructive">
                <ng-icon name="lucideCircleAlert" />
                <p hlmAlertTitle>{{ t('builder.plan.destructiveWarning') }}</p>
              </div>
            }
            @if (result.steps?.length) {
              <div class="flex flex-col gap-2">
                <h3 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  {{ t('builder.plan.steps', { count: result.steps!.length }) }}
                </h3>
                <ol class="flex flex-col gap-2">
                  @for (step of result.steps ?? []; track $index) {
                    <li class="bg-card rounded-lg border">
                      <div class="flex items-start gap-3 p-3">
                        <span
                          class="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums"
                          >{{ $index + 1 }}</span
                        >
                        <span class="min-w-0 flex-1 pt-0.5 text-sm">{{ step.description }}</span>
                        <span
                          hlmBadge
                          class="shrink-0"
                          [variant]="
                            step.risk === 'destructive'
                              ? 'destructive'
                              : step.risk === 'risky'
                                ? 'outline'
                                : 'secondary'
                          "
                        >
                          @if (step.risk === 'risky') {
                            <span class="size-1.5 rounded-full bg-amber-500"></span>
                          }
                          {{ t(riskLabels[step.risk]) }}
                        </span>
                      </div>
                      @if (step.statements.length) {
                        <details class="group border-t">
                          <summary
                            class="text-muted-foreground hover:text-foreground flex cursor-pointer list-none items-center gap-1 px-3 py-2 text-xs font-medium select-none"
                          >
                            <ng-icon
                              name="lucideChevronRight"
                              size="14"
                              class="transition-transform group-open:rotate-90"
                            />
                            {{ t('builder.plan.sql') }}
                          </summary>
                          <pre
                            class="bg-muted mx-3 mb-3 max-h-64 overflow-auto rounded-md p-3 font-mono text-xs leading-relaxed"
                            >{{
                              step.statements.join(
                                ';
'
                              )
                            }}</pre>
                        </details>
                      }
                    </li>
                  }
                </ol>
              </div>
            }
          </div>
          <hlm-dialog-footer>
            <button hlmBtn variant="outline" (click)="planResult.set(null)">
              {{ t('common.cancel') }}
            </button>
            @if (result.valid) {
              @if (acceptedHints().length) {
                <button hlmBtn variant="secondary" (click)="plan()">
                  {{ t('builder.plan.replan') }}
                </button>
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
                {{ t('builder.plan.apply') }}
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
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  /** A content type's singularName, `component:category.name`, `new` or `new-component`. */
  readonly name = input<string>();

  protected readonly mediaKinds = MEDIA_KINDS;
  protected readonly riskLabels = RISK_LABELS;
  protected readonly segments = segments;
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
  /** The attribute types offered in the picker (components cannot hold media). */
  protected readonly availableTypes = computed(() =>
    this.isComponent() ? TYPE_INFO.filter((info) => !NOT_IN_COMPONENTS.has(info.type)) : TYPE_INFO,
  );
  protected readonly isNew = computed(() => ['new', 'new-component'].includes(this.name() ?? ''));
  protected readonly draftAndPublish = computed(
    () =>
      !!(this.draft()?.['options'] as { draftAndPublish?: boolean } | undefined)?.draftAndPublish,
  );
  protected readonly typeEntries = computed(() =>
    Object.entries(this.sources()?.contentTypes ?? {}).map(([key, file]) => ({
      key,
      label: String(file['displayName'] ?? key),
      single: file['kind'] === 'singleType',
    })),
  );
  protected readonly componentEntries = computed(() =>
    Object.entries(this.sources()?.components ?? {}).map(([uid, file]) => ({
      key: `component:${uid}`,
      uid,
      displayName: String(file['displayName'] ?? uid),
      label: `${file['displayName'] ?? uid} (${uid})`,
    })),
  );
  protected readonly attributeEntries = computed(() =>
    Object.entries(this.draft()?.attributes ?? {}).map(([name, attribute]) => ({
      name,
      attribute,
    })),
  );

  protected readonly headerTitle = computed(() => {
    const displayName = this.draft()?.['displayName'];
    if (displayName) return String(displayName);
    return this.t(
      this.isComponent() ? 'builder.header.newComponent' : 'builder.header.newContentType',
    );
  });
  protected readonly headerDescription = computed(() => {
    const file = this.draft();
    if (!file || this.isNew()) return this.t('builder.header.newDescription');
    if (this.isComponent())
      return this.t('builder.header.component', { name: this.componentUid() });
    return this.t(
      file['kind'] === 'singleType' ? 'builder.header.singleType' : 'builder.header.collectionType',
      { name: String(file['singularName'] ?? '') },
    );
  });

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
    if (attribute.relation) {
      const via = attribute.mappedBy
        ? ` ${this.t('builder.summary.via', { field: attribute.mappedBy })}`
        : '';
      parts.push(`${attribute.relation} → ${attribute.target}${via}`);
    }
    if (attribute.component) parts.push(attribute.component);
    if (attribute.components) parts.push(attribute.components.join(', '));
    if (attribute.enum) parts.push(attribute.enum.join(' | '));
    if (attribute.allowedTypes)
      parts.push(
        MEDIA_KINDS.filter((media) => attribute.allowedTypes?.includes(media.kind))
          .map((media) => this.t(media.label))
          .join(', '),
      );
    if (attribute.maxLength !== undefined)
      parts.push(this.t('builder.summary.maxLength', { count: attribute.maxLength }));
    if (attribute.targetField)
      parts.push(this.t('builder.summary.from', { field: attribute.targetField }));
    return parts.join(' · ');
  }

  protected typeInfo(type: AttributeType): TypeInfo | undefined {
    return TYPE_BY_NAME.get(type);
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

  /** Without `allowedTypes`, every kind of file is allowed. */
  protected allowsMedia(attribute: Attribute, kind: MediaKind): boolean {
    return !attribute.allowedTypes || attribute.allowedTypes.includes(kind);
  }

  protected allowedMediaCount(attribute: Attribute): number {
    return attribute.allowedTypes?.length ?? MEDIA_KINDS.length;
  }

  /** `allowedTypes` is omitted when every kind (or none) is checked. */
  protected toggleMediaKind(kind: MediaKind, checked: boolean): void {
    const attribute = this.attributeDraft()?.attribute;
    if (!attribute) return;
    const allowed = MEDIA_KINDS.map((media) => media.kind).filter((item) =>
      item === kind ? checked : this.allowsMedia(attribute, item),
    );
    this.patchAttribute({
      allowedTypes: allowed.length && allowed.length < MEDIA_KINDS.length ? allowed : undefined,
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
      toast.success(this.t('builder.toast.updated'));
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
