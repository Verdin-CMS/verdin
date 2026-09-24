import { ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmTableImports } from '@spartan-ng/helm/table';

import { Schema } from '../../core/schema';
import { CONTENT_ACTIONS, Grant } from '../../core/types';

/** Content types × content API actions, as a checkbox matrix. */
@Component({
  selector: 'vd-grants-matrix',
  imports: [HlmTableImports, HlmCheckboxImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div hlmTableContainer class="rounded-md border">
      <table hlmTable>
        <thead hlmTHead>
          <tr hlmTr>
            <th hlmTh>Content type</th>
            @for (action of actions; track action) {
              <th hlmTh class="text-center">{{ action }}</th>
            }
          </tr>
        </thead>
        <tbody hlmTBody>
          @for (type of types(); track type.uid) {
            <tr hlmTr>
              <td hlmTd>
                {{ type.displayName }}
                <span class="text-muted-foreground text-xs">{{ type.uid }}</span>
              </td>
              @for (action of actions; track action) {
                <td hlmTd class="text-center">
                  <hlm-checkbox
                    [aria-label]="type.displayName + ' ' + action"
                    [checked]="has(type.uid, action)"
                    [disabled]="disabled()"
                    (checkedChange)="toggle(type.uid, action, $event)"
                  />
                </td>
              }
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class GrantsMatrix {
  private readonly schema = inject(Schema);
  readonly grants = model<Grant[]>([]);
  readonly disabled = input(false);
  protected readonly actions = CONTENT_ACTIONS;
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
}
