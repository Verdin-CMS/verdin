import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmBreadcrumbImports } from '@spartan-ng/helm/breadcrumb';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';

import { ApiFailure } from '../../core/api';
import { Auth } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import { Media } from '../../core/media';
import { MediaFile, MediaFolder } from '../../core/types';
import { UsageProbe, Usages } from '../../core/usage';
import { PageHeader } from '../../shared/components/page-header';
import { Pagination } from '../../shared/components/pagination';
import { UsageWarning } from '../../shared/components/usage';
import { FolderDialogRequest, MediaFolderDialog } from './folder-dialog';
import { MediaFileSheet } from './file-sheet';
import { MediaFromUrlDialog } from './from-url-dialog';
import { MediaFiles, MediaToggle, MediaView } from './media-files';
import { MediaFilters } from './media-filters';
import { MediaFolders, folderSummary } from './media-folders';
import { canTouch, folderChain } from './media-format';
import { MediaListing } from './media-listing';
import { UploadPanel, UploadQueue } from './upload-panel';

const PAGE_SIZE = 30;
const VIEW_KEY = 'verdin.media.view';

function readView(): MediaView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

/** The media library: folders, files, uploads and bulk actions. */
@Component({
  selector: 'vd-media-library',
  imports: [
    NgIcon,
    PageHeader,
    Pagination,
    UsageWarning,
    MediaFileSheet,
    MediaFiles,
    MediaFilters,
    MediaFolders,
    MediaFolderDialog,
    MediaFromUrlDialog,
    UploadPanel,
    HlmAlertImports,
    HlmAlertDialogImports,
    HlmBreadcrumbImports,
    HlmButtonImports,
    HlmCheckboxImports,
    HlmEmptyImports,
    HlmToggleGroupImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:dragenter)': 'dragEnter($event)',
    '(window:dragover)': 'dragOver($event)',
    '(window:dragleave)': 'dragLeave()',
    '(window:drop)': 'drop($event)',
  },
  template: `
    <div class="flex flex-col gap-6">
      <vd-page-header [title]="t('media.title')" [description]="t('media.subtitle')">
        <div actions class="flex flex-wrap items-center gap-2">
          @if (canCreate()) {
            <button
              hlmBtn
              variant="outline"
              (click)="folderDialog.set({ mode: 'create', name: '' })"
            >
              <ng-icon name="lucideFolderPlus" /> {{ t('media.folder.new') }}
            </button>
            <button hlmBtn variant="outline" (click)="fromUrlOpen.set(true)">
              <ng-icon name="lucideLink" /> {{ t('media.fromUrl.button') }}
            </button>
            <button hlmBtn (click)="fileInput.click()">
              <ng-icon name="lucideUpload" /> {{ t('media.upload.button') }}
            </button>
          }
        </div>
      </vd-page-header>
      <input
        #fileInput
        type="file"
        multiple
        class="hidden"
        tabindex="-1"
        aria-hidden="true"
        (change)="onPick($event)"
      />

      <nav hlmBreadcrumb [attr.aria-label]="t('media.breadcrumb')">
        <ol hlmBreadcrumbList>
          <li hlmBreadcrumbItem>
            @if (trail().length) {
              <a hlmBreadcrumbLink link="/media" class="inline-flex items-center gap-1">
                <ng-icon name="lucideHouse" size="14" /> {{ t('media.root') }}
              </a>
            } @else {
              <span hlmBreadcrumbPage class="inline-flex items-center gap-1">
                <ng-icon name="lucideHouse" size="14" /> {{ t('media.root') }}
              </span>
            }
          </li>
          @for (item of trail(); track item.id; let last = $last) {
            <li hlmBreadcrumbSeparator></li>
            <li hlmBreadcrumbItem>
              @if (last) {
                <span hlmBreadcrumbPage>{{ item.name }}</span>
              } @else {
                <a hlmBreadcrumbLink link="/media" [queryParams]="{ folder: item.id }">{{
                  item.name
                }}</a>
              }
            </li>
          }
        </ol>
      </nav>

      @if (listing.error()) {
        <div hlmAlert variant="destructive">
          <ng-icon name="lucideCircleAlert" />
          <p hlmAlertTitle>{{ listing.error() }}</p>
        </div>
      }

      <vd-media-filters class="gap-3" [listing]="listing" [sortable]="true">
        <hlm-toggle-group
          type="single"
          variant="outline"
          class="ms-auto"
          [value]="view()"
          (valueChange)="setView($any($event))"
        >
          <button hlmToggleGroupItem value="grid" [aria-label]="t('media.view.grid')">
            <ng-icon name="lucideLayoutGrid" />
          </button>
          <button hlmToggleGroupItem value="list" [aria-label]="t('media.view.list')">
            <ng-icon name="lucideList" />
          </button>
        </hlm-toggle-group>
      </vd-media-filters>

      @if (selection().size) {
        <div
          class="bg-card sticky top-16 z-10 flex flex-wrap items-center gap-2 rounded-xl border px-4 py-2 shadow-xs"
          role="region"
          [attr.aria-label]="t('media.selection.label')"
        >
          <span class="text-sm font-medium" aria-live="polite">
            {{ t('media.selection.count', { count: selection().size }) }}
          </span>
          <button hlmBtn variant="ghost" size="sm" (click)="clearSelection()">
            {{ t('media.selection.clear') }}
          </button>
          <span class="ms-auto"></span>
          @if (movableIds().length) {
            <button hlmBtn variant="outline" size="sm" (click)="openMoveFiles()">
              <ng-icon name="lucideFolderInput" />
              {{ t('media.selection.move', { count: movableIds().length }) }}
            </button>
          }
          @if (deletableIds().length) {
            <button hlmBtn variant="destructive" size="sm" (click)="requestBulkDelete()">
              <ng-icon name="lucideTrash2" />
              {{ t('media.selection.delete', { count: deletableIds().length }) }}
            </button>
          }
        </div>
      }

      @if (showFolders() && listing.folders().length) {
        <vd-media-folders
          [folders]="listing.folders()"
          [canManage]="canManageFolders()"
          [canDelete]="canDeleteFolders()"
          (opened)="openFolder($event)"
          (renamed)="folderDialog.set({ mode: 'rename', folder: $event, name: $event.name })"
          (moved)="folderDialog.set({ mode: 'move', folder: $event, target: $event.parent })"
          (deleted)="deletingFolder.set($event)"
        />
      }

      <section class="flex flex-col gap-3" [attr.aria-label]="t('media.files')">
        @if (
          showFolders() && listing.folders().length && (listing.files().length || listing.loading())
        ) {
          <div class="flex items-center gap-3">
            <h2 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {{ t('media.files') }}
            </h2>
          </div>
        }
        @if (listing.files().length && selectable() && !listing.loading()) {
          <label class="text-muted-foreground flex w-fit items-center gap-2 text-sm">
            <hlm-checkbox
              [checked]="allSelected()"
              [indeterminate]="someSelected()"
              (checkedChange)="selectAll($event)"
            />
            {{ t('media.selection.all') }}
          </label>
        }

        @if (listing.loading() || listing.files().length) {
          <vd-media-files
            [files]="listing.files()"
            [loading]="listing.loading()"
            [view]="view()"
            [selection]="selection()"
            [canSelect]="canSelect"
            (opened)="openedFile.set($event)"
            (toggled)="toggleSelection($event)"
          />
        } @else if (listing.filtered() || !listing.folders().length || !showFolders()) {
          <div hlmEmpty class="rounded-xl border border-dashed py-16">
            <div hlmEmptyHeader>
              <div hlmEmptyMedia variant="icon">
                <ng-icon [name]="listing.filtered() ? 'lucideSearch' : 'lucideFolderOpen'" />
              </div>
              <h2 hlmEmptyTitle>
                {{ listing.filtered() ? t('media.empty.noMatches') : t('media.empty.folder') }}
              </h2>
              <p hlmEmptyDescription>
                {{
                  listing.filtered()
                    ? listing.search()
                      ? t('media.empty.noMatchesSearch', { search: listing.search() })
                      : t('media.empty.noMatchesHint')
                    : canCreate()
                      ? t('media.empty.folderHint')
                      : t('media.empty.folderReadOnly')
                }}
              </p>
            </div>
            @if (!listing.filtered() && canCreate()) {
              <div hlmEmptyContent>
                <button hlmBtn variant="outline" size="sm" (click)="fileInput.click()">
                  <ng-icon name="lucideUpload" /> {{ t('media.upload.button') }}
                </button>
              </div>
            }
          </div>
        }

        @if (listing.pageCount() > 1) {
          <vd-pagination
            [(page)]="listing.page"
            [pageCount]="listing.pageCount()"
            [summary]="t('media.total', { count: listing.total() })"
          />
        } @else if (listing.total()) {
          <p class="text-muted-foreground text-sm tabular-nums">
            {{ t('media.total', { count: listing.total() }) }}
          </p>
        }
      </section>
    </div>

    @if (dragging()) {
      <div
        class="bg-background/80 pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-6 backdrop-blur-sm"
      >
        <div
          class="border-primary text-primary bg-card flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-16 py-12 shadow-lg"
        >
          <ng-icon name="lucideUpload" size="40" />
          <p class="text-lg font-medium">{{ t('media.upload.drop') }}</p>
          <p class="text-muted-foreground text-sm">
            {{ t('media.upload.dropTarget', { folder: currentName() }) }}
          </p>
        </div>
      </div>
    }

    <vd-upload-panel [queue]="queue" [floating]="true" />

    <vd-media-from-url-dialog
      [open]="fromUrlOpen()"
      [folder]="folderId()"
      [folderName]="currentName()"
      (added)="listing.reload()"
      (closed)="fromUrlOpen.set(false)"
    />

    <vd-media-file-sheet
      [file]="openedFile()"
      [folders]="allFolders()"
      (saved)="fileSaved($event)"
      (deleted)="fileDeleted($event)"
      (closed)="openedFile.set(null)"
    />

    <vd-media-folder-dialog
      [request]="folderDialog()"
      [folders]="allFolders()"
      [parent]="folderId()"
      (done)="folderSaved($event)"
      (closed)="folderDialog.set(null)"
    />

    <hlm-alert-dialog
      [state]="deletingFolder() ? 'open' : 'closed'"
      (closed)="deletingFolder.set(null)"
    >
      <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
        <hlm-alert-dialog-header>
          <h2 hlmAlertDialogTitle>
            {{ t('media.folder.deleteTitle', { name: deletingFolder()?.name ?? '' }) }}
          </h2>
          <p hlmAlertDialogDescription>{{ folderDeleteHint() }}</p>
        </hlm-alert-dialog-header>
        <hlm-alert-dialog-footer>
          <button hlmAlertDialogCancel (click)="ctx.close()">{{ t('common.cancel') }}</button>
          <button hlmAlertDialogAction variant="destructive" (click)="deleteFolder(); ctx.close()">
            {{ t('common.delete') }}
          </button>
        </hlm-alert-dialog-footer>
      </hlm-alert-dialog-content>
    </hlm-alert-dialog>

    <hlm-alert-dialog
      [state]="confirmBulkDelete() ? 'open' : 'closed'"
      (closed)="confirmBulkDelete.set(false)"
    >
      <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
        <hlm-alert-dialog-header>
          <h2 hlmAlertDialogTitle>
            {{ t('media.selection.deleteTitle', { count: deletableIds().length }) }}
          </h2>
          <p hlmAlertDialogDescription>{{ t('media.selection.deleteHint') }}</p>
        </hlm-alert-dialog-header>
        <vd-usage-warning [state]="deleteUsage.state()" />
        <hlm-alert-dialog-footer>
          <button hlmAlertDialogCancel (click)="ctx.close()">{{ t('common.cancel') }}</button>
          <button
            hlmAlertDialogAction
            variant="destructive"
            (click)="deleteSelected(); ctx.close()"
          >
            {{ t('common.delete') }}
          </button>
        </hlm-alert-dialog-footer>
      </hlm-alert-dialog-content>
    </hlm-alert-dialog>
  `,
})
export class MediaLibraryPage {
  private readonly media = inject(Media);
  private readonly router = inject(Router);
  protected readonly auth = inject(Auth);
  protected readonly t = inject(I18n).t;

