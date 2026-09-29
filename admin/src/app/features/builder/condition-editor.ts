import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';

import { I18n } from '../../core/i18n/i18n';
import { BuilderStore } from './builder-store';

/**
 * When the edited field shows: a simple rule on another field of the type, or the raw JSON
 * of a condition too complex to edit here.
 */
@Component({
  selector: 'fieldset[vdConditionEditor]',
  imports: [NgIcon, HlmButtonImports, HlmFieldImports, HlmInputImports, HlmNativeSelectImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <legend hlmFieldLegend variant="label" class="px-1">
      {{ t('builder.condition.title') }}
    </legend>
    @if (!conditions()) {
      <p class="text-muted-foreground text-sm">{{ t('builder.condition.none') }}</p>
      <div>
        <button
          hlmBtn
          size="sm"
          variant="outline"
          type="button"
          [disabled]="!store.conditionFields().length"
          (click)="store.addCondition()"
        >
          <ng-icon name="lucidePlus" /> {{ t('builder.condition.add') }}
        </button>
      </div>
      @if (!store.conditionFields().length) {
        <p class="text-muted-foreground text-xs">
          {{ t('builder.condition.noFields') }}
        </p>
      }
    } @else {
      @if (store.simpleRule(); as rule) {
        <div class="flex flex-wrap items-end gap-2">
          <span class="pb-2 text-sm">{{ t('builder.condition.showWhen') }}</span>
          <div hlmField class="w-44">
            <label hlmFieldLabel for="condition-field" class="sr-only">{{
              t('builder.condition.field')
            }}</label>
            <hlm-native-select
              selectId="condition-field"
              size="sm"
              [value]="rule.field"
              (valueChange)="store.setCondition({ field: $event ?? '' })"
            >
              @if (!store.isConditionField(rule.field)) {
                <option hlmNativeSelectOption [value]="rule.field">
                  {{ rule.field }}
                </option>
              }
              @for (option of store.conditionFields(); track option.name) {
                <option hlmNativeSelectOption [value]="option.name">
                  {{ option.name }}
                </option>
              }
            </hlm-native-select>
          </div>
          <div hlmField class="w-32">
            <label hlmFieldLabel for="condition-operator" class="sr-only">{{
              t('builder.condition.operator')
            }}</label>
            <hlm-native-select
              selectId="condition-operator"
              size="sm"
              [value]="rule.operator"
              (valueChange)="store.setCondition({ operator: $event === '!=' ? '!=' : '==' })"
            >
              <option hlmNativeSelectOption value="==">
                {{ t('builder.condition.is') }}
              </option>
              <option hlmNativeSelectOption value="!=">
                {{ t('builder.condition.isNot') }}
              </option>
            </hlm-native-select>
          </div>
          @let compared = store.conditionAttribute(rule.field);
          <div hlmField class="min-w-40 flex-1">
            <label hlmFieldLabel for="condition-value" class="sr-only">{{
              t('builder.condition.value')
            }}</label>
            @if (compared?.type === 'boolean') {
              <hlm-native-select
                selectId="condition-value"
                size="sm"
                [value]="String(rule.value)"
                (valueChange)="store.setCondition({ value: $event === 'true' })"
              >
                <option hlmNativeSelectOption value="true">
                  {{ t('builder.condition.true') }}
                </option>
                <option hlmNativeSelectOption value="false">
                  {{ t('builder.condition.false') }}
                </option>
              </hlm-native-select>
            } @else if (compared?.type === 'enumeration') {
              <hlm-native-select
                selectId="condition-value"
                size="sm"
                [value]="String(rule.value ?? '')"
                (valueChange)="store.setCondition({ value: $event ?? '' })"
              >
                @for (option of compared?.enum ?? []; track option) {
                  <option hlmNativeSelectOption [value]="option">{{ option }}</option>
                }
              </hlm-native-select>
            } @else {
              <input
                hlmInput
                id="condition-value"
                class="h-8"
                [value]="rule.value === null ? '' : String(rule.value)"
                (input)="store.setConditionText(rule.field, $any($event.target).value)"
              />
            }
          </div>
        </div>
      } @else {
        <p class="text-muted-foreground text-sm">
          {{ t('builder.condition.complex') }}
        </p>
        <pre
          dir="ltr"
          class="bg-muted max-h-48 overflow-auto rounded-md p-3 font-mono text-xs"
          [attr.aria-label]="t('builder.condition.raw')"
          >{{ json() }}</pre>
      }
      <div>
        <button
          hlmBtn
          size="sm"
          variant="ghost"
          type="button"
          (click)="store.patchAttribute({ conditions: undefined })"
        >
          <ng-icon name="lucideX" /> {{ t('builder.condition.remove') }}
        </button>
      </div>
    }
    <p class="text-muted-foreground text-xs">{{ t('builder.condition.hint') }}</p>
  `,
})
export class ConditionEditor {
  protected readonly store = inject(BuilderStore);
  protected readonly t = inject(I18n).t;
  protected readonly String = String;
  protected readonly conditions = computed(() => this.store.attributeDraft()?.attribute.conditions);
  protected readonly json = computed(() => JSON.stringify(this.conditions(), null, 2));
}
