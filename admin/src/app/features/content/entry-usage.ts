import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { HlmCardImports } from '@spartan-ng/helm/card';

import { UsageProbe, Usages } from '../../core/usage';
import { UsageSection } from '../../shared/components/usage';

/** The editor's "Used in" card: the entries referencing this one. */
@Component({
  selector: 'vd-entry-usage',
  imports: [HlmCardImports, UsageSection],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section hlmCard size="sm">
      <div hlmCardContent>
        <vd-usage-section [state]="probe.state()" [level]="2" (retry)="load()" />
      </div>
    </section>
  `,
})
export class EntryUsage {
  private readonly usages = inject(Usages);

  readonly uid = input.required<string>();
  readonly documentId = input.required<string>();
  readonly locale = input<string | null>(null);

  protected readonly probe = new UsageProbe();

  constructor() {
    effect(() => {
      this.uid();
      this.documentId();
      this.locale();
      untracked(() => this.load());
    });
  }

  load(): void {
    void this.probe.start(() => this.usages.forEntry(this.uid(), this.documentId(), this.locale()));
  }
}