  /** `?folder=<id>`; the root when absent. */
  readonly folder = input<string>();

  protected readonly queue = new UploadQueue(this.media);

  protected readonly folderId = computed(() => {
    const id = Number(this.folder());
    return this.folder() && Number.isInteger(id) ? id : null;
  });
  protected readonly listing = new MediaListing({
    folder: this.folderId,
    pageSize: PAGE_SIZE,
    // A selection only keeps the files still shown.
    loaded: (files) => {
      const visible = new Set(files.map((file) => file.id));
      this.selection.update((selection) => new Set([...selection].filter((id) => visible.has(id))));
    },
  });
  protected readonly view = signal<MediaView>(readView());
  protected readonly allFolders = signal<MediaFolder[]>([]);
  protected readonly dragging = signal(false);

  /** Selected file ids; a new folder starts with none. */
  protected readonly selection = linkedSignal<number | null, ReadonlySet<number>>({
    source: this.folderId,
    computation: () => new Set(),
  });
  protected readonly openedFile = signal<MediaFile | null>(null);
  protected readonly folderDialog = signal<FolderDialogRequest | null>(null);
  protected readonly fromUrlOpen = signal(false);
  protected readonly deletingFolder = signal<MediaFolder | null>(null);
  protected readonly confirmBulkDelete = signal(false);
  private readonly usages = inject(Usages);
  /** Where the files about to be deleted are used. */
  protected readonly deleteUsage = new UsageProbe();

