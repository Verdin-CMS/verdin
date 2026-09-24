import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { NgIcon } from '@ng-icons/core';

/** The Verdin mark: a leaf on the brand colour. */
@Component({
  selector: 'vd-logo',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex items-center gap-2' },
  template: `
    <span
      class="bg-primary text-primary-foreground inline-flex shrink-0 items-center justify-center rounded-lg shadow-sm"
      [class.size-8]="size() === 'md'"
      [class.size-10]="size() === 'lg'"
    >
      <ng-icon name="lucideLeaf" [size]="size() === 'lg' ? '22' : '18'" />
    </span>
    @if (wordmark()) {
      <span class="text-base font-semibold tracking-tight" [class.text-xl]="size() === 'lg'"
        >Verdin</span
      >
    }
  `,
})
export class Logo {
  readonly size = input<'md' | 'lg'>('md');
  readonly wordmark = input(true);
}
