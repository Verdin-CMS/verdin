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
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';

import { ApiFailure } from '../../core/api';
import { Auth } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import { Media, mediaKind } from '../../core/media';
import { MediaFile, MediaFolder, MediaKind, PageMeta } from '../../core/types';
import { KIND_LABELS, MEDIA_KINDS, dimensions, folderChain, formatSize } from './media-format';
import { MediaThumb } from './media-thumb';
import { UploadPanel, UploadQueue } from './upload-panel';

const PAGE_SIZE = 24;

/** Chooses files from the media library (or uploads new ones) for a media field. */
@Component({
  selector: 'vd-media-picker',
  imports: [
    NgIcon,
    HlmDialogImports,
    HlmButtonImports,
    HlmBadgeImports,
    HlmEmptyImports,
    HlmInputGroupImports,
    HlmNativeSelectImports,
    HlmSkeletonImports,
    MediaThumb,
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

        <div class="flex flex-wrap items-center gap-2">
          <div hlmInputGroup class="w-full sm:max-w-60">
            <div hlmInputGroupAddon><ng-icon name="lucideSearch" /></div>
            <input
              hlmInputGroupInput
              type="search"
              [attr.aria-label]="t('media.search')"
              [placeholder]="t('media.search')"
              [value]="searchText()"
              (input)="setSearch($any($event.target).value)"
            />
          </div>
          @if (kinds().length > 1) {
            <hlm-native-select
              class="w-40"
              size="sm"
              [attr.aria-label]="t('media.filter.type')"
              [value]="kind()"
              (valueChange)="kind.set($any($event) ?? ''); page.set(1)"
            >
              <option hlmNativeSelectOption value="">{{ t('media.filter.all') }}</option>
              @for (option of kinds(); track option) {
                <option hlmNativeSelectOption [value]="option">{{ t(kindLabels[option]) }}</option>
              }
            </hlm-native-select>
          }
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
        </div>

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
            <ng-icon name="lucideChevronRight" size="14" class="text-muted-foreground" />
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
          @if (!search() && folders().length) {
            <ul class="mb-4 flex flex-wrap gap-2" [attr.aria-label]="t('media.folders')">
              @for (item of folders(); track item.id) {
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

          @if (loading()) {
            <div class="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
              @for (tile of skeletons; track tile) {
                <hlm-skeleton class="aspect-square rounded-xl" />
              }
            </div>
          } @else if (files().length) {
            <ul
              class="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6"
              [attr.aria-label]="t('media.files')"
            >
              @for (file of files(); track file.id) {
                @let already = selected().includes(file.id);
                @let checked = already || chosen().has(file.id);
                <li class="flex min-w-0 flex-col gap-1">
                  <button
                    type="button"
                    class="bg-card hover:border-primary/40 focus-visible:ring-ring/50 relative aspect-square overflow-hidden rounded-xl border transition-colors outline-none focus-visible:ring-3 disabled:cursor-not-allowed"
                    [class.border-primary]="checked"
                    [class.ring-2]="checked"
                    [class.ring-primary/30]="checked"
                    [disabled]="already"
                    [attr.aria-pressed]="multiple() ? checked : null"
                    [attr.aria-label]="
                      (already ? t('media.picker.alreadyAdded', { name: file.name }) : file.name) +
                      ' · ' +
                      describe(file)
                    "
                    (click)="toggle(file)"
                  >
                    <vd-media-thumb [file]="file" iconSize="28" />
                    @if (multiple() || already) {
                      <span
                        class="absolute start-1.5 top-1.5 flex size-5 items-center justify-center rounded-md border shadow-xs"
                        [class]="
                          checked
                            ? 'bg-primary border-primary text-primary-foreground'
                            : 'bg-background/90'
                        "
                        aria-hidden="true"
                      >
                        @if (checked) {
                          <ng-icon name="lucideCheck" size="14" />
                        }
                      </span>
                    }
                  </button>
                  <span class="truncate px-0.5 text-xs" [title]="file.name">{{ file.name }}</span>
                </li>
              }
            </ul>
          } @else {
            <div hlmEmpty class="py-10">
              <div hlmEmptyHeader>
                <div hlmEmptyMedia variant="icon">
                  <ng-icon [name]="search() || kind() ? 'lucideSearch' : 'lucideFolderOpen'" />
                </div>
                <h3 hlmEmptyTitle>
                  {{ search() || kind() ? t('media.empty.noMatches') : t('media.empty.folder') }}
                </h3>
                <p hlmEmptyDescription>
                  {{
                    search() || kind()
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
          @if (pageCount() > 1) {
            <div class="me-auto flex items-center gap-2">
              <button
                hlmBtn
                variant="outline"
                size="icon-sm"
                type="button"
                [attr.aria-label]="t('common.previous')"
                [disabled]="page() <= 1"
                (click)="page.set(page() - 1)"
              >
                <ng-icon name="lucideArrowLeft" />
              </button>
              <span class="text-muted-foreground text-sm tabular-nums">
                {{ t('common.page', { page: page(), count: pageCount() }) }}
              </span>
              <button
                hlmBtn
                variant="outline"
                size="icon-sm"
                type="button"
                [attr.aria-label]="t('common.next')"
                [disabled]="page() >= pageCount()"
                (click)="page.set(page() + 1)"
              >
                <ng-icon name="lucideChevronRight" />
              </button>
            </div>
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
  protected readonly kindLabels = KIND_LABELS;
  protected readonly skeletons = Array.from({ length: 12 }, (_, index) => index);

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
  protected readonly searchText = signal('');
  protected readonly search = signal('');
  protected readonly kind = signal<MediaKind | ''>('');
  protected readonly page = signal(1);
  protected readonly files = signal<MediaFile[]>([]);
  protected readonly folders = signal<MediaFolder[]>([]);
  protected readonly allFolders = signal<MediaFolder[]>([]);
  protected readonly meta = signal<PageMeta>({});
  protected readonly loading = signal(false);
  protected readonly dragging = signal(false);
  /** Files checked in this session, in pick order. */
  protected readonly chosen = signal<Map<number, MediaFile>>(new Map());

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
  protected readonly pageCount = computed(() => this.meta().pageCount ?? 1);
  protected readonly trail = computed(() => {
    const id = this.folder();
    const all = this.allFolders();
    const current = all.find((item) => item.id === id);
    return current ? folderChain(current, all) : [];
  });

  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private dragDepth = 0;
  private requestId = 0;

  constructor() {
    // Each opening starts afresh at the root.
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.folder.set(null);
        this.searchText.set('');
        this.search.set('');
        this.kind.set('');
        this.page.set(1);
        this.chosen.set(new Map());
        this.queue.clearFinished();
        this.media
          .allFolders()
          .then((folders) => this.allFolders.set(folders))
          .catch(() => undefined);
      });
    });
    effect(() => {
      if (!this.open()) return;
      const request = {
        folder: this.folder(),
        search: this.search(),
        kind: this.kind(),
        page: this.page(),
      };
      untracked(() => void this.load(request));
    });
  }

  private async load(request: {
    folder: number | null;
    search: string;
    kind: MediaKind | '';
    page: number;
  }): Promise<void> {
    const id = ++this.requestId;
    this.loading.set(true);
    try {
      const [files, folders] = await Promise.all([
        this.media.list({
          folder: request.folder ?? 'root',
          search: request.search || undefined,
          types: request.kind ? [request.kind] : this.allowedTypes(),
          sort: 'createdAtDesc',
          page: request.page,
          pageSize: PAGE_SIZE,
        }),
        this.media.folders(request.folder ?? 'root'),
      ]);
      if (id !== this.requestId) return;
      this.files.set(files.data);
      this.meta.set(files.meta.pagination ?? {});
      this.folders.set(folders);
    } catch (error) {
      if (id !== this.requestId) return;
      toast.error(ApiFailure.from(error).message);
      this.files.set([]);
      this.folders.set([]);
    } finally {
      if (id === this.requestId) this.loading.set(false);
    }
  }

  protected describe(file: MediaFile): string {
    return [formatSize(this.i18n, file.size), dimensions(file)].filter(Boolean).join(' · ');
  }

  protected goTo(folder: number | null): void {
    this.folder.set(folder);
    this.page.set(1);
    this.searchText.set('');
    this.search.set('');
  }

  protected setSearch(value: string): void {
    this.searchText.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.search.set(value.trim());
      this.page.set(1);
    }, 250);
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
    void this.load({
      folder: this.folder(),
      search: this.search(),
      kind: this.kind(),
      page: this.page(),
    });
  }
}
