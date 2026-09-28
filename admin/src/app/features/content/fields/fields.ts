import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FieldTree, FormField } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmTextareaImports } from '@spartan-ng/helm/textarea';
import { HlmTooltipImports } from '@spartan-ng/helm/tooltip';

import { Api, ApiFailure, toQuery } from '../../../core/api';
import { EditView, FieldSettings, LayoutItem, layoutRows } from '../../../core/edit-view';
import { I18n } from '../../../core/i18n/i18n';
import { visible } from '../../../core/logic';
import { PluginExtensions, PluginField } from '../../../core/plugin-extensions';
import { parseCustomField } from '../../../core/plugins';
import { Schema } from '../../../core/schema';
import { Attribute, Attributes, MediaFile } from '../../../core/types';
import {
  DateControl,
  DateTimeControl,
  EnumControl,
  JsonControl,
  NumberControl,
  PasswordControl,
  SwitchControl,
} from './controls';
import { BlocksControl } from './blocks-control';
import { MarkdownControl } from './markdown-control';
import { MediaControl } from './media-control';
import { MorphControl } from './morph-control';
import { PluginFieldControl } from './plugin-field';
import { isMorph, isMorphOwner } from '../../../core/morph';
import { FormModel, MorphEntry, References, isToMany, keyed, newComponentItem } from './model';
import { RelationControl } from './relation';

/** Where the fields live, for uid checks and element ids. */
export interface FieldsContext {
  uid: string;
  documentId: string | null;
  /** The document's locale, for localized types. */
  locale?: string | null;
}

