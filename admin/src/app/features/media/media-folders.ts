import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';

import { I18n } from '../../core/i18n/i18n';
import { MediaFolder } from '../../core/types';

/** "3 subfolders · 12 files". */
export function folderSummary(t: I18n['t'], folder: MediaFolder): string {
  return [
    t('media.folder.subfolders', { count: folder.childrenCount }),
    t('media.folder.fileCount', { count: folder.filesCount }),
  ].join(' · ');
}

/** The media library's folder cards, each with a menu to rename, move or delete it. */
@Component({
  selector: 'vd-media-folders',
  imports: [NgIcon, HlmButtonImports, HlmDropdownMenuImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col gap-3', role: 'region', '[attr.aria-label]': 't("media.folders")' },
  template: `
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
            (click)="opened.emit(folder)"
          >
            <span
              class="bg-primary/10 text-primary inline-flex size-10 shrink-0 items-center justify-center rounded-lg"
            >
              <ng-icon name="lucideFolder" size="20" />
            </span>
            <span class="flex min-w-0 flex-col">
              <span class="truncate text-sm font-medium">{{ folder.name }}</span>
              <span class="text-muted-foreground truncate text-xs">
                {{ summary(folder) }}
              </span>
            </span>
          </button>
          @if (canManage() || canDelete()) {
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

    <ng-template #folderMenu let-folder>
      <hlm-dropdown-menu class="w-44">
        @if (canManage()) {
          <button hlmDropdownMenuItem (click)="renamed.emit(folder)">
            <ng-icon name="lucidePencil" /> {{ t('media.folder.rename') }}
          </button>
          <button hlmDropdownMenuItem (click)="moved.emit(folder)">
            <ng-icon name="lucideFolderInput" /> {{ t('media.folder.move') }}
          </button>
        }
        @if (canDelete()) {
          @if (canManage()) {
            <hlm-dropdown-menu-separator />
          }
          <button hlmDropdownMenuItem variant="destructive" (click)="deleted.emit(folder)">
            <ng-icon name="lucideTrash2" /> {{ t('common.delete') }}
          </button>
        }
      </hlm-dropdown-menu>
    </ng-template>
  `,
})
export class MediaFolders {
  protected readonly t = inject(I18n).t;

  readonly folders = input.required<MediaFolder[]>();
  /** Rename and move (a grant on every file). */
  readonly canManage = input(false);
  readonly canDelete = input(false);

  readonly opened = output<MediaFolder>();
  readonly renamed = output<MediaFolder>();
  readonly moved = output<MediaFolder>();
  /** Asks to delete the folder (the caller confirms). */
  readonly deleted = output<MediaFolder>();

  protected summary(folder: MediaFolder): string {
    return folderSummary(this.t, folder);
  }
}
