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
import { HlmButtonImports } from '@spartan-ng/helm/button';

import { Auth } from '../../../core/auth';
import { I18n } from '../../../core/i18n/i18n';
import { MediaFile, MediaKind } from '../../../core/types';
import { dimensions, formatSize } from '../../media/media-format';
import { MediaPicker } from '../../media/picker';
import { MediaThumb } from '../../media/media-thumb';

/**
 * A media field: one file id (single) or an ordered list of ids (multiple), picked from
 * the media library.
 */
@Component({
  selector: 'vd-media-control',
  imports: [NgIcon, HlmButtonImports, MediaThumb, MediaPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex flex-wrap gap-3 rounded-xl"
      role="group"
      [class.ring-destructive/40]="invalid()"
      [class.ring-2]="invalid()"
    >
      @for (id of ids(); track id; let index = $index, first = $first, last = $last) {
        @let file = known()[id];
        <div class="bg-card group flex w-32 flex-col overflow-hidden rounded-xl border">
          <div class="relative aspect-square border-b">
            @if (file) {
              <vd-media-thumb [file]="file" [width]="160" iconSize="28" />
            } @else {
              <div
                class="bg-muted/60 text-muted-foreground flex size-full items-center justify-center font-mono text-xs"
              >
                #{{ id }}
              </div>
            }
          </div>
          <div class="flex min-w-0 flex-col px-2 py-1.5">
            <span class="truncate text-xs font-medium" [title]="file?.name ?? ''">{{
              label(id)
            }}</span>
            @if (file) {
              <span class="text-muted-foreground truncate text-[11px] tabular-nums">{{
                describe(file)
              }}</span>
            }
          </div>
          <div class="flex items-center gap-0.5 border-t px-1 py-1">
            @if (multiple()) {
              <button
                hlmBtn
                size="icon-xs"
                variant="ghost"
                type="button"
                [attr.aria-label]="t('media.control.moveLeft', { name: label(id) })"
                [title]="t('media.control.moveLeft', { name: label(id) })"
                [disabled]="disabled() || first"
                (click)="move(index, -1)"
              >
                <ng-icon name="lucideArrowLeft" />
              </button>
              <button
                hlmBtn
                size="icon-xs"
                variant="ghost"
                type="button"
                [attr.aria-label]="t('media.control.moveRight', { name: label(id) })"
                [title]="t('media.control.moveRight', { name: label(id) })"
                [disabled]="disabled() || last"
                (click)="move(index, 1)"
              >
                <ng-icon name="lucideArrowRight" />
              </button>
            } @else {
              <button
                hlmBtn
                size="xs"
                variant="ghost"
                type="button"
                [disabled]="disabled() || !canRead()"
                (click)="openPicker()"
              >
                {{ t('media.control.replace') }}
              </button>
            }
            <button
              hlmBtn
              size="icon-xs"
              variant="ghost"
              type="button"
              class="hover:text-destructive ms-auto"
              [attr.aria-label]="t('media.control.remove', { name: label(id) })"
              [title]="t('media.control.remove', { name: label(id) })"
              [disabled]="disabled()"
              (click)="remove(index)"
            >
              <ng-icon name="lucideX" />
            </button>
          </div>
        </div>
      }
      @if (multiple() || !ids().length) {
        <button
          type="button"
          class="text-muted-foreground hover:border-primary/40 hover:text-foreground focus-visible:ring-ring/50 flex min-h-32 w-32 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-3 text-center text-xs transition-colors outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50"
          [id]="inputId()"
          [disabled]="disabled() || !canRead()"
          [attr.aria-invalid]="invalid() || null"
          (click)="openPicker()"
        >
          <ng-icon [name]="multiple() ? 'lucidePlus' : 'lucideImage'" size="20" />
          {{ multiple() ? t('media.control.add') : t('media.control.choose') }}
        </button>
      }
    </div>
    @if (!canRead()) {
      <p class="text-muted-foreground mt-1 text-xs">{{ t('media.control.noAccess') }}</p>
    }

    <vd-media-picker
      [open]="pickerOpen()"
      [multiple]="multiple()"
      [allowedTypes]="allowedTypes()"
      [selected]="multiple() ? ids() : []"
      (picked)="pick($event)"
      (closed)="closePicker()"
    />
  `,
})
export class MediaControl implements FormValueControl<number | number[] | null> {
  private readonly auth = inject(Auth);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  readonly value = model<number | number[] | null>(null);
  readonly disabled = input(false);
  readonly invalid = input(false);
  readonly touch = output<void>();
  readonly inputId = input<string>('');
  readonly multiple = input(false);
  readonly allowedTypes = input<MediaKind[]>([]);
  /** Files of the initial value, from the populated document (for previews). */
  readonly initialFiles = input<MediaFile[]>([]);

  protected readonly pickerOpen = signal(false);
  private readonly picked = signal<Record<number, MediaFile>>({});

  protected readonly canRead = computed(() => this.auth.can('media.read'));
  protected readonly known = computed<Record<number, MediaFile>>(() => ({
    ...Object.fromEntries(this.initialFiles().map((file) => [file.id, file])),
    ...this.picked(),
  }));
  protected readonly ids = computed(() => {
    const value = this.value();
    return Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  });

  protected label(id: number): string {
    return this.known()[id]?.name ?? this.t('media.control.file', { id: String(id) });
  }

  protected describe(file: MediaFile): string {
    return [formatSize(this.i18n, file.size), dimensions(file)].filter(Boolean).join(' · ');
  }

  protected openPicker(): void {
    this.pickerOpen.set(true);
  }

  protected closePicker(): void {
    this.pickerOpen.set(false);
    this.touch.emit();
  }

  protected pick(files: MediaFile[]): void {
    this.pickerOpen.set(false);
    if (!files.length) return;
    this.picked.update((known) => ({
      ...known,
      ...Object.fromEntries(files.map((file) => [file.id, file])),
    }));
    if (this.multiple()) {
      const current = this.ids();
      const added = files.map((file) => file.id).filter((id) => !current.includes(id));
      this.value.set([...current, ...added]);
    } else {
      this.value.set(files[0].id);
    }
    this.touch.emit();
  }

  protected remove(index: number): void {
    this.value.set(this.multiple() ? this.ids().filter((_, position) => position !== index) : null);
    this.touch.emit();
  }

  protected move(index: number, delta: number): void {
    const list = [...this.ids()];
    const [item] = list.splice(index, 1);
    list.splice(index + delta, 0, item);
    this.value.set(list);
  }
}
