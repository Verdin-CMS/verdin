import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { NgIcon } from '@ng-icons/core';
import { toast } from '@spartan-ng/brain/sonner';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmBreadcrumbImports } from '@spartan-ng/helm/breadcrumb';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmDialogImports } from '@spartan-ng/helm/dialog';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmTableImports } from '@spartan-ng/helm/table';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';

import { ApiFailure } from '../../core/api';
import { Auth } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/keys';
import { Media, MediaSort } from '../../core/media';
import { MediaFile, MediaFolder, MediaKind, PageMeta } from '../../core/types';
import { PageHeader } from '../../shared/components/page-header';
import { MediaFileSheet } from './file-sheet';
import {
  KIND_LABELS,
  MEDIA_KINDS,
  canTouch,
  dimensions,
  extension,
  fileKind,
  folderChain,
  folderOptions,
  formatSize,
  isWithin,
} from './media-format';
import { MediaThumb } from './media-thumb';
import { UploadPanel, UploadQueue } from './upload-panel';

const PAGE_SIZE = 30;
const VIEW_KEY = 'verdin.media.view';

type View = 'grid' | 'list';

const SORTS: { value: MediaSort; label: MessageKey }[] = [
  { value: 'createdAtDesc', label: 'media.sort.createdAtDesc' },
  { value: 'createdAtAsc', label: 'media.sort.createdAtAsc' },
  { value: 'updatedAtDesc', label: 'media.sort.updatedAtDesc' },
  { value: 'nameAsc', label: 'media.sort.nameAsc' },
  { value: 'nameDesc', label: 'media.sort.nameDesc' },
  { value: 'sizeDesc', label: 'media.sort.sizeDesc' },
];

/** The folder dialog: create/rename a folder, or move a folder or the selected files. */
type FolderDialog =
  | { mode: 'create'; name: string }
  | { mode: 'rename'; folder: MediaFolder; name: string }
  | { mode: 'move'; folder: MediaFolder; target: number | null }
  | { mode: 'moveFiles'; ids: number[]; target: number | null };

