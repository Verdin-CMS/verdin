import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import { I18n } from '../../../core/i18n/i18n';
import { PreviewPane, SPLIT_DEFAULT, splitAfterKey, splitAt } from '../preview-pane';
import { EditTarget } from '../visual-editing';

/**
 * The editor's body, with the preview beside it when `sideBySide` (large screens): the
 * editor's columns (projected), a resize handle (pointer or arrow keys) and the preview.
 */
@Component({
  selector: 'vd-preview-split',
  imports: [PreviewPane],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    <div
      #splitBox
      class="flex flex-col gap-6"
      [class.lg:grid]="sideBySide()"
      [class.lg:gap-0]="sideBySide()"
      [class.lg:items-start]="sideBySide()"
      [style.grid-template-columns]="sideBySide() ? splitColumns() : null"
    >
      <ng-content />
      @if (sideBySide()) {
        <div
          role="separator"
          tabindex="0"
          aria-orientation="vertical"
          aria-controls="document-preview"
          [attr.aria-label]="t('content.preview.resize')"
          [attr.aria-valuenow]="split()"
          aria-valuemin="30"
          aria-valuemax="70"
          class="group hidden cursor-col-resize touch-none justify-center px-1.5 outline-none lg:sticky lg:top-6 lg:flex lg:h-[calc(100dvh-8rem)]"
          (pointerdown)="startResize($event, splitBox)"
          (pointermove)="resize($event, splitBox)"
          (pointerup)="stopResize($event)"
          (pointercancel)="stopResize($event)"
          (keydown)="resizeKey($event)"
        >
          <span
            class="bg-border group-hover:bg-primary/60 group-focus-visible:bg-primary group-focus-visible:ring-ring/50 h-full w-1 rounded-full transition-colors group-focus-visible:ring-3"
          ></span>
        </div>
        <vd-preview-pane
          id="document-preview"
          class="h-[70dvh] lg:sticky lg:top-6 lg:h-[calc(100dvh-8rem)]"
          [url]="url()"
          [version]="version()"
          [title]="title()"
          [loading]="loading()"
          (reload)="reload.emit()"
          (openTab)="openTab.emit()"
          (closed)="closed.emit()"
          (edit)="edit.emit($event)"
        />
      }
    </div>
  `,
})
export class PreviewSplit {
  private readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  readonly sideBySide = input(false);
  /** The preview's URL (checked http(s)) and a counter that reloads it. */
  readonly url = input<string | null>(null);
  readonly version = input(0);
  readonly title = input('');
  readonly loading = input(false);
  readonly reload = output<void>();
  readonly openTab = output<void>();
  readonly closed = output<void>();
  /** The preview's overlay asked to edit a field. */
  readonly edit = output<EditTarget>();

  /** The editor column's share, in percent. */
  protected readonly split = signal(SPLIT_DEFAULT);
  protected readonly splitColumns = computed(
    () => `minmax(0, ${this.split()}fr) auto minmax(0, ${100 - this.split()}fr)`,
  );
  private resizing = false;

  protected startResize(event: PointerEvent, container: HTMLElement): void {
    if (event.button !== 0) return;
    this.resizing = true;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    event.preventDefault();
    this.resize(event, container);
  }

  protected resize(event: PointerEvent, container: HTMLElement): void {
    if (!this.resizing) return;
    const rect = container.getBoundingClientRect();
    this.split.set(splitAt(event.clientX, rect.left, rect.right, this.i18n.direction() === 'rtl'));
  }

  protected stopResize(event: PointerEvent): void {
    this.resizing = false;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  }

  protected resizeKey(event: KeyboardEvent): void {
    const next = splitAfterKey(this.split(), event.key, this.i18n.direction() === 'rtl');
    if (next === null) return;
    event.preventDefault();
    this.split.set(next);
  }
}
