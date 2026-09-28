import {
  CdkDrag,
  CdkDragDrop,
  CdkDragHandle,
  CdkDropList,
  moveItemInArray,
} from '@angular/cdk/drag-drop';
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
import { Auth } from '../../../core/auth';
import { isLocalized } from '../../../core/content-locales';
import { I18n } from '../../../core/i18n/i18n';
import { Schema } from '../../../core/schema';
import { Document } from '../../../core/types';
import { documentLabel } from './model';
import { RelatedEditor } from './related-editor';

/**
 * Picks related documents by searching the target type. The value is a documentId
 * (to-one) or a list of them (to-many), which is what the API's `set` accepts. To-many
 * relations are reordered by dragging (or with the move buttons), and each related entry
 * can be edited in the editor's side sheet.
 */
@Component({
  selector: 'vd-relation-control',
  imports: [
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    NgIcon,
    HlmInputImports,
    HlmBadgeImports,
    HlmButtonImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-2">
      @if (selected().length) {
        <ul
          class="flex flex-col gap-1"
          cdkDropList
          cdkDropListLockAxis="y"
          [cdkDropListDisabled]="!many() || disabled() || selected().length < 2"
          [attr.aria-label]="t('content.relation.selected', { type: targetName() })"
          (cdkDropListDropped)="drop($event)"
        >
          @for (id of selected(); track id; let index = $index) {
            @let label = labels()[id] ?? id;
            <li
              cdkDrag
              [cdkDragData]="id"
              class="bg-muted/50 flex items-center gap-2 rounded-md border py-1 ps-1 pe-1 text-sm"
              [class.ps-3]="!many()"
            >
              @if (many()) {
                <span
                  cdkDragHandle
                  class="text-muted-foreground hover:text-foreground flex cursor-grab items-center rounded-sm p-0.5 active:cursor-grabbing"
                  [attr.aria-hidden]="true"
                  [title]="t('content.relation.dragHint')"
                >
                  <ng-icon name="lucideGripVertical" size="14" />
                </span>
              }
              <span class="truncate" data-relation-label>{{ label }}</span>
              <span class="ms-auto flex items-center">
                @if (editor && canOpen()) {
                  <button
                    hlmBtn
                    size="icon-xs"
                    variant="ghost"
                    type="button"
                    [attr.aria-label]="t('content.relation.edit', { title: label })"
                    [title]="t('content.relation.edit', { title: label })"
                    (click)="edit(id)"
                  >
                    <ng-icon name="lucidePencil" />
                  </button>
                }
                @if (many()) {
                  <button
                    hlmBtn
                    size="icon-xs"
                    variant="ghost"
                    type="button"
                    [attr.aria-label]="t('content.relation.moveUp', { title: label })"
                    [disabled]="index === 0 || disabled()"
                    (click)="move(index, -1)"
                  >
                    <ng-icon name="lucideArrowUp" />
                  </button>
                  <button
                    hlmBtn
                    size="icon-xs"
                    variant="ghost"
                    type="button"
                    [attr.aria-label]="t('content.relation.moveDown', { title: label })"
                    [disabled]="index === selected().length - 1 || disabled()"
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
                  [attr.aria-label]="t('content.relation.remove', { title: label })"
                  [disabled]="disabled()"
                  (click)="remove(id)"
                >
                  <ng-icon name="lucideX" />
                </button>
              </span>
            </li>
          }
        </ul>
        <p class="sr-only" aria-live="polite">{{ announcement() }}</p>
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
  private readonly auth = inject(Auth);
  private readonly schema = inject(Schema);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  /** The editor's side sheet (absent inside the sheet itself). */
  protected readonly editor = inject(RelatedEditor, { optional: true });

  readonly value = model<string | string[] | null>(null);
  readonly disabled = input(false);
  readonly touch = output<void>();
  readonly inputId = input<string>('');
  readonly target = input.required<string>();
  readonly many = input(false);
  /** Labels for the initial value, from the populated document. */
  readonly initialLabels = input<Record<string, string>>({});
  /** The edited document's locale: related entries of a localized type open in it. */
  readonly locale = input<string | null>(null);

  protected readonly search = signal('');
  protected readonly open = signal(false);
  protected readonly results = signal<Document[]>([]);
  /** Whether a search has answered since the picker opened. */
  protected readonly searched = signal(false);
  private readonly picked = signal<Record<string, string>>({});
  /** Read by screen readers after a reorder. */
  protected readonly announcement = signal('');

  protected readonly labels = computed(() => ({
    ...this.initialLabels(),
    ...this.picked(),
    ...(this.editor?.labels() ?? {}),
  }));
  protected readonly selected = computed(() => {
    const value = this.value();
    return Array.isArray(value) ? value : value ? [value] : [];
  });
  protected readonly targetName = computed(
    () => this.schema.type(this.target())?.displayName ?? this.t('content.relation.documents'),
  );
  protected readonly canOpen = computed(() => this.auth.canContent('content.read', this.target()));
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
    this.reorder(index, index + delta);
  }

  protected drop(event: CdkDragDrop<unknown>): void {
    this.reorder(event.previousIndex, event.currentIndex);
  }

  private reorder(from: number, to: number): void {
    const list = [...this.selected()];
    if (from === to || to < 0 || to >= list.length) return;
    moveItemInArray(list, from, to);
    this.value.set(list);
    this.touch.emit();
    const id = list[to];
    this.announcement.set(
      this.t('content.relation.moved', {
        title: this.labels()[id] ?? id,
        position: to + 1,
        count: list.length,
      }),
    );
  }

  /** Opens the related entry in the editor's side sheet. */
  protected edit(id: string): void {
    const type = this.schema.type(this.target());
    this.editor?.open({
      uid: this.target(),
      documentId: id,
      locale: isLocalized(type) ? this.locale() : null,
    });
  }

  protected closeSoon(): void {
    setTimeout(() => {
      this.open.set(false);
      this.searched.set(false);
    }, 150);
  }
}
