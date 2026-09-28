import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmTableImports } from '@spartan-ng/helm/table';

import { Api, ApiFailure, saveDownload, toQuery } from '../../core/api';
import { Auth } from '../../core/auth';
import { EntryDuplicates } from '../../core/duplicate';
import { ContentLocales, isLocalized } from '../../core/content-locales';
import { allowedLocale } from '../../core/permissions';
import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/keys';
import { EntryStage, ReviewWorkflows, Workflow, stageOf } from '../../core/review';
import { Features } from '../../core/features';
import { Schema } from '../../core/schema';
import { Document, PageMeta } from '../../core/types';
import { UsageProbe, Usages } from '../../core/usage';
import { UserPreferences, asObject } from '../../core/user-preferences';
import { PageHeader } from '../../shared/components/page-header';
import { StageBadge } from '../../shared/components/stage-badge';
import { UsageWarning } from '../../shared/components/usage';
import { humanize } from './fields/fields';
import { BULK_CONCURRENCY, BulkAction, failureReason, runLimited, summarize } from './list-bulk';
import { ListFilterBuilder, operatorLabel } from './list-filter-builder';
import { ContentImport } from './list-import';
import {
  FilterCondition,
  FilterField,
  VALUELESS,
  conditionKey,
  filterParams,
  filterTree,
  filterableFields,
  isFilterParam,
  parseFilterParams,
} from './list-filters';
import { ListSettings } from './list-settings';
import {
  ListColumn,
  ListSort,
  ListView,
  PageSize,
  availableColumns,
  defaultView,
  isDefaultView,
  isSearchable,
  listQuery,
  mainColumn,
  resolveView,
} from './list-view';
import { TransferFormat } from './transfer';

type Status = 'draft' | 'published' | 'modified';

const STATUS_LABELS = {
  draft: 'content.status.draft',
  published: 'content.status.published',
  modified: 'content.status.modified',
} as const satisfies Record<Status, MessageKey>;

const SYSTEM_LABELS: Record<string, MessageKey> = {
  id: 'content.list.column.id',
  createdAt: 'content.list.column.createdAt',
  updatedAt: 'content.list.updated',
  status: 'content.list.status',
  publishedAt: 'content.list.column.publishedAt',
};

const BULK_MESSAGES = {
  publish: {
    title: 'content.list.bulk.publishTitle',
    description: 'content.list.bulk.publishDescription',
    done: 'content.list.bulk.published',
    failed: 'content.list.bulk.publishFailed',
  },
  unpublish: {
    title: 'content.list.bulk.unpublishTitle',
    description: 'content.list.bulk.unpublishDescription',
    done: 'content.list.bulk.unpublished',
    failed: 'content.list.bulk.unpublishFailed',
  },
  delete: {
    title: 'content.list.bulk.deleteTitle',
    description: 'content.list.bulk.deleteDescription',
    done: 'content.list.bulk.deleted',
    failed: 'content.list.bulk.deleteFailed',
  },
} as const satisfies Record<BulkAction, Record<string, MessageKey>>;

const DEFAULT_SORT: ListSort = { field: 'updatedAt', descending: true };

/** `updatedAt`/`publishedAt` of a listed draft's published version. */
interface LiveVersion {
  updatedAt: string;
  publishedAt: string | null;
}

