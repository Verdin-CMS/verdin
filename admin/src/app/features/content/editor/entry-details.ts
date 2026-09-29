import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';

import { I18n } from '../../../core/i18n/i18n';
import { ContentType } from '../../../core/types';
import { VoteControl } from '../../../shared/components/vote-control';

/** Where a document stands: never published, published as is, or published with edits. */
export type EntryStatus = 'draft' | 'published' | 'modified';

/** The status of a document from its versions' last updates. */
export function entryStatus(
  published: boolean,
  draftUpdatedAt: string | null,
  publishedUpdatedAt: string | null,
): EntryStatus {
  if (!published) return 'draft';
  return draftUpdatedAt && publishedUpdatedAt && draftUpdatedAt > publishedUpdatedAt
    ? 'modified'
    : 'published';
}

const STATUS_LABELS = {
  draft: 'content.status.draft',
  published: 'content.status.published',
  modified: 'content.status.modified',
} as const satisfies Record<EntryStatus, string>;

const STATUS_HINTS = {
  draft: 'content.edit.hint.draft',
  published: 'content.edit.hint.published',
  modified: 'content.edit.hint.modified',
} as const satisfies Record<EntryStatus, string>;

/**
 * The editor's "Details" panel: the publication status, creation and update dates, votes,
 * and (for published entries) unpublishing and discarding the draft's changes.
 */
@Component({
  selector: 'vd-entry-details',
  imports: [NgIcon, VoteControl, HlmBadgeImports, HlmButtonImports, HlmCardImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <section hlmCard size="sm">
      <div hlmCardHeader>
        <h2 hlmCardTitle>{{ t('content.edit.details') }}</h2>
        @if (type().draftAndPublish && !missing()) {
          <div hlmCardAction>
            <span hlmBadge [variant]="status() === 'published' ? 'secondary' : 'outline'">
              <span
                class="size-1.5 rounded-full"
                aria-hidden="true"
                [class]="
                  status() === 'published'
                    ? 'bg-emerald-500'
                    : status() === 'modified'
                      ? 'bg-amber-500'
                      : 'bg-muted-foreground/60'
                "
              ></span>
              {{ t(statusLabels[status()]) }}
            </span>
          </div>
        }
      </div>
      <div hlmCardContent class="flex flex-col gap-4">
        @if (type().draftAndPublish && documentId() && !missing()) {
          <p class="text-muted-foreground text-sm">{{ t(statusHints[status()]) }}</p>
        }
        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt class="text-muted-foreground">{{ t('content.edit.created') }}</dt>
          <dd class="text-end" [title]="i18n.formatDate(createdAt(), 'long')">
            {{ createdAt() ? i18n.formatDate(createdAt(), 'datetime') : '—' }}
          </dd>
          <dt class="text-muted-foreground">{{ t('content.edit.updated') }}</dt>
          <dd class="text-end" [title]="i18n.formatDate(draftUpdatedAt(), 'long')">
            {{ draftUpdatedAt() ? i18n.formatDate(draftUpdatedAt(), 'datetime') : '—' }}
          </dd>
          @if (type().draftAndPublish) {
            <dt class="text-muted-foreground">{{ t('content.edit.lastPublished') }}</dt>
            <dd class="text-end" [title]="i18n.formatDate(publishedUpdatedAt(), 'long')">
              {{
                published() && publishedUpdatedAt()
                  ? i18n.formatDate(publishedUpdatedAt(), 'datetime')
                  : '—'
              }}
            </dd>
          }
        </dl>
        @if (documentId(); as id) {
          <div class="flex items-center justify-between border-t pt-3">
            <span class="text-muted-foreground text-sm">{{ t('votes.title') }}</span>
            <vd-vote-control [uid]="type().uid" [documentId]="id" />
          </div>
        }
      </div>
      @if (documentId() && type().draftAndPublish && published() && canPublish()) {
        <div hlmCardFooter class="flex flex-col items-stretch gap-2 border-t">
          <button
            hlmBtn
            variant="outline"
            size="sm"
            type="button"
            [disabled]="busy()"
            (click)="unpublish.emit()"
          >
            <ng-icon name="lucideEyeOff" /> {{ t('content.edit.unpublish') }}
          </button>
          @if (status() === 'modified') {
            <button
              hlmBtn
              variant="outline"
              size="sm"
              type="button"
              [disabled]="busy()"
              (click)="discard.emit()"
            >
              <ng-icon name="lucideUndo2" /> {{ t('content.edit.discard') }}
            </button>
          }
        </div>
      }
    </section>
  `,
})
export class EntryDetails {
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly statusHints = STATUS_HINTS;

  readonly type = input.required<ContentType>();
  readonly documentId = input<string | null>(null);
  readonly missing = input(false);
  readonly published = input(false);
  readonly createdAt = input<string | null>(null);
  readonly draftUpdatedAt = input<string | null>(null);
  readonly publishedUpdatedAt = input<string | null>(null);
  readonly canPublish = input(false);
  readonly busy = input(false);
  readonly unpublish = output<void>();
  readonly discard = output<void>();

  protected readonly status = computed(() =>
    entryStatus(this.published(), this.draftUpdatedAt(), this.publishedUpdatedAt()),
  );
}
