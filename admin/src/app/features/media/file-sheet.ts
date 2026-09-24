import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSheetImports } from '@spartan-ng/helm/sheet';
import { HlmTextareaImports } from '@spartan-ng/helm/textarea';

import { ApiFailure } from '../../core/api';
import { Auth } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import { Media } from '../../core/media';
import { MediaFile, MediaFolder } from '../../core/types';
import {
  KIND_ICONS,
  KIND_LABELS,
  altText,
  canTouch,
  dimensions,
  extension,
  fileKind,
  folderOptions,
  formatSize,
} from './media-format';

type FocalPoint = { x: number; y: number };

/** Details of one file: preview, focal point, metadata editing, download and delete. */
@Component({
  selector: 'vd-media-file-sheet',
  imports: [
    NgIcon,
    HlmSheetImports,
    HlmAlertDialogImports,
    HlmBadgeImports,
    HlmButtonImports,
    HlmFieldImports,
    HlmInputImports,
    HlmNativeSelectImports,
    HlmTextareaImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-sheet side="right" [state]="file() ? 'open' : 'closed'" (closed)="closed.emit()">
      <hlm-sheet-content
        *hlmSheetPortal="let ctx"
        class="gap-0 overflow-y-auto p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
      >
        @if (current(); as file) {
          <hlm-sheet-header class="border-b p-4 pe-12">
            <h2 hlmSheetTitle class="truncate" [title]="file.name">{{ file.name }}</h2>
            <p hlmSheetDescription class="flex flex-wrap items-center gap-2">
              <span hlmBadge variant="secondary">{{ ext(file) || t(kindLabel(file)) }}</span>
              <span>{{ size(file) }}</span>
              @if (dims(file); as dims) {
                <span>· {{ dims }}</span>
              }
            </p>
          </hlm-sheet-header>

          <div class="flex flex-col gap-6 p-4">
            <div class="bg-muted/50 overflow-hidden rounded-xl border">
              @switch (kind(file)) {
                @case ('images') {
                  <div class="flex justify-center p-2">
                    <div
                      class="relative inline-block max-w-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      [class.cursor-crosshair]="canEdit()"
                      [attr.tabindex]="canEdit() ? 0 : null"
                      [attr.role]="canEdit() ? 'button' : null"
                      [attr.aria-label]="canEdit() ? t('media.file.focalPoint') : null"
                      [attr.aria-describedby]="canEdit() ? 'media-file-focal' : null"
                      (click)="setFocal($event)"
                      (keydown)="nudgeFocal($event)"
                    >
                      <img
                        class="block max-h-80 max-w-full rounded-md object-contain select-none"
                        draggable="false"
                        [src]="media.url(media.preview(file, 800))"
                        [alt]="alt(file)"
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
                    [src]="media.url(file.url)"
                    [attr.aria-label]="alt(file)"
                  ></video>
                }
                @case ('audios') {
                  <div class="flex flex-col items-center gap-4 p-6">
                    <ng-icon name="lucideMusic" size="48" class="text-muted-foreground" />
                    <audio
                      controls
                      preload="metadata"
                      class="w-full"
                      [src]="media.url(file.url)"
                      [attr.aria-label]="alt(file)"
                    ></audio>
                  </div>
                }
                @default {
                  <div class="text-muted-foreground flex flex-col items-center gap-2 p-10">
                    <ng-icon [name]="icon(file)" size="56" />
                    <span class="font-mono text-xs">{{ ext(file) }}</span>
                  </div>
                }
              }
            </div>

            @if (kind(file) === 'images' && canEdit()) {
              <div class="-mt-3 flex items-center gap-2 text-xs">
                <ng-icon name="lucideCrosshair" class="text-muted-foreground" />
                <span id="media-file-focal" class="text-muted-foreground">{{
                  focal()
                    ? t('media.file.focalSet', { point: focalText() })
                    : t('media.file.focalHint')
                }}</span>
                @if (focal()) {
                  <button
                    hlmBtn
                    variant="ghost"
                    size="xs"
                    type="button"
                    class="ms-auto"
                    (click)="focal.set(null)"
                  >
                    {{ t('common.clear') }}
                  </button>
                }
              </div>
            }

            <form class="flex flex-col gap-4" (submit)="$event.preventDefault(); save(file)">
              <div hlmField>
                <label hlmFieldLabel for="media-file-name">{{ t('common.name') }}</label>
                <input
                  hlmInput
                  id="media-file-name"
                  [value]="name()"
                  [disabled]="!canEdit()"
                  (input)="name.set($any($event.target).value)"
                />
              </div>
              <div hlmField>
                <label hlmFieldLabel for="media-file-alt">{{ t('media.file.alt') }}</label>
                <input
                  hlmInput
                  id="media-file-alt"
                  [value]="alternativeText()"
                  [disabled]="!canEdit()"
                  (input)="alternativeText.set($any($event.target).value)"
                />
                <p hlmFieldDescription>{{ t('media.file.altHint') }}</p>
              </div>
              <div hlmField>
                <label hlmFieldLabel for="media-file-caption">{{ t('media.file.caption') }}</label>
                <textarea
                  hlmTextarea
                  id="media-file-caption"
                  rows="2"
                  [value]="caption()"
                  [disabled]="!canEdit()"
                  (input)="caption.set($any($event.target).value)"
                ></textarea>
              </div>
              <div hlmField>
                <label hlmFieldLabel for="media-file-folder">{{ t('media.file.folder') }}</label>
                <hlm-native-select
                  selectId="media-file-folder"
                  [value]="folder() === null ? '' : String(folder())"
                  [disabled]="!canEdit()"
                  (valueChange)="folder.set($event ? Number($event) : null)"
                >
                  <option hlmNativeSelectOption value="">{{ t('media.root') }}</option>
                  @for (option of options(); track option.id) {
                    <option hlmNativeSelectOption [value]="String(option.id)">
                      {{ option.label }}
                    </option>
                  }
                </hlm-native-select>
              </div>

              <dl
                class="bg-muted/30 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl border p-4 text-sm"
              >
                <dt class="text-muted-foreground">{{ t('media.file.type') }}</dt>
                <dd class="truncate font-mono text-xs leading-5">{{ file.mime }}</dd>
                <dt class="text-muted-foreground">{{ t('media.file.size') }}</dt>
                <dd>{{ size(file) }}</dd>
                @if (dims(file); as dims) {
                  <dt class="text-muted-foreground">{{ t('media.file.dimensions') }}</dt>
                  <dd>{{ dims }}</dd>
                }
                <dt class="text-muted-foreground">{{ t('media.file.created') }}</dt>
                <dd>{{ i18n.formatDate(file.createdAt, 'long') }}</dd>
                <dt class="text-muted-foreground">{{ t('media.file.updated') }}</dt>
                <dd>{{ i18n.formatDate(file.updatedAt, 'long') }}</dd>
                <dt class="text-muted-foreground self-center">{{ t('media.file.url') }}</dt>
                <dd class="flex min-w-0 items-center gap-1">
                  <a
                    class="text-primary truncate font-mono text-xs hover:underline"
                    target="_blank"
                    rel="noopener"
                    [href]="media.url(file.url)"
                    >{{ file.url }}</a
                  >
                  <button
                    hlmBtn
                    variant="ghost"
                    size="icon-xs"
                    type="button"
                    [attr.aria-label]="t('media.file.copyUrl')"
                    [title]="t('media.file.copyUrl')"
                    (click)="copyUrl(file)"
                  >
                    <ng-icon name="lucideCopy" />
                  </button>
                </dd>
                @if (formats(file).length) {
                  <dt class="text-muted-foreground">{{ t('media.file.formats') }}</dt>
                  <dd>
                    <ul class="flex flex-col gap-1">
                      @for (format of formats(file); track format.name) {
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

              <div class="flex flex-wrap items-center gap-2 border-t pt-4">
                @if (canDelete()) {
                  <hlm-alert-dialog>
                    <button
                      hlmAlertDialogTrigger
                      hlmBtn
                      variant="ghost"
                      size="sm"
                      type="button"
                      class="text-destructive hover:text-destructive"
                    >
                      <ng-icon name="lucideTrash2" /> {{ t('common.delete') }}
                    </button>
                    <hlm-alert-dialog-content *hlmAlertDialogPortal="let dialog">
                      <hlm-alert-dialog-header>
                        <h2 hlmAlertDialogTitle>{{ t('media.file.deleteTitle') }}</h2>
                        <p hlmAlertDialogDescription>
                          {{ t('media.file.deleteHint', { name: file.name }) }}
                        </p>
                      </hlm-alert-dialog-header>
                      <hlm-alert-dialog-footer>
                        <button hlmAlertDialogCancel (click)="dialog.close()">
                          {{ t('common.cancel') }}
                        </button>
                        <button
                          hlmAlertDialogAction
                          variant="destructive"
                          (click)="dialog.close(); remove(file)"
                        >
                          {{ t('common.delete') }}
                        </button>
                      </hlm-alert-dialog-footer>
                    </hlm-alert-dialog-content>
                  </hlm-alert-dialog>
                }
                <a
                  hlmBtn
                  variant="outline"
                  size="sm"
                  class="ms-auto"
                  [href]="media.url(file.url)"
                  [attr.download]="file.name"
                >
                  <ng-icon name="lucideDownload" /> {{ t('media.file.download') }}
                </a>
                @if (canEdit()) {
                  <button hlmBtn size="sm" type="submit" [disabled]="busy() || !name().trim()">
                    <ng-icon name="lucideSave" /> {{ t('common.save') }}
                  </button>
                }
              </div>
            </form>
          </div>
        }
      </hlm-sheet-content>
    </hlm-sheet>
  `,
})
export class MediaFileSheet {
  protected readonly media = inject(Media);
  private readonly auth = inject(Auth);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly String = String;
  protected readonly Number = Number;

  /** The file to show; `null` closes the sheet. */
  readonly file = input<MediaFile | null>(null);
  readonly folders = input<MediaFolder[]>([]);
  readonly saved = output<MediaFile>();
  readonly deleted = output<number>();
  readonly closed = output<void>();

  /** The last file shown, kept while the sheet animates closed. */
  protected readonly current = linkedSignal<MediaFile | null, MediaFile | null>({
    source: this.file,
    computation: (file, previous) => file ?? previous?.value ?? null,
  });
  protected readonly name = linkedSignal(() => this.current()?.name ?? '');
  protected readonly alternativeText = linkedSignal(() => this.current()?.alternativeText ?? '');
  protected readonly caption = linkedSignal(() => this.current()?.caption ?? '');
  protected readonly folder = linkedSignal<number | null>(() => this.current()?.folder ?? null);
  protected readonly focal = linkedSignal<FocalPoint | null>(
    () => this.current()?.focalPoint ?? null,
  );
  protected readonly busy = signal(false);

  protected readonly options = computed(() => folderOptions(this.folders()));
  protected readonly canEdit = computed(() => {
    const file = this.current();
    return !!file && canTouch(this.auth, 'media.update', file);
  });
  protected readonly canDelete = computed(() => {
    const file = this.current();
    return !!file && canTouch(this.auth, 'media.delete', file);
  });
  protected readonly focalText = computed(() => {
    const point = this.focal();
    return point ? `${Math.round(point.x * 100)}% × ${Math.round(point.y * 100)}%` : '';
  });

  protected kind = fileKind;
  protected ext = extension;
  protected alt = altText;
  protected dims = dimensions;

  protected icon(file: MediaFile): string {
    return KIND_ICONS[fileKind(file)];
  }

  protected kindLabel(file: MediaFile) {
    return KIND_LABELS[fileKind(file)];
  }

  protected size(file: MediaFile): string {
    return formatSize(this.i18n, file.size);
  }

  protected formats(file: MediaFile) {
    return Object.values(file.formats ?? {}).sort((a, b) => a.width - b.width);
  }

  protected setFocal(event: MouseEvent): void {
    if (!this.canEdit()) return;
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
    if (!this.canEdit()) return;
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

  protected async copyUrl(file: MediaFile): Promise<void> {
    const url = new URL(this.media.url(file.url), location.href).href;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(this.t('common.copied'));
    } catch {
      toast.error(this.t('media.file.copyFailed'));
    }
  }

  protected async save(file: MediaFile): Promise<void> {
    if (!this.canEdit() || !this.name().trim()) return;
    this.busy.set(true);
    try {
      const updated = await this.media.update(file.id, {
        name: this.name().trim(),
        alternativeText: this.alternativeText().trim() || null,
        caption: this.caption().trim() || null,
        folder: this.folder(),
        focalPoint: this.focal(),
      });
      this.current.set(updated);
      this.saved.emit(updated);
      toast.success(this.t('media.file.saved'));
    } catch (error) {
      toast.error(this.t('media.file.saveFailed'), {
        description: ApiFailure.from(error).message,
      });
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(file: MediaFile): Promise<void> {
    try {
      await this.media.delete(file.id);
      this.deleted.emit(file.id);
      toast.success(this.t('media.file.deleted'));
    } catch (error) {
      toast.error(this.t('media.file.deleteFailed'), {
        description: ApiFailure.from(error).message,
      });
    }
  }
}
