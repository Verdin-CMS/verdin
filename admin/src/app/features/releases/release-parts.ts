import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';

import { ApiFailure } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/keys';
import {
  Release,
  ReleaseActionStatus,
  ReleaseStatus,
  Releases,
  fromLocalInput,
  toLocalInput,
} from '../../core/releases';

type Variant = 'default' | 'secondary' | 'destructive' | 'outline';

const STATUSES: Record<
  ReleaseStatus | ReleaseActionStatus,
  { label: MessageKey; icon: string; variant: Variant }
> = {
  pending: { label: 'releases.status.pending', icon: 'lucideClock', variant: 'outline' },
  running: { label: 'releases.status.running', icon: 'lucideRefreshCw', variant: 'secondary' },
  done: { label: 'releases.status.done', icon: 'lucideCheck', variant: 'default' },
  failed: { label: 'releases.status.failed', icon: 'lucideCircleAlert', variant: 'destructive' },
};

/** A release (or release action) status as a badge. */
@Component({
  selector: 'vd-release-status',
  imports: [NgIcon, HlmBadgeImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span hlmBadge [variant]="spec().variant">
      <ng-icon [name]="spec().icon" aria-hidden="true" />
      {{ t(spec().label) }}
    </span>
  `,
})
export class ReleaseStatusBadge {
  protected readonly t = inject(I18n).t;
  readonly status = input.required<string>();
  protected readonly spec = computed(
    () => STATUSES[this.status() as ReleaseStatus] ?? STATUSES.pending,
  );
}

/** Creates (`release` null) or edits a release: its name and optional schedule. */
@Component({
  selector: 'vd-release-dialog',
  imports: [
    NgIcon,
    HlmAlertImports,
    HlmButtonImports,
    HlmDialogImports,
    HlmFieldImports,
    HlmInputImports,
    HlmSpinnerImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog [state]="open() ? 'open' : 'closed'" (closed)="closed.emit()">
      <hlm-dialog-content
        *hlmDialogPortal="let ctx"
        class="sm:max-w-md"
        [closeLabel]="t('common.close')"
      >
        <hlm-dialog-header>
          <h2 hlmDialogTitle>
            {{ release() ? t('releases.dialog.editTitle') : t('releases.dialog.createTitle') }}
          </h2>
          <p hlmDialogDescription>{{ t('releases.dialog.description') }}</p>
        </hlm-dialog-header>
        <form class="flex flex-col gap-4" novalidate (submit)="$event.preventDefault(); save()">
          <div hlmField [attr.data-invalid]="nameProblem() ? true : null">
            <label hlmFieldLabel for="release-name">{{ t('releases.dialog.name') }}</label>
            <input
              hlmInput
              id="release-name"
              maxlength="255"
              required
              autocomplete="off"
              [attr.aria-invalid]="nameProblem() ? true : null"
              [attr.aria-describedby]="nameProblem() ? 'release-name-error' : null"
              [value]="name()"
              (input)="name.set($any($event.target).value)"
              (blur)="touched.set(true)"
            />
            @if (nameProblem()) {
              <p class="text-destructive text-sm" id="release-name-error">
                {{ t('releases.dialog.nameRequired') }}
              </p>
            }
          </div>
          <div hlmField>
            <label hlmFieldLabel for="release-date">{{ t('releases.dialog.scheduledAt') }}</label>
            <div class="flex gap-2">
              <input
                hlmInput
                id="release-date"
                type="datetime-local"
                aria-describedby="release-date-hint"
                [value]="scheduled()"
                (input)="scheduled.set($any($event.target).value)"
                (change)="scheduled.set($any($event.target).value)"
              />
              @if (scheduled()) {
                <button
                  hlmBtn
                  type="button"
                  variant="ghost"
                  size="icon"
                  [attr.aria-label]="t('releases.dialog.clearDate')"
                  (click)="scheduled.set('')"
                >
                  <ng-icon name="lucideX" />
                </button>
              }
            </div>
            <p id="release-date-hint" class="text-muted-foreground text-xs">
              {{ t('releases.dialog.scheduledHint', { zone: zone }) }}
            </p>
          </div>
          @if (error()) {
            <div hlmAlert variant="destructive" role="alert">
              <ng-icon hlmAlertIcon name="lucideCircleAlert" />
              <p hlmAlertDescription>{{ error() }}</p>
            </div>
          }
          <hlm-dialog-footer>
            <button hlmBtn type="button" variant="outline" (click)="closed.emit()">
              {{ t('common.cancel') }}
            </button>
            <button hlmBtn type="submit" [disabled]="saving()">
              @if (saving()) {
                <hlm-spinner class="size-4" />
              }
              {{ release() ? t('common.save') : t('releases.dialog.create') }}
            </button>
          </hlm-dialog-footer>
        </form>
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class ReleaseDialog {
  private readonly releases = inject(Releases);
  protected readonly t = inject(I18n).t;

  readonly open = input(false);
  /** The release to edit; `null` creates one. */
  readonly release = input<Release | null>(null);
  readonly saved = output<Release>();
  readonly closed = output<void>();

  protected readonly name = signal('');
  protected readonly scheduled = signal('');
  protected readonly touched = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly nameProblem = computed(() => this.touched() && !this.name().trim());
  protected readonly zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';

  constructor() {
    // Reset the form each time it opens.
    effect(() => {
      if (!this.open()) return;
      const release = this.release();
      untracked(() => {
        this.name.set(release?.name ?? '');
        this.scheduled.set(toLocalInput(release?.scheduledAt));
        this.touched.set(false);
        this.error.set(null);
      });
    });
  }

  protected async save(): Promise<void> {
    this.touched.set(true);
    const name = this.name().trim();
    if (!name || this.saving()) return;
    const scheduledAt = fromLocalInput(this.scheduled());
    if (this.scheduled() && !scheduledAt) {
      this.error.set(this.t('releases.dialog.invalidDate'));
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      const release = this.release();
      const saved = release
        ? await this.releases.update(release.id, { name, scheduledAt })
        : await this.releases.create({ name, scheduledAt });
      this.saved.emit(saved);
    } catch (error) {
      this.error.set(ApiFailure.from(error).message);
    } finally {
      this.saving.set(false);
    }
  }
}