@Component({
  selector: 'vd-content-list',
  imports: [
    RouterLink,
    NgIcon,
    PageHeader,
    StageBadge,
    ListSettings,
    ListFilterBuilder,
    ContentImport,
    UsageWarning,
    HlmTableImports,
    HlmDropdownMenuImports,
    HlmButtonImports,
    HlmBadgeImports,
    HlmCheckboxImports,
    HlmInputGroupImports,
    HlmNativeSelectImports,
    HlmSkeletonImports,
    HlmSpinnerImports,
    HlmEmptyImports,
    HlmAlertImports,
    HlmAlertDialogImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (type(); as type) {
      <div class="flex flex-col gap-6">
        <vd-page-header [title]="type.displayName" [description]="type.description">
          <div actions class="flex flex-wrap items-center gap-2">
            @if (canImport()) {
              <button hlmBtn variant="outline" type="button" (click)="importing.set(true)">
                <ng-icon name="lucideUpload" /> {{ t('transfer.import.button') }}
              </button>
            }
            @if (canExport()) {
              <button
                hlmBtn
                variant="outline"
                type="button"
                [disabled]="exporting()"
                [hlmDropdownMenuTrigger]="exportMenu"
                align="end"
              >
                @if (exporting()) {
                  <hlm-spinner class="size-4" />
                } @else {
                  <ng-icon name="lucideDownload" />
                }
                {{ t('transfer.export.button') }}
                <ng-icon name="lucideChevronDown" size="14" />
              </button>
            }
            @if (canCreate()) {
              <a hlmBtn [routerLink]="['/content', type.uid, 'new']" [queryParams]="localeQuery()"
                ><ng-icon name="lucidePlus" /> {{ t('common.create') }}</a
              >
            }
          </div>
        </vd-page-header>

        @if (error()) {
          <div hlmAlert variant="destructive">
            <ng-icon name="lucideCircleAlert" />
            <p hlmAlertTitle>{{ error() }}</p>
          </div>
        }

        <div class="bg-card overflow-hidden rounded-xl border shadow-xs">
          <div class="flex flex-wrap items-center gap-3 border-b px-4 py-3">
            @if (searchable()) {
              <div hlmInputGroup class="w-full sm:max-w-xs">
                <div hlmInputGroupAddon><ng-icon name="lucideSearch" /></div>
                <input
                  hlmInputGroupInput
                  type="search"
                  [attr.aria-label]="t('common.search')"
                  [placeholder]="t('search.placeholder')"
                  [value]="search()"
                  (input)="setSearch($any($event.target).value)"
                />
              </div>
            }
            @if (localized() && locales.list()?.length) {
              <div class="flex items-center gap-2">
                <label for="list-locale" class="text-muted-foreground flex items-center">
                  <ng-icon name="lucideLanguages" aria-hidden="true" />
                  <span class="sr-only">{{ t('content.locale.label') }}</span>
                </label>
                <hlm-native-select
                  selectId="list-locale"
                  size="sm"
                  class="w-44"
                  [value]="locale() ?? ''"
                  [disabled]="running()"
                  (valueChange)="setLocale($event)"
                >
                  @for (option of locales.list() ?? []; track option.code) {
                    @let readable = auth.canInLocale('content.read', uid(), option.code);
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
              [fields]="filterFields()"
              [conditions]="conditions()"
              [label]="filterLabel"
              (applied)="setFilters($event)"
            />
            <span class="text-muted-foreground ms-auto text-sm tabular-nums" aria-live="polite">
              {{ t('content.list.total', { count: total() }) }}
            </span>
            @if (view(); as view) {
              <vd-list-settings
                [type]="type"
                [titleField]="titleField()"
                [view]="view"
                [custom]="customView()"
                [label]="columnLabel"
                (saved)="saveView($event)"
                (reset)="resetView()"
              />
            }
          </div>

          @if (conditions().length) {
            <div
              class="bg-muted/20 flex flex-wrap items-center gap-2 border-b px-4 py-2"
              role="region"
              [attr.aria-label]="t('content.filters.active')"
            >
              <ul class="contents">
                @for (condition of conditions(); track $index; let index = $index) {
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
                      (click)="removeFilter(index)"
                    >
                      <ng-icon name="lucideX" size="12" />
                    </button>
                  </li>
                }
              </ul>
              <button hlmBtn variant="ghost" size="xs" type="button" (click)="setFilters([])">
                {{ t('content.filters.clear') }}
              </button>
            </div>
          }

          <div hlmTableContainer>
            <table hlmTable>
              <thead hlmTHead class="bg-muted/40">
                <tr hlmTr class="hover:bg-transparent">
                  @if (selectable()) {
                    <th hlmTh class="w-10 ps-4 pe-0">
                      <hlm-checkbox
                        [aria-label]="t('content.list.selectPage')"
                        [checked]="pageSelection() === 'all'"
                        [indeterminate]="pageSelection() === 'some'"
                        [disabled]="loading() || running() || !documents().length"
                        (checkedChange)="selectPage($event)"
                      />
                    </th>
                  }
                  @for (column of columns(); track column.name) {
                    <th hlmTh class="px-4" [attr.aria-sort]="ariaSort(column.name)">
                      @if (column.sortable) {
                        <button
                          type="button"
                          class="hover:text-foreground text-muted-foreground inline-flex items-center gap-1 text-xs font-medium tracking-wide uppercase"
                          [class.text-foreground]="activeSort()?.field === column.name"
                          (click)="toggleSort(column.name)"
                        >
                          {{ columnLabel(column.name) }}
                          @if (activeSort(); as active) {
                            @if (active.field === column.name) {
                              <ng-icon
                                [name]="active.descending ? 'lucideArrowDown' : 'lucideArrowUp'"
                                size="12"
                              />
                            }
                          }
                        </button>
                      } @else {
                        <span
                          class="text-muted-foreground text-xs font-medium tracking-wide uppercase"
                        >
                          {{ columnLabel(column.name) }}
                        </span>
                      }
                    </th>
                  }
                  @if (localized()) {
                    <th hlmTh class="px-4">
                      <span
                        class="text-muted-foreground text-xs font-medium tracking-wide uppercase"
                      >
                        {{ t('content.locale.label') }}
                      </span>
                    </th>
                  }
                  @if (workflow()) {
                    <th hlmTh class="px-4">
                      <span
                        class="text-muted-foreground text-xs font-medium tracking-wide uppercase"
                      >
                        {{ t('review.list.stage') }}
                      </span>
                    </th>
                  }
                  @if (canCreate()) {
                    <th hlmTh class="w-12 pe-4">
                      <span class="sr-only">{{ t('content.list.actions') }}</span>
                    </th>
                  }
                </tr>
              </thead>
              <tbody hlmTBody>
                @if (loading()) {
                  @for (row of skeletonRows; track row) {
                    <tr hlmTr class="hover:bg-transparent">
                      @if (selectable()) {
                        <td hlmTd class="ps-4 pe-0"><hlm-skeleton class="size-4" /></td>
                      }
                      @for (column of columns(); track column.name; let first = $first) {
                        <td hlmTd class="px-4 py-3">
                          @if (column.name === 'status') {
                            <hlm-skeleton class="h-5 w-20 rounded-full" />
                          } @else {
                            <hlm-skeleton class="h-4" [class.w-40]="first" [class.w-24]="!first" />
                          }
                        </td>
                      }
                      @if (localized()) {
                        <td hlmTd class="px-4 py-3"><hlm-skeleton class="h-5 w-10" /></td>
                      }
                      @if (workflow()) {
                        <td hlmTd class="px-4 py-3">
                          <hlm-skeleton class="h-5 w-20 rounded-full" />
                        </td>
                      }
                      @if (canCreate()) {
                        <td hlmTd class="pe-4"></td>
                      }
                    </tr>
                  }
                } @else {
                  @for (document of documents(); track document.documentId) {
                    <tr
                      hlmTr
                      class="cursor-pointer"
                      [attr.data-state]="selection().has(document.documentId) ? 'selected' : null"
                      (click)="open(document)"
                    >
                      @if (selectable()) {
                        <td hlmTd class="ps-4 pe-0" (click)="$event.stopPropagation()">
                          <hlm-checkbox
                            [aria-label]="
                              t('content.list.selectEntry', { title: titleOf(document) })
                            "
                            [checked]="selection().has(document.documentId)"
                            [disabled]="running()"
                            (checkedChange)="select(document, $event)"
                          />
                        </td>
                      }
                      @for (column of columns(); track column.name) {
                        @if (column.name === 'status') {
                          <td hlmTd class="px-4 py-3">
                            @let state = statusOf(document);
                            <span
                              hlmBadge
                              [variant]="state === 'published' ? 'secondary' : 'outline'"
                            >
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
                          @let when = timestampOf(document, column.name);
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
                            [class.font-medium]="column.name === main()"
                            [class.text-muted-foreground]="column.name !== main()"
                            [class.tabular-nums]="column.name === 'id'"
                          >
                            {{ cell(document, column) }}
                          </td>
                        }
                      }
                      @if (localized()) {
                        @let code = localeOf(document);
                        <td hlmTd class="px-4 py-3">
                          @if (code) {
                            <span
                              hlmBadge
                              variant="outline"
                              class="font-mono"
                              [title]="locales.name(code)"
                              >{{ code }}</span
                            >
                          }
                        </td>
                      }
                      @if (workflow(); as flow) {
                        <td hlmTd class="px-4 py-3">
                          @if (stageOfRow(flow, document.documentId); as stage) {
                            <vd-stage-badge [name]="stage.name" [color]="stage.color" />
                          }
                        </td>
                      }
                      @if (canCreate()) {
                        <td hlmTd class="pe-4 text-end" (click)="$event.stopPropagation()">
                          <button
                            hlmBtn
                            variant="ghost"
                            size="icon-sm"
                            type="button"
                            [disabled]="running() || duplicating() !== null"
                            [attr.aria-label]="
                              t('content.list.rowActions', { title: titleOf(document) })
                            "
                            [hlmDropdownMenuTrigger]="rowMenu"
                            [hlmDropdownMenuTriggerData]="{ $implicit: document }"
                            align="end"
                          >
                            @if (duplicating() === document.documentId) {
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
                      <td hlmTd [attr.colspan]="colspan()">
                        <div hlmEmpty class="py-12">
                          <div hlmEmptyHeader>
                            <div hlmEmptyMedia variant="icon">
                              <ng-icon
                                [name]="
                                  search()
                                    ? 'lucideSearch'
                                    : conditions().length
                                      ? 'lucideListFilter'
                                      : 'lucideFileText'
                                "
                              />
                            </div>
                            <h2 hlmEmptyTitle>
                              {{
                                search() || conditions().length
                                  ? t('content.list.noMatches')
                                  : t('content.list.empty')
                              }}
                            </h2>
                            <p hlmEmptyDescription>
                              {{
                                search()
                                  ? t('content.list.noMatchesHint', { search: search() })
                                  : conditions().length
                                    ? t('content.filters.noMatchesHint')
                                    : canCreate()
                                      ? t('content.list.emptyHint')
                                      : t('content.list.emptyReadOnly')
                              }}
                            </p>
                          </div>
                          @if (!search() && !conditions().length && canCreate()) {
                            <div hlmEmptyContent>
                              <a
                                hlmBtn
                                variant="outline"
                                size="sm"
                                [routerLink]="['/content', type.uid, 'new']"
                                [queryParams]="localeQuery()"
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

          @if (pageCount() > 1) {
            <div class="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3">
              <span class="text-muted-foreground me-auto text-sm tabular-nums">
                {{ t('common.page', { page: page(), count: pageCount() }) }}
              </span>
              <button
                hlmBtn
                variant="outline"
                size="sm"
                [disabled]="page() <= 1 || running()"
                (click)="page.set(page() - 1)"
              >
                <ng-icon name="lucideArrowLeft" class="rtl:-scale-x-100" />
                {{ t('common.previous') }}
              </button>
              <button
                hlmBtn
                variant="outline"
                size="sm"
                [disabled]="page() >= pageCount() || running()"
                (click)="page.set(page() + 1)"
              >
                {{ t('common.next') }}
                <ng-icon name="lucideChevronRight" class="rtl:-scale-x-100" />
              </button>
            </div>
          }
        </div>

        @if (selected().length || running()) {
          <div
            class="bg-popover text-popover-foreground sticky bottom-4 z-20 mx-auto flex w-full max-w-2xl flex-wrap items-center gap-2 rounded-xl border px-4 py-2 shadow-lg"
            role="region"
            [attr.aria-label]="t('content.list.bulk.selected', { count: selected().length })"
          >
            @if (progress(); as progress) {
              <hlm-spinner class="size-4" />
              <span class="text-sm tabular-nums" aria-live="polite">
                {{
                  t('content.list.bulk.progress', { done: progress.done, total: progress.total })
                }}
              </span>
            } @else {
              <span class="text-sm font-medium tabular-nums">
                {{ t('content.list.bulk.selected', { count: selected().length }) }}
              </span>
              <button hlmBtn variant="ghost" size="sm" (click)="clearSelection()">
                {{ t('content.list.bulk.clear') }}
              </button>
              <div class="ms-auto flex flex-wrap gap-2">
                @if (canPublish()) {
                  <button hlmBtn variant="outline" size="sm" (click)="request('publish')">
                    <ng-icon name="lucideSend" /> {{ t('content.list.bulk.publish') }}
                  </button>
                  @if (targets('unpublish').length) {
                    <button hlmBtn variant="outline" size="sm" (click)="request('unpublish')">
                      <ng-icon name="lucideEyeOff" /> {{ t('content.list.bulk.unpublish') }}
                    </button>
                  }
                }
                @if (canDelete()) {
                  <button hlmBtn variant="destructive" size="sm" (click)="request('delete')">
                    <ng-icon name="lucideTrash2" /> {{ t('common.delete') }}
                  </button>
                }
              </div>
            }
          </div>
        }
      </div>

      <ng-template #rowMenu let-document>
        <hlm-dropdown-menu class="w-44">
          <button hlmDropdownMenuItem (triggered)="open(document)">
            <ng-icon name="lucidePencil" /> {{ t('common.edit') }}
          </button>
          <button hlmDropdownMenuItem (triggered)="duplicate(document)">
            <ng-icon name="lucideCopyPlus" /> {{ t('content.duplicate.action') }}
          </button>
        </hlm-dropdown-menu>
      </ng-template>

      <ng-template #exportMenu>
        <hlm-dropdown-menu class="w-60">
          <div hlmDropdownMenuLabel class="text-muted-foreground text-xs font-normal">
            {{ t('transfer.export.hint') }}
          </div>
          <button hlmDropdownMenuItem (triggered)="export('csv')">
            <ng-icon name="lucideFileText" /> {{ t('transfer.export.csv') }}
          </button>
          <button hlmDropdownMenuItem (triggered)="export('json')">
            <ng-icon name="lucideBraces" /> {{ t('transfer.export.json') }}
          </button>
        </hlm-dropdown-menu>
      </ng-template>

      <vd-content-import
        [type]="type"
        [locale]="locale()"
        [open]="importing()"
        [canPublish]="canPublish()"
        (closed)="importing.set(false)"
        (imported)="reloads.update((count) => count + 1)"
      />

      <hlm-alert-dialog [state]="confirming() ? 'open' : 'closed'" (closed)="confirming.set(null)">
        <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
          @if (confirming(); as action) {
            <hlm-alert-dialog-header>
              <h2 hlmAlertDialogTitle>
                {{ t(BULK_MESSAGES[action].title, { count: targets(action).length }) }}
              </h2>
              <p hlmAlertDialogDescription>{{ t(BULK_MESSAGES[action].description) }}</p>
            </hlm-alert-dialog-header>
            @if (action === 'delete') {
              <vd-usage-warning [state]="deleteUsage.state()" />
            }
            <hlm-alert-dialog-footer>
              <button hlmAlertDialogCancel (click)="ctx.close()">{{ t('common.cancel') }}</button>
              <button
                hlmAlertDialogAction
                [variant]="action === 'delete' ? 'destructive' : 'default'"
                (click)="ctx.close(); run(action)"
              >
                {{
                  action === 'delete'
                    ? t('common.delete')
                    : action === 'publish'
                      ? t('content.list.bulk.publish')
                      : t('content.list.bulk.unpublish')
                }}
              </button>
            </hlm-alert-dialog-footer>
          }
        </hlm-alert-dialog-content>
      </hlm-alert-dialog>
    }
  `,
})
export class ContentList {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly preferences = inject(UserPreferences);
  protected readonly locales = inject(ContentLocales);
  protected readonly auth = inject(Auth);
  protected readonly schema = inject(Schema);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  private readonly features = inject(Features);
  private readonly review = inject(ReviewWorkflows);
  private readonly route = inject(ActivatedRoute);
  private readonly duplicates = inject(EntryDuplicates);

  /** The type's review workflow (feature on and a workflow set), for the Stage column. */
  protected readonly workflow = signal<Workflow | null>(null);
  /** Stored stages of the listed entries (others are at the first stage). */
  protected readonly rowStages = signal<Map<string, EntryStage>>(new Map());
  protected readonly humanize = humanize;
  protected readonly STATUS_LABELS = STATUS_LABELS;
  protected readonly BULK_MESSAGES = BULK_MESSAGES;
  protected readonly skeletonRows = [1, 2, 3, 4, 5];

  readonly uid = input.required<string>();

  protected readonly type = computed(() => this.schema.type(this.uid()));
  protected readonly titleField = computed(() => {
    const type = this.type();
    return type ? this.schema.titleField(type) : null;
  });
  protected readonly main = computed(() => {
    const type = this.type();
    return type ? mainColumn(type, this.titleField()) : 'id';
  });

  protected readonly localized = computed(() => isLocalized(this.type()));
  /** The listed locale (localized types): the last one chosen for the type, else the default. */
  protected readonly locale = computed(() => {
    if (!this.localized()) return null;
    const saved = asObject(this.preferences.value()['listLocales'])[this.uid()];
    const preferred = this.locales.resolve(typeof saved === 'string' ? saved : null);
    // An admin limited to some locales lists one of them.
    const codes = (this.locales.list() ?? []).map((locale) => locale.code);
    return allowedLocale(this.auth.permissions(), 'content.read', this.uid(), codes, preferred);
  });
  protected readonly localeQuery = computed(() => {
    const locale = this.locale();
    return locale ? { locale } : {};
  });

  /** The view saved for this type, as stored (validated by `resolveView`). */
  private readonly savedView = computed(
    () => asObject(this.preferences.value()['listViews'])[this.uid()],
  );
  protected readonly customView = computed(() => this.savedView() !== undefined);
  protected readonly view = computed<ListView | null>(() => {
    const type = this.type();
    return type ? resolveView(this.savedView(), type, this.titleField()) : null;
  });
  protected readonly columns = computed<ListColumn[]>(() => {
    const type = this.type();
    const view = this.view();
    if (!type || !view) return [];
    const byName = new Map(availableColumns(type).map((column) => [column.name, column]));
    return view.columns.flatMap((name) => byName.get(name) ?? []);
  });

  /** Actions in the listed locale (permissions may be limited to some locales). */
  protected readonly canCreate = computed(() =>
    this.auth.canInLocale('content.create', this.uid(), this.locale()),
  );
  protected readonly canDelete = computed(() =>
    this.auth.canInLocale('content.delete', this.uid(), this.locale()),
  );
  protected readonly canPublish = computed(
    () =>
      this.type()?.draftAndPublish === true &&
      this.auth.canInLocale('content.publish', this.uid(), this.locale()),
  );
  protected readonly selectable = computed(() => this.canDelete() || this.canPublish());
  /** Importing creates rows or updates the documents they name. */
  protected readonly canImport = computed(
    () =>
      this.auth.canInLocale('content.create', this.uid(), this.locale()) ||
      this.auth.canInLocale('content.update', this.uid(), this.locale()),
  );
  protected readonly canExport = computed(() =>
    this.auth.canInLocale('content.read', this.uid(), this.locale()),
  );
  /** Text fields `_q` searches (see `isSearchable`). */
  protected readonly searchable = computed(() => {
    const type = this.type();
    return !!type && isSearchable(type);
  });
  protected readonly importing = signal(false);
  protected readonly exporting = signal(false);
  private readonly usages = inject(Usages);
  /** Where the entries about to be deleted are used. */
  protected readonly deleteUsage = new UsageProbe();
  protected readonly colspan = computed(
    () =>
      this.columns().length +
      (this.selectable() ? 1 : 0) +
      (this.localized() ? 1 : 0) +
      (this.workflow() ? 1 : 0) +
      (this.canCreate() ? 1 : 0),
  );

  /** The entry being duplicated (its row shows a spinner). */
  protected readonly duplicating = signal<string | null>(null);

  // Filters: kept in the URL (`filters[$and][i][field][$op]=value`).
  private readonly queryParams = toSignal(this.route.queryParams, { initialValue: {} as Params });
  protected readonly filterFields = computed<FilterField[]>(() => {
    const type = this.type();
    if (!type) return [];
    return filterableFields(type, (target) => {
      const targetType = this.schema.type(target);
      return targetType ? this.schema.titleField(targetType) : null;
    });
  });
  protected readonly conditions = computed<FilterCondition[]>(
    () => parseFilterParams(this.queryParams(), this.filterFields()),
    { equal: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
  );

  /** Bumped to reload the current page. */
  protected readonly reloads = signal(0);
  /** A different type starts unfiltered; defaults apply once the preferences are in. */
  private readonly viewSource = computed(
    () => ({
      uid: this.uid(),
      ready:
        this.preferences.loaded() && !!this.type() && (!this.localized() || this.locales.loaded()),
    }),
    { equal: (a, b) => a.uid === b.uid && a.ready === b.ready },
  );
  /** Full-text search (`_q`), kept in the URL like the filters. */
  protected readonly search = computed(() => {
    const value = this.queryParams()['_q'];
    return typeof value === 'string' ? value : '';
  });
  protected readonly sort = linkedSignal<unknown, ListSort>({
    source: this.viewSource,
    computation: () => untracked(() => ({ ...(this.view()?.sort ?? DEFAULT_SORT) })),
  });
  /** A sort the user picked (a column, or a saved view): searches keep it. */
  private readonly sortChosen = linkedSignal<unknown, boolean>({
    source: this.viewSource,
    computation: () =>
      untracked(() => {
        const sort = this.view()?.sort ?? DEFAULT_SORT;
        return sort.field !== DEFAULT_SORT.field || sort.descending !== DEFAULT_SORT.descending;
      }),
  });
  /** The sort requested: none while searching without a chosen one (results come by rank). */
  protected readonly activeSort = computed<ListSort | null>(() =>
    this.search() && !this.sortChosen() ? null : this.sort(),
  );
  protected readonly pageSize = linkedSignal<unknown, PageSize>({
    source: this.viewSource,
    computation: () => untracked(() => this.view()?.pageSize ?? 20),
  });
  /** Back to the first page whenever what is listed changes. */
  protected readonly page = linkedSignal({
    source: () => [
      this.uid(),
      this.locale(),
      this.search(),
      this.conditions(),
      this.activeSort(),
      this.pageSize(),
    ],
    computation: () => 1,
  });
  /** Selected document ids; only ever entries of the current page. */
  protected readonly selection = linkedSignal<unknown, Set<string>>({
    source: () => [
      this.uid(),
      this.locale(),
      this.page(),
      this.search(),
      this.conditions(),
      this.activeSort(),
      this.pageSize(),
      this.reloads(),
    ],
    computation: () => new Set(),
  });

  protected readonly documents = signal<Document[]>([]);
  protected readonly meta = signal<PageMeta>({});
  protected readonly published = signal<Map<string, LiveVersion>>(new Map());
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly total = computed(() => this.meta().total ?? 0);
  protected readonly pageCount = computed(() => this.meta().pageCount ?? 1);

  protected readonly selected = computed(() =>
    this.documents().filter((document) => this.selection().has(document.documentId)),
  );
  protected readonly pageSelection = computed<'none' | 'some' | 'all'>(() => {
    const count = this.selected().length;
    if (!count) return 'none';
    return count === this.documents().length ? 'all' : 'some';
  });
  /** The bulk action waiting for confirmation. */
  protected readonly confirming = signal<BulkAction | null>(null);
  protected readonly progress = signal<{ done: number; total: number } | null>(null);
  protected readonly running = computed(() => this.progress() !== null);

  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  /** Identifies the latest list request; older responses are dropped. */
  private requests = 0;

  protected readonly columnLabel = (name: string): string => {
    const system = SYSTEM_LABELS[name];
    return system && !this.type()?.attributes[name] ? this.t(system) : humanize(name);
  };

  constructor() {
    void this.preferences.load();
    // Needed by localized types only; the list waits for it then.
    this.locales.load().catch((error) => {
      if (this.localized()) this.error.set(ApiFailure.from(error).message);
    });
    effect(() => {
      const request = {
        uid: this.uid(),
        locale: this.locale(),
        page: this.page(),
        pageSize: this.pageSize(),
        search: this.search(),
        conditions: this.conditions(),
        sort: this.activeSort(),
      };
      this.reloads();
      if (!this.viewSource().ready) return;
      untracked(() => void this.load(request));
    });
    effect(() => {
      this.uid();
      clearTimeout(this.searchTimer);
    });
  }

  private async load(request: {
    uid: string;
    locale: string | null;
    page: number;
    pageSize: number;
    search: string;
    conditions: FilterCondition[];
    sort: ListSort | null;
  }): Promise<void> {
    const current = ++this.requests;
    this.loading.set(true);
    this.error.set(null);
    const query = {
      ...listQuery(request, filterTree(request.conditions)),
      pagination: { page: request.page, pageSize: request.pageSize },
    };
    try {
      const response = await this.api.list<Document>(`/content/${request.uid}`, toQuery(query));
      if (current !== this.requests) return;
      const meta = response.meta.pagination ?? {};
      // The page emptied (e.g. its entries were deleted): show the last one instead.
      if (!response.data.length && request.page > 1 && (meta.pageCount ?? 1) < request.page) {
        this.page.set(Math.max(1, meta.pageCount ?? 1));
        return;
      }
      await this.loadPublished(request.uid, request.locale, response.data);
      if (current !== this.requests) return;
      this.documents.set(response.data);
      this.meta.set(meta);
      void this.loadStages(current, request.uid, request.locale, response.data);
    } catch (error) {
      if (current === this.requests) this.error.set(ApiFailure.from(error).message);
    } finally {
      if (current === this.requests) this.loading.set(false);
    }
  }

  /** The review stages of the listed entries and the type's workflow, in one call. */
  private async loadStages(
    current: number,
    uid: string,
    locale: string | null,
    documents: Document[],
  ): Promise<void> {
    if (!this.features.enabled('review') || !documents.length) {
      this.workflow.set(null);
      this.rowStages.set(new Map());
      return;
    }
    const ids = documents.map((document) => document.documentId);
    try {
      const { entries, workflow } = await this.review.entries(uid, ids, locale);
      if (current !== this.requests) return;
      this.workflow.set(workflow);
      this.rowStages.set(new Map(entries.map((row) => [row.documentId, row])));
    } catch {
      if (current !== this.requests) return;
      this.workflow.set(null);
      this.rowStages.set(new Map());
    }
  }

  protected stageOfRow(workflow: Workflow, documentId: string) {
    const row = this.rowStages().get(documentId);
    return row ? stageOf(workflow, row.stageId) : (workflow.stages[0] ?? null);
  }

  /** The published versions of the listed drafts. */
  private async loadPublished(
    uid: string,
    locale: string | null,
    documents: Document[],
  ): Promise<void> {
    if (!this.type()?.draftAndPublish || !documents.length) {
      this.published.set(new Map());
      return;
    }
    const ids = Object.fromEntries(
      documents.map((document, index) => [index, document.documentId]),
    );
    const query = toQuery({
      status: 'published',
      fields: { 0: 'updatedAt', 1: 'publishedAt' },
      pagination: { pageSize: documents.length },
      filters: { documentId: { $in: ids } },
      locale,
    });
    const response = await this.api.list<Document>(`/content/${uid}`, query);
    this.published.set(
      new Map(
        response.data.map((document) => [
          document.documentId,
          {
            updatedAt: String(document.updatedAt),
            publishedAt: document.publishedAt ? String(document.publishedAt) : null,
          },
        ]),
      ),
    );
  }

  protected statusOf(document: Document): Status {
    const live = this.published().get(document.documentId);
    if (!live) return 'draft';
    return String(document.updatedAt) > live.updatedAt ? 'modified' : 'published';
  }

  /** A built-in timestamp column's value (`publishedAt` comes from the live version). */
  protected timestampOf(document: Document, name: string): string | null {
    const value =
      name === 'publishedAt'
        ? this.published().get(document.documentId)?.publishedAt
        : document[name];
    return typeof value === 'string' && value ? value : null;
  }

  protected titleOf(document: Document): string {
    const field = this.titleField();
    const title = field ? document[field] : null;
    return typeof title === 'string' && title.trim() ? title : `#${document.id}`;
  }

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
    const sort = this.activeSort();
    if (sort?.field !== field) return null;
    return sort.descending ? 'descending' : 'ascending';
  }

  protected toggleSort(field: string): void {
    const current = this.activeSort();
    this.sortChosen.set(true);
    this.sort.set({ field, descending: current?.field === field ? !current.descending : false });
  }

  /** Searches once typing pauses; the URL follows without adding history entries. */
  protected setSearch(value: string): void {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      const text = value.trim();
      if (text === this.search()) return;
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { _q: text || null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }, 250);
  }

  /** Downloads the list as it is filtered, searched and sorted (every page). */
  protected async export(format: TransferFormat): Promise<void> {
    const type = this.type();
    if (!type || this.exporting()) return;
    this.exporting.set(true);
    const query = toQuery({
      ...listQuery(
        {
          locale: this.locale(),
          search: this.search(),
          sort: this.activeSort(),
        },
        filterTree(this.conditions()),
      ),
      format,
    });
    try {
      const file = await this.api.download(
        `/content/${type.uid}/export`,
        query,
        `${type.pluralName}.${format}`,
      );
      saveDownload(file);
      toast.success(this.t('transfer.export.done', { name: file.name }));
    } catch (error) {
      toast.error(this.t('transfer.export.failed'), {
        description: ApiFailure.from(error).message,
      });
    } finally {
      this.exporting.set(false);
    }
  }

  /** The locale of a listed version (localized types). */
  protected localeOf(document: Document): string | null {
    const locale = document['locale'];
    return typeof locale === 'string' && locale ? locale : this.locale();
  }

  protected readonly filterLabel = (field: FilterField): string => {
    if (!field.path) return this.columnLabel(field.field);
    return this.t('content.filters.relationField', {
      relation: humanize(field.field),
      field:
        field.path === 'documentId' ? this.t('content.filters.documentId') : humanize(field.path),
    });
  };

  /** "Title contains “news”", for a chip. */
  protected describe(condition: FilterCondition): string {
    const field = this.filterFields().find((option) => option.key === conditionKey(condition));
    if (!field) return '';
    const subject =
      VALUELESS.has(condition.operator) && field.relation
        ? humanize(field.field)
        : this.filterLabel(field);
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

  /** Applies filters: a new history entry, so going back restores the previous ones. */
  protected setFilters(conditions: FilterCondition[]): void {
    const kept = Object.fromEntries(
      Object.entries(this.queryParams()).filter(([key]) => !isFilterParam(key)),
    );
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { ...kept, ...filterParams(conditions) },
    });
  }

  protected removeFilter(index: number): void {
    this.setFilters(this.conditions().filter((_, position) => position !== index));
  }

  protected async duplicate(document: Document): Promise<void> {
    if (this.duplicating()) return;
    this.duplicating.set(document.documentId);
    try {
      await this.duplicates.duplicate(this.uid(), document.documentId, this.locale(), (name) =>
        this.columnLabel(name),
      );
    } finally {
      this.duplicating.set(null);
    }
  }

  protected open(document: Document): void {
    void this.router.navigate(['/content', this.uid(), document.documentId], {
      queryParams: this.localeQuery(),
    });
  }

  /** Lists another locale; the choice is remembered per type (the default is not stored). */
  protected setLocale(code: string | null | undefined): void {
    const type = this.type();
    if (!type || !code || code === this.locale()) return;
    const stored = code === this.locales.defaultCode() ? undefined : code;
    this.preferences
      .set(['listLocales', type.uid], stored)
      .catch((error) => toast.error(ApiFailure.from(error).message));
  }

  // Selection and bulk actions

  protected select(document: Document, checked: boolean): void {
    const next = new Set(this.selection());
    if (checked) next.add(document.documentId);
    else next.delete(document.documentId);
    this.selection.set(next);
  }

  protected selectPage(checked: boolean): void {
    // From "some", the header checkbox selects the whole page.
    const all = checked || this.pageSelection() === 'some';
    this.selection.set(
      all ? new Set(this.documents().map((document) => document.documentId)) : new Set(),
    );
  }

  protected clearSelection(): void {
    this.selection.set(new Set());
  }

  /** The selected entries an action applies to (unpublish: only those with a live version). */
  protected targets(action: BulkAction): Document[] {
    const selected = this.selected();
    return action === 'unpublish'
      ? selected.filter((document) => this.published().has(document.documentId))
      : selected;
  }

  /** Deleting always asks first; publishing and unpublishing when there are several. */
  protected request(action: BulkAction): void {
    const targets = this.targets(action);
    if (!targets.length) return;
    if (action === 'delete') this.checkUsage(targets);
    if (action === 'delete' || targets.length > 1) this.confirming.set(action);
    else void this.run(action);
  }

  /** Where the entries about to be deleted are used (except by one another). */
  private checkUsage(targets: Document[]): void {
    const uid = this.uid();
    const locale = this.locale();
    const deleting = new Set(targets.map((document) => document.documentId));
    void this.deleteUsage.start(() =>
      this.usages.many(
        targets,
        (document) => this.usages.forEntry(uid, document.documentId, locale),
        (usage) => usage.uid === uid && deleting.has(usage.documentId),
      ),
    );
  }

  protected async run(action: BulkAction): Promise<void> {
    const uid = this.uid();
    const targets = this.targets(action);
    if (!targets.length || this.running()) return;
    const base = `/content/${uid}`;
    const query = toQuery({ locale: this.locale() }) || undefined;
    const task = (document: Document): Promise<unknown> =>
      action === 'delete'
        ? this.api.delete(`${base}/${document.documentId}`, query)
        : this.api.post(`${base}/${document.documentId}/actions/${action}`, {}, query);

    this.progress.set({ done: 0, total: targets.length });
    const outcomes = await runLimited(targets, BULK_CONCURRENCY, task, (done, total) =>
      this.progress.set({ done, total }),
    );
    this.progress.set(null);

    const summary = summarize(outcomes, (document) => this.titleOf(document), failureReason);
    const messages = BULK_MESSAGES[action];
    const done = this.t(messages.done, { count: summary.succeeded });
    if (!summary.failed) {
      toast.success(done);
    } else {
      const lines = [...summary.details];
      if (summary.more) lines.push(this.t('content.list.bulk.more', { count: summary.more }));
      if (summary.succeeded) lines.unshift(done);
      toast.error(this.t(messages.failed, { count: summary.failed }), {
        description: lines.join('\n'),
        classes: { description: 'whitespace-pre-line' },
        duration: 10_000,
      });
    }
    if (uid !== this.uid()) return;
    this.clearSelection();
    this.reloads.update((count) => count + 1);
  }

  // View settings

  protected async saveView(view: ListView): Promise<void> {
    const type = this.type();
    if (!type) return;
    this.sort.set({ ...view.sort });
    this.sortChosen.set(true);
    this.pageSize.set(view.pageSize);
    const stored = isDefaultView(view, type, this.titleField()) ? undefined : view;
    try {
      await this.preferences.set(['listViews', type.uid], stored);
      toast.success(this.t('content.list.view.saved'));
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    }
  }

  protected async resetView(): Promise<void> {
    const type = this.type();
    if (!type) return;
    const fallback = defaultView(type, this.titleField());
    this.sort.set(fallback.sort);
    this.sortChosen.set(false);
    this.pageSize.set(fallback.pageSize);
    try {
      await this.preferences.set(['listViews', type.uid], undefined);
      toast.success(this.t('content.list.view.resetDone'));
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    }
  }
}
