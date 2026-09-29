import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';

import { Auth } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import { Media, mediaKind } from '../../core/media';
import { MediaFile, MediaFolder, MediaKind } from '../../core/types';
import { Pagination } from '../../shared/components/pagination';
import { MediaFiles } from './media-files';
import { MediaFilters } from './media-filters';
import { KIND_LABELS, MEDIA_KINDS, folderChain } from './media-format';
import { MediaListing } from './media-listing';
import { UploadPanel, UploadQueue } from './upload-panel';

const PAGE_SIZE = 24;

/** Chooses files from the media library (or uploads new ones) for a media field. */
@Component({
  selector: 'vd-media-picker',
  imports: [
    NgIcon,
    HlmDialogImports,
    HlmButtonImports,
    HlmEmptyImports,
    MediaFiles,
    MediaFilters,
    Pagination,
    UploadPanel,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog [state]="open() ? 'open' : 'closed'" (closed)="closed.emit()">
      <hlm-dialog-content
        *hlmDialogPortal="let ctx"
        class="flex max-h-[90svh] flex-col gap-4 sm:max-w-4xl"
        (dragenter)="dragEnter($event)"
        (dragover)="dragOver($event)"
        (dragleave)="dragLeave()"
        (drop)="drop($event)"
      >
        <hlm-dialog-header>
          <h2 hlmDialogTitle>
            {{ multiple() ? t('media.picker.titleMany') : t('media.picker.titleOne') }}
          </h2>
          <p hlmDialogDescription>
            {{
              allowedTypes().length
                ? t('media.picker.allowed', { types: allowedLabel() })
                : t('media.picker.hint')
            }}
          </p>
        </hlm-dialog-header>

        <vd-media-filters class="gap-2" [listing]="listing" [kinds]="kinds()" [compact]="true">
          @if (canUpload()) {
            <button
              hlmBtn
              variant="outline"
              size="sm"
              type="button"
              class="ms-auto"
              (click)="fileInput.click()"
            >
              <ng-icon name="lucideUpload" /> {{ t('media.upload.button') }}
            </button>
            <input
              #fileInput
              type="file"
              class="hidden"
              [multiple]="multiple()"
              [attr.accept]="accept()"
              (change)="onPick($event)"
            />
          }
        </vd-media-filters>

        <nav
          [attr.aria-label]="t('media.breadcrumb')"
          class="flex flex-wrap items-center gap-1 text-sm"
        >
          <button
            type="button"
            class="hover:text-foreground inline-flex items-center gap-1 rounded px-1 py-0.5"
            [class]="folder() === null ? 'text-foreground font-medium' : 'text-muted-foreground'"
            (click)="goTo(null)"
          >
            <ng-icon name="lucideHouse" size="14" /> {{ t('media.root') }}
          </button>
          @for (item of trail(); track item.id; let last = $last) {
            <ng-icon
              name="lucideChevronRight"
              size="14"
              class="text-muted-foreground rtl:-scale-x-100"
            />
            <button
              type="button"
              class="hover:text-foreground rounded px-1 py-0.5"
              [class]="last ? 'text-foreground font-medium' : 'text-muted-foreground'"
              [attr.aria-current]="last ? 'page' : null"
              (click)="goTo(item.id)"
            >
              {{ item.name }}
            </button>
          }
        </nav>

        <div class="relative -mx-1 min-h-48 flex-1 overflow-y-auto px-1">
          @if (!listing.search() && listing.folders().length) {
            <ul class="mb-4 flex flex-wrap gap-2" [attr.aria-label]="t('media.folders')">
              @for (item of listing.folders(); track item.id) {
                <li>
                  <button
                    hlmBtn
                    variant="outline"
                    size="sm"
                    type="button"
                    class="hover:border-primary/40"
                    (click)="goTo(item.id)"
                  >
                    <ng-icon name="lucideFolder" class="text-primary" /> {{ item.name }}
                  </button>
                </li>
              }
            </ul>
          }

          @if (listing.loading() || listing.files().length) {
            <vd-media-files
              mode="pick"
              [files]="listing.files()"
              [loading]="listing.loading()"
              [selection]="chosenIds()"
              [locked]="selected()"
              [multiple]="multiple()"
              (picked)="toggle($event)"
            />
          } @else {
            <div hlmEmpty class="py-10">
              <div hlmEmptyHeader>
                <div hlmEmptyMedia variant="icon">
                  <ng-icon [name]="listing.filtered() ? 'lucideSearch' : 'lucideFolderOpen'" />
                </div>
                <h3 hlmEmptyTitle>
                  {{ listing.filtered() ? t('media.empty.noMatches') : t('media.empty.folder') }}
                </h3>
                <p hlmEmptyDescription>
                  {{
                    listing.filtered()
                      ? t('media.empty.noMatchesHint')
                      : canUpload()
                        ? t('media.picker.emptyHint')
                        : t('media.empty.folderReadOnly')
                  }}
                </p>
              </div>
            </div>
          }

          @if (dragging()) {
            <div
              class="bg-background/85 border-primary text-primary pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed"
            >
              <ng-icon name="lucideUpload" size="32" />
              <span class="text-sm font-medium">{{ t('media.upload.drop') }}</span>
            </div>
          }
        </div>

        <vd-upload-panel [queue]="queue" />

        <hlm-dialog-footer class="items-center">
          @if (listing.pageCount() > 1) {
            <vd-pagination
              class="me-auto"
              [compact]="true"
              [(page)]="listing.page"
              [pageCount]="listing.pageCount()"
            />
          }
          <button hlmBtn variant="outline" type="button" (click)="ctx.close()">
            {{ t('common.cancel') }}
          </button>
          @if (multiple()) {
            <button hlmBtn type="button" [disabled]="!chosen().size" (click)="confirm()">
              {{ t('media.picker.add', { count: chosen().size }) }}
            </button>
          }
        </hlm-dialog-footer>
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class MediaPicker {
  private readonly media = inject(Media);
  private readonly auth = inject(Auth);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  readonly open = input(false);
  readonly multiple = input(false);
  /** Kinds the field accepts; empty accepts any. */
  readonly allowedTypes = input<MediaKind[]>([]);
  /** Ids already in the field: shown checked, not picked again. */
  readonly selected = input<number[]>([]);
  readonly picked = output<MediaFile[]>();
  readonly closed = output<void>();

  protected readonly queue = new UploadQueue(this.media);

  protected readonly folder = signal<number | null>(null);
  protected readonly listing = new MediaListing({
    folder: this.folder,
    pageSize: PAGE_SIZE,
    kinds: () => this.allowedTypes(),
    failed: (message) => toast.error(message),
  });
  protected readonly allFolders = signal<MediaFolder[]>([]);
  protected readonly dragging = signal(false);
  /** Files checked in this session, in pick order. */
  protected readonly chosen = signal<Map<number, MediaFile>>(new Map());
  protected readonly chosenIds = computed(() => new Set(this.chosen().keys()));

  protected readonly canUpload = computed(() => this.auth.can('media.create'));
  protected readonly kinds = computed(() =>
    this.allowedTypes().length ? this.allowedTypes() : MEDIA_KINDS,
  );
  protected readonly allowedLabel = computed(() =>
    this.allowedTypes()
      .map((kind) => this.t(KIND_LABELS[kind]).toLowerCase())
      .join(', '),
  );
  protected readonly accept = computed(() => {
    const patterns: Record<MediaKind, string> = {
      images: 'image/*',
      videos: 'video/*',
      audios: 'audio/*',
      files: '',
    };
    const allowed = this.allowedTypes();
    if (!allowed.length || allowed.includes('files')) return null;
    return allowed.map((kind) => patterns[kind]).join(',');
  });
  protected readonly trail = computed(() => {
    const id = this.folder();
    const all = this.allFolders();
    const current = all.find((item) => item.id === id);
    return current ? folderChain(current, all) : [];
  });

  private dragDepth = 0;

  constructor() {
    // Each opening starts afresh at the root.
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.folder.set(null);
        this.listing.reset();
        this.chosen.set(new Map());
        this.queue.clearFinished();
        this.media
          .allFolders()
          .then((folders) => this.allFolders.set(folders))
          .catch(() => undefined);
      });
    });
    this.listing.watch(() => this.open());
  }

  protected goTo(folder: number | null): void {
    this.folder.set(folder);
    this.listing.page.set(1);
    this.listing.clearSearch();
  }

  protected toggle(file: MediaFile): void {
    if (this.selected().includes(file.id)) return;
    if (!this.multiple()) {
      this.picked.emit([file]);
      return;
    }
    this.chosen.update((chosen) => {
      const next = new Map(chosen);
      if (next.has(file.id)) next.delete(file.id);
      else next.set(file.id, file);
      return next;
    });
  }

  protected confirm(): void {
    this.picked.emit([...this.chosen().values()]);
  }

  protected onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    void this.upload(files);
  }

  private isFileDrag(event: DragEvent): boolean {
    return !!event.dataTransfer?.types.includes('Files') && this.canUpload();
  }

  protected dragEnter(event: DragEvent): void {
    if (!this.isFileDrag(event)) return;
    event.preventDefault();
    this.dragDepth++;
    this.dragging.set(true);
  }

  protected dragOver(event: DragEvent): void {
    if (!this.isFileDrag(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  protected dragLeave(): void {
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (!this.dragDepth) this.dragging.set(false);
  }

  protected drop(event: DragEvent): void {
    if (!this.isFileDrag(event)) return;
    event.preventDefault();
    this.dragDepth = 0;
    this.dragging.set(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    void this.upload(this.multiple() ? files : files.slice(0, 1));
  }

  private async upload(files: File[]): Promise<void> {
    if (!files.length) return;
    const allowed = this.allowedTypes();
    const accepted = allowed.length
      ? files.filter((file) => allowed.includes(mediaKind(file.type)))
      : files;
    const rejected = files.length - accepted.length;
    if (rejected) {
      toast.error(this.t('media.picker.rejected', { count: rejected }), {
        description: this.t('media.picker.allowed', { types: this.allowedLabel() }),
      });
    }
    if (!accepted.length) return;
    const result = await this.queue.add(accepted, { folder: this.folder() });
    if (result.failed) toast.error(this.t('media.upload.failed', { count: result.failed }));
    if (!result.uploaded.length) return;
    toast.success(this.t('media.upload.done', { count: result.uploaded.length }));
    if (!this.multiple()) {
      this.picked.emit([result.uploaded[0]]);
      return;
    }
    this.chosen.update((chosen) => {
      const next = new Map(chosen);
      for (const file of result.uploaded) next.set(file.id, file);
      return next;
    });
    void this.listing.reload();
  }
}
