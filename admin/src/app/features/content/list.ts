import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmTableImports } from '@spartan-ng/helm/table';

import { Api, ApiFailure, toQuery } from '../../core/api';
import { Auth } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/messages/en';
import { Schema } from '../../core/schema';
import { Attribute, Document, PageMeta } from '../../core/types';
import { PageHeader } from '../../shared/components/page-header';
import { humanize } from './fields/fields';

const LISTABLE = new Set([
  'string',
  'email',
  'uid',
  'integer',
  'biginteger',
  'float',
  'decimal',
  'boolean',
  'enumeration',
  'date',
  'datetime',
]);
const PAGE_SIZE = 20;

type Status = 'draft' | 'published' | 'modified';

const STATUS_LABELS = {
  draft: 'content.status.draft',
  published: 'content.status.published',
  modified: 'content.status.modified',
} as const satisfies Record<Status, MessageKey>;

@Component({
  selector: 'vd-content-list',
  imports: [
    RouterLink,
    NgIcon,
    PageHeader,
    HlmTableImports,
    HlmButtonImports,
    HlmBadgeImports,
    HlmInputGroupImports,
    HlmSkeletonImports,
    HlmEmptyImports,
    HlmAlertImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (type(); as type) {
      <div class="flex flex-col gap-6">
        <vd-page-header [title]="type.displayName" [description]="type.description">
          <div actions>
            @if (canCreate()) {
              <a hlmBtn [routerLink]="['/content', type.uid, 'new']"
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
            <span class="text-muted-foreground ms-auto text-sm tabular-nums">
              {{ t('content.list.total', { count: total() }) }}
            </span>
          </div>

          <div hlmTableContainer>
            <table hlmTable>
              <thead hlmTHead class="bg-muted/40">
                <tr hlmTr class="hover:bg-transparent">
                  @for (column of columns(); track column.name) {
                    <th hlmTh class="px-4" [attr.aria-sort]="ariaSort(column.name)">
                      <button
                        type="button"
                        class="hover:text-foreground text-muted-foreground inline-flex items-center gap-1 text-xs font-medium tracking-wide uppercase"
                        [class.text-foreground]="sort().field === column.name"
                        (click)="toggleSort(column.name)"
                      >
                        {{ humanize(column.name) }}
                        @if (sort().field === column.name) {
                          <ng-icon
                            [name]="sort().descending ? 'lucideArrowDown' : 'lucideArrowUp'"
                            size="12"
                          />
                        }
                      </button>
                    </th>
                  }
                  @if (type.draftAndPublish) {
                    <th
                      hlmTh
                      class="text-muted-foreground px-4 text-xs font-medium tracking-wide uppercase"
                    >
                      {{ t('content.list.status') }}
                    </th>
                  }
                  <th hlmTh class="px-4" [attr.aria-sort]="ariaSort('updatedAt')">
                    <button
                      type="button"
                      class="hover:text-foreground text-muted-foreground inline-flex items-center gap-1 text-xs font-medium tracking-wide uppercase"
                      [class.text-foreground]="sort().field === 'updatedAt'"
                      (click)="toggleSort('updatedAt')"
                    >
                      {{ t('content.list.updated') }}
                      @if (sort().field === 'updatedAt') {
                        <ng-icon
                          [name]="sort().descending ? 'lucideArrowDown' : 'lucideArrowUp'"
                          size="12"
                        />
                      }
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody hlmTBody>
                @if (loading()) {
                  @for (row of skeletonRows; track row) {
                    <tr hlmTr class="hover:bg-transparent">
                      @for (column of columns(); track column.name; let first = $first) {
                        <td hlmTd class="px-4 py-3">
                          <hlm-skeleton class="h-4" [class.w-40]="first" [class.w-24]="!first" />
                        </td>
                      }
                      @if (type.draftAndPublish) {
                        <td hlmTd class="px-4 py-3">
                          <hlm-skeleton class="h-5 w-20 rounded-full" />
                        </td>
                      }
                      <td hlmTd class="px-4 py-3"><hlm-skeleton class="h-4 w-24" /></td>
                    </tr>
                  }
                } @else {
                  @for (document of documents(); track document.documentId) {
                    <tr hlmTr class="cursor-pointer" (click)="open(document)">
                      @for (column of columns(); track column.name; let first = $first) {
                        <td
                          hlmTd
                          class="max-w-64 truncate px-4 py-3"
                          [class.font-medium]="first"
                          [class.text-muted-foreground]="!first"
                        >
                          {{ cell(document, column.name, column.attribute) }}
                        </td>
                      }
                      @if (type.draftAndPublish) {
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
                      }
                      <td
                        hlmTd
                        class="text-muted-foreground px-4 py-3"
                        [title]="i18n.formatDate(document.updatedAt, 'long')"
                      >
                        {{ i18n.formatRelative(document.updatedAt) }}
                      </td>
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
                [disabled]="page() <= 1"
                (click)="page.set(page() - 1)"
              >
                <ng-icon name="lucideArrowLeft" /> {{ t('common.previous') }}
              </button>
              <button
                hlmBtn
                variant="outline"
                size="sm"
                [disabled]="page() >= pageCount()"
                (click)="page.set(page() + 1)"
              >
                {{ t('common.next') }} <ng-icon name="lucideChevronRight" />
              </button>
            </div>
          }
        </div>
      </div>
    }
  `,
})
export class ContentList {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  protected readonly auth = inject(Auth);
  protected readonly schema = inject(Schema);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly humanize = humanize;
  protected readonly STATUS_LABELS = STATUS_LABELS;
  protected readonly skeletonRows = [1, 2, 3, 4, 5];

  readonly uid = input.required<string>();

  protected readonly type = computed(() => this.schema.type(this.uid()));
  protected readonly titleField = computed(() => {
    const type = this.type();
    return type ? this.schema.titleField(type) : null;
  });
  protected readonly columns = computed(() => {
    const type = this.type();
    if (!type) return [];
    return Object.entries(type.attributes)
      .filter(([, attribute]) => LISTABLE.has(attribute.type) && !attribute.private)
      .slice(0, 4)
      .map(([name, attribute]) => ({ name, attribute }));
  });

  protected readonly canCreate = computed(() => this.auth.canContent('content.create', this.uid()));
  protected readonly colspan = computed(
    () => this.columns().length + (this.type()?.draftAndPublish ? 2 : 1),
  );

  protected readonly page = signal(1);
  protected readonly search = signal('');
  protected readonly sort = signal<{ field: string; descending: boolean }>({
    field: 'updatedAt',
    descending: true,
  });
  protected readonly documents = signal<Document[]>([]);
  protected readonly meta = signal<PageMeta>({});
  protected readonly published = signal<Map<string, string>>(new Map());
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly total = computed(() => this.meta().total ?? 0);
  protected readonly pageCount = computed(() => this.meta().pageCount ?? 1);

  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    effect(() => {
      const request = {
        uid: this.uid(),
        page: this.page(),
        search: this.search(),
        sort: this.sort(),
      };
      untracked(() => void this.load(request));
    });
    // A different type starts from the first page, unfiltered.
    effect(() => {
      this.uid();
      untracked(() => {
        this.page.set(1);
        this.search.set('');
        this.sort.set({ field: 'updatedAt', descending: true });
      });
    });
  }

  private async load(request: {
    uid: string;
    page: number;
    search: string;
    sort: { field: string; descending: boolean };
  }): Promise<void> {
    const type = this.type();
    if (!type) return;
    this.loading.set(true);
    this.error.set(null);
    const query: Record<string, unknown> = {
      pagination: { page: request.page, pageSize: PAGE_SIZE },
      sort: `${request.sort.field}:${request.sort.descending ? 'desc' : 'asc'}`,
    };
    const field = this.titleField();
    if (request.search && field) query['filters'] = { [field]: { $containsi: request.search } };
    try {
      const response = await this.api.list<Document>(`/content/${request.uid}`, toQuery(query));
      if (request.uid !== this.uid()) return;
      this.documents.set(response.data);
      this.meta.set(response.meta.pagination ?? {});
      await this.loadPublished(request.uid, response.data);
    } catch (error) {
      this.error.set(ApiFailure.from(error).message);
    } finally {
      this.loading.set(false);
    }
  }

  /** `updatedAt` of the published versions of the listed drafts. */
  private async loadPublished(uid: string, documents: Document[]): Promise<void> {
    const type = this.type();
    if (!type?.draftAndPublish || !documents.length) {
      this.published.set(new Map());
      return;
    }
    const ids = Object.fromEntries(
      documents.map((document, index) => [index, document.documentId]),
    );
    const query = toQuery({
      status: 'published',
      fields: { 0: 'updatedAt' },
      pagination: { pageSize: PAGE_SIZE },
      filters: { documentId: { $in: ids } },
    });
    const response = await this.api.list<Document>(`/content/${uid}`, query);
    this.published.set(
      new Map(response.data.map((document) => [document.documentId, String(document.updatedAt)])),
    );
  }

  protected statusOf(document: Document): Status {
    const live = this.published().get(document.documentId);
    if (!live) return 'draft';
    return String(document.updatedAt) > live ? 'modified' : 'published';
  }

  protected cell(document: Document, name: string, attribute: Attribute): string {
    const value = document[name];
    if (value === null || value === undefined || value === '') return '—';
    switch (attribute.type) {
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
    this.page.set(1);
  }

  protected setSearch(value: string): void {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.search.set(value);
      this.page.set(1);
    }, 250);
  }

  protected open(document: Document): void {
    void this.router.navigate(['/content', this.uid(), document.documentId]);
  }
}
