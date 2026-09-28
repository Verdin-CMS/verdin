import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { NgIcon } from '@ng-icons/core';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSheetImports } from '@spartan-ng/helm/sheet';

import { I18n, parseDate } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/keys';
import { CalendarButton, toIsoDate } from './fields/controls';
import {
  FilterCondition,
  FilterField,
  FilterOperator,
  VALUELESS,
  blankCondition,
  conditionKey,
  isComplete,
  operatorsFor,
  validValue,
  withOperator,
} from './list-filters';

export const OPERATOR_LABELS = {
  $eq: 'content.filters.op.eq',
  $ne: 'content.filters.op.ne',
  $contains: 'content.filters.op.contains',
  $notContains: 'content.filters.op.notContains',
  $startsWith: 'content.filters.op.startsWith',
  $endsWith: 'content.filters.op.endsWith',
  $lt: 'content.filters.op.lt',
  $lte: 'content.filters.op.lte',
  $gt: 'content.filters.op.gt',
  $gte: 'content.filters.op.gte',
  $in: 'content.filters.op.in',
  $null: 'content.filters.op.null',
  $notNull: 'content.filters.op.notNull',
} as const satisfies Record<FilterOperator, MessageKey>;

/** Dates and timestamps are compared by day: "before" / "after" read better than < and >. */
const DATE_OPERATOR_LABELS: Partial<Record<FilterOperator, MessageKey>> = {
  $lt: 'content.filters.op.before',
  $lte: 'content.filters.op.onOrBefore',
  $gt: 'content.filters.op.after',
  $gte: 'content.filters.op.onOrAfter',
};

/** An operator's label for a field. */
export function operatorLabel(field: FilterField, operator: FilterOperator): MessageKey {
  const dated = field.kind === 'date' || field.kind === 'datetime';
  return (dated && DATE_OPERATOR_LABELS[operator]) || OPERATOR_LABELS[operator];
}

interface Row {
  /** Rendering key. */
  id: number;
  condition: FilterCondition;
}

