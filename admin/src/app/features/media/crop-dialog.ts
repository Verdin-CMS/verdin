import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';

import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/keys';
import { Media } from '../../core/media';
import { MediaFile } from '../../core/types';
import {
  CROP_ASPECTS,
  CropAspect,
  CropBox,
  cropOutputType,
  initialBox,
  moveBox,
  nudgeBox,
  pixelBox,
  resizeBox,
} from './crop';

const ASPECT_LABELS: Record<CropAspect, MessageKey> = {
  free: 'media.crop.free',
  '1:1': 'media.crop.square',
  '4:3': 'media.crop.standard',
  '16:9': 'media.crop.wide',
};

type Drag = { mode: 'move' | 'resize'; x: number; y: number; box: CropBox };

/**
 * Crops a raster image in the browser: a box (free or with an aspect) moved and resized with
 * the pointer or the keyboard, drawn onto a canvas and handed back as a file.
 */
@Component({
  selector: 'vd-media-crop-dialog',
  imports: [NgIcon, HlmButtonImports, HlmDialogImports, HlmSpinnerImports, HlmToggleGroupImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog [state]="file() ? 'open' : 'closed'" (closed)="closed.emit()">
      <hlm-dialog-content
        *hlmDialogPortal="let ctx"
        class="sm:max-w-3xl"
        [closeLabel]="t('common.close')"
      >
        @if (file(); as current) {
          <hlm-dialog-header>
            <h2 hlmDialogTitle>{{ t('media.crop.title', { name: current.name }) }}</h2>
            <p hlmDialogDescription id="crop-hint">{{ t('media.crop.hint') }}</p>
          </hlm-dialog-header>
          <div class="flex flex-col gap-4">
            <hlm-toggle-group
              type="single"
              variant="outline"
              size="sm"
              class="self-start"
              [attr.aria-label]="t('media.crop.aspect')"
              [value]="aspect()"
              (valueChange)="setAspect($event)"
            >
              @for (option of aspects; track option) {
                <button hlmToggleGroupItem [value]="option">{{ t(aspectLabels[option]) }}</button>
              }
            </hlm-toggle-group>
            <div class="bg-muted/50 flex justify-center rounded-lg border p-2">
              <div class="relative inline-block max-w-full overflow-hidden" #frame>
                <img
                  #image
                  class="block max-h-[60vh] max-w-full select-none"
                  draggable="false"
                  crossorigin="anonymous"
                  [src]="media.url(current.url)"
                  [alt]="current.alternativeText ?? current.name"
                  (load)="loaded(image)"
                />
                @if (natural(); as size) {
                  <div
                    class="focus-visible:ring-ring absolute cursor-move touch-none border-2 border-white shadow-[0_0_0_9999px_rgb(0_0_0/0.5)] outline-none focus-visible:ring-3"
                    tabindex="0"
                    role="group"
                    data-crop-box
                    aria-describedby="crop-hint"
                    [attr.aria-label]="t('media.crop.box', { size: pixelText() })"
                    [style.left.%]="box().x * 100"
                    [style.top.%]="box().y * 100"
                    [style.width.%]="box().width * 100"
                    [style.height.%]="box().height * 100"
                    (pointerdown)="start($event, 'move')"
                    (pointermove)="drag($event)"
                    (pointerup)="stop($event)"
                    (pointercancel)="stop($event)"
                    (keydown)="nudge($event)"
                  >
                    <span
                      class="absolute -end-1.5 -bottom-1.5 size-3 cursor-nwse-resize rounded-sm border border-black/40 bg-white"
                      aria-hidden="true"
                      (pointerdown)="start($event, 'resize')"
                    ></span>
                  </div>
                }
              </div>
            </div>
            <p class="text-muted-foreground text-xs tabular-nums" aria-live="polite">
              {{ pixelText() }}
            </p>
          </div>
          <hlm-dialog-footer>
            <button hlmBtn variant="outline" type="button" (click)="closed.emit()">
              {{ t('common.cancel') }}
            </button>
            <button hlmBtn type="button" [disabled]="busy() || !natural()" (click)="apply()">
              @if (busy()) {
                <hlm-spinner />
              } @else {
                <ng-icon name="lucideCrop" />
              }
              {{ t('media.crop.apply') }}
            </button>
          </hlm-dialog-footer>
        }
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class MediaCropDialog {
  protected readonly media = inject(Media);
  protected readonly t = inject(I18n).t;

  /** The image to crop; `null` closes the dialog. */
  readonly file = input<MediaFile | null>(null);
  /** Whether the cropped image is being uploaded. */
  readonly busy = input(false);
  readonly cropped = output<Blob>();
  readonly closed = output<void>();

  protected readonly aspects = CROP_ASPECTS;
  protected readonly aspectLabels = ASPECT_LABELS;
  protected readonly aspect = signal<CropAspect>('free');
  protected readonly box = signal<CropBox>(initialBox('free', 0, 0));
  /** The image's size in pixels, once loaded. */
  protected readonly natural = signal<{ width: number; height: number } | null>(null);
  private readonly frame = viewChild<ElementRef<HTMLElement>>('frame');
  private readonly image = viewChild<ElementRef<HTMLImageElement>>('image');
  private dragging: Drag | null = null;

  protected readonly pixelText = computed(() => {
    const size = this.natural();
    if (!size) return '';
    const box = pixelBox(this.box(), size.width, size.height);
    return `${box.width} × ${box.height} px`;
  });

  protected loaded(image: HTMLImageElement): void {
    this.natural.set({ width: image.naturalWidth, height: image.naturalHeight });
    this.box.set(initialBox(this.aspect(), image.naturalWidth, image.naturalHeight));
  }

  protected setAspect(value: unknown): void {
    const aspect = CROP_ASPECTS.includes(value as CropAspect) ? (value as CropAspect) : 'free';
    this.aspect.set(aspect);
    const size = this.natural();
    if (size) this.box.set(initialBox(aspect, size.width, size.height));
  }

  protected start(event: PointerEvent, mode: Drag['mode']): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const box = (event.currentTarget as HTMLElement).closest('[data-crop-box]') as HTMLElement;
    box.setPointerCapture?.(event.pointerId);
    box.focus();
    this.dragging = { mode, x: event.clientX, y: event.clientY, box: this.box() };
  }

  protected drag(event: PointerEvent): void {
    const drag = this.dragging;
    const frame = this.frame()?.nativeElement.getBoundingClientRect();
    const size = this.natural();
    if (!drag || !frame?.width || !frame.height || !size) return;
    const dx = (event.clientX - drag.x) / frame.width;
    const dy = (event.clientY - drag.y) / frame.height;
    this.box.set(
      drag.mode === 'move'
        ? moveBox(drag.box, dx, dy)
        : resizeBox(drag.box, dx, dy, this.aspect(), size.width, size.height),
    );
  }

  protected stop(event: PointerEvent): void {
    this.dragging = null;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  }

  protected nudge(event: KeyboardEvent): void {
    const size = this.natural();
    if (!size) return;
    const next = nudgeBox(
      this.box(),
      event.key,
      event.shiftKey,
      this.aspect(),
      size.width,
      size.height,
    );
    if (!next) return;
    event.preventDefault();
    this.box.set(next);
  }

  /** Draws the box onto a canvas and emits the result, in the image's own type if possible. */
  protected apply(): void {
    const file = this.file();
    const image = this.image()?.nativeElement;
    const size = this.natural();
    if (!file || !image || !size) return;
    const area = pixelBox(this.box(), size.width, size.height);
    const canvas = document.createElement('canvas');
    canvas.width = area.width;
    canvas.height = area.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(
      image,
      area.x,
      area.y,
      area.width,
      area.height,
      0,
      0,
      area.width,
      area.height,
    );
    canvas.toBlob(
      (blob) => {
        if (blob) this.cropped.emit(blob);
      },
      cropOutputType(file.mime),
      0.92,
    );
  }
}
