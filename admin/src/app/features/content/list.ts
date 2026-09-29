import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';

import { I18n } from '../../core/i18n/i18n';
import { PageHeader } from '../../shared/components/page-header';
import { Pagination } from '../../shared/components/pagination';
import { ContentListBulkBar, ContentListBulkConfirm } from './list-bulk-bar';
import { ContentImport } from './list-import';
import { ContentListState } from './list-state';
import { ContentListTable } from './list-table';
import { ContentListToolbar } from './list-toolbar';

/**
 * The entries of a content type. The state lives in `ContentListState`; this page lays out
 * its parts: header actions (import, export, create), toolbar, table, pagination, bulk bar.
 */
@Component({
  selector: 'vd-content-list',
  imports: [
    RouterLink,
    NgIcon,
    PageHeader,
    Pagination,
    ContentImport,
    ContentListToolbar,
    ContentListTable,
    ContentListBulkBar,
    ContentListBulkConfirm,
    HlmAlertImports,
    HlmButtonImports,
    HlmDropdownMenuImports,
    HlmSpinnerImports,
  ],
  providers: [ContentListState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (list.type(); as type) {
      <div class="flex flex-col gap-6">
        <vd-page-header [title]="type.displayName" [description]="type.description">
          <div actions class="flex flex-wrap items-center gap-2">
            @if (list.canImport()) {
              <button hlmBtn variant="outline" type="button" (click)="importing.set(true)">
                <ng-icon name="lucideUpload" /> {{ t('transfer.import.button') }}
              </button>
            }
            @if (list.canExport()) {
              <button
                hlmBtn
                variant="outline"
                type="button"
                [disabled]="list.exporting()"
                [hlmDropdownMenuTrigger]="exportMenu"
                align="end"
              >
                @if (list.exporting()) {
                  <hlm-spinner class="size-4" />
                } @else {
                  <ng-icon name="lucideDownload" />
                }
                {{ t('transfer.export.button') }}
                <ng-icon name="lucideChevronDown" size="14" />
              </button>
            }
            @if (list.canCreate()) {
              <a
                hlmBtn
                [routerLink]="['/content', type.uid, 'new']"
                [queryParams]="list.localeQuery()"
                ><ng-icon name="lucidePlus" /> {{ t('common.create') }}</a
              >
            }
          </div>
        </vd-page-header>

        @if (list.error()) {
          <div hlmAlert variant="destructive">
            <ng-icon name="lucideCircleAlert" />
            <p hlmAlertTitle>{{ list.error() }}</p>
          </div>
        }

        <div class="contents" aria-live="polite">
          @if (list.outdated()) {
            <div hlmAlert>
              <ng-icon hlmAlertIcon name="lucideRefreshCw" />
              <p hlmAlertTitle>{{ t('presence.list.changed') }}</p>
              <p hlmAlertDescription>
                {{
                  list.changedRows().size
                    ? t('presence.list.changedRows', { count: list.changedRows().size })
                    : t('presence.list.changedHint')
                }}
              </p>
              <div class="col-start-2 mt-2">
                <button
                  hlmBtn
                  variant="outline"
                  size="sm"
                  type="button"
                  [disabled]="list.running()"
                  (click)="list.refresh()"
                >
                  <ng-icon name="lucideRefreshCw" /> {{ t('presence.list.refresh') }}
                </button>
              </div>
            </div>
          }
        </div>

        <div class="bg-card overflow-hidden rounded-xl border shadow-xs">
          <vd-content-list-toolbar />
          <vd-content-list-table />
          @if (list.pageCount() > 1) {
            <vd-pagination
              class="border-t px-4 py-3"
              [(page)]="list.page"
              [pageCount]="list.pageCount()"
              [disabled]="list.running()"
            />
          }
        </div>

        <vd-content-list-bulk-bar />
      </div>

      <ng-template #exportMenu>
        <hlm-dropdown-menu class="w-60">
          <div hlmDropdownMenuLabel class="text-muted-foreground text-xs font-normal">
            {{ t('transfer.export.hint') }}
          </div>
          <button hlmDropdownMenuItem (triggered)="list.export('csv')">
            <ng-icon name="lucideFileText" /> {{ t('transfer.export.csv') }}
          </button>
          <button hlmDropdownMenuItem (triggered)="list.export('json')">
            <ng-icon name="lucideBraces" /> {{ t('transfer.export.json') }}
          </button>
        </hlm-dropdown-menu>
      </ng-template>

      <vd-content-import
        [type]="type"
        [locale]="list.locale()"
        [open]="importing()"
        [canPublish]="list.canPublish()"
        (closed)="importing.set(false)"
        (imported)="list.refresh()"
      />

      <vd-content-list-bulk-confirm />
    }
  `,
})
export class ContentList {
  protected readonly list = inject(ContentListState);
  protected readonly t = inject(I18n).t;

  readonly uid = input.required<string>();

  protected readonly importing = signal(false);

  constructor() {
    this.list.connect(this.uid);
  }
}
