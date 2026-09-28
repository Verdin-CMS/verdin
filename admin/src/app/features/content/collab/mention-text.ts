import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { parseBody } from '../../../core/comments';

/** A comment body: its text, with mentions as chips. */
@Component({
  selector: 'vd-mention-text',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block text-sm break-words whitespace-pre-wrap' },
  // Keeps the comment's line breaks (Angular drops whitespace-only template nodes).
  template: `@for (segment of segments(); track $index) {
    @if (segment.kind === 'mention') {
      <span
        class="bg-primary/10 text-primary rounded px-1 py-px font-medium"
        [class.ring-1]="segment.userId === me()"
        [class.ring-primary/40]="segment.userId === me()"
        >&#64;{{ segment.name }}</span
      >
    } @else {
      <ng-container>{{ segment.text }}</ng-container>
    }
  }`,
})
export class MentionText {
  readonly body = input.required<string>();
  /** The viewer's id: their mentions stand out. */
  readonly me = input<number | null>(null);

  protected readonly segments = computed(() => parseBody(this.body()));
}
