import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';

import { ApiFailure } from '../../core/api';
import { I18n } from '../../core/i18n/i18n';
import { Media, MediaInfo, mediaKind } from '../../core/media';
import { MediaFile } from '../../core/types';
import { KIND_ICONS } from './media-format';

export interface UploadItem {
  key: number;
  name: string;
  mime: string;
  progress: number;
  status: 'queued' | 'uploading' | 'done' | 'error';
  error?: string;
}

export interface UploadResult {
  /** Stored files, in the order they were given. */
  uploaded: MediaFile[];
  failed: number;
}

let nextKey = 0;

/** Uploads files a few at a time, tracking each one's progress in `items`. */
export class UploadQueue {
  readonly items = signal<UploadItem[]>([]);
  readonly busy = computed(() =>
    this.items().some((item) => item.status === 'queued' || item.status === 'uploading'),
  );

  constructor(
    private readonly media: Media,
    private readonly parallel = 3,
  ) {}

  async add(files: File[], info: MediaInfo = {}): Promise<UploadResult> {
    const jobs = files.map((file) => ({ file, key: ++nextKey }));
    this.items.update((items) => [
      ...items,
      ...jobs.map(({ file, key }): UploadItem => ({
        key,
        name: file.name,
        mime: file.type,
        progress: 0,
        status: 'queued',
      })),
    ]);
    const results: (MediaFile | null)[] = new Array(jobs.length).fill(null);
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const index = next++;
        try {
          results[index] = await this.run(jobs[index].file, jobs[index].key, info);
        } catch {
          results[index] = null;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.parallel, jobs.length) }, worker));
    const uploaded = results.filter((file): file is MediaFile => !!file);
    return { uploaded, failed: jobs.length - uploaded.length };
  }

  dismiss(key: number): void {
    this.items.update((items) => items.filter((item) => item.key !== key));
  }

  /** Forgets finished uploads (running ones stay). */
  clearFinished(): void {
    this.items.update((items) =>
      items.filter((item) => item.status === 'queued' || item.status === 'uploading'),
    );
  }

  private run(file: File, key: number, info: MediaInfo): Promise<MediaFile> {
    this.patch(key, { status: 'uploading' });
    return new Promise((resolve, reject) => {
      let stored: MediaFile | undefined;
      this.media.upload(file, info).subscribe({
        next: (event) => {
          this.patch(key, { progress: event.progress });
          if (event.file) stored = event.file;
        },
        error: (error: unknown) => {
          this.patch(key, { status: 'error', error: ApiFailure.from(error).message });
          reject(error);
        },
        complete: () => {
          if (stored) {
            this.patch(key, { status: 'done', progress: 1 });
            resolve(stored);
          } else {
            this.patch(key, { status: 'error' });
            reject(new Error('No file stored'));
          }
        },
      });
    });
  }

  private patch(key: number, changes: Partial<UploadItem>): void {
    this.items.update((items) =>
      items.map((item) => (item.key === key ? { ...item, ...changes } : item)),
    );
  }
}

/** Progress of an `UploadQueue`: floating in a page corner, or inline (inside dialogs). */
@Component({
  selector: 'vd-upload-panel',
  imports: [NgIcon, HlmButtonImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (queue().items().length) {
      <section
        class="bg-popover text-popover-foreground flex flex-col overflow-hidden rounded-xl border"
        [class]="
          floating() ? 'fixed end-4 bottom-4 z-40 w-[min(22rem,calc(100vw-2rem))] shadow-lg' : ''
        "
        [attr.aria-label]="t('media.upload.panel')"
      >
        <header class="flex items-center gap-2 border-b px-3 py-2">
          <ng-icon
            [name]="queue().busy() ? 'lucideUpload' : 'lucideCheck'"
            class="text-muted-foreground"
          />
          <h2 class="text-sm font-medium" aria-live="polite">
            {{
              queue().busy()
                ? t('media.upload.uploading', { count: pending() })
                : t('media.upload.finished')
            }}
          </h2>
          @if (!queue().busy()) {
            <button
              hlmBtn
              variant="ghost"
              size="icon-xs"
              type="button"
              class="ms-auto"
              [attr.aria-label]="t('media.upload.dismissAll')"
              (click)="queue().clearFinished()"
            >
              <ng-icon name="lucideX" />
            </button>
          }
        </header>
        <ul class="flex max-h-64 flex-col overflow-y-auto">
          @for (item of queue().items(); track item.key) {
            <li class="flex items-center gap-3 px-3 py-2 not-last:border-b">
              <ng-icon [name]="icon(item)" class="text-muted-foreground shrink-0" />
              <div class="flex min-w-0 flex-1 flex-col gap-1">
                <span class="truncate text-xs font-medium" [title]="item.name">{{
                  item.name
                }}</span>
                @if (item.status === 'error') {
                  <span class="text-destructive truncate text-xs" [title]="item.error ?? ''">{{
                    item.error || t('media.upload.itemFailed')
                  }}</span>
                } @else {
                  <div
                    class="bg-muted h-1.5 overflow-hidden rounded-full"
                    role="progressbar"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    [attr.aria-valuenow]="percent(item)"
                    [attr.aria-label]="item.name"
                  >
                    <div
                      class="h-full rounded-full transition-[width] duration-200"
                      [class]="item.status === 'done' ? 'bg-emerald-500' : 'bg-primary'"
                      [style.width.%]="percent(item)"
                    ></div>
                  </div>
                }
              </div>
              @if (item.status === 'done') {
                <ng-icon name="lucideCheck" class="shrink-0 text-emerald-500" />
              } @else if (item.status === 'error') {
                <button
                  hlmBtn
                  variant="ghost"
                  size="icon-xs"
                  type="button"
                  [attr.aria-label]="t('media.upload.dismiss', { name: item.name })"
                  (click)="queue().dismiss(item.key)"
                >
                  <ng-icon name="lucideX" />
                </button>
              } @else {
                <span class="text-muted-foreground shrink-0 text-xs tabular-nums"
                  >{{ percent(item) }}%</span
                >
              }
            </li>
          }
        </ul>
      </section>
    }
  `,
})
export class UploadPanel {
  protected readonly t = inject(I18n).t;

  readonly queue = input.required<UploadQueue>();
  readonly floating = input(false);

  protected readonly pending = computed(
    () =>
      this.queue()
        .items()
        .filter((item) => item.status === 'queued' || item.status === 'uploading').length,
  );

  protected percent(item: UploadItem): number {
    return Math.round(item.progress * 100);
  }

  protected icon(item: UploadItem): string {
    return item.status === 'error' ? 'lucideCircleAlert' : KIND_ICONS[mediaKind(item.mime)];
  }
}