  protected readonly canCreate = computed(() => this.auth.can('media.create'));
  protected readonly canManageFolders = computed(
    () => this.auth.mediaGrant('media.update') === 'all',
  );
  protected readonly canDeleteFolders = computed(
    () => this.auth.mediaGrant('media.delete') === 'all',
  );
  protected readonly selectable = computed(
    () =>
      this.auth.mediaGrant('media.update') !== 'none' ||
      this.auth.mediaGrant('media.delete') !== 'none',
  );

  /** Folders are listed on the first page of an unsearched folder. */
  protected readonly showFolders = computed(
    () => !this.listing.search() && this.listing.page() === 1,
  );

  protected readonly currentFolder = computed(
    () => this.allFolders().find((folder) => folder.id === this.folderId()) ?? null,
  );
  protected readonly trail = computed(() => {
    const current = this.currentFolder();
    return current ? folderChain(current, this.allFolders()) : [];
  });
  protected readonly currentName = computed(
    () => this.currentFolder()?.name ?? this.t('media.root'),
  );

  private readonly selectedFiles = computed(() =>
    this.listing.files().filter((file) => this.selection().has(file.id)),
  );
  protected readonly movableIds = computed(() =>
    this.selectedFiles()
      .filter((file) => canTouch(this.auth, 'media.update', file))
      .map((file) => file.id),
  );
  protected readonly deletableIds = computed(() =>
    this.selectedFiles()
      .filter((file) => canTouch(this.auth, 'media.delete', file))
      .map((file) => file.id),
  );
  private readonly selectableFiles = computed(() =>
    this.listing.files().filter((file) => this.canSelect(file)),
  );
  protected readonly allSelected = computed(
    () =>
      this.selectableFiles().length > 0 &&
      this.selectableFiles().every((file) => this.selection().has(file.id)),
  );
  protected readonly someSelected = computed(
    () =>
      !this.allSelected() && this.selectableFiles().some((file) => this.selection().has(file.id)),
  );
  protected readonly folderDeleteHint = computed(() => {
    const folder = this.deletingFolder();
    if (!folder) return '';
    return folder.childrenCount || folder.filesCount
      ? this.t('media.folder.deleteHintContents', { summary: folderSummary(this.t, folder) })
      : this.t('media.folder.deleteHint');
  });

