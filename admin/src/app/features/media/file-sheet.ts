import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  untracked,
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
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { HlmTextareaImports } from '@spartan-ng/helm/textarea';

import { ALT_TEXT_MIMES, AiActions, aiErrorMessage } from '../../core/ai';
import { ApiFailure } from '../../core/api';
import { Auth } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import { Media } from '../../core/media';
import { MediaFile, MediaFolder } from '../../core/types';
import { UsageProbe, Usages } from '../../core/usage';
import { UsageSection, UsageWarning } from '../../shared/components/usage';
import { MediaCropDialog } from './crop-dialog';
import { MediaFileDetails } from './file-details';
import { FocalPoint, MediaFilePreview } from './file-preview';
import { croppable } from './crop';
import {
  KIND_LABELS,
  canTouch,
  dimensions,
  extension,
  fileKind,
  folderOptions,
  formatSize,
} from './media-format';

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
    HlmSpinnerImports,
    MediaCropDialog,
    MediaFileDetails,
    MediaFilePreview,
    UsageSection,
    UsageWarning,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-sheet
      [side]="i18n.endSide()"
      [state]="file() ? 'open' : 'closed'"
      (closed)="closed.emit()"
    >
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
            <vd-media-file-preview [file]="file" [editable]="canEdit()" [(focal)]="focal" />

            @if (canEdit()) {
              <div class="-mt-3 flex flex-wrap items-center gap-2">
                <button
                  hlmBtn
                  variant="outline"
                  size="sm"
                  type="button"
                  [disabled]="replacing()"
                  (click)="replaceInput.click()"
                >
                  @if (replacing()) {
                    <hlm-spinner class="size-4" />
                  } @else {
                    <ng-icon name="lucideReplace" />
                  }
                  {{ t('media.file.replace') }}
                </button>
                @if (canCrop(file)) {
                  <button
                    hlmBtn
                    variant="outline"
                    size="sm"
                    type="button"
                    [disabled]="replacing()"
                    (click)="cropping.set(file)"
                  >
                    <ng-icon name="lucideCrop" /> {{ t('media.file.crop') }}
                  </button>
                }
                <input
                  #replaceInput
                  type="file"
                  class="hidden"
                  tabindex="-1"
                  aria-hidden="true"
                  (change)="onReplace($event, file)"
                />
                <span class="text-muted-foreground basis-full text-xs">{{
                  t('media.file.replaceHint')
                }}</span>
              </div>
            }

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
                @if (canDescribe(file)) {
                  <div>
                    <button
                      hlmBtn
                      variant="outline"
                      size="xs"
                      type="button"
                      [disabled]="describing()"
                      [title]="t('ai.altText.hint')"
                      (click)="describe(file)"
                    >
                      @if (describing()) {
                        <hlm-spinner class="size-3" />
                      } @else {
                        <ng-icon name="lucideSparkles" />
                      }
                      {{ describing() ? t('ai.altText.running') : t('ai.altText.action') }}
                    </button>
                  </div>
                }
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

              <vd-media-file-details [file]="file" />

              <div class="rounded-xl border p-4">
                <vd-usage-section [state]="usage.state()" [level]="3" (retry)="loadUsage()" />
              </div>

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
                      (click)="checkUsage(file)"
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
                      <vd-usage-warning [state]="deleteUsage.state()" />
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

    <vd-media-crop-dialog
      [file]="cropping()"
      [busy]="replacing()"
      (cropped)="onCropped($event)"
      (closed)="cropping.set(null)"
    />
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
  protected readonly replacing = signal(false);
  private readonly ai = inject(AiActions);
  protected readonly describing = signal(false);
  /** The image in the crop dialog. */
  protected readonly cropping = signal<MediaFile | null>(null);
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

  private readonly usages = inject(Usages);
  /** Where the shown file is used. */
  protected readonly usage = new UsageProbe();
  /** The same, looked up again when a delete is confirmed. */
  protected readonly deleteUsage = new UsageProbe();
  /** The file whose usage is shown (by id: saving the file keeps it). */
  private readonly usageId = computed(() => this.file()?.id ?? null);

  constructor() {
    void this.ai.load();
    effect(() => {
      // Closing keeps the last answer while the sheet animates out.
      if (this.usageId() !== null) untracked(() => this.loadUsage());
    });
  }

  protected loadUsage(): void {
    const id = this.usageId();
    if (id !== null) void this.usage.start(() => this.usages.forFile(id));
  }

  protected checkUsage(file: MediaFile): void {
    void this.deleteUsage.start(() => this.usages.forFile(file.id));
  }

  protected kind = fileKind;
  protected ext = extension;
  protected dims = dimensions;

  protected kindLabel(file: MediaFile) {
    return KIND_LABELS[fileKind(file)];
  }

  protected size(file: MediaFile): string {
    return formatSize(this.i18n, file.size);
  }

  /** Alt text by AI: images the provider reads, for admins who may edit the file. */
  protected canDescribe(file: MediaFile): boolean {
    return this.ai.enabled() && this.canEdit() && ALT_TEXT_MIMES.has(file.mime);
  }

  /** Fills the alternative text (and the caption when empty) with a suggestion; not saved. */
  protected async describe(file: MediaFile): Promise<void> {
    if (this.describing()) return;
    this.describing.set(true);
    try {
      const result = await this.ai.altText(file.id);
      if (this.current()?.id !== file.id) return;
      const previous = { alternativeText: this.alternativeText(), caption: this.caption() };
      if (result.alternativeText.trim()) this.alternativeText.set(result.alternativeText.trim());
      if (!previous.caption.trim() && result.caption.trim())
        this.caption.set(result.caption.trim());
      document.getElementById('media-file-alt')?.focus();
      toast.success(this.t('ai.altText.done'), {
        description: this.t('ai.reviewHint'),
        action: {
          label: this.t('ai.undo'),
          onClick: () => {
            if (this.current()?.id !== file.id) return;
            this.alternativeText.set(previous.alternativeText);
            this.caption.set(previous.caption);
          },
        },
      });
    } catch (error) {
      toast.error(this.t('ai.altText.error'), { description: aiErrorMessage(error, this.t) });
    } finally {
      this.describing.set(false);
    }
  }

  protected canCrop(file: MediaFile): boolean {
    return croppable(file.mime);
  }

  protected onReplace(event: Event, file: MediaFile): void {
    const input = event.target as HTMLInputElement;
    const picked = input.files?.[0];
    input.value = '';
    if (picked) void this.replace(file, picked, picked.name);
  }

  protected onCropped(blob: Blob): void {
    const file = this.cropping();
    if (file) void this.replace(file, blob, croppedName(file.name, blob.type), true);
  }

  /** New content for the file: its id, metadata and the entries using it stay. */
  private async replace(file: MediaFile, blob: Blob, name: string, crop = false): Promise<void> {
    this.replacing.set(true);
    try {
      const replaced = await this.media.replace(file.id, blob, name);
      this.current.set(replaced);
      this.cropping.set(null);
      this.saved.emit(replaced);
      toast.success(this.t(crop ? 'media.file.cropped' : 'media.file.replaced'));
    } catch (error) {
      toast.error(this.t('media.file.replaceFailed'), {
        description: ApiFailure.from(error).message,
      });
    } finally {
      this.replacing.set(false);
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

/** The file name after a crop: the extension follows the encoded type. */
export function croppedName(name: string, type: string): string {
  const extensions: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
  };
  const ext = extensions[type];
  if (!ext) return name;
  const base = name.replace(/\.[^.]+$/, '');
  return /\.(jpe?g)$/i.test(name) && ext === '.jpg' ? name : `${base}${ext}`;
}
