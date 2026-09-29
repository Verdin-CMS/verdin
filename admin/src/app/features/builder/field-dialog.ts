import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';

import { I18n } from '../../core/i18n/i18n';
import { PluginExtensions } from '../../core/plugin-extensions';
import { UNIQUE_TYPES, camel } from './builder-model';
import { BuilderStore } from './builder-store';
import { ComponentOptions, ZoneOptions } from './component-options';
import { ConditionEditor } from './condition-editor';
import { FieldTypePicker } from './field-type-picker';
import { attributeLocalized } from './i18n-options';
import { RelationOptions } from './relation-options';
import { MediaOptions, ValueOptions } from './value-options';

/**
 * The add or edit field dialog: the kind of a new field, its name and type, the options of
 * that type, when it shows and its flags. Done writes it into the draft.
 */
@Component({
  selector: 'vd-field-dialog',
  imports: [
    NgIcon,
    HlmButtonImports,
    HlmDialogImports,
    HlmFieldImports,
    HlmInputImports,
    HlmNativeSelectImports,
    HlmSwitchImports,
    FieldTypePicker,
    RelationOptions,
    ComponentOptions,
    ZoneOptions,
    MediaOptions,
    ValueOptions,
    ConditionEditor,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog
      [state]="store.attributeDraft() ? 'open' : 'closed'"
      (closed)="store.closeAttribute()"
    >
      <hlm-dialog-content
        *hlmDialogPortal="let ctx"
        class="max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-2xl"
        [closeLabel]="t('common.close')"
      >
        @if (store.attributeDraft(); as field) {
          @let attr = field.attribute;
          <hlm-dialog-header>
            <h2 hlmDialogTitle>
              {{ field.originalName ? t('builder.field.editTitle') : t('builder.field.addTitle') }}
            </h2>
            <p hlmDialogDescription>{{ t('builder.field.description') }}</p>
          </hlm-dialog-header>
          <div class="-mx-6 flex flex-col gap-6 overflow-y-auto px-6">
            @if (!field.originalName) {
              <vd-field-type-picker />
            }

            <div class="flex flex-col gap-4">
              <h3 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {{ t('builder.field.configure') }}
              </h3>
              @if (attr.customField) {
                <div class="bg-muted/40 flex items-start gap-2.5 rounded-lg border p-3 text-sm">
                  <ng-icon name="lucidePlug" class="text-primary mt-0.5 shrink-0" />
                  <div class="flex min-w-0 flex-col gap-0.5">
                    <span class="font-medium">{{
                      t('builder.field.customField', {
                        name: store.customFieldName(attr.customField),
                      })
                    }}</span>
                    <span class="text-muted-foreground font-mono text-xs break-all">{{
                      attr.customField
                    }}</span>
                    @if (!extensions.field(attr.customField)) {
                      <span class="text-muted-foreground text-xs">{{
                        t('builder.field.customFieldUnavailable')
                      }}</span>
                    }
                  </div>
                </div>
              }
              <div class="grid gap-4 sm:grid-cols-2">
                <div hlmField>
                  <label hlmFieldLabel for="field-name">{{ t('builder.field.name') }}</label>
                  <input
                    dir="ltr"
                    hlmInput
                    id="field-name"
                    class="font-mono"
                    [value]="field.name"
                    (input)="store.patchField({ name: camel($any($event.target).value) })"
                  />
                </div>
                <div hlmField>
                  <label hlmFieldLabel for="field-type">{{ t('builder.field.type') }}</label>
                  <hlm-native-select
                    selectId="field-type"
                    [value]="attr.type"
                    (valueChange)="store.setType($any($event))"
                  >
                    @for (info of store.availableTypes(); track info.type) {
                      <option hlmNativeSelectOption [value]="info.type">
                        {{ t(info.label) }}
                      </option>
                    }
                  </hlm-native-select>
                </div>
              </div>
              @switch (attr.type) {
                @case ('relation') {
                  <vd-relation-options />
                }
                @case ('component') {
                  <vd-component-options />
                }
                @case ('dynamiczone') {
                  <fieldset hlmFieldSet vdZoneOptions></fieldset>
                }
                @case ('media') {
                  <vd-media-options />
                }
              }
              <vd-value-options />
              <fieldset hlmFieldSet vdConditionEditor class="rounded-lg border p-3"></fieldset>
              <div class="bg-muted/40 flex flex-wrap gap-x-6 gap-y-3 rounded-lg border p-3">
                <div hlmField orientation="horizontal" class="w-auto">
                  <hlm-switch
                    inputId="field-required"
                    [checked]="!!attr.required"
                    (checkedChange)="store.patchAttribute({ required: $event || undefined })"
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
                      (checkedChange)="store.patchAttribute({ unique: $event || undefined })"
                    />
                    <label hlmFieldLabel for="field-unique">{{ t('builder.field.unique') }}</label>
                  </div>
                }
                @if (store.localized()) {
                  <div hlmField orientation="horizontal" class="w-auto">
                    <hlm-switch
                      inputId="field-localized"
                      [checked]="attributeLocalized(attr)"
                      (checkedChange)="store.setFieldLocalized($event)"
                    />
                    <div hlmFieldContent>
                      <label hlmFieldLabel for="field-localized">{{
                        t('builder.field.localized')
                      }}</label>
                      <p hlmFieldDescription>{{ t('builder.field.localizedHint') }}</p>
                    </div>
                  </div>
                }
                @if (attr.type === 'password') {
                  <p class="text-muted-foreground flex items-center gap-1.5 text-sm">
                    <ng-icon name="lucideLock" size="14" aria-hidden="true" />
                    {{ t('builder.field.passwordPrivate') }}
                  </p>
                } @else if (!store.isComponent()) {
                  <div hlmField orientation="horizontal" class="w-auto">
                    <hlm-switch
                      inputId="field-private"
                      [checked]="!!attr.private"
                      (checkedChange)="store.patchAttribute({ private: $event || undefined })"
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
            @if (store.fieldIssue(); as issue) {
              <p
                class="text-destructive me-auto self-center text-sm"
                aria-live="polite"
                data-field-issue
              >
                {{ t(issue) }}
              </p>
            }
            <button hlmBtn variant="outline" (click)="store.closeAttribute()">
              {{ t('common.cancel') }}
            </button>
            <button
              hlmBtn
              [disabled]="!field.name || !!store.fieldIssue()"
              (click)="store.commitAttribute()"
            >
              <ng-icon name="lucideCheck" /> {{ t('builder.field.done') }}
            </button>
          </hlm-dialog-footer>
        }
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class FieldDialog {
  protected readonly store = inject(BuilderStore);
  protected readonly extensions = inject(PluginExtensions);
  protected readonly t = inject(I18n).t;
  protected readonly uniqueTypes = UNIQUE_TYPES;
  protected readonly camel = camel;
  protected readonly attributeLocalized = attributeLocalized;
}
