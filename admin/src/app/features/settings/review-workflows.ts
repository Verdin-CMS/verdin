import { ChangeDetectionStrategy, Component, computed, inject, resource } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmTableImports } from '@spartan-ng/helm/table';

import { ApiFailure } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { ReviewWorkflows, Workflow, stageOf } from '../../core/review';
import { Schema } from '../../core/schema';
import { PageHeader } from '../../shared/components/page-header';
import { StageBadge } from '../../shared/components/stage-badge';

/** Settings → Review workflows (`workflows.manage`): the workflows and their stages. */
@Component({
  selector: 'vd-review-workflows',
  imports: [
    NgIcon,
    RouterLink,
    StageBadge,
    HlmAlertImports,
    HlmAlertDialogImports,
    HlmBadgeImports,
    HlmButtonImports,
    HlmEmptyImports,
    HlmSkeletonImports,
    HlmTableImports,
    PageHeader,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <vd-page-header
        [title]="t('settings.review.title')"
        [description]="t('settings.review.description')"
      >
        <span eyebrow class="text-primary flex items-center gap-1.5 text-xs font-medium">
          <ng-icon name="lucideListChecks" size="14" /> {{ t('shell.settings') }}
        </span>
        @if (workflows.hasValue() && workflows.value().length) {
          <div actions>
            <a hlmBtn routerLink="/settings/review-workflows/new">
              <ng-icon name="lucidePlus" /> {{ t('settings.review.create') }}
            </a>
          </div>
        }
      </vd-page-header>

      @if (error(); as message) {
        <div hlmAlert variant="destructive">
          <ng-icon hlmAlertIcon name="lucideCircleAlert" />
          <p hlmAlertTitle>{{ t('settings.review.loadError') }}</p>
          <p hlmAlertDescription>{{ message }}</p>
        </div>
      } @else if (!workflows.hasValue()) {
        <hlm-skeleton class="h-48 rounded-xl" />
      } @else if (workflows.value().length === 0) {
        <div hlmEmpty class="rounded-xl border border-dashed py-16">
          <div hlmEmptyHeader>
            <div hlmEmptyMedia variant="icon"><ng-icon name="lucideListChecks" /></div>
            <h2 hlmEmptyTitle>{{ t('settings.review.emptyTitle') }}</h2>
            <p hlmEmptyDescription>{{ t('settings.review.emptyHint') }}</p>
          </div>
          <div hlmEmptyContent>
            <a hlmBtn variant="outline" routerLink="/settings/review-workflows/new">
              <ng-icon name="lucidePlus" /> {{ t('settings.review.create') }}
            </a>
          </div>
        </div>
      } @else {
        <div class="bg-card overflow-hidden rounded-xl border">
          <div hlmTableContainer>
            <table hlmTable>
              <thead hlmTHead class="bg-muted/50">
                <tr hlmTr class="hover:bg-transparent">
                  <th hlmTh class="ps-4">{{ t('common.name') }}</th>
                  <th hlmTh>{{ t('settings.review.contentTypes') }}</th>
                  <th hlmTh>{{ t('settings.review.stages') }}</th>
                  <th hlmTh>{{ t('settings.review.publishStage') }}</th>
                  <th hlmTh class="pe-4">
                    <span class="sr-only">{{ t('common.actions') }}</span>
                  </th>
                </tr>
              </thead>
              <tbody hlmTBody>
                @for (workflow of workflows.value(); track workflow.id) {
                  <tr hlmTr>
                    <td hlmTd class="ps-4">
                      <a
                        class="font-medium hover:underline"
                        [routerLink]="['/settings/review-workflows', workflow.id]"
                        >{{ workflow.name }}</a
                      >
                    </td>
                    <td hlmTd>
                      <div class="flex max-w-xs flex-wrap gap-1">
                        @for (uid of workflow.contentTypes; track uid) {
                          <span hlmBadge variant="secondary" class="font-normal">{{
                            typeName(uid)
                          }}</span>
                        } @empty {
                          <span class="text-muted-foreground">{{
                            t('settings.review.noTypes')
                          }}</span>
                        }
                      </div>
                    </td>
                    <td hlmTd>
                      <ol
                        class="flex max-w-md flex-wrap gap-1"
                        [attr.aria-label]="t('settings.review.stagesOf', { name: workflow.name })"
                      >
                        @for (stage of workflow.stages; track stage.id) {
                          <li><vd-stage-badge [name]="stage.name" [color]="stage.color" /></li>
                        }
                      </ol>
                    </td>
                    <td hlmTd>
                      @if (stageOf(workflow, workflow.publishStageId); as stage) {
                        <vd-stage-badge [name]="stage.name" [color]="stage.color" />
                      } @else {
                        <span class="text-muted-foreground">{{
                          t('settings.review.anyStage')
                        }}</span>
                      }
                    </td>
                    <td hlmTd class="pe-4">
                      <div class="flex justify-end gap-1">
                        <a
                          hlmBtn
                          size="icon-sm"
                          variant="ghost"
                          class="text-muted-foreground"
                          [routerLink]="['/settings/review-workflows', workflow.id]"
                          [attr.aria-label]="
                            t('settings.review.editLabel', { name: workflow.name })
                          "
                          [attr.title]="t('common.edit')"
                        >
                          <ng-icon name="lucidePencil" />
                        </a>
                        <hlm-alert-dialog>
                          <button
                            hlmAlertDialogTrigger
                            hlmBtn
                            size="icon-sm"
                            variant="ghost"
                            class="text-muted-foreground hover:text-destructive"
                            [attr.aria-label]="
                              t('settings.review.deleteLabel', { name: workflow.name })
                            "
                            [attr.title]="t('common.delete')"
                          >
                            <ng-icon name="lucideTrash2" />
                          </button>
                          <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
                            <hlm-alert-dialog-header>
                              <h2 hlmAlertDialogTitle>
                                {{ t('settings.review.deleteTitle', { name: workflow.name }) }}
                              </h2>
                              <p hlmAlertDialogDescription>
                                {{ t('settings.review.deleteHint') }}
                              </p>
                            </hlm-alert-dialog-header>
                            <hlm-alert-dialog-footer>
                              <button hlmAlertDialogCancel (click)="ctx.close()">
                                {{ t('common.cancel') }}
                              </button>
                              <button
                                hlmAlertDialogAction
                                variant="destructive"
                                (click)="ctx.close(); remove(workflow)"
                              >
                                {{ t('common.delete') }}
                              </button>
                            </hlm-alert-dialog-footer>
                          </hlm-alert-dialog-content>
                        </hlm-alert-dialog>
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }
    </div>
  `,
})
export class ReviewWorkflowsPage {
  private readonly service = inject(ReviewWorkflows);
  private readonly schema = inject(Schema);
  protected readonly t = inject(I18n).t;
  protected readonly stageOf = stageOf;

  protected readonly workflows = resource({ loader: () => this.service.list() });
  /** The load failure's message; a 404 means the feature is off. */
  protected readonly error = computed(() => {
    const error = this.workflows.error();
    if (!error) return null;
    const failure = ApiFailure.from(error);
    return failure.status === 404 ? this.t('settings.review.featureOff') : failure.message;
  });

  protected typeName(uid: string): string {
    return this.schema.type(uid)?.displayName ?? uid;
  }

  protected async remove(workflow: Workflow): Promise<void> {
    try {
      await this.service.remove(workflow.id);
      if (this.workflows.hasValue()) {
        this.workflows.update((list) => (list ?? []).filter((item) => item.id !== workflow.id));
      }
      toast.success(this.t('settings.review.deleted', { name: workflow.name }));
    } catch (error) {
      toast.error(ApiFailure.from(error).message);
    }
  }
}
