import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  Injector,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';

import { ApiFailure } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import {
  DEFAULT_STAGE_COLOR,
  ReviewWorkflows,
  STAGE_COLORS,
  StageRole,
  Workflow,
  isStageColor,
  moveItem,
  nextStageName,
  toWorkflowInput,
  typesInUse,
} from '../../core/review';
import { Schema } from '../../core/schema';
import { PageHeader } from '../../shared/components/page-header';

/** A stage being edited; `key` identifies it in the page (new stages have no `id`). */
interface StageDraft {
  key: number;
  id?: number;
  name: string;
  color: string;
  roles: string[];
}

/** Settings → Review workflows → one workflow (or `new`). */
@Component({
  selector: 'vd-review-workflow-edit',
  imports: [
    NgIcon,
    RouterLink,
    HlmAlertImports,
    HlmAlertDialogImports,
    HlmButtonImports,
    HlmCardImports,
    HlmCheckboxImports,
    HlmFieldImports,
    HlmInputImports,
    HlmNativeSelectImports,
    HlmSkeletonImports,
    HlmSpinnerImports,
    PageHeader,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <vd-page-header
        [title]="creating() ? t('settings.review.newTitle') : workflow()?.name || '…'"
        [description]="creating() ? t('settings.review.newDescription') : undefined"
      >
        <a
          eyebrow
          routerLink="/settings/review-workflows"
          class="text-primary flex items-center gap-1.5 text-xs font-medium hover:underline"
        >
          <ng-icon name="lucideArrowLeft" size="14" class="rtl:-scale-x-100" />
          {{ t('settings.review.title') }}
        </a>
        <div actions class="flex gap-2">
          @if (workflow(); as current) {
            <hlm-alert-dialog>
              <button hlmAlertDialogTrigger hlmBtn variant="outline" type="button">
                <ng-icon name="lucideTrash2" /> {{ t('common.delete') }}
              </button>
              <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
                <hlm-alert-dialog-header>
                  <h2 hlmAlertDialogTitle>
                    {{ t('settings.review.deleteTitle', { name: current.name }) }}
                  </h2>
                  <p hlmAlertDialogDescription>{{ t('settings.review.deleteHint') }}</p>
                </hlm-alert-dialog-header>
                <hlm-alert-dialog-footer>
                  <button hlmAlertDialogCancel (click)="ctx.close()">
                    {{ t('common.cancel') }}
                  </button>
                  <button
                    hlmAlertDialogAction
                    variant="destructive"
                    (click)="ctx.close(); remove(current)"
                  >
                    {{ t('common.delete') }}
                  </button>
                </hlm-alert-dialog-footer>
              </hlm-alert-dialog-content>
            </hlm-alert-dialog>
          }
          <button hlmBtn type="button" [disabled]="saving() || !!problem()" (click)="save()">
            @if (saving()) {
              <hlm-spinner class="size-4" />
            } @else {
              <ng-icon name="lucideSave" />
            }
            {{ creating() ? t('common.create') : t('common.save') }}
          </button>
        </div>
      </vd-page-header>

      @if (loadError()) {
        <div hlmAlert variant="destructive">
          <ng-icon hlmAlertIcon name="lucideCircleAlert" />
          <p hlmAlertDescription>{{ loadError() }}</p>
        </div>
      } @else if (!ready()) {
        <hlm-skeleton class="h-96 rounded-xl" />
      } @else {
        @if (error()) {
          <div hlmAlert variant="destructive" role="alert">
            <ng-icon hlmAlertIcon name="lucideCircleAlert" />
            <p hlmAlertTitle>{{ t('settings.review.saveError') }}</p>
            <p hlmAlertDescription>{{ error() }}</p>
          </div>
        }
        @if (problemText(); as text) {
          <p class="text-muted-foreground -mt-2 text-sm" role="status">{{ text }}</p>
        }

        <div class="grid items-start gap-6 lg:grid-cols-3">
          <div class="flex flex-col gap-6 lg:col-span-2">
            <section hlmCard>
              <div hlmCardHeader>
                <h2 hlmCardTitle>{{ t('settings.review.general') }}</h2>
              </div>
              <div hlmCardContent class="flex flex-col gap-4">
                <div hlmField>
                  <label hlmFieldLabel for="workflow-name">{{ t('common.name') }}</label>
                  <input
                    hlmInput
                    id="workflow-name"
                    maxlength="255"
                    [value]="name()"
                    (input)="name.set($any($event.target).value)"
                  />
                </div>
                <div hlmField>
                  <label hlmFieldLabel for="workflow-publish-stage">{{
                    t('settings.review.publishStage')
                  }}</label>
                  <hlm-native-select
                    selectId="workflow-publish-stage"
                    [value]="publishKey()"
                    (valueChange)="publishKey.set($event ?? '')"
                  >
                    <option hlmNativeSelectOption value="">
                      {{ t('settings.review.anyStage') }}
                    </option>
                    @for (stage of stages(); track stage.key) {
                      <option hlmNativeSelectOption [value]="'' + stage.key">
                        {{ stage.name || t('settings.review.unnamedStage') }}
                      </option>
                    }
                  </hlm-native-select>
                  <p hlmFieldDescription>{{ t('settings.review.publishStageHint') }}</p>
                </div>
              </div>
            </section>

            <section hlmCard aria-labelledby="workflow-stages-title">
              <div hlmCardHeader>
                <h2 hlmCardTitle id="workflow-stages-title">{{ t('settings.review.stages') }}</h2>
                <p hlmCardDescription>{{ t('settings.review.stagesHint') }}</p>
                <div hlmCardAction>
                  <button
                    hlmBtn
                    variant="outline"
                    size="sm"
                    type="button"
                    [disabled]="stages().length >= 50"
                    (click)="addStage()"
                  >
                    <ng-icon name="lucidePlus" /> {{ t('settings.review.addStage') }}
                  </button>
                </div>
              </div>
              <div hlmCardContent>
                <ol class="flex flex-col gap-3">
                  @for (
                    stage of stages();
                    track stage.key;
                    let index = $index, first = $first, last = $last
                  ) {
                    @let label = stage.name || t('settings.review.stageNumber', { n: index + 1 });
                    <li
                      class="flex flex-col gap-3 rounded-lg border p-3"
                      [attr.aria-label]="t('settings.review.stageNumber', { n: index + 1 })"
                    >
                      <div class="flex flex-wrap items-end gap-3">
                        <span
                          class="text-muted-foreground flex h-9 w-6 items-center justify-center text-sm tabular-nums"
                          aria-hidden="true"
                          >{{ index + 1 }}</span
                        >
                        <div hlmField class="min-w-40 flex-1">
                          <label hlmFieldLabel [for]="'stage-name-' + stage.key">{{
                            t('settings.review.stageName')
                          }}</label>
                          <input
                            hlmInput
                            maxlength="255"
                            [id]="'stage-name-' + stage.key"
                            [value]="stage.name"
                            (input)="patchStage(stage.key, { name: $any($event.target).value })"
                          />
                        </div>
                        <div hlmField class="w-40">
                          <label hlmFieldLabel [for]="'stage-color-' + stage.key">{{
                            t('settings.review.stageColor')
                          }}</label>
                          <div class="flex items-center gap-2">
                            <input
                              type="color"
                              class="border-input h-9 w-10 shrink-0 cursor-pointer rounded-md border bg-transparent p-1"
                              [attr.aria-label]="t('settings.review.pickColor', { name: label })"
                              [value]="isStageColor(stage.color) ? stage.color : defaultColor"
                              (input)="patchStage(stage.key, { color: $any($event.target).value })"
                            />
                            <input
                              hlmInput
                              dir="ltr"
                              class="font-mono"
                              maxlength="7"
                              spellcheck="false"
                              [id]="'stage-color-' + stage.key"
                              [attr.aria-invalid]="isStageColor(stage.color) ? null : 'true'"
                              [value]="stage.color"
                              (input)="patchStage(stage.key, { color: $any($event.target).value })"
                            />
                          </div>
                        </div>
                        <div class="flex items-center gap-1">
                          <button
                            hlmBtn
                            size="icon-sm"
                            variant="ghost"
                            type="button"
                            [id]="'stage-up-' + stage.key"
                            [disabled]="first"
                            [attr.aria-label]="t('settings.review.moveUp', { name: label })"
                            [attr.title]="t('settings.review.moveUp', { name: label })"
                            (click)="move(index, -1)"
                          >
                            <ng-icon name="lucideArrowUp" />
                          </button>
                          <button
                            hlmBtn
                            size="icon-sm"
                            variant="ghost"
                            type="button"
                            [id]="'stage-down-' + stage.key"
                            [disabled]="last"
                            [attr.aria-label]="t('settings.review.moveDown', { name: label })"
                            [attr.title]="t('settings.review.moveDown', { name: label })"
                            (click)="move(index, 1)"
                          >
                            <ng-icon name="lucideArrowDown" />
                          </button>
                          <button
                            hlmBtn
                            size="icon-sm"
                            variant="ghost"
                            type="button"
                            class="text-muted-foreground hover:text-destructive"
                            [disabled]="stages().length === 1"
                            [attr.aria-label]="t('settings.review.removeStage', { name: label })"
                            [attr.title]="t('settings.review.removeStage', { name: label })"
                            (click)="removeStage(stage.key)"
                          >
                            <ng-icon name="lucideTrash2" />
                          </button>
                        </div>
                      </div>
                      <fieldset class="flex flex-col gap-2 ps-9">
                        <legend class="mb-1 text-sm font-medium">
                          {{ t('settings.review.stageRoles') }}
                        </legend>
                        <div class="flex flex-wrap gap-x-4 gap-y-2">
                          @for (role of roles(); track role.code) {
                            <div hlmField orientation="horizontal">
                              <hlm-checkbox
                                [inputId]="'stage-' + stage.key + '-role-' + role.code"
                                [checked]="stage.roles.includes(role.code)"
                                (checkedChange)="toggleRole(stage.key, role.code, $event === true)"
                              />
                              <label
                                hlmFieldLabel
                                class="font-normal"
                                [for]="'stage-' + stage.key + '-role-' + role.code"
                                >{{ role.name }}</label
                              >
                            </div>
                          }
                        </div>
                        <p class="text-muted-foreground text-xs">
                          {{
                            stage.roles.length
                              ? t('settings.review.rolesSome', { count: stage.roles.length })
                              : t('settings.review.rolesAnyone')
                          }}
                        </p>
                      </fieldset>
                    </li>
                  }
                </ol>
                <p class="sr-only" aria-live="polite">{{ announcement() }}</p>
              </div>
            </section>
          </div>

          <section hlmCard aria-labelledby="workflow-types-title">
            <div hlmCardHeader>
              <h2 hlmCardTitle id="workflow-types-title">
                {{ t('settings.review.contentTypes') }}
              </h2>
              <p hlmCardDescription>{{ t('settings.review.contentTypesHint') }}</p>
            </div>
            <div hlmCardContent class="flex flex-col gap-2">
              @for (type of types(); track type.uid) {
                @let usedBy = inUse().get(type.uid);
                <div hlmField orientation="horizontal">
                  <hlm-checkbox
                    [inputId]="'workflow-type-' + type.uid"
                    [checked]="contentTypes().includes(type.uid)"
                    [disabled]="!!usedBy"
                    [aria-describedby]="usedBy ? 'workflow-type-used-' + type.uid : null"
                    (checkedChange)="toggleType(type.uid, $event === true)"
                  />
                  <label
                    hlmFieldLabel
                    class="flex flex-col items-start gap-0 font-normal"
                    [for]="'workflow-type-' + type.uid"
                  >
                    <span>{{ type.displayName }}</span>
                    @if (usedBy) {
                      <span
                        class="text-muted-foreground text-xs"
                        [id]="'workflow-type-used-' + type.uid"
                        >{{ t('settings.review.usedBy', { name: usedBy }) }}</span
                      >
                    }
                  </label>
                </div>
              } @empty {
                <p class="text-muted-foreground text-sm">{{ t('shell.noTypes') }}</p>
              }
            </div>
          </section>
        </div>
      }
    </div>
  `,
})
export class ReviewWorkflowEditPage {
  private readonly service = inject(ReviewWorkflows);
  private readonly schema = inject(Schema);
  private readonly router = inject(Router);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly injector = inject(Injector);
  protected readonly t = inject(I18n).t;
  protected readonly isStageColor = isStageColor;
  protected readonly defaultColor = DEFAULT_STAGE_COLOR;

  readonly id = input.required<string>();

  protected readonly creating = computed(() => this.id() === 'new');
  protected readonly workflow = signal<Workflow | null>(null);
  private readonly others = signal<Workflow[]>([]);
  protected readonly ready = signal(false);
  protected readonly name = signal('');
  protected readonly contentTypes = signal<string[]>([]);
  protected readonly stages = signal<StageDraft[]>([]);
  /** The key of the publish stage, as a string (`''`: none). */
  protected readonly publishKey = signal('');
  /** Roles that stages can be restricted to. */
  protected readonly roles = signal<StageRole[]>([]);
  protected readonly loadError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly announcement = signal('');
  private nextKey = 1;

  protected readonly types = computed(() => [
    ...this.schema.collections(),
    ...this.schema.singles(),
  ]);
  protected readonly inUse = computed(() => typesInUse(this.others(), this.workflow()?.id ?? null));

  /** Why the form cannot be saved yet (`null`: it can). */
  protected readonly problem = computed<string | null>(() => {
    if (!this.name().trim()) return 'name';
    const names = new Set<string>();
    for (const stage of this.stages()) {
      const name = stage.name.trim().toLowerCase();
      if (!name || names.has(name) || !isStageColor(stage.color)) return 'stage';
      names.add(name);
    }
    return this.stages().length ? null : 'stages';
  });

  protected readonly problemText = computed(() => {
    const problem = this.problem();
    if (problem === 'name') return this.t('settings.review.problem.name');
    if (problem === 'stage') return this.t('settings.review.problem.stage');
    return null;
  });

  constructor() {
    effect(() => {
      const id = this.id();
      untracked(() => void this.load(id));
    });
  }

  private async load(id: string): Promise<void> {
    this.ready.set(false);
    this.error.set(null);
    this.loadError.set(null);
    try {
      const [workflows, roles] = await Promise.all([this.service.list(), this.service.roles()]);
      this.roles.set(roles);
      this.others.set(workflows);
      const workflow = id === 'new' ? null : workflows.find((item) => String(item.id) === id);
      if (id !== 'new' && !workflow) {
        this.loadError.set(this.t('settings.review.notFound'));
        return;
      }
      this.reset(workflow ?? null);
      this.ready.set(true);
    } catch (error) {
      const failure = ApiFailure.from(error);
      this.loadError.set(
        failure.status === 404 ? this.t('settings.review.featureOff') : failure.message,
      );
    }
  }

  private reset(workflow: Workflow | null): void {
    this.workflow.set(workflow);
    this.name.set(workflow?.name ?? '');
    this.contentTypes.set([...(workflow?.contentTypes ?? [])]);
    const stages: StageDraft[] = workflow
      ? workflow.stages.map((stage) => ({ ...stage, roles: [...stage.roles], key: this.nextKey++ }))
      : [
          this.draft(this.t('settings.review.defaultStage.todo'), STAGE_COLORS[0]),
          this.draft(this.t('settings.review.defaultStage.inReview'), STAGE_COLORS[1]),
          this.draft(this.t('settings.review.defaultStage.ready'), STAGE_COLORS[2]),
        ];
    this.stages.set(stages);
    const publish = stages.find((stage) => stage.id === workflow?.publishStageId);
    this.publishKey.set(workflow && publish ? String(publish.key) : '');
  }

  private draft(name: string, color: string): StageDraft {
    return { key: this.nextKey++, name, color, roles: [] };
  }

  protected patchStage(key: number, changes: Partial<StageDraft>): void {
    this.stages.update((stages) =>
      stages.map((stage) => (stage.key === key ? { ...stage, ...changes } : stage)),
    );
  }

  protected addStage(): void {
    const stages = this.stages();
    const name = nextStageName(stages, (n) => this.t('settings.review.stageNumber', { n }));
    const stage = this.draft(name, STAGE_COLORS[stages.length % STAGE_COLORS.length]);
    this.stages.set([...stages, stage]);
    this.focus(`stage-name-${stage.key}`);
  }

  protected removeStage(key: number): void {
    const stages = this.stages();
    const index = stages.findIndex((stage) => stage.key === key);
    if (index < 0 || stages.length === 1) return;
    const removed = stages[index];
    this.stages.set(stages.filter((stage) => stage.key !== key));
    if (this.publishKey() === String(key)) this.publishKey.set('');
    this.announcement.set(this.t('settings.review.stageRemoved', { name: removed.name }));
    const neighbour = this.stages()[Math.min(index, this.stages().length - 1)];
    this.focus(`stage-name-${neighbour.key}`);
  }

  protected move(index: number, delta: number): void {
    const stage = this.stages()[index];
    const moved = moveItem(this.stages(), index, delta);
    this.stages.set(moved);
    const position = moved.findIndex((item) => item.key === stage.key);
    this.announcement.set(
      this.t('settings.review.stageMoved', {
        name: stage.name,
        position: position + 1,
        count: moved.length,
      }),
    );
    // Keep the focus on the moved stage; at an end, on the button that still works.
    const atEdge = delta < 0 ? position === 0 : position === moved.length - 1;
    const direction = delta < 0 ? (atEdge ? 'down' : 'up') : atEdge ? 'up' : 'down';
    this.focus(`stage-${direction}-${stage.key}`);
  }

  protected toggleRole(key: number, code: string, on: boolean): void {
    const stage = this.stages().find((item) => item.key === key);
    if (!stage) return;
    const roles = stage.roles.filter((role) => role !== code);
    this.patchStage(key, { roles: on ? [...roles, code] : roles });
  }

  protected toggleType(uid: string, on: boolean): void {
    const current = this.contentTypes().filter((item) => item !== uid);
    this.contentTypes.set(on ? [...current, uid] : current);
  }

  private focus(id: string): void {
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>(`#${CSS.escape(id)}`)?.focus(),
      { injector: this.injector },
    );
  }

  protected async save(): Promise<void> {
    if (this.problem() || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    const publish = this.stages().find((stage) => String(stage.key) === this.publishKey());
    const input = toWorkflowInput(
      this.name(),
      this.contentTypes(),
      this.stages(),
      publish?.name ?? null,
    );
    try {
      const current = this.workflow();
      if (!current) {
        const created = await this.service.create(input);
        toast.success(this.t('settings.review.created', { name: created.name }));
        await this.router.navigate(['/settings/review-workflows', created.id], {
          replaceUrl: true,
        });
      } else {
        const updated = await this.service.update(current.id, input);
        this.others.update((list) => list.map((item) => (item.id === updated.id ? updated : item)));
        this.reset(updated);
        toast.success(this.t('settings.review.saved'));
      }
    } catch (error) {
      this.error.set(ApiFailure.from(error).message);
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(workflow: Workflow): Promise<void> {
    try {
      await this.service.remove(workflow.id);
      toast.success(this.t('settings.review.deleted', { name: workflow.name }));
      await this.router.navigate(['/settings/review-workflows']);
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    }
  }
}
