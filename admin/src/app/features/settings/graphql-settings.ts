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
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmTableImports } from '@spartan-ng/helm/table';

import { ApiFailure } from '../../core/api';
import {
  GRAPHQL_GROUPS,
  GRAPHQL_OPERATIONS,
  GraphqlOperation,
  disabledSetting,
  readDisabled,
  toggleOperations,
} from '../../core/feature-settings';
import { Feature, Features } from '../../core/features';
import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/keys';
import { Schema } from '../../core/schema';

type Coverage = 'none' | 'some' | 'all';

const OPERATION_LABELS: Record<GraphqlOperation, MessageKey> = {
  find: 'features.graphql.op.find',
  findOne: 'features.graphql.op.findOne',
  create: 'features.graphql.op.create',
  update: 'features.graphql.op.update',
  delete: 'features.graphql.op.delete',
};

/**
 * Settings → Features → GraphQL → Disabled operations: per content type, the queries and
 * mutations left out of the schema (Strapi's shadow CRUD switches), saved as
 * `settings.disabled`.
 */
@Component({
  selector: 'vd-graphql-settings',
  imports: [
    NgIcon,
    HlmAlertImports,
    HlmButtonImports,
    HlmCheckboxImports,
    HlmDialogImports,
    HlmSpinnerImports,
    HlmTableImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog [state]="open() ? 'open' : 'closed'" (closed)="closed.emit()">
      <hlm-dialog-content
        *hlmDialogPortal="let ctx"
        class="max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-4xl"
        [closeLabel]="t('common.close')"
      >
        <hlm-dialog-header>
          <h2 hlmDialogTitle>{{ t('features.graphql.disabledTitle') }}</h2>
          <p hlmDialogDescription>{{ t('features.graphql.disabledDescription') }}</p>
        </hlm-dialog-header>
        <div class="-mx-6 min-h-0 overflow-auto px-6">
          @if (rows().length) {
            <table hlmTable class="text-sm">
              <thead hlmTHead>
                <tr hlmTr>
                  <th hlmTh scope="col">{{ t('features.graphql.contentType') }}</th>
                  <th hlmTh scope="col" class="text-center">{{ t('features.graphql.all') }}</th>
                  <th hlmTh scope="col" class="text-center">
                    {{ t('features.graphql.queries') }}
                  </th>
                  @for (op of queries; track op) {
                    <th hlmTh scope="col" class="text-center font-mono text-xs">{{ op }}</th>
                  }
                  <th hlmTh scope="col" class="text-center">
                    {{ t('features.graphql.mutations') }}
                  </th>
                  @for (op of mutations; track op) {
                    <th hlmTh scope="col" class="text-center font-mono text-xs">{{ op }}</th>
                  }
                </tr>
              </thead>
              <tbody hlmTBody>
                @for (row of rows(); track row.uid) {
                  <tr hlmTr>
                    <th scope="row" class="p-2 text-start align-middle font-normal">
                      <span class="flex flex-col">
                        <span class="font-medium">{{ row.name }}</span>
                        <span class="text-muted-foreground font-mono text-xs">{{ row.uid }}</span>
                      </span>
                    </th>
                    <td hlmTd class="text-center">
                      <hlm-checkbox
                        [checked]="coverage(row.uid, all) === 'all'"
                        [indeterminate]="coverage(row.uid, all) === 'some'"
                        [aria-label]="t('features.graphql.disableAll', { type: row.name })"
                        (checkedChange)="toggle(row.uid, all, $event === true)"
                      />
                    </td>
                    <td hlmTd class="text-center">
                      <hlm-checkbox
                        [checked]="coverage(row.uid, queries) === 'all'"
                        [indeterminate]="coverage(row.uid, queries) === 'some'"
                        [aria-label]="t('features.graphql.disableQueries', { type: row.name })"
                        (checkedChange)="toggle(row.uid, queries, $event === true)"
                      />
                    </td>
                    @for (op of queries; track op) {
                      <td hlmTd class="text-center">
                        <hlm-checkbox
                          [checked]="isOff(row.uid, op)"
                          [aria-label]="
                            t('features.graphql.disableOperation', {
                              operation: t(labels[op]),
                              type: row.name,
                            })
                          "
                          (checkedChange)="toggle(row.uid, [op], $event === true)"
                        />
                      </td>
                    }
                    <td hlmTd class="text-center">
                      <hlm-checkbox
                        [checked]="coverage(row.uid, mutations) === 'all'"
                        [indeterminate]="coverage(row.uid, mutations) === 'some'"
                        [aria-label]="t('features.graphql.disableMutations', { type: row.name })"
                        (checkedChange)="toggle(row.uid, mutations, $event === true)"
                      />
                    </td>
                    @for (op of mutations; track op) {
                      <td hlmTd class="text-center">
                        <hlm-checkbox
                          [checked]="isOff(row.uid, op)"
                          [aria-label]="
                            t('features.graphql.disableOperation', {
                              operation: t(labels[op]),
                              type: row.name,
                            })
                          "
                          (checkedChange)="toggle(row.uid, [op], $event === true)"
                        />
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          } @else {
            <p class="text-muted-foreground text-sm">{{ t('features.preview.noTypes') }}</p>
          }
          @if (error()) {
            <div hlmAlert variant="destructive" role="alert" class="mt-4">
              <ng-icon hlmAlertIcon name="lucideCircleAlert" />
              <p hlmAlertTitle>{{ t('features.settingsRejected') }}</p>
              <p hlmAlertDescription>{{ error() }}</p>
            </div>
          }
        </div>
        <hlm-dialog-footer>
          <button hlmBtn type="button" variant="outline" (click)="closed.emit()">
            {{ t('common.cancel') }}
          </button>
          <button hlmBtn type="button" [disabled]="saving()" (click)="save()">
            @if (saving()) {
              <hlm-spinner class="size-4" />
            }
            {{ t('common.save') }}
          </button>
        </hlm-dialog-footer>
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class GraphqlSettingsDialog {
  private readonly features = inject(Features);
  private readonly schema = inject(Schema);
  protected readonly t = inject(I18n).t;

  readonly open = input(false);
  readonly feature = input.required<Feature>();
  readonly closed = output<void>();

  protected readonly all = GRAPHQL_OPERATIONS;
  protected readonly queries = GRAPHQL_GROUPS.queries;
  protected readonly mutations = GRAPHQL_GROUPS.mutations;
  protected readonly labels = OPERATION_LABELS;
  /** Disabled operations per content type uid. */
  protected readonly state = signal<Record<string, Set<GraphqlOperation>>>({});
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly rows = computed(() => {
    const rows = [...this.schema.contentTypes()]
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .map((type) => ({ uid: type.uid, name: type.displayName }));
    // Types that no longer exist keep their switches (the server keeps them).
    for (const uid of Object.keys(this.state()))
      if (!rows.some((row) => row.uid === uid)) rows.push({ uid, name: uid });
    return rows;
  });

  constructor() {
    effect(() => {
      if (!this.open()) return;
      const feature = this.feature();
      untracked(() => {
        this.state.set(readDisabled(feature.settings));
        this.error.set(null);
      });
    });
  }

  protected isOff(uid: string, op: GraphqlOperation): boolean {
    return this.state()[uid]?.has(op) ?? false;
  }

  protected coverage(uid: string, ops: readonly GraphqlOperation[]): Coverage {
    const count = ops.filter((op) => this.isOff(uid, op)).length;
    return count === 0 ? 'none' : count === ops.length ? 'all' : 'some';
  }

  protected toggle(uid: string, ops: readonly GraphqlOperation[], disabled: boolean): void {
    this.state.update((state) => ({
      ...state,
      [uid]: toggleOperations(state[uid], ops, disabled),
    }));
  }

  protected async save(): Promise<void> {
    if (this.saving()) return;
    const feature = this.feature();
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.features.update(feature.id, feature.enabled, {
        ...(feature.settings ?? {}),
        disabled: disabledSetting(this.state()),
      });
      toast.success(this.t('features.settingsSaved', { name: this.t('features.graphql.name') }));
      this.closed.emit();
    } catch (error) {
      this.error.set(ApiFailure.from(error).message);
    } finally {
      this.saving.set(false);
    }
  }
}