function readView(): View {
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
    HlmAlertImports,
    HlmAlertDialogImports,
    HlmBadgeImports,
    HlmBreadcrumbImports,
    HlmButtonImports,
    HlmCheckboxImports,
    HlmDialogImports,
    HlmDropdownMenuImports,
    HlmEmptyImports,
    HlmFieldImports,
    HlmInputImports,
    HlmInputGroupImports,
    HlmNativeSelectImports,
    HlmSkeletonImports,
    HlmTableImports,
    HlmToggleGroupImports,
    MediaThumb,
    MediaFileSheet,
    UploadPanel,
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
            <button hlmBtn variant="outline" (click)="openCreateFolder()">
              <ng-icon name="lucideFolderPlus" /> {{ t('media.folder.new') }}
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

      @if (error()) {
        <div hlmAlert variant="destructive">
          <ng-icon name="lucideCircleAlert" />
          <p hlmAlertTitle>{{ error() }}</p>
        </div>
      }

      <div class="flex flex-wrap items-center gap-3">
        <div hlmInputGroup class="w-full sm:max-w-xs">
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
        <hlm-native-select
          class="w-40"
          [attr.aria-label]="t('media.filter.type')"
          [value]="kind()"
          (valueChange)="setKind($any($event) ?? '')"
        >
          <option hlmNativeSelectOption value="">{{ t('media.filter.all') }}</option>
          @for (option of kinds; track option) {
            <option hlmNativeSelectOption [value]="option">{{ t(kindLabels[option]) }}</option>
          }
        </hlm-native-select>
        <hlm-native-select
          class="w-48"
          [attr.aria-label]="t('media.sort.label')"
          [value]="sort()"
          (valueChange)="setSort($any($event))"
        >
          @for (option of sorts; track option.value) {
            <option hlmNativeSelectOption [value]="option.value">{{ t(option.label) }}</option>
          }
        </hlm-native-select>
        <hlm-toggle-group
          type="single"
          variant="outline"
          class="ms-auto"
          [value]="view()"
          (valueChange)="setView($any($event))"
        >
          <button hlmToggleGroupItem value="grid" [attr.aria-label]="t('media.view.grid')">
            <ng-icon name="lucideLayoutGrid" />
          </button>
          <button hlmToggleGroupItem value="list" [attr.aria-label]="t('media.view.list')">
            <ng-icon name="lucideList" />
          </button>
        </hlm-toggle-group>
      </div>

      @if (selectedIds().length) {
        <div
          class="bg-card sticky top-16 z-10 flex flex-wrap items-center gap-2 rounded-xl border px-4 py-2 shadow-xs"
          role="region"
          [attr.aria-label]="t('media.selection.label')"
        >
          <span class="text-sm font-medium" aria-live="polite">
            {{ t('media.selection.count', { count: selectedIds().length }) }}
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
            <button hlmBtn variant="destructive" size="sm" (click)="confirmBulkDelete.set(true)">
              <ng-icon name="lucideTrash2" />
              {{ t('media.selection.delete', { count: deletableIds().length }) }}
            </button>
          }
        </div>
      }

      @if (showFolders() && folders().length) {
        <section class="flex flex-col gap-3" [attr.aria-label]="t('media.folders')">
          <h2 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {{ t('media.folders') }}
          </h2>
          <ul class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            @for (folder of folders(); track folder.id) {
              <li
                class="bg-card hover:border-primary/40 group relative flex items-center rounded-xl border transition-colors"
              >
                <button
                  type="button"
                  class="focus-visible:ring-ring/50 flex min-w-0 flex-1 items-center gap-3 rounded-xl p-3 text-start outline-none focus-visible:ring-3"
                  (click)="openFolder(folder)"
                >
                  <span
                    class="bg-primary/10 text-primary inline-flex size-10 shrink-0 items-center justify-center rounded-lg"
                  >
                    <ng-icon name="lucideFolder" size="20" />
                  </span>
                  <span class="flex min-w-0 flex-col">
                    <span class="truncate text-sm font-medium">{{ folder.name }}</span>
                    <span class="text-muted-foreground truncate text-xs">
                      {{ folderSummary(folder) }}
                    </span>
                  </span>
                </button>
                @if (canManageFolders() || canDeleteFolders()) {
                  <button
                    hlmBtn
                    variant="ghost"
                    size="icon-sm"
                    class="me-2 shrink-0"
                    [attr.aria-label]="t('media.folder.actions', { name: folder.name })"
                    [hlmDropdownMenuTrigger]="folderMenu"
                    [hlmDropdownMenuTriggerData]="{ $implicit: folder }"
                    align="end"
                  >
                    <ng-icon name="lucideEllipsis" />
                  </button>
                }
              </li>
            }
          </ul>
        </section>
      }

      <ng-template #folderMenu let-folder>
        <hlm-dropdown-menu class="w-44">
          @if (canManageFolders()) {
            <button hlmDropdownMenuItem (click)="openRename(folder)">
              <ng-icon name="lucidePencil" /> {{ t('media.folder.rename') }}
            </button>
            <button hlmDropdownMenuItem (click)="openMoveFolder(folder)">
              <ng-icon name="lucideFolderInput" /> {{ t('media.folder.move') }}
            </button>
          }
          @if (canDeleteFolders()) {
            @if (canManageFolders()) {
              <hlm-dropdown-menu-separator />
            }
            <button hlmDropdownMenuItem variant="destructive" (click)="deletingFolder.set(folder)">
              <ng-icon name="lucideTrash2" /> {{ t('common.delete') }}
            </button>
          }
        </hlm-dropdown-menu>
      </ng-template>

      <section class="flex flex-col gap-3" [attr.aria-label]="t('media.files')">
        @if (showFolders() && folders().length && (files().length || loading())) {
          <div class="flex items-center gap-3">
            <h2 class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {{ t('media.files') }}
            </h2>
          </div>
        }
        @if (files().length && selectable() && !loading()) {
          <label class="text-muted-foreground flex w-fit items-center gap-2 text-sm">
            <hlm-checkbox
              [checked]="allSelected()"
              [indeterminate]="someSelected()"
              (checkedChange)="selectAll($event)"
            />
            {{ t('media.selection.all') }}
          </label>
        }

        @if (loading()) {
          @if (view() === 'grid') {
            <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
              @for (tile of skeletons; track tile) {
                <div class="bg-card overflow-hidden rounded-xl border">
                  <hlm-skeleton class="aspect-square rounded-none" />
                  <div class="flex flex-col gap-2 p-3">
                    <hlm-skeleton class="h-4 w-3/4" />
                    <hlm-skeleton class="h-3 w-1/2" />
                  </div>
                </div>
              }
            </div>
          } @else {
            <div class="bg-card flex flex-col gap-3 rounded-xl border p-4">
              @for (row of skeletons.slice(0, 6); track row) {
                <div class="flex items-center gap-3">
                  <hlm-skeleton class="size-10 rounded-md" />
                  <hlm-skeleton class="h-4 w-48" />
                  <hlm-skeleton class="ms-auto h-4 w-24" />
                </div>
              }
            </div>
          }
        } @else if (files().length) {
          @if (view() === 'grid') {
            <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
              @for (file of files(); track file.id) {
                @let checked = isSelected(file.id);
                <li
                  class="bg-card hover:border-primary/40 group relative flex flex-col overflow-hidden rounded-xl border transition-colors"
                  [class.border-primary]="checked"
                  [class.ring-2]="checked"
                  [class.ring-primary/30]="checked"
                >
                  <button
                    type="button"
                    class="focus-visible:ring-ring/50 flex flex-col text-start outline-none focus-visible:ring-3 focus-visible:ring-inset"
                    [attr.aria-label]="t('media.file.open', { name: file.name })"
                    (click)="openFile(file)"
                  >
                    <div class="aspect-square border-b">
                      <vd-media-thumb [file]="file" />
                    </div>
                    <div class="flex min-w-0 flex-col gap-0.5 p-3">
                      <span class="truncate text-sm font-medium" [title]="file.name">{{
                        file.name
                      }}</span>
                      <span class="text-muted-foreground truncate text-xs tabular-nums">
                        {{ size(file) }}
                        @if (dims(file); as dims) {
                          · {{ dims }}
                        }
                      </span>
                    </div>
                  </button>
                  @if (canSelect(file)) {
                    <span
                      class="bg-background/90 absolute start-2 top-2 flex rounded-md p-1 shadow-xs transition-opacity focus-within:opacity-100 group-hover:opacity-100"
                      [class.opacity-0]="!checked && !selectedIds().length"
                    >
                      <hlm-checkbox
                        [checked]="checked"
                        [aria-label]="t('media.selection.select', { name: file.name })"
                        (checkedChange)="toggleSelection(file.id, $event)"
                      />
                    </span>
                  }
                  @if (extension(file); as ext) {
                    <span
                      hlmBadge
                      variant="secondary"
                      class="pointer-events-none absolute end-2 top-2 font-mono text-[10px]"
                      >{{ ext }}</span
                    >
                  }
                </li>
              }
            </ul>
          } @else {
            <div class="bg-card overflow-hidden rounded-xl border shadow-xs">
              <div hlmTableContainer>
                <table hlmTable>
                  <thead hlmTHead class="bg-muted/40">
                    <tr hlmTr class="hover:bg-transparent">
                      <th hlmTh class="w-10 px-4">
                        <span class="sr-only">{{ t('media.selection.label') }}</span>
                      </th>
                      <th hlmTh class="w-14 px-2">
                        <span class="sr-only">{{ t('media.list.preview') }}</span>
                      </th>
                      @for (heading of listHeadings; track heading) {
                        <th
                          hlmTh
                          class="text-muted-foreground px-4 text-xs font-medium tracking-wide uppercase"
                        >
                          {{ t(heading) }}
                        </th>
                      }
                    </tr>
                  </thead>
                  <tbody hlmTBody>
                    @for (file of files(); track file.id) {
                      <tr
                        hlmTr
                        class="cursor-pointer"
                        [attr.data-state]="isSelected(file.id) ? 'selected' : null"
                        (click)="openFile(file)"
                      >
                        <td hlmTd class="px-4" (click)="$event.stopPropagation()">
                          @if (canSelect(file)) {
                            <hlm-checkbox
                              [checked]="isSelected(file.id)"
                              [aria-label]="t('media.selection.select', { name: file.name })"
                              (checkedChange)="toggleSelection(file.id, $event)"
                            />
                          }
                        </td>
                        <td hlmTd class="px-2 py-2">
                          <div class="size-10 overflow-hidden rounded-md border">
                            <vd-media-thumb
                              [file]="file"
                              [width]="80"
                              iconSize="18"
                              [showExtension]="false"
                            />
                          </div>
                        </td>
                        <td hlmTd class="max-w-72 px-4">
                          <button
                            type="button"
                            class="block max-w-full truncate text-start font-medium hover:underline"
                            [title]="file.name"
                            (click)="$event.stopPropagation(); openFile(file)"
                          >
                            {{ file.name }}
                          </button>
                        </td>
                        <td hlmTd class="px-4">
                          <span hlmBadge variant="outline" class="font-mono text-[10px]">{{
                            extension(file) || t(kindLabel(file))
                          }}</span>
                        </td>
                        <td hlmTd class="text-muted-foreground px-4 tabular-nums">
                          {{ size(file) }}
                        </td>
                        <td hlmTd class="text-muted-foreground px-4 tabular-nums">
                          {{ dims(file) ?? '—' }}
                        </td>
                        <td
                          hlmTd
                          class="text-muted-foreground px-4"
                          [title]="i18n.formatDate(file.updatedAt, 'long')"
                        >
                          {{ i18n.formatRelative(file.updatedAt) }}
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>
          }
        } @else if (filtered() || !folders().length || !showFolders()) {
          <div hlmEmpty class="rounded-xl border border-dashed py-16">
            <div hlmEmptyHeader>
              <div hlmEmptyMedia variant="icon">
                <ng-icon [name]="filtered() ? 'lucideSearch' : 'lucideFolderOpen'" />
              </div>
              <h2 hlmEmptyTitle>
                {{ filtered() ? t('media.empty.noMatches') : t('media.empty.folder') }}
              </h2>
              <p hlmEmptyDescription>
                {{
                  filtered()
                    ? search()
                      ? t('media.empty.noMatchesSearch', { search: search() })
                      : t('media.empty.noMatchesHint')
                    : canCreate()
                      ? t('media.empty.folderHint')
                      : t('media.empty.folderReadOnly')
                }}
              </p>
            </div>
            @if (!filtered() && canCreate()) {
              <div hlmEmptyContent>
                <button hlmBtn variant="outline" size="sm" (click)="fileInput.click()">
                  <ng-icon name="lucideUpload" /> {{ t('media.upload.button') }}
                </button>
              </div>
            }
          </div>
        }

        @if (pageCount() > 1) {
          <div class="flex flex-wrap items-center justify-end gap-2">
            <span class="text-muted-foreground me-auto text-sm tabular-nums">
              {{ t('media.total', { count: total() }) }} ·
              {{ t('common.page', { page: page(), count: pageCount() }) }}
            </span>
            <button
              hlmBtn
              variant="outline"
              size="sm"
              [disabled]="page() <= 1"
              (click)="goToPage(page() - 1)"
            >
              <ng-icon name="lucideArrowLeft" /> {{ t('common.previous') }}
            </button>
            <button
              hlmBtn
              variant="outline"
              size="sm"
              [disabled]="page() >= pageCount()"
              (click)="goToPage(page() + 1)"
            >
              {{ t('common.next') }} <ng-icon name="lucideChevronRight" />
            </button>
          </div>
        } @else if (total()) {
          <p class="text-muted-foreground text-sm tabular-nums">
            {{ t('media.total', { count: total() }) }}
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

    <vd-media-file-sheet
      [file]="openedFile()"
      [folders]="allFolders()"
      (saved)="fileSaved($event)"
      (deleted)="fileDeleted($event)"
      (closed)="openedFile.set(null)"
    />

    <hlm-dialog [state]="dialog() ? 'open' : 'closed'" (closed)="dialog.set(null)">
      <hlm-dialog-content *hlmDialogPortal="let ctx" class="sm:max-w-md">
        @if (dialog(); as current) {
          <form class="flex flex-col gap-4" (submit)="$event.preventDefault(); submitDialog()">
            <hlm-dialog-header>
              <h2 hlmDialogTitle>{{ dialogTitle() }}</h2>
              @if (current.mode === 'moveFiles') {
                <p hlmDialogDescription>
                  {{ t('media.selection.moveHint', { count: current.ids.length }) }}
                </p>
              }
            </hlm-dialog-header>
            @if (current.mode === 'create' || current.mode === 'rename') {
              <div hlmField>
                <label hlmFieldLabel for="media-folder-name">{{ t('common.name') }}</label>
                <input
                  hlmInput
                  id="media-folder-name"
                  autocomplete="off"
                  [value]="current.name"
                  (input)="setDialogName($any($event.target).value)"
                />
              </div>
            } @else {
              <div hlmField>
                <label hlmFieldLabel for="media-folder-target">{{
                  t('media.folder.destination')
                }}</label>
                <hlm-native-select
                  selectId="media-folder-target"
                  [value]="current.target === null ? '' : String(current.target)"
                  (valueChange)="setDialogTarget($event ? Number($event) : null)"
                >
                  <option hlmNativeSelectOption value="">{{ t('media.root') }}</option>
                  @for (option of targetOptions(); track option.id) {
                    <option hlmNativeSelectOption [value]="String(option.id)">
                      {{ option.label }}
                    </option>
                  }
                </hlm-native-select>
              </div>
            }
            <hlm-dialog-footer>
              <button hlmBtn variant="outline" type="button" (click)="ctx.close()">
                {{ t('common.cancel') }}
              </button>
              <button hlmBtn type="submit" [disabled]="busy() || !dialogValid()">
                {{ current.mode === 'create' ? t('common.create') : t('common.save') }}
              </button>
            </hlm-dialog-footer>
          </form>
        }
      </hlm-dialog-content>
    </hlm-dialog>

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
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly String = String;
  protected readonly Number = Number;
  protected readonly kinds = MEDIA_KINDS;
  protected readonly kindLabels = KIND_LABELS;
  protected readonly sorts = SORTS;
  protected readonly extension = extension;
  protected readonly skeletons = Array.from({ length: 12 }, (_, index) => index);
  protected readonly listHeadings: MessageKey[] = [
    'common.name',
    'media.file.type',
    'media.file.size',
    'media.file.dimensions',
    'media.list.updated',
  ];

  /** `?folder=<id>`; the root when absent. */
  readonly folder = input<string>();

  protected readonly queue = new UploadQueue(this.media);

  protected readonly folderId = computed(() => {
    const id = Number(this.folder());
    return this.folder() && Number.isInteger(id) ? id : null;
  });
  protected readonly searchText = signal('');
  protected readonly search = signal('');
  protected readonly kind = signal<MediaKind | ''>('');
  protected readonly sort = signal<MediaSort>('createdAtDesc');
  /** Resets to the first page when the folder changes. */
  protected readonly page = linkedSignal({ source: this.folderId, computation: () => 1 });
  protected readonly view = signal<View>(readView());

  protected readonly files = signal<MediaFile[]>([]);
  protected readonly folders = signal<MediaFolder[]>([]);
  protected readonly allFolders = signal<MediaFolder[]>([]);
  protected readonly meta = signal<PageMeta>({});
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly dragging = signal(false);

  protected readonly selection = linkedSignal<number | null, ReadonlySet<number>>({
    source: this.folderId,
    computation: () => new Set(),
  });
  protected readonly openedFile = signal<MediaFile | null>(null);
  protected readonly dialog = signal<FolderDialog | null>(null);
  protected readonly deletingFolder = signal<MediaFolder | null>(null);
  protected readonly confirmBulkDelete = signal(false);

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

  protected readonly total = computed(() => this.meta().total ?? 0);
  protected readonly pageCount = computed(() => this.meta().pageCount ?? 1);
  protected readonly filtered = computed(() => !!this.search() || !!this.kind());
  /** Folders are listed on the first page of an unsearched folder. */
  protected readonly showFolders = computed(() => !this.search() && this.page() === 1);

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

  protected readonly selectedIds = computed(() => [...this.selection()]);
  private readonly selectedFiles = computed(() =>
    this.files().filter((file) => this.selection().has(file.id)),
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
    this.files().filter((file) => this.canSelect(file)),
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

  protected readonly dialogTitle = computed(() => {
    const dialog = this.dialog();
    switch (dialog?.mode) {
      case 'create':
        return this.t('media.folder.new');
      case 'rename':
        return this.t('media.folder.renameTitle', { name: dialog.folder.name });
      case 'move':
        return this.t('media.folder.moveTitle', { name: dialog.folder.name });
      case 'moveFiles':
        return this.t('media.selection.moveTitle', { count: dialog.ids.length });
      default:
        return '';
    }
  });
  protected readonly dialogValid = computed(() => {
    const dialog = this.dialog();
    if (!dialog) return false;
    if (dialog.mode === 'create' || dialog.mode === 'rename') return !!dialog.name.trim();
    return true;
  });
  /** Destinations for a move: never the folder itself or a folder below it. */
  protected readonly targetOptions = computed(() => {
    const dialog = this.dialog();
    const all = this.allFolders();
    const moving = dialog?.mode === 'move' ? dialog.folder : null;
    const allowed = moving ? all.filter((folder) => !isWithin(folder, moving)) : all;
    return folderOptions(allowed);
  });
  protected readonly folderDeleteHint = computed(() => {
    const folder = this.deletingFolder();
    if (!folder) return '';
    return folder.childrenCount || folder.filesCount
      ? this.t('media.folder.deleteHintContents', { summary: this.folderSummary(folder) })
      : this.t('media.folder.deleteHint');
  });

  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private dragDepth = 0;
  private requestId = 0;

  constructor() {
    effect(() => {
      const request = {
        folder: this.folderId(),
        search: this.search(),
        kind: this.kind(),
        sort: this.sort(),
        page: this.page(),
      };
      untracked(() => void this.load(request));
    });
    void this.loadAllFolders();
  }

  private async load(request: {
    folder: number | null;
    search: string;
    kind: MediaKind | '';
    sort: MediaSort;
    page: number;
  }): Promise<void> {
    const id = ++this.requestId;
    this.loading.set(true);
    this.error.set(null);
    try {
      const [files, folders] = await Promise.all([
        this.media.list({
          folder: request.folder ?? 'root',
          search: request.search || undefined,
          types: request.kind ? [request.kind] : undefined,
          sort: request.sort,
          page: request.page,
          pageSize: PAGE_SIZE,
        }),
        this.media.folders(request.folder ?? 'root'),
      ]);
      if (id !== this.requestId) return;
      this.files.set(files.data);
      this.meta.set(files.meta.pagination ?? {});
      this.folders.set(folders);
      const visible = new Set(files.data.map((file) => file.id));
      this.selection.update((selection) => new Set([...selection].filter((id) => visible.has(id))));
    } catch (error) {
      if (id !== this.requestId) return;
      this.error.set(ApiFailure.from(error).message);
      this.files.set([]);
      this.folders.set([]);
    } finally {
      if (id === this.requestId) this.loading.set(false);
    }
  }

  private reload(): Promise<void> {
    return this.load({
      folder: this.folderId(),
      search: this.search(),
      kind: this.kind(),
      sort: this.sort(),
      page: this.page(),
    });
  }

  private async loadAllFolders(): Promise<void> {
    try {
      this.allFolders.set(await this.media.allFolders());
    } catch {
      // Names in the breadcrumb and pickers are a nicety; the listing still works.
    }
  }

  protected size(file: MediaFile): string {
    return formatSize(this.i18n, file.size);
  }

  protected dims = dimensions;

  protected kindLabel(file: MediaFile): MessageKey {
    return KIND_LABELS[fileKind(file)];
  }

  protected folderSummary(folder: MediaFolder): string {
    return [
      this.t('media.folder.subfolders', { count: folder.childrenCount }),
      this.t('media.folder.fileCount', { count: folder.filesCount }),
    ].join(' · ');
  }

  // Toolbar

  protected setSearch(value: string): void {
    this.searchText.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.search.set(value.trim());
      this.page.set(1);
    }, 250);
  }

  protected setKind(kind: MediaKind | ''): void {
    this.kind.set(kind);
    this.page.set(1);
  }

  protected setSort(sort: MediaSort | null | undefined): void {
    if (!sort) return;
    this.sort.set(sort);
    this.page.set(1);
  }

  protected setView(view: View | null | undefined): void {
    if (!view) return;
    this.view.set(view);
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // Storage may be unavailable (private mode); the choice then lasts for this visit.
    }
  }

  protected goToPage(page: number): void {
    this.page.set(page);
  }

  // Navigation

  protected openFolder(folder: MediaFolder): void {
    void this.router.navigate(['/media'], { queryParams: { folder: folder.id } });
  }

  protected openFile(file: MediaFile): void {
    this.openedFile.set(file);
  }

  protected fileSaved(file: MediaFile): void {
    this.openedFile.set(file);
    if ((file.folder ?? null) !== this.folderId()) {
      void this.reload();
      void this.loadAllFolders();
    } else {
      this.files.update((files) => files.map((item) => (item.id === file.id ? file : item)));
    }
  }

  protected fileDeleted(id: number): void {
    this.openedFile.set(null);
    this.files.update((files) => files.filter((file) => file.id !== id));
    void this.reload();
  }

  // Selection

  protected canSelect(file: MediaFile): boolean {
    return canTouch(this.auth, 'media.update', file) || canTouch(this.auth, 'media.delete', file);
  }

  protected isSelected(id: number): boolean {
    return this.selection().has(id);
  }

  protected toggleSelection(id: number, checked: boolean): void {
    this.selection.update((selection) => {
      const next = new Set(selection);
      if (checked) next.add(id);
      else next.delete(id);
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

  protected async deleteSelected(): Promise<void> {
    const ids = this.deletableIds();
    if (!ids.length) return;
    const results = await Promise.allSettled(ids.map((id) => this.media.delete(id)));
    const failed = results.filter((result) => result.status === 'rejected').length;
    const done = ids.length - failed;
    if (done) toast.success(this.t('media.selection.deleted', { count: done }));
    if (failed) toast.error(this.t('media.selection.deleteFailed', { count: failed }));
    this.clearSelection();
    await this.reload();
  }

  // Folder dialog

  protected openCreateFolder(): void {
    this.dialog.set({ mode: 'create', name: '' });
  }

  protected openRename(folder: MediaFolder): void {
    this.dialog.set({ mode: 'rename', folder, name: folder.name });
  }

  protected openMoveFolder(folder: MediaFolder): void {
    this.dialog.set({ mode: 'move', folder, target: folder.parent });
  }

  protected openMoveFiles(): void {
    this.dialog.set({ mode: 'moveFiles', ids: this.movableIds(), target: this.folderId() });
  }

  protected setDialogName(name: string): void {
    this.dialog.update((dialog) =>
      dialog && (dialog.mode === 'create' || dialog.mode === 'rename')
        ? { ...dialog, name }
        : dialog,
    );
  }

  protected setDialogTarget(target: number | null): void {
    this.dialog.update((dialog) =>
      dialog && (dialog.mode === 'move' || dialog.mode === 'moveFiles')
        ? { ...dialog, target }
        : dialog,
    );
  }

  protected async submitDialog(): Promise<void> {
    const dialog = this.dialog();
    if (!dialog || !this.dialogValid()) return;
    this.busy.set(true);
    try {
      switch (dialog.mode) {
        case 'create':
          await this.media.createFolder(dialog.name.trim(), this.folderId());
          toast.success(this.t('media.folder.created'));
          break;
        case 'rename':
          await this.media.updateFolder(dialog.folder.id, { name: dialog.name.trim() });
          toast.success(this.t('media.folder.renamed'));
          break;
        case 'move':
          await this.media.updateFolder(dialog.folder.id, { parent: dialog.target });
          toast.success(this.t('media.folder.moved'));
          break;
        case 'moveFiles': {
          const results = await Promise.allSettled(
            dialog.ids.map((id) => this.media.update(id, { folder: dialog.target })),
          );
          const failed = results.filter((result) => result.status === 'rejected').length;
          const done = dialog.ids.length - failed;
          if (done) toast.success(this.t('media.selection.moved', { count: done }));
          if (failed) toast.error(this.t('media.selection.moveFailed', { count: failed }));
          this.clearSelection();
          break;
        }
      }
      this.dialog.set(null);
      await Promise.all([this.reload(), this.loadAllFolders()]);
    } catch (error) {
      toast.error(this.t('media.folder.saveFailed'), {
        description: ApiFailure.from(error).message,
      });
    } finally {
      this.busy.set(false);
    }
  }

  protected async deleteFolder(): Promise<void> {
    const folder = this.deletingFolder();
    if (!folder) return;
    try {
      await this.media.deleteFolder(folder.id);
      toast.success(this.t('media.folder.deleted', { name: folder.name }));
      await Promise.all([this.reload(), this.loadAllFolders()]);
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
    await this.reload();
  }

  /** Whether a drag carries files and the page may take them (no dialog in the way). */
  private acceptsDrag(event: DragEvent): boolean {
    return (
      this.canCreate() &&
      !!event.dataTransfer?.types.includes('Files') &&
      !this.dialog() &&
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
