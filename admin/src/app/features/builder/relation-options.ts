import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';

import { I18n } from '../../core/i18n/i18n';
import { camel, isBidirectional } from './builder-model';
import { BuilderStore } from './builder-store';
import { MORPH_RELATIONS, isInverseKind, isOwnerKind, ownerKindOf } from './morph-options';

/**
 * A relation field's options: its kind, then the target type (plain relations and the
 * inverse polymorphic sides, with the owner field they read) and the inverse field's name.
 */
@Component({
  selector: 'vd-relation-options',
  imports: [HlmFieldImports, HlmInputImports, HlmNativeSelectImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (store.attributeDraft(); as field) {
      @let attr = field.attribute;
      <div class="grid gap-4 sm:grid-cols-2">
        <div hlmField>
          <label hlmFieldLabel for="relation-kind">{{ t('builder.field.relation') }}</label>
          <hlm-native-select
            selectId="relation-kind"
            [value]="attr.relation ?? store.defaultRelation()"
            (valueChange)="store.setRelationKind($any($event))"
          >
            @if (store.isComponent()) {
              @for (relation of store.availableRelations(); track relation.kind) {
                <option hlmNativeSelectOption [value]="relation.kind">
                  {{ t(relation.label) }}
                </option>
              }
            } @else {
              <optgroup hlmNativeSelectOptGroup [label]="t('builder.morph.group.plain')">
                @for (relation of store.availableRelations(); track relation.kind) {
                  <option hlmNativeSelectOption [value]="relation.kind">
                    {{ t(relation.label) }}
                  </option>
                }
              </optgroup>
              <optgroup hlmNativeSelectOptGroup [label]="t('builder.morph.group.polymorphic')">
                @for (relation of morphRelations; track relation.kind) {
                  <option hlmNativeSelectOption [value]="relation.kind">
                    {{ t(relation.label) }}
                  </option>
                }
              </optgroup>
            }
          </hlm-native-select>
          @if (store.isComponent()) {
            <p hlmFieldDescription>{{ t('builder.field.relationInComponent') }}</p>
          }
        </div>
        @if (isOwnerKind(attr.relation)) {
          <div hlmField>
            <span hlmFieldTitle>{{ t('builder.field.target') }}</span>
            <p hlmFieldDescription data-morph-owner-hint>
              {{ t('builder.morph.ownerHint') }}
            </p>
          </div>
        } @else if (isInverseKind(attr.relation)) {
          <div hlmField>
            <label hlmFieldLabel for="morph-target">{{ t('builder.morph.owner') }}</label>
            <hlm-native-select
              selectId="morph-target"
              [value]="attr.target ?? ''"
              (valueChange)="store.setMorphTarget($any($event))"
            >
              <option hlmNativeSelectOption value="">
                {{ t('builder.field.choose') }}
              </option>
              @for (owner of store.morphOwners(); track owner.uid) {
                <option hlmNativeSelectOption [value]="owner.uid">
                  {{ owner.label }}
                </option>
              }
            </hlm-native-select>
            <p hlmFieldDescription id="morph-target-hint">
              {{
                store.morphOwners().length
                  ? t('builder.morph.ownerTypeHint', { kind: ownerKindOf(attr.relation) })
                  : t('builder.morph.noOwners', { kind: ownerKindOf(attr.relation) })
              }}
            </p>
          </div>
        } @else {
          <div hlmField>
            <label hlmFieldLabel for="relation-target">{{ t('builder.field.target') }}</label>
            <hlm-native-select
              selectId="relation-target"
              [value]="attr.target ?? ''"
              (valueChange)="store.patchAttribute({ target: $any($event) })"
            >
              <option hlmNativeSelectOption value="">
                {{ t('builder.field.choose') }}
              </option>
              @for (entry of store.typeEntries(); track entry.key) {
                <option hlmNativeSelectOption [value]="'api::' + entry.key">
                  {{ entry.label }}
                </option>
              }
            </hlm-native-select>
          </div>
        }
      </div>
      @if (isInverseKind(attr.relation) && attr.target) {
        <div hlmField>
          <label hlmFieldLabel for="morph-by">{{ t('builder.morph.by') }}</label>
          <hlm-native-select
            selectId="morph-by"
            [value]="attr.morphBy ?? ''"
            (valueChange)="store.patchAttribute({ morphBy: $any($event) || undefined })"
          >
            <option hlmNativeSelectOption value="">
              {{ t('builder.field.choose') }}
            </option>
            @for (name of store.morphByOptions(); track name) {
              <option hlmNativeSelectOption [value]="name">{{ name }}</option>
            }
          </hlm-native-select>
          <p hlmFieldDescription>
            {{ t('builder.morph.byHint', { kind: ownerKindOf(attr.relation) }) }}
          </p>
        </div>
      }
      @if (isInverseKind(attr.relation)) {
        <p class="text-muted-foreground text-xs">{{ t('builder.morph.inverseHint') }}</p>
      }
      @if (isBidirectional(attr) && !attr.mappedBy) {
        <div hlmField>
          <label hlmFieldLabel for="inverse-name">{{ t('builder.field.inverseName') }}</label>
          <input
            dir="ltr"
            hlmInput
            id="inverse-name"
            class="font-mono"
            [value]="field.inverseName"
            (input)="store.patchField({ inverseName: camel($any($event.target).value) })"
          />
          <p hlmFieldDescription>{{ t('builder.field.inverseHint') }}</p>
        </div>
      }
    }
  `,
})
export class RelationOptions {
  protected readonly store = inject(BuilderStore);
  protected readonly t = inject(I18n).t;
  protected readonly morphRelations = MORPH_RELATIONS;
  protected readonly isOwnerKind = isOwnerKind;
  protected readonly isInverseKind = isInverseKind;
  protected readonly ownerKindOf = ownerKindOf;
  protected readonly isBidirectional = isBidirectional;
  protected readonly camel = camel;
}
