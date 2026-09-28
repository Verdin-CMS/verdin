import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { I18n } from '../../../core/i18n/i18n';
import { initialsOf } from '../../../core/presence';
import { Viewer } from '../../../core/realtime';

/** At most this many avatars; the rest are counted. */
const SHOWN = 4;

/** Avatars of the other admins on the entry; editors get a ring. */
@Component({
  selector: 'vd-presence-avatars',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (viewers().length) {
      <div class="flex items-center" role="group" [attr.aria-label]="summary()">
        <ul class="flex -space-x-2 rtl:space-x-reverse" aria-hidden="true">
          @for (viewer of shown(); track viewer.userId) {
            <li
              class="bg-muted text-foreground ring-background inline-flex size-8 items-center justify-center rounded-full text-xs font-medium ring-2"
              [class.ring-amber-500]="viewer.editing"
              [title]="
                viewer.editing
                  ? t('presence.editing', { name: viewer.name })
                  : t('presence.viewing', { name: viewer.name })
              "
            >
              {{ initials(viewer.name) }}
            </li>
          }
          @if (hidden()) {
            <li
              class="bg-muted text-muted-foreground ring-background inline-flex size-8 items-center justify-center rounded-full text-xs ring-2 tabular-nums"
              [title]="hiddenNames()"
            >
              +{{ hidden() }}
            </li>
          }
        </ul>
      </div>
    }
  `,
})
export class PresenceAvatars {
  protected readonly t = inject(I18n).t;
  private readonly i18n = inject(I18n);
  readonly viewers = input<Viewer[]>([]);

  protected readonly initials = initialsOf;
  protected readonly shown = computed(() => this.viewers().slice(0, SHOWN));
  protected readonly hidden = computed(() => Math.max(0, this.viewers().length - SHOWN));
  protected readonly hiddenNames = computed(() =>
    this.i18n.formatList(
      this.viewers()
        .slice(SHOWN)
        .map((viewer) => viewer.name),
    ),
  );
  protected readonly summary = computed(() => {
    const editing = this.viewers().filter((viewer) => viewer.editing);
    const viewing = this.viewers().filter((viewer) => !viewer.editing);
    const parts: string[] = [];
    if (editing.length)
      parts.push(
        this.t('presence.summaryEditing', {
          names: this.i18n.formatList(editing.map((viewer) => viewer.name)),
        }),
      );
    if (viewing.length)
      parts.push(
        this.t('presence.summaryViewing', {
          names: this.i18n.formatList(viewing.map((viewer) => viewer.name)),
        }),
      );
    return parts.join('. ');
  });
}
