import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';

import { I18n } from '../../../core/i18n/i18n';
import { EntryCollab } from './entry-collab';

/**
 * The comment button next to a field's label: opens the field's threads (a new comment is
 * then about the field) and shows how many are open. Nothing outside an entry editor, or
 * before the entry is saved.
 */
@Component({
  selector: 'vd-field-comments-button',
  imports: [NgIcon, HlmButtonImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (shown()) {
      <button
        hlmBtn
        variant="ghost"
        size="xs"
        type="button"
        class="text-muted-foreground hover:text-foreground h-6 gap-1 px-1.5"
        [class.text-primary]="count()"
        [attr.aria-label]="
          count()
            ? t('comments.field.buttonCount', { field: label(), count: count() })
            : t('comments.field.button', { field: label() })
        "
        [title]="t('comments.field.button', { field: label() })"
        (click)="collab!.open('comments', path())"
      >
        <ng-icon [name]="count() ? 'lucideMessageSquareText' : 'lucideMessageSquarePlus'" />
        @if (count()) {
          <span class="text-xs tabular-nums">{{ i18n.formatNumber(count()) }}</span>
        }
      </button>
    }
  `,
})
export class FieldCommentsButton {
  protected readonly collab = inject(EntryCollab, { optional: true });
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  /** The field's path (`title`, `seo.metaTitle`, `blocks.0.heading`). */
  readonly path = input.required<string>();
  /** The field's label, for the button's accessible name. */
  readonly label = input.required<string>();

  protected readonly shown = computed(
    () => !!this.collab && this.collab.on() && !!this.collab.entry(),
  );
  protected readonly count = computed(() => this.collab?.counts().get(this.path()) ?? 0);
}
