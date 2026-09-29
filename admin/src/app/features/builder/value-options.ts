import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';

import { I18n } from '../../core/i18n/i18n';
import {
  LENGTH_TYPES,
  MEDIA_KINDS,
  NUMBER_TYPES,
  allowedMediaCount,
  allowsMedia,
} from './builder-model';
import { BuilderStore } from './builder-store';

/** A media field's options: one file or many, and the kinds of file it takes. */
@Component({
  selector: 'vd-media-options',
  imports: [HlmCheckboxImports, HlmFieldImports, HlmSwitchImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (attribute(); as attr) {
      <div hlmField orientation="horizontal">
        <hlm-switch
          inputId="field-multiple"
          [checked]="!!attr.multiple"
          (checkedChange)="store.patchAttribute({ multiple: $event || undefined })"
        />
        <div hlmFieldContent>
          <label hlmFieldLabel for="field-multiple">{{ t('builder.field.multiple') }}</label>
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
                (checkedChange)="store.toggleMediaKind(media.kind, $event === true)"
              />
              <label hlmFieldLabel [for]="'media-' + media.kind">{{ t(media.label) }}</label>
            </div>
          }
        </div>
      </fieldset>
    }
  `,
})
export class MediaOptions {
  protected readonly store = inject(BuilderStore);
  protected readonly t = inject(I18n).t;
  protected readonly attribute = computed(() => this.store.attributeDraft()?.attribute);
  protected readonly mediaKinds = MEDIA_KINDS;
  protected readonly allowsMedia = allowsMedia;
  protected readonly allowedMediaCount = allowedMediaCount;
}

/**
 * The options of plain values: an enumeration's values, the field a UID is generated from,
 * and length or number limits.
 */
@Component({
  selector: 'vd-value-options',
  imports: [HlmFieldImports, HlmInputImports, HlmNativeSelectImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (attribute(); as attr) {
      @if (attr.type === 'enumeration') {
        <div hlmField>
          <label hlmFieldLabel for="field-enum">{{ t('builder.field.enum') }}</label>
          <input
            hlmInput
            id="field-enum"
            [value]="(attr.enum ?? []).join(', ')"
            (change)="store.setEnum($any($event.target).value)"
          />
        </div>
      }
      @if (attr.type === 'uid') {
        <div hlmField>
          <label hlmFieldLabel for="field-target">{{ t('builder.field.generatedFrom') }}</label>
          <hlm-native-select
            selectId="field-target"
            [value]="attr.targetField ?? ''"
            (valueChange)="store.patchAttribute({ targetField: $any($event) || undefined })"
          >
            <option hlmNativeSelectOption value="">—</option>
            @for (entry of store.attributeEntries(); track entry.name) {
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
              (change)="store.setNumber('minLength', $any($event.target).value)"
            />
          </div>
          <div hlmField>
            <label hlmFieldLabel for="max-length">{{ t('builder.field.maxLength') }}</label
            ><input
              hlmInput
              id="max-length"
              inputmode="numeric"
              [value]="attr.maxLength ?? ''"
              (change)="store.setNumber('maxLength', $any($event.target).value)"
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
              (change)="store.setNumber('min', $any($event.target).value)"
            />
          </div>
          <div hlmField>
            <label hlmFieldLabel for="max">{{ t('builder.field.max') }}</label
            ><input
              hlmInput
              id="max"
              inputmode="decimal"
              [value]="attr.max ?? ''"
              (change)="store.setNumber('max', $any($event.target).value)"
            />
          </div>
        </div>
      }
    }
  `,
})
export class ValueOptions {
  protected readonly store = inject(BuilderStore);
  protected readonly t = inject(I18n).t;
  protected readonly attribute = computed(() => this.store.attributeDraft()?.attribute);
  protected readonly lengthTypes = LENGTH_TYPES;
  protected readonly numberTypes = NUMBER_TYPES;
}