/** `metaTitle` → `Meta title`. */
export function humanize(name: string): string {
  const words = name.replace(/([A-Z])/g, ' $1').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

type Tree = FieldTree<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Renders `attributes` against the field tree of an object; recursive for components. */
@Component({
  selector: 'vd-fields',
  imports: [
    NgTemplateOutlet,
    FormField,
    RouterLink,
    NgIcon,
    HlmFieldImports,
    HlmInputImports,
    HlmInputGroupImports,
    HlmTextareaImports,
    HlmNativeSelectImports,
    HlmButtonImports,
    HlmBadgeImports,
    HlmTooltipImports,
    NumberControl,
    SwitchControl,
    EnumControl,
    DateControl,
    DateTimeControl,
    JsonControl,
    PasswordControl,
    RelationControl,
    MediaControl,
    MorphControl,
    BlocksControl,
    MarkdownControl,
    PluginFieldControl,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      @for (row of rows(); track rowKey(row)) {
        <div class="grid grid-cols-12 gap-6" data-layout-row>
          @for (cell of row; track cell.name) {
            <div
              class="col-span-12 min-w-0 md:col-span-(--span)"
              [style.--span]="cell.size"
              [attr.data-field]="cell.name"
            >
              <ng-container
                *ngTemplateOutlet="
                  field;
                  context: { $implicit: cell.name, attribute: attributes()[cell.name] }
                "
              />
            </div>
          }
        </div>
      }
    </div>

    <ng-template #field let-name let-attribute="attribute">
      @let id = idFor(name);
      @let locked = readOnly(name);
      @switch (attribute.type) {
        @case ('component') {
          <section
            role="group"
            class="overflow-hidden rounded-lg border"
            [attr.aria-labelledby]="id + '-label'"
          >
            <div
              class="bg-muted/40 flex items-center gap-2 border-b px-4 py-2.5"
              [id]="id + '-label'"
            >
              <ng-icon name="lucideBlocks" class="text-muted-foreground" />
              <span class="text-sm font-medium">{{ label(name) }}</span>
              @if (attribute.required) {
                <span class="text-destructive" aria-hidden="true">*</span>
              }
              @if (locked) {
                <ng-container *ngTemplateOutlet="lockMark" />
              }
              @if (isShared(name)) {
                <ng-container *ngTemplateOutlet="sharedMark" />
              }
              @if (listCount(name, attribute); as count) {
                <span hlmBadge variant="outline" class="ms-auto tabular-nums">{{
                  i18n.formatNumber(count)
                }}</span>
              }
            </div>
            <fieldset class="flex min-w-0 flex-col gap-3 p-4" [disabled]="locked">
              @if (description(name); as text) {
                <p hlmFieldDescription>{{ text }}</p>
              }
              @if (attribute.repeatable) {
                @for (item of listValue(name); track item['__key'] ?? $index; let index = $index) {
                  <div class="bg-background overflow-hidden rounded-md border">
                    <div class="bg-muted/30 flex items-center gap-1 border-b px-3 py-1.5">
                      <span hlmBadge variant="secondary" class="tabular-nums"
                        >#{{ index + 1 }}</span
                      >
                      <span class="ms-auto"></span>
                      <button
                        hlmBtn
                        size="icon-xs"
                        variant="ghost"
                        type="button"
                        [attr.aria-label]="t('content.fields.moveUp')"
                        [title]="t('content.fields.moveUp')"
                        [disabled]="index === 0"
                        (click)="moveItem(name, index, -1)"
                      >
                        <ng-icon name="lucideArrowUp" />
                      </button>
                      <button
                        hlmBtn
                        size="icon-xs"
                        variant="ghost"
                        type="button"
                        [attr.aria-label]="t('content.fields.moveDown')"
                        [title]="t('content.fields.moveDown')"
                        [disabled]="index === listValue(name).length - 1"
                        (click)="moveItem(name, index, 1)"
                      >
                        <ng-icon name="lucideArrowDown" />
                      </button>
                      <button
                        hlmBtn
                        size="icon-xs"
                        variant="ghost"
                        type="button"
                        class="hover:text-destructive"
                        [attr.aria-label]="t('content.fields.remove')"
                        [title]="t('content.fields.remove')"
                        (click)="removeItem(name, index)"
                      >
                        <ng-icon name="lucideTrash2" />
                      </button>
                    </div>
                    <div class="p-4">
                      <vd-fields
                        [attributes]="componentAttributes(attribute.component)"
                        [tree]="at(name, index)"
                        [context]="context()"
                        [refs]="refs()"
                        [prefix]="id + '-' + index"
                      />
                    </div>
                  </div>
                } @empty {
                  <p class="text-muted-foreground text-sm">{{ t('content.fields.noItems') }}</p>
                }
                <div>
                  <button
                    hlmBtn
                    variant="outline"
                    size="sm"
                    type="button"
                    [disabled]="
                      attribute.max !== undefined && listValue(name).length >= attribute.max
                    "
                    (click)="addItem(name, attribute.component ?? '')"
                  >
                    <ng-icon name="lucidePlus" />
                    {{ t('content.fields.add', { name: componentName(attribute.component) }) }}
                  </button>
                </div>
              } @else if (value(name) === null) {
                <div>
                  <button
                    hlmBtn
                    variant="outline"
                    size="sm"
                    type="button"
                    (click)="setComponent(name, attribute.component ?? '')"
                  >
                    <ng-icon name="lucidePlus" />
                    {{ t('content.fields.add', { name: componentName(attribute.component) }) }}
                  </button>
                </div>
              } @else {
                <vd-fields
                  [attributes]="componentAttributes(attribute.component)"
                  [tree]="child(name)"
                  [context]="context()"
                  [refs]="refs()"
                  [prefix]="id"
                />
                <div>
                  <button
                    hlmBtn
                    variant="ghost"
                    size="sm"
                    type="button"
                    (click)="setValue(name, null)"
                  >
                    <ng-icon name="lucideTrash2" /> {{ t('content.fields.remove') }}
                  </button>
                </div>
              }
              <ng-container *ngTemplateOutlet="errors; context: { $implicit: name }" />
            </fieldset>
          </section>
        }
        @case ('dynamiczone') {
          <section
            role="group"
            class="overflow-hidden rounded-lg border"
            [attr.aria-labelledby]="id + '-label'"
          >
            <div
              class="bg-muted/40 flex items-center gap-2 border-b px-4 py-2.5"
              [id]="id + '-label'"
            >
              <ng-icon name="lucideLayers" class="text-muted-foreground" />
              <span class="text-sm font-medium">{{ label(name) }}</span>
              @if (attribute.required) {
                <span class="text-destructive" aria-hidden="true">*</span>
              }
              @if (locked) {
                <ng-container *ngTemplateOutlet="lockMark" />
              }
              @if (isShared(name)) {
                <ng-container *ngTemplateOutlet="sharedMark" />
              }
              @if (listCount(name, attribute); as count) {
                <span hlmBadge variant="outline" class="ms-auto tabular-nums">{{
                  i18n.formatNumber(count)
                }}</span>
              }
            </div>
            <fieldset class="flex min-w-0 flex-col gap-3 p-4" [disabled]="locked">
              @if (description(name); as text) {
                <p hlmFieldDescription>{{ text }}</p>
              }
              @for (item of listValue(name); track item['__key'] ?? $index; let index = $index) {
                <div class="bg-background overflow-hidden rounded-md border">
                  <div class="bg-muted/30 flex items-center gap-1 border-b px-3 py-1.5">
                    <span hlmBadge variant="secondary">{{
                      componentName(item['__component'])
                    }}</span>
                    <span class="ms-auto"></span>
                    <button
                      hlmBtn
                      size="icon-xs"
                      variant="ghost"
                      type="button"
                      [attr.aria-label]="t('content.fields.moveUp')"
                      [title]="t('content.fields.moveUp')"
                      [disabled]="index === 0"
                      (click)="moveItem(name, index, -1)"
                    >
                      <ng-icon name="lucideArrowUp" />
                    </button>
                    <button
                      hlmBtn
                      size="icon-xs"
                      variant="ghost"
                      type="button"
                      [attr.aria-label]="t('content.fields.moveDown')"
                      [title]="t('content.fields.moveDown')"
                      [disabled]="index === listValue(name).length - 1"
                      (click)="moveItem(name, index, 1)"
                    >
                      <ng-icon name="lucideArrowDown" />
                    </button>
                    <button
                      hlmBtn
                      size="icon-xs"
                      variant="ghost"
                      type="button"
                      class="hover:text-destructive"
                      [attr.aria-label]="t('content.fields.remove')"
                      [title]="t('content.fields.remove')"
                      (click)="removeItem(name, index)"
                    >
                      <ng-icon name="lucideTrash2" />
                    </button>
                  </div>
                  <div class="p-4">
                    <vd-fields
                      [attributes]="componentAttributes(item['__component'])"
                      [tree]="at(name, index)"
                      [context]="context()"
                      [refs]="refs()"
                      [prefix]="id + '-' + index"
                    />
                  </div>
                </div>
              } @empty {
                <p class="text-muted-foreground text-sm">{{ t('content.fields.noBlocks') }}</p>
              }
              <div class="flex flex-wrap items-center gap-2">
                <hlm-native-select
                  [value]="zoneChoice()[name] ?? attribute.components?.[0] ?? ''"
                  (valueChange)="chooseZone(name, $event)"
                  class="w-56"
                  size="sm"
                  [attr.aria-label]="t('content.fields.blockType')"
                >
                  @for (uid of attribute.components ?? []; track uid) {
                    <option hlmNativeSelectOption [value]="uid">{{ componentName(uid) }}</option>
                  }
                </hlm-native-select>
                <button
                  hlmBtn
                  variant="outline"
                  size="sm"
                  type="button"
                  (click)="
                    addItem(name, zoneChoice()[name] ?? attribute.components?.[0] ?? '', true)
                  "
                >
                  <ng-icon name="lucidePlus" /> {{ t('content.fields.addBlock') }}
                </button>
              </div>
              <ng-container *ngTemplateOutlet="errors; context: { $implicit: name }" />
            </fieldset>
          </section>
        }
        @default {
          <div hlmField [attr.data-invalid]="hasErrors(name) || null">
            <label hlmFieldLabel [for]="id">
              {{ label(name) }}
              @if (attribute.required) {
                <span class="text-destructive"> *</span>
              }
              @if (attribute.private) {
                <span hlmBadge variant="outline">{{ t('content.fields.private') }}</span>
              }
              @if (isShared(name)) {
                <ng-container *ngTemplateOutlet="sharedMark" />
              }
              @if (locked) {
                <ng-container *ngTemplateOutlet="lockMark" />
              }
            </label>
            @if (pluginField(attribute); as custom) {
              <vd-plugin-field
                [inputId]="id"
                [element]="custom.element"
                [attribute]="attribute"
                [locale]="context().locale ?? null"
                [formField]="child(name)"
              />
            } @else {
              @switch (attribute.type) {
                @case ('text') {
                  <textarea
                    hlmTextarea
                    [id]="id"
                    rows="3"
                    [attr.placeholder]="placeholder(name)"
                    [formField]="child(name)"
                  ></textarea>
                }
                @case ('richtext') {
                  <vd-markdown-control [inputId]="id" [formField]="child(name)" />
                }
                @case ('blocks') {
                  <vd-blocks-control [inputId]="id" [formField]="child(name)" />
                }
                @case ('password') {
                  <vd-password-control
                    [inputId]="id"
                    [describedBy]="context().documentId ? id + '-hint' : ''"
                    [formField]="child(name)"
                  />
                  @if (context().documentId) {
                    <p hlmFieldDescription [id]="id + '-hint'">
                      {{ t('content.password.keepHint') }}
                    </p>
                  }
                }
                @case ('email') {
                  <input
                    dir="ltr"
                    hlmInput
                    [id]="id"
                    type="email"
                    [attr.placeholder]="placeholder(name)"
                    [formField]="child(name)"
                  />
                }
                @case ('uid') {
                  <div hlmInputGroup>
                    <input
                      hlmInputGroupInput
                      dir="ltr"
                      [id]="id"
                      [attr.placeholder]="placeholder(name)"
                      [formField]="child(name)"
                    />
                    <div hlmInputGroupAddon align="inline-end">
                      <button
                        hlmInputGroupButton
                        type="button"
                        size="xs"
                        [disabled]="locked"
                        (click)="generateUid(name, attribute)"
                      >
                        {{ t('content.fields.generate') }}
                      </button>
                    </div>
                  </div>
                  @if (uidNotes()[name]; as note) {
                    <p hlmFieldDescription>{{ note }}</p>
                  }
                }
                @case ('integer') {
                  <vd-number-control [inputId]="id" [integer]="true" [formField]="child(name)" />
                }
                @case ('biginteger') {
                  <vd-number-control
                    [inputId]="id"
                    [integer]="true"
                    [bigint]="true"
                    [formField]="child(name)"
                  />
                }
                @case ('float') {
                  <vd-number-control [inputId]="id" [formField]="child(name)" />
                }
                @case ('decimal') {
                  <vd-number-control [inputId]="id" [formField]="child(name)" />
                }
                @case ('boolean') {
                  <vd-switch-control [inputId]="id" [formField]="child(name)" />
                }
                @case ('enumeration') {
                  <vd-enum-control
                    [inputId]="id"
                    [options]="attribute.enum ?? []"
                    [formField]="child(name)"
                  />
                }
                @case ('date') {
                  <vd-date-control [inputId]="id" [formField]="child(name)" />
                }
                @case ('time') {
                  <input hlmInput [id]="id" type="time" step="1" [formField]="child(name)" />
                }
                @case ('datetime') {
                  <vd-datetime-control [inputId]="id" [formField]="child(name)" />
                }
                @case ('json') {
                  <vd-json-control [inputId]="id" [formField]="child(name)" />
                }
                @case ('relation') {
                  @if (isMorphOwner(attribute)) {
                    <vd-morph-control
                      [inputId]="id"
                      [many]="isToMany(attribute)"
                      [label]="label(name)"
                      [initial]="morphs()[name] ?? []"
                      [locale]="context().locale ?? null"
                      [formField]="child(name)"
                    />
                  } @else if (isMorph(attribute)) {
                    <ul
                      class="flex flex-col gap-1"
                      [id]="id"
                      [attr.aria-label]="label(name)"
                      [attr.aria-describedby]="id + '-morph'"
                      data-morph-list
                    >
                      @for (item of morphs()[name] ?? []; track item.uid + ':' + item.documentId) {
                        <li class="flex min-w-0 items-center gap-2 text-sm">
                          <span hlmBadge variant="outline" class="shrink-0">{{
                            item.typeName
                          }}</span>
                          @if (item.link) {
                            <a
                              class="truncate underline-offset-4 hover:underline"
                              [routerLink]="item.link"
                              >{{ item.label }}</a
                            >
                          } @else {
                            <span class="truncate">{{ item.label }}</span>
                          }
                        </li>
                      } @empty {
                        <li class="text-muted-foreground text-sm">
                          {{ t('content.fields.morphEmpty') }}
                        </li>
                      }
                    </ul>
                    <p hlmFieldDescription class="flex items-center gap-1.5" [id]="id + '-morph'">
                      <ng-icon name="lucideInfo" size="12" aria-hidden="true" />
                      {{
                        t('morph.inverse.note', {
                          target: targetName(attribute.target),
                          field: attribute.morphBy ?? '',
                        })
                      }}
                    </p>
                  } @else if (attribute.mappedBy) {
                    <p hlmFieldDescription>
                      {{
                        t('content.fields.managedFrom', {
                          target: targetName(attribute.target),
                          field: attribute.mappedBy,
                        })
                      }}
                    </p>
                    <ul class="flex flex-wrap gap-1">
                      @for (item of inverse()[name] ?? []; track item.id) {
                        <li>
                          <a
                            hlmBadge
                            variant="secondary"
                            [routerLink]="['/content', attribute.target, item.id]"
                            >{{ item.label }}</a
                          >
                        </li>
                      } @empty {
                        <li class="text-muted-foreground text-sm">{{ t('common.none') }}</li>
                      }
                    </ul>
                  } @else {
                    <vd-relation-control
                      [inputId]="id"
                      [target]="attribute.target ?? ''"
                      [many]="isToMany(attribute)"
                      [initialLabels]="relationLabels()[name] ?? refs().labels"
                      [mainField]="settings(name)?.mainField ?? null"
                      [locale]="context().locale ?? null"
                      [formField]="child(name)"
                    />
                  }
                }
                @case ('media') {
                  <vd-media-control
                    [inputId]="id"
                    [multiple]="!!attribute.multiple"
                    [allowedTypes]="attribute.allowedTypes ?? []"
                    [initialFiles]="mediaFiles()[name] ?? refs().files"
                    [formField]="child(name)"
                  />
                }
                @default {
                  <input
                    hlmInput
                    [id]="id"
                    [attr.placeholder]="placeholder(name)"
                    [formField]="child(name)"
                  />
                }
              }
              @if (missingPlugin(attribute); as plugin) {
                <p hlmFieldDescription class="flex items-center gap-1.5">
                  <ng-icon name="lucidePlug" size="12" aria-hidden="true" />
                  {{ t('content.fields.customFieldMissing', { plugin }) }}
                </p>
              }
            }
            @if (description(name); as text) {
              <p hlmFieldDescription>{{ text }}</p>
            }
            <ng-container *ngTemplateOutlet="errors; context: { $implicit: name }" />
          </div>
        }
      }
    </ng-template>

    <ng-template #lockMark>
      <span
        class="text-muted-foreground inline-flex items-center"
        tabindex="0"
        role="img"
        [attr.aria-label]="t('content.fields.readOnly')"
        [hlmTooltip]="t('content.fields.readOnly')"
      >
        <ng-icon name="lucideLock" size="14" aria-hidden="true" />
      </span>
    </ng-template>

    <ng-template #sharedMark>
      <span
        class="text-muted-foreground inline-flex items-center"
        tabindex="0"
        role="img"
        [attr.aria-label]="t('content.locale.shared')"
        [hlmTooltip]="t('content.locale.shared')"
      >
        <ng-icon name="lucideGlobe" size="14" aria-hidden="true" />
      </span>
    </ng-template>

    <ng-template #errors let-name>
      @if (hasErrors(name)) {
        @for (error of child(name)().errors(); track $index) {
          <hlm-field-error>{{ error.message }}</hlm-field-error>
        }
      }
    </ng-template>
  `,
})
export class FieldsComponent {
  private readonly api = inject(Api);
  private readonly schema = inject(Schema);
  private readonly extensions = inject(PluginExtensions);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  readonly attributes = input.required<Attributes>();
  readonly tree = input.required<Tree>();
  readonly context = input.required<FieldsContext>();
  readonly prefix = input('field');
  /** Labels of related documents, per relation attribute. */
  readonly relationLabels = input<Record<string, Record<string, string>>>({});
  /** Files of media attributes in the loaded document (top-level only). */
  readonly mediaFiles = input<Record<string, MediaFile[]>>({});
  /** Labels and files of populated references at any depth (components, dynamic zones). */
  readonly refs = input<References>({ labels: {}, files: [] });
  /** Read-only `mappedBy` relations, per attribute. */
  readonly inverse = input<Record<string, { id: string; label: string }[]>>({});
  /** Linked entries of polymorphic relations (owners: labels; inverse sides: the list). */
  readonly morphs = input<Record<string, MorphEntry[]>>({});
  /** Attributes shared by every locale (top level of a localized type), marked with a globe. */
  readonly shared = input<readonly string[]>([]);
  /** The type's edit view (top level only): layout, labels, read-only fields. */
  readonly view = input<EditView | null>(null);

  protected readonly humanize = humanize;
  protected readonly isToMany = isToMany;
  protected readonly isMorph = isMorph;
  protected readonly isMorphOwner = isMorphOwner;
  protected readonly zoneChoice = signal<Record<string, string>>({});
  protected readonly uidNotes = signal<Record<string, string>>({});

  /**
   * Rows of visible fields: the edit view's layout (top level of a configured type), else
   * one field per row. Fields whose condition fails for the current values are left out,
   * re-evaluated as the form changes (inside components, against the item's own values).
   */
  protected readonly rows = computed(() => {
    const attributes = this.attributes();
    const scope = this.tree()().value();
    return layoutRows(attributes, this.view(), (name) =>
      visible(attributes[name]?.conditions, scope),
    );
  });

  protected rowKey(row: LayoutItem[]): string {
    return row.map((cell) => cell.name).join('|');
  }

  protected settings(name: string): FieldSettings | undefined {
    return this.view()?.fields[name];
  }

  protected label(name: string): string {
    return this.settings(name)?.label || humanize(name);
  }

  protected description(name: string): string | null {
    return this.settings(name)?.description || null;
  }

  protected placeholder(name: string): string | null {
    return this.settings(name)?.placeholder || null;
  }

  /** Configured as not editable: shown read-only. */
  protected readOnly(name: string): boolean {
    return this.settings(name)?.editable === false;
  }

  /** The loaded plugin field rendering a `customField` attribute, if any. */
  protected pluginField(attribute: Attribute): PluginField | undefined {
    return attribute.customField ? this.extensions.field(attribute.customField) : undefined;
  }

  /** The plugin of a `customField` attribute whose field is not available (hint shown). */
  protected missingPlugin(attribute: Attribute): string | null {
    if (!attribute.customField || !this.extensions.loaded()) return null;
    return parseCustomField(attribute.customField)?.plugin ?? attribute.customField;
  }

  protected isShared(name: string): boolean {
    return this.shared().includes(name);
  }

  protected idFor(name: string): string {
    return `${this.prefix()}-${name}`;
  }

  // Field trees are typed by the schema at runtime; `any` is the honest static type here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected child(name: string): any {
    return (this.tree() as unknown as Record<string, Tree>)[name];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected at(name: string, index: number): any {
    return (this.child(name) as Tree[])[index];
  }

  protected value(name: string): unknown {
    return this.child(name)().value();
  }

  protected listValue(name: string): FormModel[] {
    return (this.value(name) as FormModel[] | null) ?? [];
  }

  protected setValue(name: string, value: unknown): void {
    this.child(name)().value.set(value);
  }

  protected hasErrors(name: string): boolean {
    const state = this.child(name)();
    return (
      state.errors().length > 0 &&
      (state.touched() || state.errors().some((error: { kind: string }) => error.kind === 'server'))
    );
  }

  protected componentAttributes(uid: unknown): Attributes {
    return this.schema.component(String(uid ?? ''))?.attributes ?? {};
  }

  /** Item count shown in a repeatable component's or dynamic zone's header. */
  protected listCount(name: string, attribute: Attribute): number | null {
    if (attribute.type === 'component' && !attribute.repeatable) return null;
    return this.listValue(name).length || null;
  }

  protected targetName(uid: string | undefined): string {
    return this.schema.type(uid ?? '')?.displayName ?? uid ?? '';
  }

  protected componentName(uid: unknown): string {
    return this.schema.component(String(uid ?? ''))?.displayName ?? String(uid ?? '');
  }

  protected setComponent(name: string, uid: string): void {
    const component = this.schema.component(uid);
    if (component)
      this.setValue(
        name,
        keyed(newComponentItem(component, (id) => this.schema.component(id), false)),
      );
  }

  protected addItem(name: string, uid: string, dynamicZone = false): void {
    const component = this.schema.component(uid);
    if (!component) return;
    const item = keyed(newComponentItem(component, (id) => this.schema.component(id), dynamicZone));
    this.setValue(name, [...this.listValue(name), item]);
  }

  protected removeItem(name: string, index: number): void {
    this.setValue(
      name,
      this.listValue(name).filter((_, position) => position !== index),
    );
  }

  protected moveItem(name: string, index: number, delta: number): void {
    const list = [...this.listValue(name)];
    const [item] = list.splice(index, 1);
    list.splice(index + delta, 0, item);
    this.setValue(name, list);
  }

  protected chooseZone(name: string, uid: string | null | undefined): void {
    this.zoneChoice.update((choices) => ({ ...choices, [name]: uid ?? '' }));
  }

  /** Suggests a free uid from the target field (or the current value). */
  protected async generateUid(name: string, attribute: Attribute): Promise<void> {
    const source = attribute.targetField ? this.value(attribute.targetField) : this.value(name);
    const text = String(source ?? '').trim();
    if (!text) {
      this.uidNotes.update((notes) => ({
        ...notes,
        [name]: this.t('content.fields.fillFirst', {
          field: humanize(attribute.targetField ?? name),
        }),
      }));
      return;
    }
    const { uid, documentId, locale } = this.context();
    try {
      const result = await this.api.get<{ available: boolean; suggestion: string }>(
        `/content/${uid}/uid-available`,
        toQuery({ field: name, value: text, documentId, locale }),
      );
      this.setValue(name, result.suggestion);
      this.uidNotes.update((notes) => ({ ...notes, [name]: '' }));
    } catch (error) {
      this.uidNotes.update((notes) => ({ ...notes, [name]: ApiFailure.from(error).message }));
    }
  }
}