/** The "Filters" button and the sheet where conditions are built (combined with AND). */
@Component({
  selector: 'vd-list-filter-builder',
  imports: [
    NgTemplateOutlet,
    NgIcon,
    CalendarButton,
    HlmBadgeImports,
    HlmButtonImports,
    HlmCheckboxImports,
    HlmFieldImports,
    HlmInputImports,
    HlmNativeSelectImports,
    HlmSheetImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      hlmBtn
      variant="outline"
      size="sm"
      type="button"
      [disabled]="!fields().length"
      [attr.aria-label]="
        conditions().length
          ? t('content.filters.buttonActive', { count: conditions().length })
          : t('content.filters.button')
      "
      (click)="openSheet()"
    >
      <ng-icon name="lucideListFilter" />
      <span class="hidden sm:inline">{{ t('content.filters.button') }}</span>
      @if (conditions().length) {
        <span hlmBadge variant="secondary" class="tabular-nums" aria-hidden="true">{{
          i18n.formatNumber(conditions().length)
        }}</span>
      }
    </button>

    <hlm-sheet
      [side]="i18n.endSide()"
      [state]="open() ? 'open' : 'closed'"
      (closed)="open.set(false)"
    >
      <hlm-sheet-content *hlmSheetPortal="let ctx" class="w-full gap-0 p-0 sm:max-w-lg">
        <hlm-sheet-header class="border-b p-4">
          <h2 hlmSheetTitle>{{ t('content.filters.title') }}</h2>
          <p hlmSheetDescription>{{ t('content.filters.description') }}</p>
        </hlm-sheet-header>

        <form
          class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
          (submit)="$event.preventDefault(); apply()"
        >
          <ol class="flex flex-col gap-3">
            @for (row of rows(); track row.id; let index = $index) {
              @let field = fieldOf(row.condition);
              <li
                class="bg-muted/30 flex flex-col gap-2 rounded-lg border p-3"
                role="group"
                [attr.aria-label]="t('content.filters.condition', { index: index + 1 })"
              >
                <div class="flex items-center gap-2">
                  @if (index > 0) {
                    <span
                      hlmBadge
                      variant="outline"
                      class="text-muted-foreground text-xs uppercase"
                      >{{ t('content.filters.and') }}</span
                    >
                  }
                  <label class="sr-only" [for]="'filter-field-' + row.id">{{
                    t('content.filters.field')
                  }}</label>
                  <hlm-native-select
                    class="min-w-0 flex-1"
                    size="sm"
                    [selectId]="'filter-field-' + row.id"
                    [value]="conditionKey(row.condition)"
                    (valueChange)="setField(row.id, $event)"
                  >
                    @for (option of fields(); track option.key) {
                      <option hlmNativeSelectOption [value]="option.key">
                        {{ label()(option) }}
                      </option>
                    }
                  </hlm-native-select>
                  <button
                    hlmBtn
                    size="icon-sm"
                    variant="ghost"
                    type="button"
                    class="hover:text-destructive shrink-0"
                    [attr.aria-label]="t('content.filters.removeCondition', { index: index + 1 })"
                    (click)="remove(row.id)"
                  >
                    <ng-icon name="lucideTrash2" />
                  </button>
                </div>
                @if (field) {
                  <div class="flex flex-wrap items-start gap-2">
                    <label class="sr-only" [for]="'filter-operator-' + row.id">{{
                      t('content.filters.operator')
                    }}</label>
                    <hlm-native-select
                      class="w-44"
                      size="sm"
                      [selectId]="'filter-operator-' + row.id"
                      [value]="row.condition.operator"
                      (valueChange)="setOperator(row.id, $event)"
                    >
                      @for (operator of operatorsFor(field); track operator) {
                        <option hlmNativeSelectOption [value]="operator">
                          {{ t(operatorLabel(field, operator)) }}
                        </option>
                      }
                    </hlm-native-select>
                    @if (!valueless.has(row.condition.operator)) {
                      <div class="min-w-40 flex-1">
                        @switch (field.kind) {
                          @case ('boolean') {
                            <label class="sr-only" [for]="'filter-value-' + row.id">{{
                              t('content.filters.value')
                            }}</label>
                            <hlm-native-select
                              size="sm"
                              [selectId]="'filter-value-' + row.id"
                              [value]="stringValue(row.condition)"
                              (valueChange)="setValue(row.id, $event ?? '')"
                            >
                              <option hlmNativeSelectOption value="true">
                                {{ t('common.yes') }}
                              </option>
                              <option hlmNativeSelectOption value="false">
                                {{ t('common.no') }}
                              </option>
                            </hlm-native-select>
                          }
                          @case ('enum') {
                            @if (row.condition.operator === '$in') {
                              <fieldset
                                class="flex flex-wrap gap-x-4 gap-y-2 py-1"
                                [attr.aria-label]="t('content.filters.value')"
                              >
                                @for (option of field.options ?? []; track option) {
                                  <div hlmField orientation="horizontal" class="w-auto">
                                    <hlm-checkbox
                                      [inputId]="'filter-' + row.id + '-' + option"
                                      [checked]="listValue(row.condition).includes(option)"
                                      (checkedChange)="
                                        toggleOption(row.id, option, $event === true)
                                      "
                                    />
                                    <label
                                      hlmFieldLabel
                                      class="font-normal"
                                      [for]="'filter-' + row.id + '-' + option"
                                      >{{ option }}</label
                                    >
                                  </div>
                                }
                              </fieldset>
                            } @else {
                              <label class="sr-only" [for]="'filter-value-' + row.id">{{
                                t('content.filters.value')
                              }}</label>
                              <hlm-native-select
                                size="sm"
                                [selectId]="'filter-value-' + row.id"
                                [value]="stringValue(row.condition)"
                                (valueChange)="setValue(row.id, $event ?? '')"
                              >
                                <option hlmNativeSelectOption value="">—</option>
                                @for (option of field.options ?? []; track option) {
                                  <option hlmNativeSelectOption [value]="option">
                                    {{ option }}
                                  </option>
                                }
                              </hlm-native-select>
                            }
                          }
                          @case ('date') {
                            <ng-container
                              *ngTemplateOutlet="dayPicker; context: { $implicit: row }"
                            />
                          }
                          @case ('datetime') {
                            <ng-container
                              *ngTemplateOutlet="dayPicker; context: { $implicit: row }"
                            />
                          }
                          @case ('time') {
                            <input
                              hlmInput
                              type="time"
                              step="1"
                              class="h-8 w-full"
                              [attr.aria-label]="t('content.filters.value')"
                              [value]="stringValue(row.condition)"
                              (input)="setValue(row.id, $any($event.target).value)"
                            />
                          }
                          @case ('number') {
                            <input
                              hlmInput
                              inputmode="decimal"
                              class="h-8 w-full"
                              [attr.aria-label]="t('content.filters.value')"
                              [attr.aria-invalid]="invalid(row.condition) || null"
                              [value]="stringValue(row.condition)"
                              (input)="setValue(row.id, $any($event.target).value)"
                            />
                          }
                          @default {
                            <input
                              hlmInput
                              class="h-8 w-full"
                              [attr.dir]="field.kind === 'documentId' ? 'ltr' : null"
                              [attr.aria-label]="t('content.filters.value')"
                              [value]="stringValue(row.condition)"
                              (input)="setValue(row.id, $any($event.target).value)"
                            />
                          }
                        }
                      </div>
                    }
                  </div>
                }
              </li>
            } @empty {
              <li class="text-muted-foreground py-6 text-center text-sm">
                {{ t('content.filters.none') }}
              </li>
            }
          </ol>
          <div>
            <button hlmBtn variant="outline" size="sm" type="button" (click)="add()">
              <ng-icon name="lucidePlus" /> {{ t('content.filters.add') }}
            </button>
          </div>
          <button type="submit" class="hidden" tabindex="-1" aria-hidden="true"></button>
        </form>

        <ng-template #dayPicker let-row>
          <label class="sr-only" [for]="'filter-value-' + row.id">{{
            t('content.filters.value')
          }}</label>
          <vd-calendar-button
            [inputId]="'filter-value-' + row.id"
            [date]="dateValue(row.condition)"
            (picked)="setValue(row.id, toIsoDate($event))"
          />
        </ng-template>

        <hlm-sheet-footer class="flex-row flex-wrap justify-between gap-2 border-t p-4">
          <button
            hlmBtn
            variant="ghost"
            type="button"
            [disabled]="!rows().length"
            (click)="clear()"
          >
            {{ t('content.filters.clearAll') }}
          </button>
          <div class="flex gap-2">
            <button hlmBtn variant="outline" type="button" (click)="open.set(false)">
              {{ t('common.cancel') }}
            </button>
            <button hlmBtn type="button" [disabled]="hasInvalid()" (click)="apply()">
              {{ t('content.filters.apply') }}
            </button>
          </div>
        </hlm-sheet-footer>
      </hlm-sheet-content>
    </hlm-sheet>
  `,
})
export class ListFilterBuilder {
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly valueless = VALUELESS;
  protected readonly operatorsFor = operatorsFor;
  protected readonly operatorLabel = operatorLabel;
  protected readonly conditionKey = conditionKey;
  protected readonly toIsoDate = toIsoDate;

  readonly fields = input.required<FilterField[]>();
  /** The applied conditions. */
  readonly conditions = input<FilterCondition[]>([]);
  /** A field's label, shared with the chips. */
  readonly label = input.required<(field: FilterField) => string>();
  readonly applied = output<FilterCondition[]>();

  protected readonly open = signal(false);
  protected readonly rows = signal<Row[]>([]);
  private nextId = 0;

  private readonly byKey = computed(
    () => new Map(this.fields().map((field) => [field.key, field])),
  );

  /** A value that cannot be sent (e.g. letters in a number): Apply waits for a fix. */
  protected readonly hasInvalid = computed(() =>
    this.rows().some((row) => this.invalid(row.condition)),
  );

  protected openSheet(): void {
    const rows = this.conditions().map((condition) => ({ id: ++this.nextId, condition }));
    this.rows.set(rows.length ? rows : this.fields().length ? [this.blankRow()] : []);
    this.open.set(true);
  }

  protected fieldOf(condition: FilterCondition): FilterField | undefined {
    return this.byKey().get(conditionKey(condition));
  }

  protected stringValue(condition: FilterCondition): string {
    return typeof condition.value === 'string' ? condition.value : '';
  }

  protected listValue(condition: FilterCondition): string[] {
    return Array.isArray(condition.value) ? condition.value : [];
  }

  protected dateValue(condition: FilterCondition): Date | null {
    const value = this.stringValue(condition);
    return value ? parseDate(value.slice(0, 10)) : null;
  }

  protected invalid(condition: FilterCondition): boolean {
    const field = this.fieldOf(condition);
    if (!field || VALUELESS.has(condition.operator) || condition.operator === '$in') return false;
    const value = this.stringValue(condition);
    return value.trim() !== '' && !validValue(field, value);
  }

  private blankRow(): Row {
    return { id: ++this.nextId, condition: blankCondition(this.fields()[0]) };
  }

  protected add(): void {
    if (!this.fields().length) return;
    this.rows.update((rows) => [...rows, this.blankRow()]);
  }

  protected remove(id: number): void {
    this.rows.update((rows) => rows.filter((row) => row.id !== id));
  }

  protected clear(): void {
    this.rows.set([]);
  }

  private patch(id: number, change: (condition: FilterCondition) => FilterCondition): void {
    this.rows.update((rows) =>
      rows.map((row) => (row.id === id ? { ...row, condition: change(row.condition) } : row)),
    );
  }

  protected setField(id: number, key: string | null | undefined): void {
    const field = key ? this.byKey().get(key) : undefined;
    if (field) this.patch(id, () => blankCondition(field));
  }

  protected setOperator(id: number, operator: string | null | undefined): void {
    if (operator)
      this.patch(id, (condition) => withOperator(condition, operator as FilterOperator));
  }

  protected setValue(id: number, value: string): void {
    this.patch(id, (condition) => ({ ...condition, value }));
  }

  protected toggleOption(id: number, option: string, checked: boolean): void {
    this.patch(id, (condition) => {
      const current = this.listValue(condition).filter((value) => value !== option);
      const options = this.fieldOf(condition)?.options ?? [];
      const next = checked ? [...current, option] : current;
      // Keep the schema's order.
      return { ...condition, value: options.filter((value) => next.includes(value)) };
    });
  }

  /** Applies the complete conditions (incomplete ones are dropped). */
  protected apply(): void {
    if (this.hasInvalid()) return;
    this.applied.emit(
      this.rows()
        .map((row) => row.condition)
        .filter(isComplete),
    );
    this.open.set(false);
  }
}
