import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';

import { I18n } from '../../core/i18n/i18n';
import { RISK_LABELS } from './builder-model';
import { BuilderStore } from './builder-store';

/**
 * The migration plan under review: the schema's errors, or its steps with their risk and SQL,
 * the renames to accept, and the button that applies it.
 */
@Component({
  selector: 'vd-plan-dialog',
  imports: [
    NgIcon,
    HlmAlertImports,
    HlmBadgeImports,
    HlmButtonImports,
    HlmCheckboxImports,
    HlmDialogImports,
    HlmFieldImports,
    HlmSpinnerImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog [state]="store.planResult() ? 'open' : 'closed'" (closed)="store.closePlan()">
      <hlm-dialog-content
        *hlmDialogPortal="let ctx"
        class="max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-3xl"
        [closeLabel]="t('common.close')"
      >
        @if (store.planResult(); as result) {
          <hlm-dialog-header>
            <h2 hlmDialogTitle>
              {{ result.valid ? t('builder.plan.title') : t('builder.plan.invalidTitle') }}
            </h2>
            <p hlmDialogDescription>
              @if (result.valid) {
                {{
                  result.steps?.length ? t('builder.plan.description') : t('builder.plan.noChanges')
                }}
              } @else {
                {{ t('builder.plan.fixFirst') }}
              }
            </p>
          </hlm-dialog-header>
          <div class="-mx-6 flex flex-col gap-4 overflow-y-auto px-6">
            @for (error of result.errors ?? []; track $index) {
              <div hlmAlert variant="destructive">
                <ng-icon name="lucideCircleAlert" />
                <p hlmAlertDescription>
                  <code class="font-mono">{{ error.path }}</code> {{ error.message }}
                </p>
              </div>
            }
            @if (result.hints?.length) {
              <fieldset hlmFieldSet class="rounded-lg border p-3">
                <legend hlmFieldLegend variant="label" class="px-1">
                  {{ t('builder.plan.renames') }}
                </legend>
                <div hlmFieldGroup class="gap-3">
                  @for (hint of result.hints ?? []; track hint) {
                    <div hlmField orientation="horizontal">
                      <hlm-checkbox
                        [inputId]="'hint-' + $index"
                        [checked]="store.acceptedHints().includes(hint)"
                        (checkedChange)="store.toggleHint(hint, $event === true)"
                      />
                      <label hlmFieldLabel [for]="'hint-' + $index"
                        >{{ t('builder.plan.rename') }}
                        <code class="bg-muted rounded px-1 py-0.5 font-mono text-xs">{{
                          hint.replace('--rename-column ', '').replace('--rename-table ', '')
                        }}</code></label
                      >
                    </div>
                  }
                </div>
              </fieldset>
            }
            @if (result.valid && result.requires === 'destructive') {
              <div hlmAlert variant="destructive">
                <ng-icon name="lucideCircleAlert" />
                <p hlmAlertTitle>{{ t('builder.plan.destructiveWarning') }}</p>
              </div>
            }
            @if (result.steps?.length) {
              <div class="flex flex-col gap-2">
                <h3 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  {{ t('builder.plan.steps', { count: result.steps!.length }) }}
                </h3>
                <ol class="flex flex-col gap-2">
                  @for (step of result.steps ?? []; track $index) {
                    <li class="bg-card rounded-lg border">
                      <div class="flex items-start gap-3 p-3">
                        <span
                          class="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums"
                          >{{ $index + 1 }}</span
                        >
                        <span class="min-w-0 flex-1 pt-0.5 text-sm">{{ step.description }}</span>
                        <span
                          hlmBadge
                          class="shrink-0"
                          [variant]="
                            step.risk === 'destructive'
                              ? 'destructive'
                              : step.risk === 'risky'
                                ? 'outline'
                                : 'secondary'
                          "
                        >
                          @if (step.risk === 'risky') {
                            <span class="size-1.5 rounded-full bg-amber-500"></span>
                          }
                          {{ t(riskLabels[step.risk]) }}
                        </span>
                      </div>
                      @if (step.statements.length) {
                        <details class="group border-t">
                          <summary
                            class="text-muted-foreground hover:text-foreground flex cursor-pointer list-none items-center gap-1 px-3 py-2 text-xs font-medium select-none"
                          >
                            <ng-icon
                              name="lucideChevronRight"
                              size="14"
                              class="transition-transform group-open:rotate-90 rtl:-scale-x-100 rtl:group-open:-rotate-90"
                            />
                            {{ t('builder.plan.sql') }}
                          </summary>
                          <pre
                            dir="ltr"
                            class="bg-muted mx-3 mb-3 max-h-64 overflow-auto rounded-md p-3 font-mono text-xs leading-relaxed"
                            >{{ sql(step.statements) }}</pre>
                        </details>
                      }
                    </li>
                  }
                </ol>
              </div>
            }
          </div>
          <hlm-dialog-footer>
            <button hlmBtn variant="outline" (click)="store.closePlan()">
              {{ t('common.cancel') }}
            </button>
            @if (result.valid) {
              @if (store.acceptedHints().length) {
                <button hlmBtn variant="secondary" (click)="store.plan()">
                  {{ t('builder.plan.replan') }}
                </button>
              }
              <button
                hlmBtn
                [variant]="result.requires === 'destructive' ? 'destructive' : 'default'"
                [disabled]="store.busy()"
                (click)="store.apply(result)"
              >
                @if (store.busy()) {
                  <hlm-spinner />
                }
                {{ t('builder.plan.apply') }}
              </button>
            }
          </hlm-dialog-footer>
        }
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class PlanDialog {
  protected readonly store = inject(BuilderStore);
  protected readonly t = inject(I18n).t;
  protected readonly riskLabels = RISK_LABELS;

  /** A step's statements, one per line. */
  protected sql(statements: string[]): string {
    return statements.join(';\n');
  }
}
