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

import { Auth } from '../../../core/auth';
import { isLocalized } from '../../../core/content-locales';
import { I18n } from '../../../core/i18n/i18n';
import { Schema } from '../../../core/schema';
import { EntryPicker, PickedEntry } from './entry-picker';
import { RelatedEditor } from './related-editor';

/**
 * Related documents of one target type, added with the entry picker. The value is a
 * documentId (to-one) or a list of them (to-many), which is what the API's `set` accepts.
 * To-many relations are reordered by dragging (or with the move buttons), and each related
 * entry can be edited in the editor's side sheet.
 */
@Component({
  selector: 'vd-relation-control',
  imports: [
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    NgIcon,
    HlmBadgeImports,
    HlmButtonImports,
    EntryPicker,
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
        <div>
          <button
            hlmBtn
            variant="outline"
            size="sm"
            type="button"
            [id]="inputId()"
            [disabled]="disabled()"
            (click)="pickerOpen.set(true)"
          >
            <ng-icon name="lucidePlus" />
            {{ many() ? t('morph.control.addMany') : t('morph.control.addOne') }}
          </button>
        </div>
      }
    </div>

    <vd-entry-picker
      [open]="pickerOpen()"
      [many]="many()"
      [description]="t('content.relation.pickerDescription', { type: targetName() })"
      [types]="targetTypes()"
      [linked]="linked()"
      [editorLocale]="locale()"
      [mainFields]="mainFields()"
      (picked)="pick($event)"
      (closed)="closePicker()"
    />
  `,
})
export class RelationControl implements FormValueControl<string | string[] | null> {
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

  protected readonly pickerOpen = signal(false);
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
  /** The edit view's field naming related entries (`null`: the type's first text field). */
  readonly mainField = input<string | null>(null);

  /** Entries the field holds, for the picker. */
  protected readonly linked = computed(() =>
    this.selected().map((documentId) => ({ uid: this.target(), documentId })),
  );
  protected readonly targetTypes = computed(() => [this.target()]);
  protected readonly mainFields = computed(() => ({ [this.target()]: this.mainField() }));

  protected pick(entries: PickedEntry[]): void {
    this.pickerOpen.set(false);
    if (!entries.length) return;
    this.picked.update((labels) => ({
      ...labels,
      ...Object.fromEntries(entries.map((entry) => [entry.documentId, entry.label])),
    }));
    const ids = entries.map((entry) => entry.documentId);
    const current = this.selected();
    this.value.set(
      this.many() ? [...current, ...ids.filter((id) => !current.includes(id))] : ids[0],
    );
    this.touch.emit();
  }

  protected closePicker(): void {
    this.pickerOpen.set(false);
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
}
