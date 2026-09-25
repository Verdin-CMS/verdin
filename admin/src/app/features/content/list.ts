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
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmTableImports } from '@spartan-ng/helm/table';

import { Api, ApiFailure, toQuery } from '../../core/api';
import { Auth } from '../../core/auth';
import { ContentLocales, isLocalized } from '../../core/content-locales';
import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/keys';
import { Schema } from '../../core/schema';
import { Document, PageMeta } from '../../core/types';
import { UserPreferences, asObject } from '../../core/user-preferences';
import { PageHeader } from '../../shared/components/page-header';
import { humanize } from './fields/fields';
import { BULK_CONCURRENCY, BulkAction, failureReason, runLimited, summarize } from './list-bulk';
import { ListSettings } from './list-settings';
import {
  ListColumn,
  ListSort,
  ListView,
  PageSize,
  availableColumns,
  defaultView,
  isDefaultView,
  mainColumn,
  resolveView,
} from './list-view';

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
    ListSettings,
    HlmTableImports,
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
          <div actions>
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
            @if (titleField()) {
              <div hlmInputGroup class="w-full sm:max-w-xs">
                <div hlmInputGroupAddon><ng-icon name="lucideSearch" /></div>
                <input
                  hlmInputGroupInput
                  type="search"
                  [attr.aria-label]="t('common.search')"
                  [placeholder]="t('content.list.searchBy', { field: humanize(titleField()!) })"
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
                    <option hlmNativeSelectOption [value]="option.code">
                      {{ option.name }} ({{ option.code }})
                    </option>
                  }
                </hlm-native-select>
              </div>
            }
            <span class="text-muted-foreground ms-auto text-sm tabular-nums">
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
                          [class.text-foreground]="sort().field === column.name"
                          (click)="toggleSort(column.name)"
                        >
                          {{ columnLabel(column.name) }}
                          @if (sort().field === column.name) {
                            <ng-icon
                              [name]="sort().descending ? 'lucideArrowDown' : 'lucideArrowUp'"
                              size="12"
                            />
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
                    </tr>
                  } @empty {
                    <tr hlmTr class="hover:bg-transparent">
                      <td hlmTd [attr.colspan]="colspan()">
                        <div hlmEmpty class="py-12">
                          <div hlmEmptyHeader>
                            <div hlmEmptyMedia variant="icon">
                              <ng-icon [name]="search() ? 'lucideSearch' : 'lucideFileText'" />
                            </div>
                            <h2 hlmEmptyTitle>
                              {{ search() ? t('content.list.noMatches') : t('content.list.empty') }}
                            </h2>
                            <p hlmEmptyDescription>
                              {{
                                search()
                                  ? t('content.list.noMatchesHint', { search: search() })
                                  : canCreate()
                                    ? t('content.list.emptyHint')
                                    : t('content.list.emptyReadOnly')
                              }}
                            </p>
                          </div>
                          @if (!search() && canCreate()) {
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
                <ng-icon name="lucideArrowLeft" /> {{ t('common.previous') }}
              </button>
              <button
                hlmBtn
                variant="outline"
                size="sm"
                [disabled]="page() >= pageCount() || running()"
                (click)="page.set(page() + 1)"
              >
                {{ t('common.next') }} <ng-icon name="lucideChevronRight" />
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

      <hlm-alert-dialog [state]="confirming() ? 'open' : 'closed'" (closed)="confirming.set(null)">
        <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
          @if (confirming(); as action) {
            <hlm-alert-dialog-header>
              <h2 hlmAlertDialogTitle>
                {{ t(BULK_MESSAGES[action].title, { count: targets(action).length }) }}
              </h2>
              <p hlmAlertDialogDescription>{{ t(BULK_MESSAGES[action].description) }}</p>
            </hlm-alert-dialog-header>
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
    return this.locales.resolve(typeof saved === 'string' ? saved : null);
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

  protected readonly canCreate = computed(() => this.auth.canContent('content.create', this.uid()));
  protected readonly canDelete = computed(() => this.auth.canContent('content.delete', this.uid()));
  protected readonly canPublish = computed(
    () =>
      this.type()?.draftAndPublish === true && this.auth.canContent('content.publish', this.uid()),
  );
  protected readonly selectable = computed(() => this.canDelete() || this.canPublish());
  protected readonly colspan = computed(() => this.columns().length + (this.selectable() ? 1 : 0));

  /** Bumped to reload the current page. */
  private readonly reloads = signal(0);
  /** A different type starts unfiltered; defaults apply once the preferences are in. */
  private readonly viewSource = computed(
    () => ({
      uid: this.uid(),
      ready:
        this.preferences.loaded() && !!this.type() && (!this.localized() || this.locales.loaded()),
    }),
    { equal: (a, b) => a.uid === b.uid && a.ready === b.ready },
  );
  protected readonly search = linkedSignal({ source: this.uid, computation: () => '' });
  protected readonly sort = linkedSignal<unknown, ListSort>({
    source: this.viewSource,
    computation: () => untracked(() => ({ ...(this.view()?.sort ?? DEFAULT_SORT) })),
  });
  protected readonly pageSize = linkedSignal<unknown, PageSize>({
    source: this.viewSource,
    computation: () => untracked(() => this.view()?.pageSize ?? 20),
  });
  /** Back to the first page whenever what is listed changes. */
  protected readonly page = linkedSignal({
    source: () => [this.uid(), this.locale(), this.search(), this.sort(), this.pageSize()],
    computation: () => 1,
  });
  /** Selected document ids; only ever entries of the current page. */
  protected readonly selection = linkedSignal<unknown, Set<string>>({
    source: () => [
      this.uid(),
      this.locale(),
      this.page(),
      this.search(),
      this.sort(),
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
        sort: this.sort(),
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
    sort: ListSort;
  }): Promise<void> {
    const current = ++this.requests;
    this.loading.set(true);
    this.error.set(null);
    const query: Record<string, unknown> = {
      pagination: { page: request.page, pageSize: request.pageSize },
      sort: `${request.sort.field}:${request.sort.descending ? 'desc' : 'asc'}`,
      locale: request.locale,
    };
    const field = this.titleField();
    if (request.search && field) query['filters'] = { [field]: { $containsi: request.search } };
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
    } catch (error) {
      if (current === this.requests) this.error.set(ApiFailure.from(error).message);
    } finally {
      if (current === this.requests) this.loading.set(false);
    }
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
    const sort = this.sort();
    if (sort.field !== field) return null;
    return sort.descending ? 'descending' : 'ascending';
  }

  protected toggleSort(field: string): void {
    const current = this.sort();
    this.sort.set({ field, descending: current.field === field ? !current.descending : false });
  }

  protected setSearch(value: string): void {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.search.set(value), 250);
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
    const count = this.targets(action).length;
    if (!count) return;
    if (action === 'delete' || count > 1) this.confirming.set(action);
    else void this.run(action);
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
    this.pageSize.set(fallback.pageSize);
    try {
      await this.preferences.set(['listViews', type.uid], undefined);
      toast.success(this.t('content.list.view.resetDone'));
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    }
  }
}
