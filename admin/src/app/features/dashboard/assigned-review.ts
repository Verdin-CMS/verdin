import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';

import { Api, toQuery } from '../../core/api';
import { Features } from '../../core/features';
import { I18n } from '../../core/i18n/i18n';
import { EntryStage, ReviewStage, ReviewWorkflows, stageOf } from '../../core/review';
import { Schema } from '../../core/schema';
import { ContentType, Document } from '../../core/types';
import { StageBadge } from '../../shared/components/stage-badge';
import { documentLabel } from '../content/fields/model';

/** At most this many assigned entries are listed. */
const LIMIT = 10;

interface Row {
  entry: EntryStage;
  type: ContentType;
  label: string;
  stage: ReviewStage | null;
  link: unknown[];
  query: Record<string, string>;
}

/** Rows grouped by type and locale: each group needs one lookup of titles and stages. */
export function groupAssigned(entries: EntryStage[]): Map<string, EntryStage[]> {
  const groups = new Map<string, EntryStage[]>();
  for (const entry of entries) {
    const key = `${entry.uid}|${entry.locale}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return groups;
}

/** The home page's "Assigned to me" section (review workflows): entries to look at. */
@Component({
  selector: 'vd-assigned-review',
  imports: [RouterLink, HlmBadgeImports, HlmSkeletonImports, StageBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // No box of its own: nothing takes room in the page while there is nothing to show.
  host: { class: 'contents' },
  template: `
    @if (on() && rows() !== undefined && (rows() === null || rows()!.length)) {
      <section
        class="bg-card text-card-foreground flex flex-col gap-3 rounded-xl border p-5 shadow-xs"
        aria-labelledby="assigned-review-title"
      >
        <header class="flex items-center gap-2">
          <h2 id="assigned-review-title" class="flex-1 text-sm font-medium">
            {{ t('home.assigned.title') }}
          </h2>
          @if (total() > rows()!.length) {
            <span class="text-muted-foreground text-xs">{{
              t('home.assigned.more', { count: total() - rows()!.length })
            }}</span>
          }
        </header>
        @if (rows() === null) {
          <hlm-skeleton class="h-8 w-full" />
        } @else {
          <ul class="-mx-2 flex flex-col">
            @for (row of rows(); track row.entry.uid + row.entry.documentId + row.entry.locale) {
              <li>
                <a
                  class="hover:bg-accent flex min-w-0 items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors"
                  [routerLink]="row.link"
                  [queryParams]="row.query"
                >
                  <span class="min-w-0 flex-1 truncate font-medium">{{ row.label }}</span>
                  <span hlmBadge variant="secondary" class="shrink-0 font-normal">{{
                    row.type.displayName
                  }}</span>
                  @if (row.entry.locale) {
                    <span class="text-muted-foreground shrink-0 font-mono text-xs">{{
                      row.entry.locale
                    }}</span>
                  }
                  @if (row.stage; as stage) {
                    <vd-stage-badge [name]="stage.name" [color]="stage.color" />
                  }
                </a>
              </li>
            }
          </ul>
        }
      </section>
    }
  `,
})
export class AssignedReview {
  private readonly api = inject(Api);
  private readonly service = inject(ReviewWorkflows);
  private readonly schema = inject(Schema);
  private readonly features = inject(Features);
  protected readonly t = inject(I18n).t;

  protected readonly on = computed(() => this.features.enabled('review'));
  /** `undefined` before loading, `null` while loading. */
  protected readonly rows = signal<Row[] | null | undefined>(undefined);
  protected readonly total = signal(0);

  constructor() {
    effect(() => {
      if (this.on()) untracked(() => void this.load());
    });
  }

  private async load(): Promise<void> {
    this.rows.set(null);
    try {
      const assigned = await this.service.assigned();
      const known = assigned.filter((entry) => this.schema.type(entry.uid));
      this.total.set(known.length);
      const shown = [...known]
        .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
        .slice(0, LIMIT);
      const groups = await Promise.all(
        [...groupAssigned(shown).values()].map((entries) => this.describe(entries)),
      );
      const rows = groups.flat();
      const order = new Map(shown.map((entry, index) => [entry, index]));
      rows.sort((a, b) => (order.get(a.entry) ?? 0) - (order.get(b.entry) ?? 0));
      this.rows.set(rows);
    } catch {
      this.rows.set([]);
    }
  }

  /** Titles and stages of one type's (and locale's) assigned entries. */
  private async describe(entries: EntryStage[]): Promise<Row[]> {
    const type = this.schema.type(entries[0].uid)!;
    const locale = entries[0].locale || null;
    const titleField = this.schema.titleField(type);
    const [documents, review] = await Promise.all([
      this.api
        .list<Document>(
          `/content/${type.uid}`,
          toQuery({
            filters: {
              documentId: {
                $in: Object.fromEntries(entries.map((entry, i) => [i, entry.documentId])),
              },
            },
            pagination: { pageSize: entries.length },
            status: type.draftAndPublish ? 'draft' : undefined,
            locale,
          }),
        )
        .then((response) => response.data)
        .catch(() => [] as Document[]),
      this.service
        .entries(
          type.uid,
          entries.map((entry) => entry.documentId),
          locale,
        )
        .catch(() => null),
    ]);
    const byId = new Map(documents.map((document) => [document.documentId, document]));
    return entries.map((entry) => {
      const document = byId.get(entry.documentId);
      return {
        entry,
        type,
        label: document ? documentLabel(document, titleField) : entry.documentId,
        stage: stageOf(review?.workflow, entry.stageId),
        link:
          type.kind === 'singleType'
            ? ['/single', type.uid]
            : ['/content', type.uid, entry.documentId],
        query: entry.locale ? { locale: entry.locale } : ({} as Record<string, string>),
      };
    });
  }
}
