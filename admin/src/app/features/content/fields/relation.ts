import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { FormValueControl } from '@angular/forms/signals';
import { NgIcon } from '@ng-icons/core';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmInputImports } from '@spartan-ng/helm/input';

import { Api, toQuery } from '../../../core/api';
import { I18n } from '../../../core/i18n/i18n';
import { Schema } from '../../../core/schema';
import { Document } from '../../../core/types';
import { documentLabel } from './model';

/**
 * Picks related documents by searching the target type. The value is a documentId
 * (to-one) or a list of them (to-many), which is what the API's `set` accepts.
 */
@Component({
  selector: 'vd-relation-control',
  imports: [NgIcon, HlmInputImports, HlmBadgeImports, HlmButtonImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-2">
      @if (selected().length) {
        <ul class="flex flex-col gap-1">
          @for (id of selected(); track id; let index = $index) {
            <li
              class="bg-muted/50 flex items-center gap-2 rounded-md border py-1 ps-3 pe-1 text-sm"
            >
              <span class="truncate">{{ labels()[id] ?? id }}</span>
              <span class="ms-auto flex items-center">
                @if (many()) {
                  <button
                    hlmBtn
                    size="icon-xs"
                    variant="ghost"
                    type="button"
                    [attr.aria-label]="t('content.fields.moveUp')"
                    [disabled]="index === 0"
                    (click)="move(index, -1)"
                  >
                    <ng-icon name="lucideArrowUp" />
                  </button>
                  <button
                    hlmBtn
                    size="icon-xs"
                    variant="ghost"
                    type="button"
                    [attr.aria-label]="t('content.fields.moveDown')"
                    [disabled]="index === selected().length - 1"
                    (click)="move(index, 1)"
                  >
                    <ng-icon name="lucideArrowDown" />
                  </button>
                }
                <button
                  hlmBtn
                  size="icon-xs"
                  variant="ghost"
                  type="button"
                  [attr.aria-label]="t('content.fields.remove')"
                  [disabled]="disabled()"
                  (click)="remove(id)"
                >
                  <ng-icon name="lucideX" />
                </button>
              </span>
            </li>
          }
        </ul>
      }
      @if (many() || selected().length === 0) {
        <div class="relative">
          <ng-icon
            name="lucideSearch"
            size="16"
            class="text-muted-foreground pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2"
          />
          <input
            hlmInput
            class="ps-8"
            autocomplete="off"
            [id]="inputId()"
            [placeholder]="t('content.relation.search', { type: targetName() })"
            [value]="search()"
            [disabled]="disabled()"
            (input)="search.set($any($event.target).value)"
            (focus)="open.set(true)"
            (blur)="touch.emit(); closeSoon()"
          />
          @if (open() && searched() && !results().length) {
            <div
              class="bg-popover text-muted-foreground absolute z-10 mt-1 w-full rounded-md border px-3 py-2 text-sm shadow-md"
            >
              {{ t('content.relation.noResults') }}
            </div>
          }
          @if (open() && results().length) {
            <ul
              class="bg-popover text-popover-foreground absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border p-1 shadow-md"
            >
              @for (result of results(); track result.documentId) {
                <li>
                  <button
                    type="button"
                    class="hover:bg-accent w-full rounded-sm px-2 py-1.5 text-start text-sm"
                    (mousedown)="pick(result)"
                  >
                    {{ label(result) }}
                  </button>
                </li>
              }
            </ul>
          }
        </div>
      }
    </div>
  `,
})
export class RelationControl implements FormValueControl<string | string[] | null> {
  private readonly api = inject(Api);
  private readonly schema = inject(Schema);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  readonly value = model<string | string[] | null>(null);
  readonly disabled = input(false);
  readonly touch = output<void>();
  readonly inputId = input<string>('');
  readonly target = input.required<string>();
  readonly many = input(false);
  /** Labels for the initial value, from the populated document. */
  readonly initialLabels = input<Record<string, string>>({});

  protected readonly search = signal('');
  protected readonly open = signal(false);
  protected readonly results = signal<Document[]>([]);
  /** Whether a search has answered since the picker opened. */
  protected readonly searched = signal(false);
  private readonly picked = signal<Record<string, string>>({});

  protected readonly labels = computed(() => ({ ...this.initialLabels(), ...this.picked() }));
  protected readonly selected = computed(() => {
    const value = this.value();
    return Array.isArray(value) ? value : value ? [value] : [];
  });
  protected readonly targetName = computed(
    () => this.schema.type(this.target())?.displayName ?? this.t('content.relation.documents'),
  );
  private readonly titleField = computed(() => {
    const type = this.schema.type(this.target());
    return type ? this.schema.titleField(type) : null;
  });

  constructor() {
    effect((onCleanup) => {
      const term = this.search();
      const target = this.target();
      if (!this.open()) return;
      const timer = setTimeout(() => void this.find(target, term), 200);
      onCleanup(() => clearTimeout(timer));
    });
  }

  protected label(document: Document): string {
    return documentLabel(document, this.titleField());
  }

  private async find(target: string, term: string): Promise<void> {
    const field = this.titleField();
    const query: Record<string, unknown> = { pagination: { pageSize: 10 }, sort: 'updatedAt:desc' };
    if (term && field) query['filters'] = { [field]: { $containsi: term } };
    try {
      const response = await this.api.list<Document>(`/content/${target}`, toQuery(query));
      this.results.set(
        response.data.filter((document) => !this.selected().includes(document.documentId)),
      );
    } catch {
      this.results.set([]);
    }
    this.searched.set(true);
  }

  protected pick(document: Document): void {
    this.picked.update((labels) => ({ ...labels, [document.documentId]: this.label(document) }));
    this.value.set(this.many() ? [...this.selected(), document.documentId] : document.documentId);
    this.search.set('');
    this.open.set(false);
    this.touch.emit();
  }

  protected remove(id: string): void {
    this.value.set(this.many() ? this.selected().filter((selected) => selected !== id) : null);
  }

  protected move(index: number, delta: number): void {
    const list = [...this.selected()];
    const [item] = list.splice(index, 1);
    list.splice(index + delta, 0, item);
    this.value.set(list);
  }

  protected closeSoon(): void {
    setTimeout(() => {
      this.open.set(false);
      this.searched.set(false);
    }, 150);
  }
}
