import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';

import { ContentLocales } from '../../../core/content-locales';
import { I18n } from '../../../core/i18n/i18n';
import { ContentType } from '../../../core/types';
import { EntryCollab } from '../collab/entry-collab';

/**
 * The editor's actions, in its page header: preview (in a tab or side by side), history,
 * comments, the "more" menu (translate, duplicate, configure the view) and save / publish.
 * The editor decides what is allowed and runs the actions.
 */
@Component({
  selector: 'vd-entry-toolbar',
  imports: [
    RouterLink,
    NgIcon,
    HlmBadgeImports,
    HlmButtonImports,
    HlmDropdownMenuImports,
    HlmSpinnerImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (documentId() && previewOn() && !missing()) {
      <button
        hlmBtn
        variant="ghost"
        type="button"
        [disabled]="previewing()"
        [attr.title]="t('content.preview.hint')"
        (click)="openPreview.emit()"
      >
        @if (previewing()) {
          <hlm-spinner />
        } @else {
          <ng-icon name="lucideExternalLink" />
        }
        {{ t('content.preview.open') }}
      </button>
      <button
        hlmBtn
        variant="ghost"
        type="button"
        class="max-lg:hidden"
        [attr.aria-pressed]="sideBySide()"
        [disabled]="previewLoading()"
        (click)="toggleSideBySide.emit()"
      >
        <ng-icon name="lucideColumns2" />
        {{ t('content.preview.sideBySide') }}
      </button>
    }
    @if (documentId() && historyOn() && !missing()) {
      <a
        hlmBtn
        variant="ghost"
        [routerLink]="['/content', type().uid, documentId(), 'history']"
        [queryParams]="locale() ? { locale: locale() } : {}"
      >
        <ng-icon name="lucideHistory" /> {{ t('content.history.open') }}
      </a>
    }
    @if (collab && collabOn()) {
      <button
        hlmBtn
        variant="ghost"
        type="button"
        [attr.aria-label]="
          collab.openThreads()
            ? t('comments.openButtonCount', { count: collab.openThreads() })
            : t('comments.openButton')
        "
        (click)="collab.open()"
      >
        <ng-icon name="lucideMessageSquare" />
        {{ t('comments.openButton') }}
        @if (collab.openThreads()) {
          <span hlmBadge variant="secondary" class="tabular-nums">{{
            i18n.formatNumber(collab.openThreads())
          }}</span>
        }
      </button>
    }
    @if (canDuplicate() || canConfigure() || (canTranslate() && !missing())) {
      <button
        hlmBtn
        variant="ghost"
        size="icon"
        type="button"
        [disabled]="busy()"
        [attr.aria-label]="t('content.edit.moreActions')"
        [title]="t('content.edit.moreActions')"
        [hlmDropdownMenuTrigger]="moreMenu"
        align="end"
      >
        <ng-icon name="lucideEllipsis" />
      </button>
      <ng-template #moreMenu>
        <hlm-dropdown-menu class="w-64">
          @if (canTranslate() && !missing()) {
            <button hlmDropdownMenuItem (triggered)="translate.emit()">
              <ng-icon name="lucideSparkles" />
              {{ t('ai.translate.action', { locale: locales.name(translateFrom()) }) }}
            </button>
          }
          @if (canDuplicate()) {
            <button hlmDropdownMenuItem (triggered)="duplicate.emit()">
              <ng-icon name="lucideCopyPlus" /> {{ t('content.duplicate.action') }}
            </button>
          }
          @if (canConfigure()) {
            <button hlmDropdownMenuItem (triggered)="configure.emit()">
              <ng-icon name="lucideLayoutDashboard" /> {{ t('content.view.configure') }}
            </button>
          }
        </hlm-dropdown-menu>
      </ng-template>
    }
    <button
      hlmBtn
      variant="outline"
      type="button"
      [disabled]="busy() || !canSave()"
      (click)="save.emit(false)"
    >
      @if (busy()) {
        <hlm-spinner />
      } @else {
        <ng-icon name="lucideSave" />
      }
      {{ type().draftAndPublish ? t('content.edit.saveDraft') : t('common.save') }}
    </button>
    @if (type().draftAndPublish && canPublish()) {
      <button
        hlmBtn
        type="button"
        [disabled]="busy() || !canSave()"
        [attr.title]="
          publishHold() ? t('review.entry.publishRequires', { stage: publishHold()!.name }) : null
        "
        (click)="save.emit(true)"
      >
        <ng-icon name="lucideSend" /> {{ t('content.edit.publish') }}
      </button>
    }
  `,
})
export class EntryToolbar {
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly locales = inject(ContentLocales);
  /** Comments and tasks of the open entry (`null` where comments do not apply). */
  protected readonly collab = inject(EntryCollab, { optional: true });

  readonly type = input.required<ContentType>();
  readonly documentId = input<string | null>(null);
  readonly locale = input<string | null>(null);
  /** The document has no version in `locale` yet. */
  readonly missing = input(false);
  readonly busy = input(false);
  readonly canSave = input(false);
  readonly canPublish = input(false);
  readonly canDuplicate = input(false);
  readonly canConfigure = input(false);
  readonly canTranslate = input(false);
  /** The locale a translation starts from, by default. */
  readonly translateFrom = input('');
  readonly historyOn = input(false);
  readonly collabOn = input(false);
  readonly previewOn = input(false);
  readonly previewing = input(false);
  readonly previewLoading = input(false);
  readonly sideBySide = input(false);
  /** The review stage the entry must reach before it can be published. */
  readonly publishHold = input<{ name: string } | null>(null);

  /** Save the draft; `true`: then publish it. */
  readonly save = output<boolean>();
  readonly openPreview = output<void>();
  readonly toggleSideBySide = output<void>();
  readonly translate = output<void>();
  readonly duplicate = output<void>();
  readonly configure = output<void>();
}
