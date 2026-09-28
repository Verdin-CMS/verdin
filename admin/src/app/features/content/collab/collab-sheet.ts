import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmSheetImports } from '@spartan-ng/helm/sheet';
import { HlmTabsImports } from '@spartan-ng/helm/tabs';

import { I18n } from '../../../core/i18n/i18n';
import { CommentsTab } from './comments-tab';
import { CollabTab, EntryCollab } from './entry-collab';
import { TasksTab } from './tasks-tab';

/** The entry editor's side panel: comments and tasks of the open entry. */
@Component({
  selector: 'vd-collab-sheet',
  imports: [CommentsTab, TasksTab, HlmBadgeImports, HlmSheetImports, HlmTabsImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-sheet
      [side]="i18n.endSide()"
      [state]="collab.panelOpen() ? 'open' : 'closed'"
      (closed)="collab.close()"
    >
      <hlm-sheet-content
        *hlmSheetPortal="let ctx"
        class="gap-0 p-0 data-[side=left]:w-full data-[side=right]:w-full data-[side=left]:sm:max-w-md data-[side=right]:sm:max-w-md"
      >
        <hlm-sheet-header class="border-b p-4 pe-12">
          <h2 hlmSheetTitle>{{ t('comments.panel.title') }}</h2>
          <p hlmSheetDescription class="truncate">{{ heading() }}</p>
        </hlm-sheet-header>
        <hlm-tabs
          class="min-h-0 flex-1 gap-0"
          [tab]="collab.tab()"
          (tabActivated)="collab.tab.set(asTab($event))"
        >
          <hlm-tabs-list class="mx-4 mt-3 self-start" [attr.aria-label]="t('comments.panel.title')">
            <button hlmTabsTrigger="comments" type="button">
              {{ t('comments.tab') }}
              @if (collab.openThreads()) {
                <span hlmBadge variant="secondary" class="tabular-nums">{{
                  i18n.formatNumber(collab.openThreads())
                }}</span>
              }
            </button>
            <button hlmTabsTrigger="tasks" type="button">
              {{ t('tasks.tab') }}
              @if (collab.openTasks()) {
                <span hlmBadge variant="secondary" class="tabular-nums">{{
                  i18n.formatNumber(collab.openTasks())
                }}</span>
              }
            </button>
          </hlm-tabs-list>
          <div hlmTabsContent="comments" class="min-h-0 flex-1 overflow-y-auto p-4 outline-none">
            <vd-comments-tab />
          </div>
          <div hlmTabsContent="tasks" class="min-h-0 flex-1 overflow-y-auto p-4 outline-none">
            <vd-tasks-tab />
          </div>
        </hlm-tabs>
        <p class="sr-only" aria-live="polite">{{ live() }}</p>
      </hlm-sheet-content>
    </hlm-sheet>
  `,
})
export class CollabSheet {
  protected readonly collab = inject(EntryCollab);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  /** The entry's title. */
  readonly heading = input('');

  /** Other admins' changes, read out as they come in. */
  protected readonly live = computed(() => {
    const incoming = this.collab.incoming();
    if (!incoming) return '';
    const text =
      incoming.comments && incoming.tasks
        ? this.t('comments.live.both')
        : incoming.tasks
          ? this.t('tasks.live.updated')
          : this.t('comments.live.updated');
    // A zero-width variation keeps repeated announcements distinct.
    return incoming.seq % 2 ? text : `${text}​`;
  });

  protected asTab(value: string): CollabTab {
    return value === 'tasks' ? 'tasks' : 'comments';
  }
}
