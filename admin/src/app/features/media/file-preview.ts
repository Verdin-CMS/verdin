import { ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { NgIcon } from '@ng-icons/core';

import { I18n } from '../../core/i18n/i18n';
import { Media } from '../../core/media';
import { MediaFile } from '../../core/types';
import { KIND_ICONS, altText, extension, fileKind } from './media-format';

export type FocalPoint = { x: number; y: number };

/**
 * A file's preview in the file sheet: the image (where an editor clicks or uses the arrow
 * keys to set the focal point), the video or audio player, the PDF, or the kind's icon.
 */
@Component({
  selector: 'vd-media-file-preview',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'bg-muted/50 block overflow-hidden rounded-xl border' },
  template: `
    @let current = file();
    @switch (kind()) {
      @case ('images') {
        <div class="flex justify-center p-2">
          <div
            class="relative inline-block max-w-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            [class.cursor-crosshair]="editable()"
            [attr.tabindex]="editable() ? 0 : null"
            [attr.role]="editable() ? 'button' : null"
            [attr.aria-label]="editable() ? t('media.file.focalPoint') : null"
            [attr.aria-describedby]="editable() ? 'media-file-focal' : null"
            (click)="setFocal($event)"
            (keydown)="nudgeFocal($event)"
          >
            <img
              class="block max-h-80 max-w-full rounded-md object-contain select-none"
              draggable="false"
              [src]="media.url(media.preview(current, 800))"
              [alt]="alt()"
            />
            @if (focal(); as point) {
              <span
                class="pointer-events-none absolute size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.4)]"
                [style.left.%]="point.x * 100"
                [style.top.%]="point.y * 100"
                aria-hidden="true"
              >
                <span
                  class="absolute top-1/2 left-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
                ></span>
              </span>
            }
          </div>
        </div>
      }
      @case ('videos') {
        <video
          controls
          preload="metadata"
          class="max-h-80 w-full bg-black"
          [src]="media.url(current.url)"
          [attr.aria-label]="alt()"
        ></video>
      }
      @case ('audios') {
        <div class="flex flex-col items-center gap-4 p-6">
          <ng-icon name="lucideMusic" size="48" class="text-muted-foreground" />
          <audio
            controls
            preload="metadata"
            class="w-full"
            [src]="media.url(current.url)"
            [attr.aria-label]="alt()"
          ></audio>
        </div>
      }
      @default {
        @if (pdfUrl(); as url) {
          <iframe
            class="block h-[60vh] w-full bg-white"
            sandbox="allow-same-origin"
            referrerpolicy="no-referrer"
            [src]="url"
            [title]="t('media.file.pdfPreview', { name: current.name })"
          ></iframe>
        } @else {
          <div class="text-muted-foreground flex flex-col items-center gap-2 p-10">
            <ng-icon [name]="icon()" size="56" />
            <span class="font-mono text-xs">{{ ext() }}</span>
          </div>
        }
      }
    }
  `,
})
export class MediaFilePreview {
  protected readonly media = inject(Media);
  protected readonly t = inject(I18n).t;
  private readonly sanitizer = inject(DomSanitizer);

  readonly file = input.required<MediaFile>();
  /** The focal point can be set (images, for admins who may edit the file). */
  readonly editable = input(false);
  /** The image's focal point, 0–1 on each axis (`[(focal)]`). */
  readonly focal = model<FocalPoint | null>(null);

  protected readonly kind = computed(() => fileKind(this.file()));
  protected readonly alt = computed(() => altText(this.file()));
  protected readonly ext = computed(() => extension(this.file()));
  protected readonly icon = computed(() => KIND_ICONS[this.kind()]);
  /** PDFs preview in a sandboxed frame (same-origin library files only). */
  protected readonly pdfUrl = computed<SafeResourceUrl | null>(() => {
    const file = this.file();
    if (file.mime !== 'application/pdf') return null;
    const url = new URL(this.media.url(file.url), location.href);
    if (url.origin !== location.origin) return null;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url.pathname);
  });

  protected setFocal(event: MouseEvent): void {
    if (!this.editable()) return;
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (!box.width || !box.height) return;
    const clamp = (value: number) => Math.min(1, Math.max(0, Math.round(value * 1000) / 1000));
    this.focal.set({
      x: clamp((event.clientX - box.left) / box.width),
      y: clamp((event.clientY - box.top) / box.height),
    });
  }

  /** Arrow keys move the focal point by 5%; Delete clears it. */
  protected nudgeFocal(event: KeyboardEvent): void {
    if (!this.editable()) return;
    const steps: Record<string, [number, number]> = {
      ArrowLeft: [-0.05, 0],
      ArrowRight: [0.05, 0],
      ArrowUp: [0, -0.05],
      ArrowDown: [0, 0.05],
    };
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.focal.set(null);
      return;
    }
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    const point = this.focal() ?? { x: 0.5, y: 0.5 };
    const clamp = (value: number) => Math.min(1, Math.max(0, Math.round(value * 100) / 100));
    this.focal.set({ x: clamp(point.x + step[0]), y: clamp(point.y + step[1]) });
  }
}
