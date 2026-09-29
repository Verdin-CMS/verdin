import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';

import { I18n } from '../../core/i18n/i18n';
import { humanize } from './fields/fields';
import { ListFilterBuilder, operatorLabel } from './list-filter-builder';
import { FilterCondition, VALUELESS, conditionKey } from './list-filters';
import { ListSettings } from './list-settings';
import { ContentListState } from './list-state';

/**
 * The bar above the content list: search, locale, filters, the total and the view settings,
 * then the active filters as removable chips.
 */
@Component({
  selector: 'vd-content-list-toolbar',
  imports: [
    NgIcon,
    ListFilterBuilder,
    ListSettings,
    HlmBadgeImports,
    HlmButtonImports,
    HlmInputGroupImports,
    HlmNativeSelectImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <div class="flex flex-wrap items-center gap-3 border-b px-4 py-3">
      @if (list.searchable()) {
        <div hlmInputGroup class="w-full sm:max-w-xs">
          <div hlmInputGroupAddon><ng-icon name="lucideSearch" /></div>
          <input
            hlmInputGroupInput
            type="search"
            [attr.aria-label]="t('common.search')"
            [placeholder]="t('search.placeholder')"
            [value]="list.search()"
            (input)="list.setSearch($any($event.target).value)"
          />
        </div>
      }
      @if (list.localized() && list.locales.list()?.length) {
        <div class="flex items-center gap-2">
          <label for="list-locale" class="text-muted-foreground flex items-center">
            <ng-icon name="lucideLanguages" aria-hidden="true" />
            <span class="sr-only">{{ t('content.locale.label') }}</span>
          </label>
          <hlm-native-select
            selectId="list-locale"
            size="sm"
            class="w-44"
            [value]="list.locale() ?? ''"
            [disabled]="list.running()"
            (valueChange)="list.setLocale($event)"
          >
            @for (option of list.locales.list() ?? []; track option.code) {
              @let readable = list.auth.canInLocale('content.read', list.uid(), option.code);
              <option hlmNativeSelectOption [value]="option.code" [disabled]="!readable">
                {{
                  readable
                    ? option.name + ' (' + option.code + ')'
                    : t('content.locale.notAllowed', {
                        locale: option.name + ' (' + option.code + ')',
                      })
                }}
              </option>
            }
          </hlm-native-select>
        </div>
      }
      <vd-list-filter-builder
        [fields]="list.filterFields()"
        [conditions]="list.conditions()"
        [label]="list.filterLabel"
        (applied)="list.setFilters($event)"
      />
      <span class="text-muted-foreground ms-auto text-sm tabular-nums" aria-live="polite">
        {{ t('content.list.total', { count: list.total() }) }}
      </span>
      @if (list.type(); as type) {
        @if (list.view(); as view) {
          <vd-list-settings
            [type]="type"
            [titleField]="list.titleField()"
            [view]="view"
            [custom]="list.customView()"
            [label]="list.columnLabel"
            (saved)="list.saveView($event)"
            (reset)="list.resetView()"
          />
        }
      }
    </div>

    @if (list.conditions().length) {
      <div
        class="bg-muted/20 flex flex-wrap items-center gap-2 border-b px-4 py-2"
        role="region"
        [attr.aria-label]="t('content.filters.active')"
      >
        <ul class="contents">
          @for (condition of list.conditions(); track $index; let index = $index) {
            @let text = describe(condition);
            <li
              hlmBadge
              variant="secondary"
              class="h-7 max-w-full gap-1 rounded-full py-0 ps-3 pe-1 font-normal"
            >
              <span class="truncate" [title]="text">{{ text }}</span>
              <button
                type="button"
                class="hover:bg-foreground/10 focus-visible:ring-ring/50 inline-flex size-5 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2"
                [attr.aria-label]="t('content.filters.remove', { filter: text })"
                (click)="list.removeFilter(index)"
              >
                <ng-icon name="lucideX" size="12" />
              </button>
            </li>
          }
        </ul>
        <button hlmBtn variant="ghost" size="xs" type="button" (click)="list.setFilters([])">
          {{ t('content.filters.clear') }}
        </button>
      </div>
    }
  `,
})
export class ContentListToolbar {
  protected readonly list = inject(ContentListState);
  private readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  /** "Title contains “news”", for a chip. */
  protected describe(condition: FilterCondition): string {
    const field = this.list.filterFields().find((option) => option.key === conditionKey(condition));
    if (!field) return '';
    const subject =
      VALUELESS.has(condition.operator) && field.relation
        ? humanize(field.field)
        : this.list.filterLabel(field);
    const operator = this.t(operatorLabel(field, condition.operator));
    if (VALUELESS.has(condition.operator)) return `${subject} ${operator}`;
    const values = (Array.isArray(condition.value) ? condition.value : [condition.value]).map(
      (value) => {
        switch (field.kind) {
          case 'boolean':
            return this.t(value === 'true' ? 'common.yes' : 'common.no');
          case 'date':
          case 'datetime':
            return this.i18n.formatDate(value.slice(0, 10), 'date');
          case 'number':
            return this.i18n.formatNumber(value);
          default:
            return `“${value}”`;
        }
      },
    );
    return `${subject} ${operator} ${this.i18n.formatList(values, 'disjunction')}`;
  }
}
