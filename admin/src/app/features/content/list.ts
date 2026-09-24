import { DatePipe } from '@angular/common';
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
import { Schema } from '../../core/schema';
import { Attribute, Document, PageMeta } from '../../core/types';
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

@Component({
  selector: 'vd-content-list',
  imports: [
    RouterLink,
    DatePipe,
    NgIcon,
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
      <div class="flex flex-col gap-4">
        <div class="flex flex-wrap items-center gap-3">
          <div>
            <h1 class="text-2xl font-semibold">{{ type.displayName }}</h1>
            <p class="text-muted-foreground text-sm">
              {{ total() }} {{ total() === 1 ? 'entry' : 'entries' }}
            </p>
          </div>
          @if (auth.canContent('content.create', type.uid)) {
            <a hlmBtn class="ms-auto" [routerLink]="['/content', type.uid, 'new']"
              ><ng-icon name="lucidePlus" /> Create</a
            >
          }
        </div>

        @if (titleField()) {
          <div hlmInputGroup class="max-w-sm">
            <div hlmInputGroupAddon><ng-icon name="lucideSearch" /></div>
            <input
              hlmInputGroupInput
              [placeholder]="'Search by ' + humanize(titleField()!)"
              [value]="search()"
              (input)="setSearch($any($event.target).value)"
            />
          </div>
        }

        @if (error()) {
          <div hlmAlert variant="destructive">
            <p hlmAlertTitle>{{ error() }}</p>
          </div>
        }

        <div hlmTableContainer class="rounded-md border">
          <table hlmTable>
            <thead hlmTHead>
              <tr hlmTr>
                @for (column of columns(); track column.name) {
                  <th hlmTh>
                    <button
                      type="button"
                      class="inline-flex items-center gap-1"
                      (click)="toggleSort(column.name)"
                    >
                      {{ humanize(column.name) }}
                      @if (sort().field === column.name) {
                        <ng-icon
                          [name]="sort().descending ? 'lucideArrowDown' : 'lucideArrowUp'"
                          size="14"
                        />
                      }
                    </button>
                  </th>
                }
                @if (type.draftAndPublish) {
                  <th hlmTh>Status</th>
                }
                <th hlmTh>
                  <button
                    type="button"
                    class="inline-flex items-center gap-1"
                    (click)="toggleSort('updatedAt')"
                  >
                    Updated
                    @if (sort().field === 'updatedAt') {
                      <ng-icon
                        [name]="sort().descending ? 'lucideArrowDown' : 'lucideArrowUp'"
                        size="14"
                      />
                    }
                  </button>
                </th>
              </tr>
            </thead>
            <tbody hlmTBody>
              @if (loading()) {
                @for (row of [1, 2, 3]; track row) {
                  <tr hlmTr>
                    <td hlmTd [attr.colspan]="columns().length + 2">
                      <hlm-skeleton class="h-5 w-full" />
                    </td>
                  </tr>
                }
              } @else {
                @for (document of documents(); track document.documentId) {
                  <tr hlmTr class="cursor-pointer" (click)="open(document)">
                    @for (column of columns(); track column.name) {
                      <td hlmTd class="max-w-64 truncate">
                        {{ cell(document, column.name, column.attribute) }}
                      </td>
                    }
                    @if (type.draftAndPublish) {
                      <td hlmTd>
                        @let state = statusOf(document);
                        <span
                          hlmBadge
                          [variant]="
                            state === 'published'
                              ? 'default'
                              : state === 'modified'
                                ? 'outline'
                                : 'secondary'
                          "
                        >
                          {{
                            state === 'modified'
                              ? 'Modified'
                              : state === 'published'
                                ? 'Published'
                                : 'Draft'
                          }}
                        </span>
                      </td>
                    }
                    <td hlmTd class="text-muted-foreground">
                      {{ document.updatedAt | date: 'short' }}
                    </td>
                  </tr>
                } @empty {
                  <tr hlmTr>
                    <td hlmTd [attr.colspan]="columns().length + 2">
                      <div hlmEmpty>
                        <div hlmEmptyHeader>
                          <h2 hlmEmptyTitle>{{ search() ? 'No matches' : 'No entries yet' }}</h2>
                        </div>
                      </div>
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>

        @if (pageCount() > 1) {
          <div class="flex items-center justify-end gap-2">
            <span class="text-muted-foreground text-sm"
              >Page {{ page() }} of {{ pageCount() }}</span
            >
            <button
              hlmBtn
              variant="outline"
              size="sm"
              [disabled]="page() <= 1"
              (click)="page.set(page() - 1)"
            >
              Previous
            </button>
            <button
              hlmBtn
              variant="outline"
              size="sm"
              [disabled]="page() >= pageCount()"
              (click)="page.set(page() + 1)"
            >
              Next
            </button>
          </div>
        }
      </div>
    }
  `,
})
export class ContentList {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  protected readonly auth = inject(Auth);
  protected readonly schema = inject(Schema);
  protected readonly humanize = humanize;

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
    if (attribute.type === 'boolean') return value ? 'Yes' : 'No';
    if (attribute.type === 'datetime') return new Date(String(value)).toLocaleString();
    return String(value);
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
