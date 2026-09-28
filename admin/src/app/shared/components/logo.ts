import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';

import { BrandingService } from '../../core/branding';

/** The brand mark: the configured logo, else a leaf on the brand colour; then the title. */
@Component({
  selector: 'vd-logo',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex min-w-0 items-center gap-2' },
  template: `
    @if (logoUrl && !logoFailed()) {
      <img
        [src]="logoUrl"
        alt=""
        class="w-auto max-w-40 shrink-0 object-contain"
        [class.h-8]="size() === 'md'"
        [class.h-10]="size() === 'lg'"
        (error)="logoFailed.set(true)"
      />
    } @else {
      <span
        class="bg-primary text-primary-foreground inline-flex shrink-0 items-center justify-center rounded-lg shadow-sm"
        [class.size-8]="size() === 'md'"
        [class.size-10]="size() === 'lg'"
      >
        <ng-icon name="lucideLeaf" [size]="size() === 'lg' ? '22' : '18'" />
      </span>
    }
    @if (wordmark()) {
      <span
        class="truncate text-base font-semibold tracking-tight"
        [class.text-xl]="size() === 'lg'"
        >{{ title }}</span
      >
    } @else {
      <span class="sr-only">{{ title }}</span>
    }
  `,
})
export class Logo {
  private readonly branding = inject(BrandingService);
  readonly size = input<'md' | 'lg'>('md');
  readonly wordmark = input(true);
  protected readonly title = this.branding.title;
  protected readonly logoUrl = this.branding.value.logoUrl;
  /** A logo that cannot be loaded falls back to the mark. */
  protected readonly logoFailed = signal(false);
}
