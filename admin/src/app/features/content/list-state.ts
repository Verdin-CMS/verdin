import {
  DestroyRef,
  Injectable,
  Signal,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { toast } from '@spartan-ng/brain/sonner';

import { Api, ApiFailure, saveDownload, toQuery } from '../../core/api';
import { Auth } from '../../core/auth';
import { ContentLocales, isLocalized } from '../../core/content-locales';
import { EntryDuplicates } from '../../core/duplicate';
import { Features } from '../../core/features';
import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/keys';
import { allowedLocale } from '../../core/permissions';
import { Realtime } from '../../core/realtime';
import { EntryStage, ReviewWorkflows, Workflow, stageOf } from '../../core/review';
import { Schema } from '../../core/schema';
import { Document, PageMeta } from '../../core/types';
import { UsageProbe, Usages } from '../../core/usage';
import { UserPreferences, asObject } from '../../core/user-preferences';
import { humanize } from './fields/fields';
import { BULK_CONCURRENCY, BulkAction, failureReason, runLimited, summarize } from './list-bulk';
import {
  FilterCondition,
  FilterField,
  filterParams,
  filterTree,
  filterableFields,
  isFilterParam,
  parseFilterParams,
} from './list-filters';
import { listChange } from './list-live';
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

export type EntryStatus = 'draft' | 'published' | 'modified';

const SYSTEM_LABELS: Record<string, MessageKey> = {
  id: 'content.list.column.id',
  createdAt: 'content.list.column.createdAt',
  updatedAt: 'content.list.updated',
  status: 'content.list.status',
  publishedAt: 'content.list.column.publishedAt',
};

export const BULK_MESSAGES = {
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

/** What one list request asks for. */
interface ListRequest {
  uid: string;
  locale: string | null;
  page: number;
  pageSize: number;
  search: string;
  conditions: FilterCondition[];
  sort: ListSort | null;
}

/**
 * The content list's state, shared by its parts (toolbar, table, bulk bar, pagination):
 * what is listed (type, locale, search, filters, sort, page), the loaded page, the
 * selection and the bulk actions. Provided by `ContentList`, which calls `connect`.
 */
@Injectable()
export class ContentListState {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly preferences = inject(UserPreferences);
  readonly locales = inject(ContentLocales);
  readonly auth = inject(Auth);
  private readonly schema = inject(Schema);
  private readonly i18n = inject(I18n);
  private readonly t = this.i18n.t;
  private readonly features = inject(Features);
  private readonly review = inject(ReviewWorkflows);
  private readonly duplicates = inject(EntryDuplicates);
  private readonly realtime = inject(Realtime);
  private readonly usages = inject(Usages);
  private readonly destroyRef = inject(DestroyRef);

  private readonly uidSource = signal<Signal<string>>(signal(''));
  /** The listed type's uid (the `ContentList` input). */
  readonly uid = computed(() => this.uidSource()());

  /** Listed entries other admins changed since the page loaded. */
  readonly changedRows = signal<ReadonlySet<string>>(new Set());
  /** The page may be outdated (other admins' changes); cleared when it reloads. */
  readonly outdated = signal(false);

  /** The type's review workflow (feature on and a workflow set), for the Stage column. */
  readonly workflow = signal<Workflow | null>(null);
  /** Stored stages of the listed entries (others are at the first stage). */
  readonly rowStages = signal<Map<string, EntryStage>>(new Map());

  readonly type = computed(() => this.schema.type(this.uid()));
  readonly titleField = computed(() => {
    const type = this.type();
    return type ? this.schema.titleField(type) : null;
  });
  readonly main = computed(() => {
    const type = this.type();
    return type ? mainColumn(type, this.titleField()) : 'id';
  });

  readonly localized = computed(() => isLocalized(this.type()));
  /** The listed locale (localized types): the last one chosen for the type, else the default. */
  readonly locale = computed(() => {
    if (!this.localized()) return null;
    const saved = asObject(this.preferences.value()['listLocales'])[this.uid()];
    const preferred = this.locales.resolve(typeof saved === 'string' ? saved : null);
    // An admin limited to some locales lists one of them.
    const codes = (this.locales.list() ?? []).map((locale) => locale.code);
    return allowedLocale(this.auth.permissions(), 'content.read', this.uid(), codes, preferred);
  });
  readonly localeQuery = computed(() => {
    const locale = this.locale();
    return locale ? { locale } : {};
  });

  /** The view saved for this type, as stored (validated by `resolveView`). */
  private readonly savedView = computed(
    () => asObject(this.preferences.value()['listViews'])[this.uid()],
  );
  readonly customView = computed(() => this.savedView() !== undefined);
  readonly view = computed<ListView | null>(() => {
    const type = this.type();
    return type ? resolveView(this.savedView(), type, this.titleField()) : null;
  });
  readonly columns = computed<ListColumn[]>(() => {
    const type = this.type();
    const view = this.view();
    if (!type || !view) return [];
    const byName = new Map(availableColumns(type).map((column) => [column.name, column]));
    return view.columns.flatMap((name) => byName.get(name) ?? []);
  });

  /** Actions in the listed locale (permissions may be limited to some locales). */
  readonly canCreate = computed(() =>
    this.auth.canInLocale('content.create', this.uid(), this.locale()),
  );
  readonly canDelete = computed(() =>
    this.auth.canInLocale('content.delete', this.uid(), this.locale()),
  );
  readonly canPublish = computed(
    () =>
      this.type()?.draftAndPublish === true &&
      this.auth.canInLocale('content.publish', this.uid(), this.locale()),
  );
  readonly selectable = computed(() => this.canDelete() || this.canPublish());
  /** Importing creates rows or updates the documents they name. */
  readonly canImport = computed(
    () =>
      this.auth.canInLocale('content.create', this.uid(), this.locale()) ||
      this.auth.canInLocale('content.update', this.uid(), this.locale()),
  );
  readonly canExport = computed(() =>
    this.auth.canInLocale('content.read', this.uid(), this.locale()),
  );
  /** Text fields `_q` searches (see `isSearchable`). */
  readonly searchable = computed(() => {
    const type = this.type();
    return !!type && isSearchable(type);
  });
  readonly exporting = signal(false);
  /** Where the entries about to be deleted are used. */
  readonly deleteUsage = new UsageProbe();
  readonly colspan = computed(
    () =>
      this.columns().length +
      (this.selectable() ? 1 : 0) +
      (this.localized() ? 1 : 0) +
      (this.workflow() ? 1 : 0) +
      (this.canCreate() ? 1 : 0),
  );

  /** The entry being duplicated (its row shows a spinner). */
  readonly duplicating = signal<string | null>(null);

  // Filters: kept in the URL (`filters[$and][i][field][$op]=value`).
  private readonly queryParams = toSignal(this.route.queryParams, { initialValue: {} as Params });
  readonly filterFields = computed<FilterField[]>(() => {
    const type = this.type();
    if (!type) return [];
    return filterableFields(type, (target) => {
      const targetType = this.schema.type(target);
      return targetType ? this.schema.titleField(targetType) : null;
    });
  });
  readonly conditions = computed<FilterCondition[]>(
    () => parseFilterParams(this.queryParams(), this.filterFields()),
    { equal: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
  );

  /** Bumped to reload the current page. */
  readonly reloads = signal(0);
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
  readonly search = computed(() => {
    const value = this.queryParams()['_q'];
    return typeof value === 'string' ? value : '';
  });
  readonly sort = linkedSignal<unknown, ListSort>({
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
  readonly activeSort = computed<ListSort | null>(() =>
    this.search() && !this.sortChosen() ? null : this.sort(),
  );
  readonly pageSize = linkedSignal<unknown, PageSize>({
    source: this.viewSource,
    computation: () => untracked(() => this.view()?.pageSize ?? 20),
  });
  /** Back to the first page whenever what is listed changes. */
  readonly page = linkedSignal({
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
  readonly selection = linkedSignal<unknown, Set<string>>({
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

  readonly documents = signal<Document[]>([]);
  readonly meta = signal<PageMeta>({});
  readonly published = signal<Map<string, LiveVersion>>(new Map());
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly total = computed(() => this.meta().total ?? 0);
  readonly pageCount = computed(() => this.meta().pageCount ?? 1);

  readonly selected = computed(() =>
    this.documents().filter((document) => this.selection().has(document.documentId)),
  );
  readonly pageSelection = computed<'none' | 'some' | 'all'>(() => {
    const count = this.selected().length;
    if (!count) return 'none';
    return count === this.documents().length ? 'all' : 'some';
  });
  /** The bulk action waiting for confirmation. */
  readonly confirming = signal<BulkAction | null>(null);
  readonly progress = signal<{ done: number; total: number } | null>(null);
  readonly running = computed(() => this.progress() !== null);

  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  /** Identifies the latest list request; older responses are dropped. */
  private requests = 0;

  readonly columnLabel = (name: string): string => {
    const system = SYSTEM_LABELS[name];
    return system && !this.type()?.attributes[name] ? this.t(system) : humanize(name);
  };

  readonly filterLabel = (field: FilterField): string => {
    if (!field.path) return this.columnLabel(field.field);
    return this.t('content.filters.relationField', {
      relation: humanize(field.field),
      field:
        field.path === 'documentId' ? this.t('content.filters.documentId') : humanize(field.path),
    });
  };

  /** Starts listing the type `uid` names (call once, from the list's constructor). */
  connect(uid: Signal<string>): void {
    this.uidSource.set(uid);
    void this.preferences.load();
    // Needed by localized types only; the list waits for it then.
    this.locales.load().catch((error) => {
      if (this.localized()) this.error.set(ApiFailure.from(error).message);
    });
    effect(() => {
      const request: ListRequest = {
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
    // A pending search must not navigate once the list is gone.
    this.destroyRef.onDestroy(() => clearTimeout(this.searchTimer));
    this.followChanges();
  }

  /** Marks rows (and the page) that other admins change while it is shown. */
  private followChanges(): void {
    this.destroyRef.onDestroy(this.realtime.retain());
    this.realtime.messages.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((message) => {
      if (this.running() || this.loading() || this.realtime.isOwn(message)) return;
      const listed = new Set(this.documents().map((document) => document.documentId));
      const change = listChange(message, this.uid(), this.locale(), listed);
      if (!change) return;
      if (change === 'row' && message.documentId)
        this.changedRows.update((rows) => new Set([...rows, message.documentId!]));
      this.outdated.set(true);
    });
  }

  refresh(): void {
    this.reloads.update((count) => count + 1);
  }

  private async load(request: ListRequest): Promise<void> {
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
      this.changedRows.set(new Set());
      this.outdated.set(false);
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

  stageOfRow(workflow: Workflow, documentId: string) {
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

  statusOf(document: Document): EntryStatus {
    const live = this.published().get(document.documentId);
    if (!live) return 'draft';
    return String(document.updatedAt) > live.updatedAt ? 'modified' : 'published';
  }

  /** A built-in timestamp column's value (`publishedAt` comes from the live version). */
  timestampOf(document: Document, name: string): string | null {
    const value =
      name === 'publishedAt'
        ? this.published().get(document.documentId)?.publishedAt
        : document[name];
    return typeof value === 'string' && value ? value : null;
  }

  titleOf(document: Document): string {
    const field = this.titleField();
    const title = field ? document[field] : null;
    return typeof title === 'string' && title.trim() ? title : `#${document.id}`;
  }

  /** The locale of a listed version (localized types). */
  localeOf(document: Document): string | null {
    const locale = document['locale'];
    return typeof locale === 'string' && locale ? locale : this.locale();
  }

  // Sort, search, filters and locale

  toggleSort(field: string): void {
    const current = this.activeSort();
    this.sortChosen.set(true);
    this.sort.set({ field, descending: current?.field === field ? !current.descending : false });
  }

  /** Searches once typing pauses; the URL follows without adding history entries. */
  setSearch(value: string): void {
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

  /** Applies filters: a new history entry, so going back restores the previous ones. */
  setFilters(conditions: FilterCondition[]): void {
    const kept = Object.fromEntries(
      Object.entries(this.queryParams()).filter(([key]) => !isFilterParam(key)),
    );
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { ...kept, ...filterParams(conditions) },
    });
  }

  removeFilter(index: number): void {
    this.setFilters(this.conditions().filter((_, position) => position !== index));
  }

  /** Lists another locale; the choice is remembered per type (the default is not stored). */
  setLocale(code: string | null | undefined): void {
    const type = this.type();
    if (!type || !code || code === this.locale()) return;
    const stored = code === this.locales.defaultCode() ? undefined : code;
    this.preferences
      .set(['listLocales', type.uid], stored)
      .catch((error) => toast.error(ApiFailure.from(error).message));
  }

  // Rows

  open(document: Document): void {
    void this.router.navigate(['/content', this.uid(), document.documentId], {
      queryParams: this.localeQuery(),
    });
  }

  async duplicate(document: Document): Promise<void> {
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

  /** Downloads the list as it is filtered, searched and sorted (every page). */
  async export(format: TransferFormat): Promise<void> {
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

  // Selection and bulk actions

  select(document: Document, checked: boolean): void {
    const next = new Set(this.selection());
    if (checked) next.add(document.documentId);
    else next.delete(document.documentId);
    this.selection.set(next);
  }

  selectPage(checked: boolean): void {
    // From "some", the header checkbox selects the whole page.
    const all = checked || this.pageSelection() === 'some';
    this.selection.set(
      all ? new Set(this.documents().map((document) => document.documentId)) : new Set(),
    );
  }

  clearSelection(): void {
    this.selection.set(new Set());
  }

  /** The selected entries an action applies to (unpublish: only those with a live version). */
  targets(action: BulkAction): Document[] {
    const selected = this.selected();
    return action === 'unpublish'
      ? selected.filter((document) => this.published().has(document.documentId))
      : selected;
  }

  /** Deleting always asks first; publishing and unpublishing when there are several. */
  request(action: BulkAction): void {
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

  async run(action: BulkAction): Promise<void> {
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

  async saveView(view: ListView): Promise<void> {
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

  async resetView(): Promise<void> {
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
