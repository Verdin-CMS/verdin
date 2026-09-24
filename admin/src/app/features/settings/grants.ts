import { ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmTableImports } from '@spartan-ng/helm/table';

import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/messages/en';
import { Schema } from '../../core/schema';
import { CONTENT_ACTIONS, Grant, UPLOAD_SUBJECT } from '../../core/types';

type ContentAction = (typeof CONTENT_ACTIONS)[number];
type Coverage = 'none' | 'some' | 'all';

/** A matrix row: a content type or the media library. */
interface Row {
  subject: string;
  label: string;
  icon: string | null;
  /** The actions that apply to the subject. */
  actions: readonly ContentAction[];
}

/** Drafts and publishing do not apply to media files. */
const UPLOAD_ACTIONS: readonly ContentAction[] = ['find', 'findOne', 'create', 'update', 'delete'];

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
      <div hlmEmpty class="mb-4 rounded-xl border border-dashed py-12">
        <div hlmEmptyHeader>
          <div hlmEmptyMedia variant="icon"><ng-icon name="lucideBlocks" /></div>
          <h2 hlmEmptyTitle>{{ t('settings.grants.emptyTitle') }}</h2>
          <p hlmEmptyDescription>{{ t('settings.grants.emptyHint') }}</p>
        </div>
      </div>
    }
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
            @for (row of rows(); track row.subject) {
              <tr hlmTr [class.bg-muted/30]="!!row.icon">
                <td hlmTd class="ps-4">
                  <div class="flex items-center gap-3">
                    <hlm-checkbox
                      [aria-label]="t('settings.grants.toggleRow', { type: row.label })"
                      [checked]="rowCoverage(row) === 'all'"
                      [indeterminate]="rowCoverage(row) === 'some'"
                      [disabled]="disabled()"
                      (checkedChange)="toggleRow(row, $event)"
                    />
                    @if (row.icon) {
                      <ng-icon [name]="row.icon" size="16" class="text-muted-foreground shrink-0" />
                    }
                    <div class="flex min-w-0 flex-col">
                      <span class="font-medium">{{ row.label }}</span>
                      <span class="text-muted-foreground font-mono text-xs">{{ row.subject }}</span>
                    </div>
                  </div>
                </td>
                @for (action of actions; track action) {
                  <td hlmTd class="text-center">
                    @if (row.actions.includes(action)) {
                      <div class="flex justify-center">
                        <hlm-checkbox
                          [aria-label]="row.label + ' ' + action"
                          [checked]="has(row.subject, action)"
                          [disabled]="disabled()"
                          (checkedChange)="toggle(row.subject, action, $event)"
                        />
                      </div>
                    } @else {
                      <span
                        class="text-muted-foreground/60 text-sm"
                        [attr.title]="t('settings.grants.notApplicable')"
                        [attr.aria-label]="t('settings.grants.notApplicable')"
                        >—</span
                      >
                    }
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
  /** Content types, then the media library. */
  protected readonly rows = computed<Row[]>(() => [
    ...this.types().map((type) => ({
      subject: type.uid,
      label: type.displayName,
      icon: null,
      actions: CONTENT_ACTIONS,
    })),
    {
      subject: UPLOAD_SUBJECT,
      label: this.t('settings.grants.mediaLibrary'),
      icon: 'lucideImage',
      actions: UPLOAD_ACTIONS,
    },
  ]);

  protected has(subject: string, action: string): boolean {
    return this.grants().some((grant) => grant.subject === subject && grant.action === action);
  }

  protected toggle(subject: string, action: string, checked: boolean | 'indeterminate'): void {
    const rest = this.grants().filter(
      (grant) => !(grant.subject === subject && grant.action === action),
    );
    this.grants.set(checked === true ? [...rest, { subject, action }] : rest);
  }

  protected rowCoverage(row: Row): Coverage {
    return coverage(
      row.actions.filter((action) => this.has(row.subject, action)).length,
      row.actions.length,
    );
  }

  /** The rows where an action applies. */
  private rowsWith(action: ContentAction): Row[] {
    return this.rows().filter((row) => row.actions.includes(action));
  }

  protected columnCoverage(action: ContentAction): Coverage {
    const rows = this.rowsWith(action);
    return coverage(rows.filter((row) => this.has(row.subject, action)).length, rows.length);
  }

  /** Grants or revokes every applicable action on one subject. */
  protected toggleRow(row: Row, checked: boolean): void {
    const rest = this.grants().filter((grant) => grant.subject !== row.subject);
    this.grants.set(
      checked
        ? [...rest, ...row.actions.map((action) => ({ subject: row.subject, action }))]
        : rest,
    );
  }

  /** Grants or revokes one action on every subject where it applies. */
  protected toggleColumn(action: ContentAction, checked: boolean): void {
    const subjects = new Set(this.rowsWith(action).map((row) => row.subject));
    const rest = this.grants().filter(
      (grant) => !(grant.action === action && subjects.has(grant.subject)),
    );
    this.grants.set(
      checked ? [...rest, ...[...subjects].map((subject) => ({ subject, action }))] : rest,
    );
  }
}

function coverage(count: number, total: number): Coverage {
  if (count === 0 || total === 0) return 'none';
  return count === total ? 'all' : 'some';
}
