import { ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';

import { I18n } from '../../core/i18n/i18n';

/**
 * Previous / next paging under a list: "Page 2 of 5" (after an optional summary) and the
 * two buttons. `compact` shows icon buttons around the page (dialogs). The host lays out
 * the row; callers add its border and padding, and show it only when there is more than one page.
 */
@Component({
  selector: 'vd-pagination',
  imports: [NgIcon, HlmButtonImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'flex flex-wrap items-center justify-end gap-2',
    role: 'navigation',
    '[attr.aria-label]': 'label() || t("common.pagination")',
  },
  template: `
    @if (compact()) {
      <button
        hlmBtn
        variant="outline"
        size="icon-sm"
        type="button"
        [attr.aria-label]="t('common.previous')"
        [disabled]="page() <= 1 || disabled()"
        (click)="go(page() - 1)"
      >
        <ng-icon name="lucideArrowLeft" class="rtl:-scale-x-100" />
      </button>
      <span class="text-muted-foreground text-sm tabular-nums">
        {{ text() }}
      </span>
      <button
        hlmBtn
        variant="outline"
        size="icon-sm"
        type="button"
        [attr.aria-label]="t('common.next')"
        [disabled]="page() >= pageCount() || disabled()"
        (click)="go(page() + 1)"
      >
        <ng-icon name="lucideChevronRight" class="rtl:-scale-x-100" />
      </button>
    } @else {
      <span class="text-muted-foreground me-auto text-sm tabular-nums">
        {{ text() }}
      </span>
      <button
        hlmBtn
        variant="outline"
        size="sm"
        type="button"
        [disabled]="page() <= 1 || disabled()"
        (click)="go(page() - 1)"
      >
        <ng-icon name="lucideArrowLeft" class="rtl:-scale-x-100" />
        {{ t('common.previous') }}
      </button>
      <button
        hlmBtn
        variant="outline"
        size="sm"
        type="button"
        [disabled]="page() >= pageCount() || disabled()"
        (click)="go(page() + 1)"
      >
        {{ t('common.next') }}
        <ng-icon name="lucideChevronRight" class="rtl:-scale-x-100" />
      </button>
    }
  `,
})
export class Pagination {
  protected readonly t = inject(I18n).t;

  /** The current page, 1-based (`[(page)]`). */
  readonly page = model.required<number>();
  readonly pageCount = input.required<number>();
  /** Both buttons off (a request or bulk action is running). */
  readonly disabled = input(false);
  /** The landmark's name; "Pagination" by default. */
  readonly label = input<string | null>(null);
  readonly compact = input(false);
  /** Shown before the page number ("12 files"). */
  readonly summary = input<string | null>(null);

  protected readonly text = computed(() => {
    const page = this.t('common.page', { page: this.page(), count: this.pageCount() });
    const summary = this.summary();
    return summary ? `${summary} · ${page}` : page;
  });

  protected go(page: number): void {
    this.page.set(Math.min(Math.max(1, page), Math.max(1, this.pageCount())));
  }
}
