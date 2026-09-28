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
import { MorphRef, addMorphRefs, morphKey, morphRefs, morphValue } from '../../../core/morph';
import { Schema } from '../../../core/schema';
import { MorphEntry } from './model';
import { MorphPicker } from './morph-picker';
import { RelatedEditor } from './related-editor';

type MorphFormValue = MorphRef | MorphRef[] | null;

/**
 * A polymorphic owner (`morphToOne` / `morphToMany`): linked entries of any content type,
 * each with its type. The value is what the API writes: `{ __type, documentId }` (to-one)
 * or an ordered list of them (to-many), reordered by dragging or with the move buttons.
 * Entries are added with the picker and can be edited in the editor's side sheet.
 */
@Component({
  selector: 'vd-morph-control',
  imports: [
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    NgIcon,
    HlmBadgeImports,
    HlmButtonImports,
    MorphPicker,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-2">
      <ul
        class="flex flex-col gap-1"
        cdkDropList
        cdkDropListLockAxis="y"
        [cdkDropListDisabled]="!many() || disabled() || items().length < 2"
        [attr.aria-label]="label()"
        (cdkDropListDropped)="drop($event)"
        data-morph-list
      >
        @for (item of items(); track item.key; let index = $index) {
          <li
            cdkDrag
            [cdkDragData]="item.key"
            class="bg-muted/50 flex min-w-0 items-center gap-2 rounded-md border py-1 ps-1 pe-1 text-sm"
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
            <span hlmBadge variant="outline" class="shrink-0" data-morph-type>{{
              item.typeName
            }}</span>
            <span class="truncate" data-relation-label>{{ item.label }}</span>
            <span class="ms-auto flex items-center">
              @if (editor && item.editable) {
                <button
                  hlmBtn
                  size="icon-xs"
                  variant="ghost"
                  type="button"
                  [attr.aria-label]="t('content.relation.edit', { title: item.label })"
                  [title]="t('content.relation.edit', { title: item.label })"
                  (click)="edit(item.ref)"
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
                  [attr.aria-label]="t('content.relation.moveUp', { title: item.label })"
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
                  [attr.aria-label]="t('content.relation.moveDown', { title: item.label })"
                  [disabled]="index === items().length - 1 || disabled()"
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
                [attr.aria-label]="t('content.relation.remove', { title: item.label })"
                [disabled]="disabled()"
                (click)="remove(index)"
              >
                <ng-icon name="lucideX" />
              </button>
            </span>
          </li>
        } @empty {
          <li class="text-muted-foreground text-sm">{{ t('content.fields.morphEmpty') }}</li>
        }
      </ul>
      <p class="sr-only" aria-live="polite">{{ announcement() }}</p>
      @if (many() || !items().length) {
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

    <vd-morph-picker
      [open]="pickerOpen()"
      [many]="many()"
      [field]="label()"
      [linked]="refs()"
      [editorLocale]="locale()"
      (picked)="pick($event)"
      (closed)="closePicker()"
    />
  `,
})
export class MorphControl implements FormValueControl<MorphFormValue> {
  private readonly auth = inject(Auth);
  private readonly schema = inject(Schema);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  /** The editor's side sheet (absent inside the sheet itself). */
  protected readonly editor = inject(RelatedEditor, { optional: true });

  readonly value = model<MorphFormValue>(null);
  readonly disabled = input(false);
  readonly touch = output<void>();
  readonly inputId = input<string>('');
  readonly many = input(false);
  /** The field's label: names the list of linked entries. */
  readonly label = input('');
  /** Linked entries of the loaded document (type names, labels). */
  readonly initial = input<MorphEntry[]>([]);
  /** The edited document's locale: pickers search it, the sheet opens entries in it. */
  readonly locale = input<string | null>(null);

  protected readonly pickerOpen = signal(false);
  private readonly picked = signal<Record<string, MorphEntry>>({});
  /** Read by screen readers after a change. */
  protected readonly announcement = signal('');

  protected readonly refs = computed(() => morphRefs(this.value()));
  private readonly known = computed<Record<string, MorphEntry>>(() => ({
    ...Object.fromEntries(this.initial().map((entry) => [morphKey(entry), entry])),
    ...this.picked(),
  }));
  /** The linked entries, ready to show. */
  protected readonly items = computed(() => {
    const known = this.known();
    const saved = this.editor?.labels() ?? {};
    return this.refs().map((ref) => {
      const key = morphKey(ref);
      const entry = known[key];
      const type = this.schema.type(ref.__type);
      return {
        key,
        ref,
        typeName: type?.displayName ?? entry?.typeName ?? ref.__type,
        label: saved[ref.documentId] ?? entry?.label ?? ref.documentId,
        editable: !!type && this.auth.canContent('content.read', ref.__type),
      };
    });
  });

  protected pick(entries: MorphEntry[]): void {
    this.pickerOpen.set(false);
    if (!entries.length) return;
    this.picked.update((known) => ({
      ...known,
      ...Object.fromEntries(entries.map((entry) => [morphKey(entry), entry])),
    }));
    const added = entries.map((entry) => ({ __type: entry.uid, documentId: entry.documentId }));
    this.set(addMorphRefs(this.refs(), added, this.many()));
    this.announcement.set(this.t('morph.control.added', { count: entries.length }));
  }

  protected closePicker(): void {
    this.pickerOpen.set(false);
    this.touch.emit();
  }

  protected remove(index: number): void {
    const item = this.items()[index];
    this.set(this.refs().filter((_, position) => position !== index));
    if (item) this.announcement.set(this.t('morph.control.removed', { title: item.label }));
  }

  protected move(index: number, delta: number): void {
    this.reorder(index, index + delta);
  }

  protected drop(event: CdkDragDrop<unknown>): void {
    this.reorder(event.previousIndex, event.currentIndex);
  }

  private reorder(from: number, to: number): void {
    const list = [...this.refs()];
    if (from === to || to < 0 || to >= list.length) return;
    const label = this.items()[from]?.label ?? '';
    moveItemInArray(list, from, to);
    this.set(list);
    this.announcement.set(
      this.t('content.relation.moved', { title: label, position: to + 1, count: list.length }),
    );
  }

  private set(refs: MorphRef[]): void {
    this.value.set(morphValue(refs, this.many()));
    this.touch.emit();
  }

  /** Opens the linked entry in the editor's side sheet. */
  protected edit(ref: MorphRef): void {
    const type = this.schema.type(ref.__type);
    this.editor?.open({
      uid: ref.__type,
      documentId: ref.documentId,
      locale: isLocalized(type) ? this.locale() : null,
    });
  }
}
