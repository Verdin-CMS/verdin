import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { NgIcon } from '@ng-icons/core';

import { Media } from '../../core/media';
import { MediaFile } from '../../core/types';
import { KIND_ICONS, altText, extension, fileKind } from './media-format';

/** A file preview filling its container: the image (cropped around its focal point) or a kind icon. */
@Component({
  selector: 'vd-media-thumb',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'bg-muted/60 relative block size-full overflow-hidden' },
  template: `
    @if (image()) {
      <img
        class="size-full object-cover"
        loading="lazy"
        draggable="false"
        [src]="src()"
        [alt]="alt()"
        [style.object-position]="position()"
      />
    } @else {
      <div
        class="text-muted-foreground flex size-full flex-col items-center justify-center gap-1.5"
      >
        <ng-icon [name]="icon()" [size]="iconSize()" />
        @if (ext() && showExtension()) {
          <span
            class="bg-background/80 rounded px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wide"
            >{{ ext() }}</span
          >
        }
        <span class="sr-only">{{ alt() }}</span>
      </div>
    }
  `,
})
export class MediaThumb {
  private readonly media = inject(Media);

  readonly file = input.required<MediaFile>();
  /** Smallest format width to use for the preview. */
  readonly width = input(245);
  readonly iconSize = input('32');
  readonly showExtension = input(true);

  protected readonly image = computed(() => fileKind(this.file()) === 'images');
  protected readonly src = computed(() =>
    this.media.url(this.media.preview(this.file(), this.width())),
  );
  protected readonly alt = computed(() => altText(this.file()));
  protected readonly icon = computed(() => KIND_ICONS[fileKind(this.file())]);
  protected readonly ext = computed(() => extension(this.file()));
  protected readonly position = computed(() => {
    const focal = this.file().focalPoint;
    return focal ? `${focal.x * 100}% ${focal.y * 100}%` : null;
  });
}
