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
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';

import { ApiFailure } from '../../core/api';
import { Auth } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import {
  Assignee,
  EntryReview as EntryReviewState,
  EntryReviewChange,
  ReviewWorkflows,
  pendingPublishStage,
  stageOf,
} from '../../core/review';
import { StageBadge } from '../../shared/components/stage-badge';

/** A user's name for pickers: "First Last", else the email. */
export function adminName(user: Pick<Assignee, 'firstname' | 'lastname' | 'email'>): string {
  return [user.firstname, user.lastname].filter(Boolean).join(' ') || user.email;
}

/** The editor's "Review" card: the entry's stage and assignee (types with a workflow). */
@Component({
  selector: 'vd-entry-review',
  imports: [
    NgIcon,
    StageBadge,
    HlmAlertImports,
    HlmButtonImports,
    HlmCardImports,
    HlmFieldImports,
    HlmNativeSelectImports,
    HlmSkeletonImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (review() === undefined) {
      <section hlmCard size="sm" [attr.aria-label]="t('review.entry.title')">
        <div hlmCardContent><hlm-skeleton class="h-16 w-full" /></div>
      </section>
    } @else if (review(); as state) {
      <section hlmCard size="sm" aria-labelledby="entry-review-title">
        <div hlmCardHeader>
          <h2 hlmCardTitle id="entry-review-title">{{ t('review.entry.title') }}</h2>
          <p hlmCardDescription>{{ state.workflow.name }}</p>
          @if (current(); as stage) {
            <div hlmCardAction>
              <vd-stage-badge [name]="stage.name" [color]="stage.color" />
            </div>
          }
        </div>
        <div hlmCardContent class="flex flex-col gap-4">
          <div hlmField>
            <label hlmFieldLabel for="entry-review-stage">{{ t('review.entry.stage') }}</label>
            <hlm-native-select
              selectId="entry-review-stage"
              [value]="'' + state.stageId"
              [disabled]="busy() || !movable()"
              (valueChange)="moveTo($event)"
            >
              @for (stage of state.workflow.stages; track stage.id) {
                <option
                  hlmNativeSelectOption
                  [value]="'' + stage.id"
                  [disabled]="stage.id !== state.stageId && !state.canMoveTo.includes(stage.id)"
                >
                  {{ stage.name }}
                </option>
              }
            </hlm-native-select>
            @if (!movable()) {
              <p hlmFieldDescription>{{ t('review.entry.readOnly') }}</p>
            } @else if (restricted()) {
              <p hlmFieldDescription>{{ t('review.entry.restricted') }}</p>
            }
          </div>

          <div hlmField>
            @if (canUpdate() && assignees(); as list) {
              <label hlmFieldLabel for="entry-review-assignee">{{
                t('review.entry.assignee')
              }}</label>
              <div class="flex items-center gap-2">
                <hlm-native-select
                  class="min-w-0 flex-1"
                  selectId="entry-review-assignee"
                  [value]="state.assigneeId === null ? '' : '' + state.assigneeId"
                  [disabled]="busy()"
                  (valueChange)="assign($event ? +$event : null)"
                >
                  <option hlmNativeSelectOption value="">{{ t('review.entry.unassigned') }}</option>
                  @if (state.assigneeId !== null && !listed(list, state.assigneeId)) {
                    <option hlmNativeSelectOption [value]="'' + state.assigneeId">
                      {{ t('review.entry.assignedTo', { id: state.assigneeId }) }}
                    </option>
                  }
                  @for (user of list; track user.id) {
                    <option hlmNativeSelectOption [value]="'' + user.id">
                      {{ name(user) }}{{ user.id === me() ? ' · ' + t('review.entry.you') : '' }}
                    </option>
                  }
                </hlm-native-select>
                @if (state.assigneeId !== null) {
                  <button
                    hlmBtn
                    size="icon"
                    variant="ghost"
                    type="button"
                    class="text-muted-foreground"
                    [disabled]="busy()"
                    [attr.aria-label]="t('review.entry.unassign')"
                    [attr.title]="t('review.entry.unassign')"
                    (click)="assign(null)"
                  >
                    <ng-icon name="lucideX" />
                  </button>
                }
              </div>
            } @else {
              <span hlmFieldLabel id="entry-review-assignee-label">{{
                t('review.entry.assignee')
              }}</span>
              <p class="text-sm" aria-labelledby="entry-review-assignee-label">
                {{
                  state.assigneeId === null
                    ? t('review.entry.unassigned')
                    : state.assigneeId === me()
                      ? t('review.entry.assignedToYou')
                      : t('review.entry.assignedTo', { id: state.assigneeId })
                }}
              </p>
            }
          </div>

          @if (required(); as stage) {
            <div hlmAlert>
              <ng-icon hlmAlertIcon name="lucideInfo" />
              <p hlmAlertDescription>
                {{ t('review.entry.publishRequires', { stage: stage.name }) }}
              </p>
            </div>
          }
          @if (state.updatedAt) {
            <p class="text-muted-foreground text-xs">
              {{ t('review.entry.changed', { when: i18n.formatRelative(state.updatedAt) }) }}
            </p>
          }
        </div>
      </section>
    }
  `,
})
export class EntryReview {
  private readonly service = inject(ReviewWorkflows);
  private readonly auth = inject(Auth);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly name = adminName;

  readonly uid = input.required<string>();
  readonly documentId = input.required<string>();
  /** The edited locale (localized types). */
  readonly locale = input<string | null>(null);
  /** The review state whenever it loads or changes (`null`: the type has no workflow). */
  readonly changed = output<EntryReviewState | null>();

  /** `undefined` while loading, `null` without a workflow. */
  protected readonly review = signal<EntryReviewState | null | undefined>(undefined);
  /** Admins who can be assigned (they can read the type); `null` until loaded or unavailable. */
  protected readonly assignees = signal<Assignee[] | null>(null);
  protected readonly busy = signal(false);

  protected readonly me = computed(() => this.auth.user()?.id ?? null);
  protected readonly canUpdate = computed(() => this.auth.canContent('content.update', this.uid()));
  protected readonly current = computed(() => {
    const review = this.review();
    return review ? stageOf(review.workflow, review.stageId) : null;
  });
  protected readonly movable = computed(() => {
    const review = this.review();
    return !!review && review.canMoveTo.some((id) => id !== review.stageId);
  });
  /** Some stages are kept for other roles. */
  protected readonly restricted = computed(() => {
    const review = this.review();
    return !!review && review.workflow.stages.some((stage) => !review.canMoveTo.includes(stage.id));
  });
  protected readonly required = computed(() => pendingPublishStage(this.review() ?? null));

  constructor() {
    effect(() => {
      this.uid();
      this.documentId();
      this.locale();
      untracked(() => void this.load());
    });
  }

  async load(): Promise<void> {
    try {
      const review = await this.service.entry(this.uid(), this.documentId(), this.locale());
      this.review.set(review);
      this.changed.emit(review);
      if (review && this.assignees() === null && this.canUpdate()) {
        this.assignees.set(await this.service.assignees(this.uid()).catch(() => null));
      }
    } catch {
      // Without the feature (or the right to read it) the card stays hidden.
      this.review.set(null);
      this.changed.emit(null);
    }
  }

  protected listed(list: Assignee[], id: number): boolean {
    return list.some((user) => user.id === id);
  }

  protected moveTo(value: string | null | undefined): void {
    const stageId = Number(value);
    if (!stageId || stageId === this.review()?.stageId) return;
    void this.apply({ stageId }, 'stage');
  }

  protected assign(assigneeId: number | null): void {
    if (assigneeId === (this.review()?.assigneeId ?? null)) return;
    void this.apply({ assigneeId }, 'assignee');
  }

  private async apply(change: EntryReviewChange, kind: 'stage' | 'assignee'): Promise<void> {
    const review = this.review();
    if (!review || this.busy()) return;
    this.busy.set(true);
    try {
      const updated = await this.service.change(
        this.uid(),
        this.documentId(),
        this.locale(),
        change,
      );
      const next: EntryReviewState = {
        ...review,
        stageId: updated.stageId,
        assigneeId: updated.assigneeId,
        updatedAt: updated.updatedAt,
        updatedBy: updated.updatedBy,
      };
      this.review.set(next);
      this.changed.emit(next);
      if (kind === 'stage') {
        const stage = stageOf(review.workflow, updated.stageId);
        toast.success(this.t('review.entry.moved', { stage: stage?.name ?? '' }));
      } else {
        toast.success(
          this.t(
            updated.assigneeId === null ? 'review.entry.unassignedToast' : 'review.entry.assigned',
          ),
        );
      }
    } catch (error) {
      const failure = ApiFailure.from(error);
      toast.error(
        this.t(kind === 'stage' ? 'review.entry.moveError' : 'review.entry.assignError'),
        {
          description:
            failure.status === 403 ? this.t('review.entry.forbiddenStage') : failure.message,
        },
      );
      // Put the selects back.
      this.review.set({ ...review });
    } finally {
      this.busy.set(false);
    }
  }
}
