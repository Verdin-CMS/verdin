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

import { Api, ApiFailure, toQuery } from '../../../core/api';
import { Schema } from '../../../core/schema';
import { Attribute, Attributes } from '../../../core/types';
import {
  DateTimeControl,
  EnumControl,
  JsonControl,
  NumberControl,
  SwitchControl,
} from './controls';
import { FormModel, isToMany, keyed, newComponentItem } from './model';
import { RelationControl } from './relation';

/** Where the fields live, for uid checks and element ids. */
export interface FieldsContext {
  uid: string;
  documentId: string | null;
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
    NumberControl,
    SwitchControl,
    EnumControl,
    DateTimeControl,
    JsonControl,
    RelationControl,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-5">
      @for (entry of entries(); track entry.name) {
        @let name = entry.name;
        @let attribute = entry.attribute;
        @let id = idFor(name);
        @switch (attribute.type) {
          @case ('component') {
            <fieldset hlmFieldSet class="rounded-lg border p-4">
              <legend hlmFieldLegend class="px-1">
                {{ humanize(name) }}
                @if (attribute.required) {
                  <span class="text-destructive"> *</span>
                }
              </legend>
              @if (attribute.repeatable) {
                @for (item of listValue(name); track item['__key'] ?? $index; let index = $index) {
                  <div class="bg-muted/40 flex flex-col gap-3 rounded-md border p-3">
                    <div class="flex items-center gap-1">
                      <span hlmBadge variant="secondary">#{{ index + 1 }}</span>
                      <span class="ms-auto"></span>
                      <button
                        hlmBtn
                        size="icon-xs"
                        variant="ghost"
                        type="button"
                        aria-label="Move up"
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
                        aria-label="Move down"
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
                        aria-label="Remove"
                        (click)="removeItem(name, index)"
                      >
                        <ng-icon name="lucideTrash2" />
                      </button>
                    </div>
                    <vd-fields
                      [attributes]="componentAttributes(attribute.component)"
                      [tree]="at(name, index)"
                      [context]="context()"
                      [prefix]="id + '-' + index"
                    />
                  </div>
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
                    <ng-icon name="lucidePlus" /> Add {{ componentName(attribute.component) }}
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
                    <ng-icon name="lucidePlus" /> Add {{ componentName(attribute.component) }}
                  </button>
                </div>
              } @else {
                <vd-fields
                  [attributes]="componentAttributes(attribute.component)"
                  [tree]="child(name)"
                  [context]="context()"
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
                    <ng-icon name="lucideTrash2" /> Remove
                  </button>
                </div>
              }
              <ng-container *ngTemplateOutlet="errors; context: { $implicit: name }" />
            </fieldset>
          }
          @case ('dynamiczone') {
            <fieldset hlmFieldSet class="rounded-lg border p-4">
              <legend hlmFieldLegend class="px-1">
                {{ humanize(name) }}
                @if (attribute.required) {
                  <span class="text-destructive"> *</span>
                }
              </legend>
              @for (item of listValue(name); track item['__key'] ?? $index; let index = $index) {
                <div class="bg-muted/40 flex flex-col gap-3 rounded-md border p-3">
                  <div class="flex items-center gap-1">
                    <span hlmBadge variant="secondary">{{
                      componentName(item['__component'])
                    }}</span>
                    <span class="ms-auto"></span>
                    <button
                      hlmBtn
                      size="icon-xs"
                      variant="ghost"
                      type="button"
                      aria-label="Move up"
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
                      aria-label="Move down"
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
                      aria-label="Remove"
                      (click)="removeItem(name, index)"
                    >
                      <ng-icon name="lucideTrash2" />
                    </button>
                  </div>
                  <vd-fields
                    [attributes]="componentAttributes(item['__component'])"
                    [tree]="at(name, index)"
                    [context]="context()"
                    [prefix]="id + '-' + index"
                  />
                </div>
              }
              <div class="flex items-center gap-2">
                <hlm-native-select
                  [value]="zoneChoice()[name] ?? attribute.components?.[0] ?? ''"
                  (valueChange)="chooseZone(name, $event)"
                  class="w-56"
                  size="sm"
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
                  <ng-icon name="lucidePlus" /> Add block
                </button>
              </div>
              <ng-container *ngTemplateOutlet="errors; context: { $implicit: name }" />
            </fieldset>
          }
          @default {
            <div hlmField [attr.data-invalid]="hasErrors(name) || null">
              <label hlmFieldLabel [for]="id">
                {{ humanize(name) }}
                @if (attribute.required) {
                  <span class="text-destructive"> *</span>
                }
                @if (attribute.private) {
                  <span hlmBadge variant="outline">private</span>
                }
              </label>
              @switch (attribute.type) {
                @case ('text') {
                  <textarea hlmTextarea [id]="id" rows="3" [formField]="child(name)"></textarea>
                }
                @case ('richtext') {
                  <textarea
                    hlmTextarea
                    [id]="id"
                    rows="10"
                    class="font-mono text-sm"
                    [formField]="child(name)"
                  ></textarea>
                }
                @case ('email') {
                  <input hlmInput [id]="id" type="email" [formField]="child(name)" />
                }
                @case ('uid') {
                  <div hlmInputGroup>
                    <input hlmInputGroupInput [id]="id" [formField]="child(name)" />
                    <div hlmInputGroupAddon align="inline-end">
                      <button
                        hlmInputGroupButton
                        type="button"
                        size="xs"
                        (click)="generateUid(name, attribute)"
                      >
                        Generate
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
                  <input hlmInput [id]="id" type="date" [formField]="child(name)" />
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
                  @if (attribute.mappedBy) {
                    <p hlmFieldDescription>
                      Managed from {{ attribute.target }} · {{ attribute.mappedBy }}.
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
                        <li class="text-muted-foreground text-sm">None</li>
                      }
                    </ul>
                  } @else {
                    <vd-relation-control
                      [inputId]="id"
                      [target]="attribute.target ?? ''"
                      [many]="isToMany(attribute)"
                      [initialLabels]="relationLabels()[name] ?? {}"
                      [formField]="child(name)"
                    />
                  }
                }
                @default {
                  <input hlmInput [id]="id" [formField]="child(name)" />
                }
              }
              <ng-container *ngTemplateOutlet="errors; context: { $implicit: name }" />
            </div>
          }
        }
      }
    </div>

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

