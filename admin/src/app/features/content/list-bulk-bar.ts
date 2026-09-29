import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';

import { I18n } from '../../core/i18n/i18n';
import { UsageWarning } from '../../shared/components/usage';
import { BULK_MESSAGES, ContentListState } from './list-state';

/** The floating bar of the selected entries: publish, unpublish or delete them. */
@Component({
  selector: 'vd-content-list-bulk-bar',
  imports: [NgIcon, HlmButtonImports, HlmSpinnerImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (list.selected().length || list.running()) {
      <div
        class="bg-popover text-popover-foreground sticky bottom-4 z-20 mx-auto flex w-full max-w-2xl flex-wrap items-center gap-2 rounded-xl border px-4 py-2 shadow-lg"
        role="region"
        [attr.aria-label]="t('content.list.bulk.selected', { count: list.selected().length })"
      >
        @if (list.progress(); as progress) {
          <hlm-spinner class="size-4" />
          <span class="text-sm tabular-nums" aria-live="polite">
            {{ t('content.list.bulk.progress', { done: progress.done, total: progress.total }) }}
          </span>
        } @else {
          <span class="text-sm font-medium tabular-nums">
            {{ t('content.list.bulk.selected', { count: list.selected().length }) }}
          </span>
          <button hlmBtn variant="ghost" size="sm" (click)="list.clearSelection()">
            {{ t('content.list.bulk.clear') }}
          </button>
          <div class="ms-auto flex flex-wrap gap-2">
            @if (list.canPublish()) {
              <button hlmBtn variant="outline" size="sm" (click)="list.request('publish')">
                <ng-icon name="lucideSend" /> {{ t('content.list.bulk.publish') }}
              </button>
              @if (list.targets('unpublish').length) {
                <button hlmBtn variant="outline" size="sm" (click)="list.request('unpublish')">
                  <ng-icon name="lucideEyeOff" /> {{ t('content.list.bulk.unpublish') }}
                </button>
              }
            }
            @if (list.canDelete()) {
              <button hlmBtn variant="destructive" size="sm" (click)="list.request('delete')">
                <ng-icon name="lucideTrash2" /> {{ t('common.delete') }}
              </button>
            }
          </div>
        }
      </div>
    }
  `,
})
export class ContentListBulkBar {
  protected readonly list = inject(ContentListState);
  protected readonly t = inject(I18n).t;
}

/** Confirms a bulk action (always for deletes, which also show where the entries are used). */
@Component({
  selector: 'vd-content-list-bulk-confirm',
  imports: [UsageWarning, HlmAlertDialogImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-alert-dialog
      [state]="list.confirming() ? 'open' : 'closed'"
      (closed)="list.confirming.set(null)"
    >
      <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
        @if (list.confirming(); as action) {
          <hlm-alert-dialog-header>
            <h2 hlmAlertDialogTitle>
              {{ t(BULK_MESSAGES[action].title, { count: list.targets(action).length }) }}
            </h2>
            <p hlmAlertDialogDescription>{{ t(BULK_MESSAGES[action].description) }}</p>
          </hlm-alert-dialog-header>
          @if (action === 'delete') {
            <vd-usage-warning [state]="list.deleteUsage.state()" />
          }
          <hlm-alert-dialog-footer>
            <button hlmAlertDialogCancel (click)="ctx.close()">{{ t('common.cancel') }}</button>
            <button
              hlmAlertDialogAction
              [variant]="action === 'delete' ? 'destructive' : 'default'"
              (click)="ctx.close(); list.run(action)"
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
  `,
})
export class ContentListBulkConfirm {
  protected readonly list = inject(ContentListState);
  protected readonly t = inject(I18n).t;
  protected readonly BULK_MESSAGES = BULK_MESSAGES;
}
