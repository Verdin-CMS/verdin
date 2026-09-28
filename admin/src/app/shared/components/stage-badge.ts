import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';

/** A review stage: its name with a dot of its color (the text keeps the theme's contrast). */
@Component({
  selector: 'vd-stage-badge',
  imports: [HlmBadgeImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span hlmBadge variant="outline" class="max-w-48 gap-1.5 font-normal" [attr.title]="name()">
      <span
        class="size-2 shrink-0 rounded-full"
        aria-hidden="true"
        [style.background]="color()"
      ></span>
      <span class="truncate">{{ name() }}</span>
    </span>
  `,
})
export class StageBadge {
  readonly name = input.required<string>();
  readonly color = input('#4945ff');
}
