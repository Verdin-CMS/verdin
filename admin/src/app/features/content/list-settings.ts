import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSheetImports } from '@spartan-ng/helm/sheet';

import { I18n } from '../../core/i18n/i18n';
import { ContentType } from '../../core/types';
import {
  ListColumn,
  ListView,
  PAGE_SIZES,
  PageSize,
  availableColumns,
  defaultView,
  mainColumn,
  moveColumn,
} from './list-view';

/** The "Configure the view" button and sheet of the content list. */
@Component({
  selector: 'vd-list-settings',
  imports: [
    NgIcon,
    HlmButtonImports,
    HlmCheckboxImports,
    HlmFieldImports,
    HlmNativeSelectImports,
    HlmSheetImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      hlmBtn
      variant="outline"
      size="sm"
      [attr.aria-label]="t('content.list.view.configure')"
      [title]="t('content.list.view.configure')"
      (click)="openSheet()"
    >
      <ng-icon name="lucideSettings2" />
      <span class="hidden sm:inline">{{ t('content.list.view.configure') }}</span>
    </button>

    <hlm-sheet side="right" [state]="open() ? 'open' : 'closed'" (closed)="open.set(false)">
      <hlm-sheet-content *hlmSheetPortal="let ctx" class="w-full gap-0 p-0 sm:max-w-md">
        <hlm-sheet-header class="border-b p-4">
          <h2 hlmSheetTitle>{{ t('content.list.view.configure') }}</h2>
          <p hlmSheetDescription>{{ t('content.list.view.description') }}</p>
        </hlm-sheet-header>

        <div class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
          <section class="flex flex-col gap-2">
            <h3 class="text-sm font-medium">{{ t('content.list.view.columns') }}</h3>
            <ul class="divide-y rounded-lg border">
              @for (name of order(); track name; let index = $index, first = $first, last = $last) {
                <li class="flex items-center gap-3 px-3 py-2">
                  <hlm-checkbox
                    [inputId]="'list-column-' + name"
                    [checked]="name === main() || visible().has(name)"
                    [disabled]="name === main()"
                    (checkedChange)="toggle(name, $event === true)"
                  />
                  <label class="min-w-0 flex-1 truncate text-sm" [for]="'list-column-' + name">
                    {{ label()(name) }}
                    @if (name === main()) {
                      <span class="text-muted-foreground text-xs">
                        · {{ t('content.list.view.alwaysShown') }}</span
                      >
                    }
                  </label>
                  <button
                    hlmBtn
                    variant="ghost"
                    size="icon-sm"
                    [disabled]="first"
                    [attr.aria-label]="t('content.list.view.moveUp', { column: label()(name) })"
                    (click)="move(index, -1)"
                  >
                    <ng-icon name="lucideChevronUp" />
                  </button>
                  <button
                    hlmBtn
                    variant="ghost"
                    size="icon-sm"
                    [disabled]="last"
                    [attr.aria-label]="t('content.list.view.moveDown', { column: label()(name) })"
                    (click)="move(index, 1)"
                  >
                    <ng-icon name="lucideChevronDown" />
                  </button>
                </li>
              }
            </ul>
          </section>

          <div class="grid gap-4 sm:grid-cols-2">
            <div hlmField>
              <label hlmFieldLabel for="list-sort-field">{{ t('content.list.view.sort') }}</label>
              <hlm-native-select
                selectId="list-sort-field"
                [value]="sortField()"
                (valueChange)="sortField.set($event ?? sortField())"
              >
                @for (column of sortable(); track column.name) {
                  <option hlmNativeSelectOption [value]="column.name">
                    {{ label()(column.name) }}
                  </option>
                }
              </hlm-native-select>
            </div>
            <div hlmField>
              <label hlmFieldLabel for="list-sort-direction">
                {{ t('content.list.view.direction') }}
              </label>
              <hlm-native-select
                selectId="list-sort-direction"
                [value]="descending() ? 'desc' : 'asc'"
                (valueChange)="descending.set($event === 'desc')"
              >
                <option hlmNativeSelectOption value="asc">
                  {{ t('content.list.view.ascending') }}
                </option>
                <option hlmNativeSelectOption value="desc">
                  {{ t('content.list.view.descending') }}
                </option>
              </hlm-native-select>
            </div>
            <div hlmField>
              <label hlmFieldLabel for="list-page-size">{{
                t('content.list.view.pageSize')
              }}</label>
              <hlm-native-select
                selectId="list-page-size"
                [value]="'' + pageSize()"
                (valueChange)="setPageSize($event)"
              >
                @for (size of pageSizes; track size) {
                  <option hlmNativeSelectOption [value]="'' + size">{{ size }}</option>
                }
              </hlm-native-select>
            </div>
          </div>
        </div>

        <hlm-sheet-footer class="flex-row flex-wrap justify-between gap-2 border-t p-4">
          <button hlmBtn variant="ghost" [disabled]="!custom()" (click)="resetView()">
            {{ t('content.list.view.reset') }}
          </button>
          <div class="flex gap-2">
            <button hlmBtn variant="outline" (click)="open.set(false)">
              {{ t('common.cancel') }}
            </button>
            <button hlmBtn (click)="save()">{{ t('common.save') }}</button>
          </div>
        </hlm-sheet-footer>
      </hlm-sheet-content>
    </hlm-sheet>
  `,
})
export class ListSettings {
  protected readonly t = inject(I18n).t;
  protected readonly pageSizes = PAGE_SIZES;

  readonly type = input.required<ContentType>();
  readonly titleField = input<string | null>(null);
  /** The view the list currently applies. */
  readonly view = input.required<ListView>();
  /** Whether the user saved their own view (enables "Reset to default"). */
  readonly custom = input(false);
  /** Column label, shared with the table headers. */
  readonly label = input.required<(name: string) => string>();

  readonly saved = output<ListView>();
  readonly reset = output<void>();

  protected readonly open = signal(false);
  /** Every available column, visible ones first in their shown order. */
  protected readonly order = signal<string[]>([]);
  protected readonly visible = signal<Set<string>>(new Set());
  protected readonly sortField = signal('updatedAt');
  protected readonly descending = signal(true);
  protected readonly pageSize = signal<PageSize>(20);

  protected readonly columns = computed<ListColumn[]>(() => availableColumns(this.type()));
  protected readonly main = computed(() => mainColumn(this.type(), this.titleField()));
  protected readonly sortable = computed(() => this.columns().filter((column) => column.sortable));

  protected openSheet(): void {
    this.load(this.view());
    this.open.set(true);
  }

  private load(view: ListView): void {
    const shown = view.columns;
    const rest = this.columns()
      .map((column) => column.name)
      .filter((name) => !shown.includes(name));
    this.order.set([...shown, ...rest]);
    this.visible.set(new Set(shown));
    this.sortField.set(view.sort.field);
    this.descending.set(view.sort.descending);
    this.pageSize.set(view.pageSize);
  }

  protected toggle(name: string, checked: boolean): void {
    const next = new Set(this.visible());
    if (checked) next.add(name);
    else next.delete(name);
    this.visible.set(next);
  }

  protected move(index: number, offset: number): void {
    this.order.set(moveColumn(this.order(), index, offset));
  }

  protected setPageSize(value: string | null | undefined): void {
    const size = Number(value) as PageSize;
    if (PAGE_SIZES.includes(size)) this.pageSize.set(size);
  }

  protected save(): void {
    const main = this.main();
    this.saved.emit({
      columns: this.order().filter((name) => name === main || this.visible().has(name)),
      sort: { field: this.sortField(), descending: this.descending() },
      pageSize: this.pageSize(),
    });
    this.open.set(false);
  }

  protected resetView(): void {
    this.load(defaultView(this.type(), this.titleField()));
    this.reset.emit();
    this.open.set(false);
  }
}
