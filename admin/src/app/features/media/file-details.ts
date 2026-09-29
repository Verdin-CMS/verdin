import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButtonImports } from '@spartan-ng/helm/button';

import { I18n } from '../../core/i18n/i18n';
import { Media } from '../../core/media';
import { MediaFile } from '../../core/types';
import { dimensions, formatSize } from './media-format';

/** A file's read-only facts in the file sheet: type, size, dates, URL and image formats. */
@Component({
  selector: 'vd-media-file-details',
  imports: [NgIcon, HlmButtonImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let current = file();
    <dl class="bg-muted/30 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl border p-4 text-sm">
      <dt class="text-muted-foreground">{{ t('media.file.type') }}</dt>
      <dd class="truncate font-mono text-xs leading-5">{{ current.mime }}</dd>
      <dt class="text-muted-foreground">{{ t('media.file.size') }}</dt>
      <dd>{{ size() }}</dd>
      @if (dims(); as dims) {
        <dt class="text-muted-foreground">{{ t('media.file.dimensions') }}</dt>
        <dd>{{ dims }}</dd>
      }
      <dt class="text-muted-foreground">{{ t('media.file.created') }}</dt>
      <dd>{{ i18n.formatDate(current.createdAt, 'long') }}</dd>
      <dt class="text-muted-foreground">{{ t('media.file.updated') }}</dt>
      <dd>{{ i18n.formatDate(current.updatedAt, 'long') }}</dd>
      <dt class="text-muted-foreground self-center">{{ t('media.file.url') }}</dt>
      <dd class="flex min-w-0 items-center gap-1">
        <a
          class="text-primary truncate font-mono text-xs hover:underline"
          target="_blank"
          rel="noopener"
          [href]="media.url(current.url)"
          >{{ current.url }}</a
        >
        <button
          hlmBtn
          variant="ghost"
          size="icon-xs"
          type="button"
          [attr.aria-label]="t('media.file.copyUrl')"
          [title]="t('media.file.copyUrl')"
          (click)="copyUrl()"
        >
          <ng-icon name="lucideCopy" />
        </button>
      </dd>
      @if (formats().length) {
        <dt class="text-muted-foreground">{{ t('media.file.formats') }}</dt>
        <dd>
          <ul class="flex flex-col gap-1">
            @for (format of formats(); track format.name) {
              <li class="flex items-center gap-2">
                <a
                  class="text-primary hover:underline"
                  target="_blank"
                  rel="noopener"
                  [href]="media.url(format.url)"
                  >{{ format.name }}</a
                >
                <span class="text-muted-foreground text-xs tabular-nums"
                  >{{ format.width }} × {{ format.height }}</span
                >
              </li>
            }
          </ul>
        </dd>
      }
    </dl>
  `,
})
export class MediaFileDetails {
  protected readonly media = inject(Media);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  readonly file = input.required<MediaFile>();

  protected readonly size = computed(() => formatSize(this.i18n, this.file().size));
  protected readonly dims = computed(() => dimensions(this.file()));
  protected readonly formats = computed(() =>
    Object.values(this.file().formats ?? {}).sort((a, b) => a.width - b.width),
  );

  protected async copyUrl(): Promise<void> {
    const url = new URL(this.media.url(this.file().url), location.href).href;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(this.t('common.copied'));
    } catch {
      toast.error(this.t('media.file.copyFailed'));
    }
  }
}
