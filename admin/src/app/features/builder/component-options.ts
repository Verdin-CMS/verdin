import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';

import { I18n } from '../../core/i18n/i18n';
import { BuilderStore } from './builder-store';

/** A component field's options: the component it holds, and whether it repeats. */
@Component({
  selector: 'vd-component-options',
  imports: [HlmFieldImports, HlmNativeSelectImports, HlmSwitchImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (attribute(); as attr) {
      <div hlmField>
        <label hlmFieldLabel for="field-component">{{ t('builder.field.component') }}</label>
        <hlm-native-select
          selectId="field-component"
          [value]="attr.component ?? ''"
          (valueChange)="store.patchAttribute({ component: $any($event) })"
        >
          <option hlmNativeSelectOption value="">{{ t('builder.field.choose') }}</option>
          @for (entry of store.componentEntries(); track entry.key) {
            <option hlmNativeSelectOption [value]="entry.uid">{{ entry.label }}</option>
          }
        </hlm-native-select>
      </div>
      <div hlmField orientation="horizontal">
        <hlm-switch
          inputId="field-repeatable"
          [checked]="!!attr.repeatable"
          (checkedChange)="store.patchAttribute({ repeatable: $event || undefined })"
        />
        <label hlmFieldLabel for="field-repeatable">{{ t('builder.field.repeatable') }}</label>
      </div>
    }
  `,
})
export class ComponentOptions {
  protected readonly store = inject(BuilderStore);
  protected readonly t = inject(I18n).t;
  protected readonly attribute = computed(() => this.store.attributeDraft()?.attribute);
}

/** A dynamic zone's options: the components it allows. */
@Component({
  selector: 'fieldset[vdZoneOptions]',
  imports: [HlmCheckboxImports, HlmFieldImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <legend hlmFieldLegend>{{ t('builder.field.allowedComponents') }}</legend>
    <div hlmFieldGroup>
      @for (entry of store.componentEntries(); track entry.key) {
        <div hlmField orientation="horizontal">
          <hlm-checkbox
            [inputId]="'dz-' + entry.uid"
            [checked]="allowed().includes(entry.uid)"
            (checkedChange)="store.toggleZoneComponent(entry.uid, $event === true)"
          />
          <label hlmFieldLabel [for]="'dz-' + entry.uid">{{ entry.label }}</label>
        </div>
      } @empty {
        <p class="text-muted-foreground text-sm">
          {{ t('builder.field.noComponents') }}
        </p>
      }
    </div>
  `,
})
export class ZoneOptions {
  protected readonly store = inject(BuilderStore);
  protected readonly t = inject(I18n).t;
  protected readonly allowed = computed(
    () => this.store.attributeDraft()?.attribute.components ?? [],
  );
}
