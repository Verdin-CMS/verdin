import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';

import { Engagement, VoteTally } from '../../core/engagement';
import { I18n } from '../../core/i18n/i18n';

/** Up/down vote on a document, with its score. Loads its own tally unless given one. */
@Component({
  selector: 'vd-vote-control',
  imports: [NgIcon, HlmButtonImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex items-center gap-0.5' },
  template: `
    <button
      hlmBtn
      type="button"
      variant="ghost"
      size="icon-sm"
      [class.text-primary]="tally().mine === 1"
      [attr.aria-pressed]="tally().mine === 1"
      [attr.aria-label]="t('votes.up')"
      [disabled]="busy()"
      (click)="$event.preventDefault(); $event.stopPropagation(); cast(1)"
    >
      <ng-icon name="lucideThumbsUp" [size]="size()" />
    </button>
    <span
      class="min-w-6 text-center text-sm font-medium tabular-nums"
      [class.text-primary]="tally().score > 0"
      [class.text-destructive]="tally().score < 0"
      [title]="t('votes.detail', { up: tally().up, down: tally().down })"
      >{{ i18n.formatNumber(tally().score) }}</span
    >
    <button
      hlmBtn
      type="button"
      variant="ghost"
      size="icon-sm"
      [class.text-destructive]="tally().mine === -1"
      [attr.aria-pressed]="tally().mine === -1"
      [attr.aria-label]="t('votes.down')"
      [disabled]="busy()"
      (click)="$event.preventDefault(); $event.stopPropagation(); cast(-1)"
    >
      <ng-icon name="lucideThumbsDown" [size]="size()" />
    </button>
  `,
})
export class VoteControl {
  private readonly engagement = inject(Engagement);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  readonly uid = input.required<string>();
  readonly documentId = input.required<string>();
  /** A tally already loaded in bulk (lists); otherwise fetched. */
  readonly initial = input<VoteTally | null | undefined>(undefined);
  readonly size = input('14');

  protected readonly tally = signal<VoteTally>({ score: 0, up: 0, down: 0, mine: 0 });
  protected readonly busy = signal(false);

  constructor() {
    effect(() => {
      const initial = this.initial();
      if (initial) {
        this.tally.set(initial);
        return;
      }
      if (initial === undefined) void this.load(this.uid(), this.documentId());
    });
  }

  private async load(uid: string, documentId: string): Promise<void> {
    try {
      const tallies = await this.engagement.votes(uid, [documentId]);
      if (tallies[documentId]) this.tally.set(tallies[documentId]);
    } catch {
      // Votes are optional decoration; keep the zero tally.
    }
  }

  protected async cast(value: 1 | -1): Promise<void> {
    this.busy.set(true);
    try {
      const next = this.tally().mine === value ? 0 : value;
      this.tally.set(await this.engagement.vote(this.uid(), this.documentId(), next));
    } catch {
      // Leave the tally as it was.
    } finally {
      this.busy.set(false);
    }
  }
}
