import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmTableImports } from '@spartan-ng/helm/table';

import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/keys';
import { Document } from '../../core/types';
import { StageBadge } from '../../shared/components/stage-badge';
import { ContentListState, EntryStatus } from './list-state';
import { ListColumn } from './list-view';

const STATUS_LABELS = {
  draft: 'content.status.draft',
  published: 'content.status.published',
  modified: 'content.status.modified',
} as const satisfies Record<EntryStatus, MessageKey>;

/** The content list's table: sortable headers, selectable rows, row menu and empty state. */
@Component({
  selector: 'vd-content-list-table',
  imports: [
    RouterLink,
    NgIcon,
    StageBadge,
    HlmBadgeImports,
    HlmButtonImports,
    HlmCheckboxImports,
    HlmDropdownMenuImports,
    HlmEmptyImports,
    HlmSkeletonImports,
    HlmSpinnerImports,
    HlmTableImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <div hlmTableContainer>
      <table hlmTable>
        <thead hlmTHead class="bg-muted/40">
          <tr hlmTr class="hover:bg-transparent">
            @if (list.selectable()) {
              <th hlmTh class="w-10 ps-4 pe-0">
                <hlm-checkbox
                  [aria-label]="t('content.list.selectPage')"
                  [checked]="list.pageSelection() === 'all'"
                  [indeterminate]="list.pageSelection() === 'some'"
                  [disabled]="list.loading() || list.running() || !list.documents().length"
                  (checkedChange)="list.selectPage($event)"
                />
              </th>
            }
            @for (column of list.columns(); track column.name) {
              <th hlmTh class="px-4" [attr.aria-sort]="ariaSort(column.name)">
                @if (column.sortable) {
                  <button
                    type="button"
                    class="hover:text-foreground text-muted-foreground inline-flex items-center gap-1 text-xs font-medium tracking-wide uppercase"
                    [class.text-foreground]="list.activeSort()?.field === column.name"
                    (click)="list.toggleSort(column.name)"
                  >
                    {{ list.columnLabel(column.name) }}
                    @if (list.activeSort(); as active) {
                      @if (active.field === column.name) {
                        <ng-icon
                          [name]="active.descending ? 'lucideArrowDown' : 'lucideArrowUp'"
                          size="12"
                        />
                      }
                    }
                  </button>
                } @else {
                  <span class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    {{ list.columnLabel(column.name) }}
                  </span>
                }
              </th>
            }
            @if (list.localized()) {
              <th hlmTh class="px-4">
                <span class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  {{ t('content.locale.label') }}
                </span>
              </th>
            }
            @if (list.workflow()) {
              <th hlmTh class="px-4">
                <span class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  {{ t('review.list.stage') }}
                </span>
              </th>
            }
            @if (list.canCreate()) {
              <th hlmTh class="w-12 pe-4">
                <span class="sr-only">{{ t('content.list.actions') }}</span>
              </th>
            }
          </tr>
        </thead>
        <tbody hlmTBody>
          @if (list.loading()) {
            @for (row of skeletonRows; track row) {
              <tr hlmTr class="hover:bg-transparent">
                @if (list.selectable()) {
                  <td hlmTd class="ps-4 pe-0"><hlm-skeleton class="size-4" /></td>
                }
                @for (column of list.columns(); track column.name; let first = $first) {
                  <td hlmTd class="px-4 py-3">
                    @if (column.name === 'status') {
                      <hlm-skeleton class="h-5 w-20 rounded-full" />
                    } @else {
                      <hlm-skeleton class="h-4" [class.w-40]="first" [class.w-24]="!first" />
                    }
                  </td>
                }
                @if (list.localized()) {
                  <td hlmTd class="px-4 py-3"><hlm-skeleton class="h-5 w-10" /></td>
                }
                @if (list.workflow()) {
                  <td hlmTd class="px-4 py-3">
                    <hlm-skeleton class="h-5 w-20 rounded-full" />
                  </td>
                }
                @if (list.canCreate()) {
                  <td hlmTd class="pe-4"></td>
                }
              </tr>
            }
          } @else {
            @for (document of list.documents(); track document.documentId) {
              <tr
                hlmTr
                class="cursor-pointer"
                [attr.data-state]="list.selection().has(document.documentId) ? 'selected' : null"
                (click)="list.open(document)"
              >
                @if (list.selectable()) {
                  <td hlmTd class="ps-4 pe-0" (click)="$event.stopPropagation()">
                    <hlm-checkbox
                      [aria-label]="
                        t('content.list.selectEntry', { title: list.titleOf(document) })
                      "
                      [checked]="list.selection().has(document.documentId)"
                      [disabled]="list.running()"
                      (checkedChange)="list.select(document, $event)"
                    />
                  </td>
                }
                @for (column of list.columns(); track column.name) {
                  @if (column.name === 'status') {
                    <td hlmTd class="px-4 py-3">
                      @let state = list.statusOf(document);
                      <span hlmBadge [variant]="state === 'published' ? 'secondary' : 'outline'">
                        <span
                          class="size-1.5 rounded-full"
                          aria-hidden="true"
                          [class]="
                            state === 'published'
                              ? 'bg-emerald-500'
                              : state === 'modified'
                                ? 'bg-amber-500'
                                : 'bg-muted-foreground/60'
                          "
                        ></span>
                        {{ t(STATUS_LABELS[state]) }}
                      </span>
                    </td>
                  } @else if (!column.attribute && column.name !== 'id') {
                    @let when = list.timestampOf(document, column.name);
                    <td
                      hlmTd
                      class="text-muted-foreground px-4 py-3 whitespace-nowrap"
                      [title]="when ? i18n.formatDate(when, 'long') : ''"
                    >
                      {{ when ? i18n.formatRelative(when) : '—' }}
                    </td>
                  } @else {
                    <td
                      hlmTd
                      class="max-w-64 truncate px-4 py-3"
                      [class.font-medium]="column.name === list.main()"
                      [class.text-muted-foreground]="column.name !== list.main()"
                      [class.tabular-nums]="column.name === 'id'"
                    >
                      @if (
                        column.name === list.main() && list.changedRows().has(document.documentId)
                      ) {
                        <span
                          class="me-1.5 inline-block size-2 rounded-full bg-amber-500 align-middle"
                          [title]="t('presence.list.rowChanged')"
                        ></span>
                        <span class="sr-only">{{ t('presence.list.rowChanged') }}</span>
                      }
                      {{ cell(document, column) }}
                    </td>
                  }
                }
                @if (list.localized()) {
                  @let code = list.localeOf(document);
                  <td hlmTd class="px-4 py-3">
                    @if (code) {
                      <span
                        hlmBadge
                        variant="outline"
                        class="font-mono"
                        [title]="list.locales.name(code)"
                        >{{ code }}</span
                      >
                    }
                  </td>
                }
                @if (list.workflow(); as flow) {
                  <td hlmTd class="px-4 py-3">
                    @if (list.stageOfRow(flow, document.documentId); as stage) {
                      <vd-stage-badge [name]="stage.name" [color]="stage.color" />
                    }
                  </td>
                }
                @if (list.canCreate()) {
                  <td hlmTd class="pe-4 text-end" (click)="$event.stopPropagation()">
                    <button
                      hlmBtn
                      variant="ghost"
                      size="icon-sm"
                      type="button"
                      [disabled]="list.running() || list.duplicating() !== null"
                      [attr.aria-label]="
                        t('content.list.rowActions', { title: list.titleOf(document) })
                      "
                      [hlmDropdownMenuTrigger]="rowMenu"
                      [hlmDropdownMenuTriggerData]="{ $implicit: document }"
                      align="end"
                    >
                      @if (list.duplicating() === document.documentId) {
                        <hlm-spinner class="size-4" />
                      } @else {
                        <ng-icon name="lucideEllipsis" />
                      }
                    </button>
                  </td>
                }
              </tr>
            } @empty {
              <tr hlmTr class="hover:bg-transparent">
                <td hlmTd [attr.colspan]="list.colspan()">
                  <div hlmEmpty class="py-12">
                    <div hlmEmptyHeader>
                      <div hlmEmptyMedia variant="icon">
                        <ng-icon
                          [name]="
                            list.search()
                              ? 'lucideSearch'
                              : list.conditions().length
                                ? 'lucideListFilter'
                                : 'lucideFileText'
                          "
                        />
                      </div>
                      <h2 hlmEmptyTitle>
                        {{
                          list.search() || list.conditions().length
                            ? t('content.list.noMatches')
                            : t('content.list.empty')
                        }}
                      </h2>
                      <p hlmEmptyDescription>
                        {{
                          list.search()
                            ? t('content.list.noMatchesHint', { search: list.search() })
                            : list.conditions().length
                              ? t('content.filters.noMatchesHint')
                              : list.canCreate()
                                ? t('content.list.emptyHint')
                                : t('content.list.emptyReadOnly')
                        }}
                      </p>
                    </div>
                    @if (!list.search() && !list.conditions().length && list.canCreate()) {
                      <div hlmEmptyContent>
                        <a
                          hlmBtn
                          variant="outline"
                          size="sm"
                          [routerLink]="['/content', list.uid(), 'new']"
                          [queryParams]="list.localeQuery()"
                          ><ng-icon name="lucidePlus" /> {{ t('content.list.addFirst') }}</a
                        >
                      </div>
                    }
                  </div>
                </td>
              </tr>
            }
          }
        </tbody>
      </table>
    </div>

    <ng-template #rowMenu let-document>
      <hlm-dropdown-menu class="w-44">
        <button hlmDropdownMenuItem (triggered)="list.open(document)">
          <ng-icon name="lucidePencil" /> {{ t('common.edit') }}
        </button>
        <button hlmDropdownMenuItem (triggered)="list.duplicate(document)">
          <ng-icon name="lucideCopyPlus" /> {{ t('content.duplicate.action') }}
        </button>
      </hlm-dropdown-menu>
    </ng-template>
  `,
})
export class ContentListTable {
  protected readonly list = inject(ContentListState);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly STATUS_LABELS = STATUS_LABELS;
  protected readonly skeletonRows = [1, 2, 3, 4, 5];

  protected cell(document: Document, column: ListColumn): string {
    const value = document[column.name];
    if (value === null || value === undefined || value === '') return '—';
    switch (column.attribute?.type) {
      case 'boolean':
        return this.t(value ? 'common.yes' : 'common.no');
      case 'datetime':
        return this.i18n.formatDate(String(value), 'datetime');
      case 'date':
        return this.i18n.formatDate(String(value), 'date');
      case 'integer':
      case 'biginteger':
      case 'float':
      case 'decimal':
        return this.i18n.formatNumber(value as number | string);
      default:
        return String(value);
    }
  }

  protected ariaSort(field: string): 'ascending' | 'descending' | null {
    const sort = this.list.activeSort();
    if (sort?.field !== field) return null;
    return sort.descending ? 'descending' : 'ascending';
  }
}
