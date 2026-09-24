import { ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmTableImports } from '@spartan-ng/helm/table';

import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/messages/en';
import { Schema } from '../../core/schema';
import { CONTENT_ACTIONS, Grant } from '../../core/types';

type ContentAction = (typeof CONTENT_ACTIONS)[number];
type Coverage = 'none' | 'some' | 'all';

const ACTION_LABELS: Record<ContentAction, MessageKey> = {
  find: 'settings.grants.action.find',
  findOne: 'settings.grants.action.findOne',
  create: 'settings.grants.action.create',
  update: 'settings.grants.action.update',
  delete: 'settings.grants.action.delete',
  publish: 'settings.grants.action.publish',
  readDrafts: 'settings.grants.action.readDrafts',
};

/** Content types × content API actions, as a checkbox matrix. */
@Component({
  selector: 'vd-grants-matrix',
  imports: [NgIcon, HlmTableImports, HlmCheckboxImports, HlmEmptyImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (types().length === 0) {
      <div hlmEmpty class="rounded-xl border border-dashed py-12">
        <div hlmEmptyHeader>
          <div hlmEmptyMedia variant="icon"><ng-icon name="lucideBlocks" /></div>
          <h2 hlmEmptyTitle>{{ t('settings.grants.emptyTitle') }}</h2>
          <p hlmEmptyDescription>{{ t('settings.grants.emptyHint') }}</p>
        </div>
      </div>
    } @else {
      <div class="bg-card overflow-hidden rounded-xl border">
        <div hlmTableContainer class="max-h-[65vh] overflow-y-auto">
          <table hlmTable>
            <thead hlmTHead>
              <tr hlmTr class="hover:bg-transparent">
                <th hlmTh class="bg-muted sticky top-0 z-10 ps-4">
                  {{ t('settings.grants.contentType') }}
                </th>
                @for (action of actions; track action) {
                  <th hlmTh class="bg-muted sticky top-0 z-10 h-auto py-2 text-center">
                    <div class="flex flex-col items-center gap-1.5">
                      <span class="flex flex-col items-center leading-tight">
                        <span>{{ t(labels[action]) }}</span>
                        <span class="text-muted-foreground font-mono text-[10px] font-normal">{{
                          action
                        }}</span>
                      </span>
                      <hlm-checkbox
                        [aria-label]="
                          t('settings.grants.toggleColumn', { action: t(labels[action]) })
                        "
                        [checked]="columnCoverage(action) === 'all'"
                        [indeterminate]="columnCoverage(action) === 'some'"
                        [disabled]="disabled()"
                        (checkedChange)="toggleColumn(action, $event)"
                      />
                    </div>
                  </th>
                }
              </tr>
            </thead>
            <tbody hlmTBody>
              @for (type of types(); track type.uid) {
                <tr hlmTr>
                  <td hlmTd class="ps-4">
                    <div class="flex items-center gap-3">
                      <hlm-checkbox
                        [aria-label]="t('settings.grants.toggleRow', { type: type.displayName })"
                        [checked]="rowCoverage(type.uid) === 'all'"
                        [indeterminate]="rowCoverage(type.uid) === 'some'"
                        [disabled]="disabled()"
                        (checkedChange)="toggleRow(type.uid, $event)"
                      />
                      <div class="flex min-w-0 flex-col">
                        <span class="font-medium">{{ type.displayName }}</span>
                        <span class="text-muted-foreground font-mono text-xs">{{ type.uid }}</span>
                      </div>
                    </div>
                  </td>
                  @for (action of actions; track action) {
                    <td hlmTd class="text-center">
                      <div class="flex justify-center">
                        <hlm-checkbox
                          [aria-label]="type.displayName + ' ' + action"
                          [checked]="has(type.uid, action)"
                          [disabled]="disabled()"
                          (checkedChange)="toggle(type.uid, action, $event)"
                        />
                      </div>
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
        <div class="text-muted-foreground bg-muted/30 border-t px-4 py-2 text-xs">
          {{ t('settings.grants.selected', { count: grants().length }) }}
        </div>
      </div>
    }
  `,
})
export class GrantsMatrix {
  private readonly schema = inject(Schema);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  readonly grants = model<Grant[]>([]);
  readonly disabled = input(false);
  protected readonly actions = CONTENT_ACTIONS;
  protected readonly labels = ACTION_LABELS;
  protected readonly types = computed(() =>
    [...this.schema.contentTypes()].sort((a, b) => a.displayName.localeCompare(b.displayName)),
  );

  protected has(subject: string, action: string): boolean {
    return this.grants().some((grant) => grant.subject === subject && grant.action === action);
  }

  protected toggle(subject: string, action: string, checked: boolean | 'indeterminate'): void {
    const rest = this.grants().filter(
      (grant) => !(grant.subject === subject && grant.action === action),
    );
    this.grants.set(checked === true ? [...rest, { subject, action }] : rest);
  }

  protected rowCoverage(subject: string): Coverage {
    return coverage(
      this.actions.filter((action) => this.has(subject, action)).length,
      this.actions.length,
    );
  }

  protected columnCoverage(action: string): Coverage {
    const types = this.types();
    return coverage(types.filter((type) => this.has(type.uid, action)).length, types.length);
  }

  /** Grants or revokes every action on one content type. */
  protected toggleRow(subject: string, checked: boolean): void {
    const rest = this.grants().filter((grant) => grant.subject !== subject);
    this.grants.set(
      checked ? [...rest, ...this.actions.map((action) => ({ subject, action }))] : rest,
    );
  }

  /** Grants or revokes one action on every content type. */
  protected toggleColumn(action: string, checked: boolean): void {
    const uids = new Set(this.types().map((type) => type.uid));
    const rest = this.grants().filter(
      (grant) => !(grant.action === action && uids.has(grant.subject)),
    );
    this.grants.set(
      checked ? [...rest, ...[...uids].map((subject) => ({ subject, action }))] : rest,
    );
  }
}

function coverage(count: number, total: number): Coverage {
  if (count === 0 || total === 0) return 'none';
  return count === total ? 'all' : 'some';
}
