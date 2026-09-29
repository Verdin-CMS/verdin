import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NgIcon } from '@ng-icons/core';

import { I18n } from '../../core/i18n/i18n';
import { PluginExtensions } from '../../core/plugin-extensions';
import { customFieldId } from '../../core/plugins';
import { BuilderStore } from './builder-store';

/** The new field's kind: the built-in attribute types, then the plugins' custom fields. */
@Component({
  selector: 'vd-field-type-picker',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <div class="flex flex-col gap-2">
      <h3 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {{ t('builder.field.chooseKind') }}
      </h3>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
        @for (info of store.availableTypes(); track info.type) {
          @let selected = attribute()?.type === info.type && !attribute()?.customField;
          <button
            type="button"
            class="hover:bg-muted/60 focus-visible:ring-ring/50 flex items-start gap-2.5 rounded-lg border p-2.5 text-start transition-colors outline-none focus-visible:ring-[3px]"
            [class.border-primary]="selected"
            [class.bg-primary/5]="selected"
            [attr.aria-pressed]="selected"
            (click)="store.setType(info.type)"
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
    </div>
    @if (extensions.fields().length) {
      <div class="flex flex-col gap-2">
        <h3 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {{ t('builder.field.customFields') }}
        </h3>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
          @for (custom of extensions.fields(); track custom.plugin + '.' + custom.id) {
            @let selected = attribute()?.customField === customFieldId(custom.plugin, custom.id);
            <button
              type="button"
              class="hover:bg-muted/60 focus-visible:ring-ring/50 flex items-start gap-2.5 rounded-lg border p-2.5 text-start transition-colors outline-none focus-visible:ring-[3px]"
              [class.border-primary]="selected"
              [class.bg-primary/5]="selected"
              [attr.aria-pressed]="selected"
              (click)="store.setCustomField(custom)"
            >
              <span
                class="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-md"
              >
                <ng-icon name="lucidePlug" size="16" />
              </span>
              <span class="flex min-w-0 flex-col">
                <span class="text-sm font-medium">{{ custom.title }}</span>
                <span class="text-muted-foreground text-xs leading-snug">{{
                  custom.description || t('builder.field.customFieldBy', { plugin: custom.plugin })
                }}</span>
              </span>
            </button>
          }
        </div>
      </div>
    }
  `,
})
export class FieldTypePicker {
  protected readonly store = inject(BuilderStore);
  protected readonly extensions = inject(PluginExtensions);
  protected readonly t = inject(I18n).t;
  protected readonly customFieldId = customFieldId;
  protected readonly attribute = computed(() => this.store.attributeDraft()?.attribute);
}