  private dragDepth = 0;

  constructor() {
    this.listing.watch();
    void this.loadAllFolders();
  }

  private async loadAllFolders(): Promise<void> {
    try {
      this.allFolders.set(await this.media.allFolders());
    } catch {
      // Names in the breadcrumb and pickers are a nicety; the listing still works.
    }
  }

  protected setView(view: MediaView | null | undefined): void {
    if (!view) return;
    this.view.set(view);
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // Storage may be unavailable (private mode); the choice then lasts for this visit.
    }
  }

  // Navigation

  protected openFolder(folder: MediaFolder): void {
    void this.router.navigate(['/media'], { queryParams: { folder: folder.id } });
  }

  protected fileSaved(file: MediaFile): void {
    this.openedFile.set(file);
    if ((file.folder ?? null) !== this.folderId()) {
      void this.listing.reload();
      void this.loadAllFolders();
    } else {
      this.listing.files.update((files) =>
        files.map((item) => (item.id === file.id ? file : item)),
      );
    }
  }

  protected fileDeleted(id: number): void {
    this.openedFile.set(null);
    this.listing.files.update((files) => files.filter((file) => file.id !== id));
    void this.listing.reload();
  }

  // Selection

  protected readonly canSelect = (file: MediaFile): boolean =>
    canTouch(this.auth, 'media.update', file) || canTouch(this.auth, 'media.delete', file);

  protected toggleSelection({ file, checked }: MediaToggle): void {
    this.selection.update((selection) => {
      const next = new Set(selection);
      if (checked) next.add(file.id);
      else next.delete(file.id);
      return next;
    });
  }

  protected selectAll(checked: boolean): void {
    this.selection.set(
      checked ? new Set(this.selectableFiles().map((file) => file.id)) : new Set(),
    );
  }

  protected clearSelection(): void {
    this.selection.set(new Set());
  }

  protected requestBulkDelete(): void {
    const ids = this.deletableIds();
    if (!ids.length) return;
    this.confirmBulkDelete.set(true);
    void this.deleteUsage.start(() => this.usages.many(ids, (id) => this.usages.forFile(id)));
  }

  protected async deleteSelected(): Promise<void> {
    const ids = this.deletableIds();
    if (!ids.length) return;
    const results = await Promise.allSettled(ids.map((id) => this.media.delete(id)));
    const failed = results.filter((result) => result.status === 'rejected').length;
    const done = ids.length - failed;
    if (done) toast.success(this.t('media.selection.deleted', { count: done }));
    if (failed) toast.error(this.t('media.selection.deleteFailed', { count: failed }));
    this.clearSelection();
    await this.listing.reload();
  }

  // Folders

  protected openMoveFiles(): void {
    this.folderDialog.set({ mode: 'moveFiles', ids: this.movableIds(), target: this.folderId() });
  }

  protected async folderSaved(request: FolderDialogRequest): Promise<void> {
    if (request.mode === 'moveFiles') this.clearSelection();
    this.folderDialog.set(null);
    await Promise.all([this.listing.reload(), this.loadAllFolders()]);
  }

  protected async deleteFolder(): Promise<void> {
    const folder = this.deletingFolder();
    if (!folder) return;
    try {
      await this.media.deleteFolder(folder.id);
      toast.success(this.t('media.folder.deleted', { name: folder.name }));
      await Promise.all([this.listing.reload(), this.loadAllFolders()]);
    } catch (error) {
      toast.error(this.t('media.folder.deleteFailed'), {
        description: ApiFailure.from(error).message,
      });
    }
  }

  // Uploads

  protected onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    void this.upload(files);
  }

  private async upload(files: File[]): Promise<void> {
    if (!files.length || !this.canCreate()) return;
    const result = await this.queue.add(files, { folder: this.folderId() });
    if (result.uploaded.length)
      toast.success(this.t('media.upload.done', { count: result.uploaded.length }));
    if (result.failed) toast.error(this.t('media.upload.failed', { count: result.failed }));
    await this.listing.reload();
  }

  /** Whether a drag carries files and the page may take them (no dialog in the way). */
  private acceptsDrag(event: DragEvent): boolean {
    return (
      this.canCreate() &&
      !!event.dataTransfer?.types.includes('Files') &&
      !this.folderDialog() &&
      !this.fromUrlOpen() &&
      !this.openedFile()
    );
  }

  protected dragEnter(event: DragEvent): void {
    if (!this.acceptsDrag(event)) return;
    event.preventDefault();
    this.dragDepth++;
    this.dragging.set(true);
  }

  protected dragOver(event: DragEvent): void {
    if (!this.acceptsDrag(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  protected dragLeave(): void {
    if (!this.dragging()) return;
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (!this.dragDepth) this.dragging.set(false);
  }

  protected drop(event: DragEvent): void {
    if (!this.acceptsDrag(event)) return;
    event.preventDefault();
    this.dragDepth = 0;
    this.dragging.set(false);
    void this.upload(Array.from(event.dataTransfer?.files ?? []));
  }
}
