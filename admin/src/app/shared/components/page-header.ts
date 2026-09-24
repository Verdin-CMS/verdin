import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Page title, optional description and actions (projected `[actions]`). */
@Component({
  selector: 'vd-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-wrap items-end gap-x-4 gap-y-3' },
  template: `
    <div class="flex min-w-0 flex-col gap-1">
      <ng-content select="[eyebrow]" />
      <h1 class="truncate text-2xl font-semibold tracking-tight">{{ title() }}</h1>
      @if (description()) {
        <p class="text-muted-foreground text-sm">{{ description() }}</p>
      }
    </div>
    <div class="ms-auto flex flex-wrap items-center gap-2">
      <ng-content select="[actions]" />
    </div>
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly description = input<string | null | undefined>(null);
}