  readonly attributes = input.required<Attributes>();
  readonly tree = input.required<Tree>();
  readonly context = input.required<FieldsContext>();
  readonly prefix = input('field');
  /** Labels of related documents, per relation attribute. */
  readonly relationLabels = input<Record<string, Record<string, string>>>({});
  /** Read-only `mappedBy` relations, per attribute. */
  readonly inverse = input<Record<string, { id: string; label: string }[]>>({});

  protected readonly humanize = humanize;
  protected readonly isToMany = isToMany;
  protected readonly zoneChoice = signal<Record<string, string>>({});
  protected readonly uidNotes = signal<Record<string, string>>({});

  protected readonly entries = computed(() =>
    Object.entries(this.attributes()).map(([name, attribute]) => ({ name, attribute })),
  );

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
        [name]: `Fill in ${humanize(attribute.targetField ?? name)} first.`,
      }));
      return;
    }
    const { uid, documentId } = this.context();
    try {
      const result = await this.api.get<{ available: boolean; suggestion: string }>(
        `/content/${uid}/uid-available`,
        toQuery({ field: name, value: text, documentId }),
      );
      this.setValue(name, result.suggestion);
      this.uidNotes.update((notes) => ({ ...notes, [name]: '' }));
    } catch (error) {
      this.uidNotes.update((notes) => ({ ...notes, [name]: ApiFailure.from(error).message }));
    }
  }
}
