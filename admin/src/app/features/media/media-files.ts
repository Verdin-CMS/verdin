import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { NgIcon } from '@ng-icons/core';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmTableImports } from '@spartan-ng/helm/table';

import { I18n } from '../../core/i18n/i18n';
import { MessageKey } from '../../core/i18n/keys';
import { MediaFile } from '../../core/types';
import { KIND_LABELS, dimensions, extension, fileKind, formatSize } from './media-format';
import { MediaThumb } from './media-thumb';

export type MediaView = 'grid' | 'list';

/** A file's checkbox changed. */
export interface MediaToggle {
  file: MediaFile;
  checked: boolean;
}

const LIST_HEADINGS: MessageKey[] = [
  'common.name',
  'media.file.type',
  'media.file.size',
  'media.file.dimensions',
  'media.list.updated',
];

/**
 * A page of files as a grid of tiles (or, in the library, a table), with skeletons while
 * loading. `browse` (the library): a tile opens the file and its checkbox selects it.
 * `pick` (the picker): a tile picks the file; `locked` ones are already in the field.
 * The caller shows its own empty state when there are no files.
 */
@Component({
  selector: 'vd-media-files',
  imports: [
    NgIcon,
    MediaThumb,
    HlmBadgeImports,
    HlmCheckboxImports,
    HlmSkeletonImports,
    HlmTableImports,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
  template: `
    @if (loading()) {
      @if (mode() === 'pick') {
        <div class="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
          @for (tile of skeletons; track tile) {
            <hlm-skeleton class="aspect-square rounded-xl" />
          }
        </div>
      } @else if (view() === 'grid') {
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
      @if (mode() === 'pick') {
        <ul
          class="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6"
          [attr.aria-label]="t('media.files')"
        >
          @for (file of files(); track file.id) {
            @let already = locked().includes(file.id);
            @let checked = already || selection().has(file.id);
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
                (click)="picked.emit(file)"
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
      } @else if (view() === 'grid') {
        <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
          @for (file of files(); track file.id) {
            @let checked = selection().has(file.id);
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
                (click)="opened.emit(file)"
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
              @if (canSelect()(file)) {
                <span
                  class="bg-background/90 absolute start-2 top-2 flex rounded-md p-1 shadow-xs transition-opacity focus-within:opacity-100 group-hover:opacity-100"
                  [class.opacity-0]="!checked && !selection().size"
                >
                  <hlm-checkbox
                    [checked]="checked"
                    [aria-label]="t('media.selection.select', { name: file.name })"
                    (checkedChange)="toggled.emit({ file, checked: $event })"
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
                    [attr.data-state]="selection().has(file.id) ? 'selected' : null"
                    (click)="opened.emit(file)"
                  >
                    <td hlmTd class="px-4" (click)="$event.stopPropagation()">
                      @if (canSelect()(file)) {
                        <hlm-checkbox
                          [checked]="selection().has(file.id)"
                          [aria-label]="t('media.selection.select', { name: file.name })"
                          (checkedChange)="toggled.emit({ file, checked: $event })"
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
                        (click)="$event.stopPropagation(); opened.emit(file)"
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
    }
  `,
})
export class MediaFiles {
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly extension = extension;
  protected readonly dims = dimensions;
  protected readonly listHeadings = LIST_HEADINGS;
  protected readonly skeletons = Array.from({ length: 12 }, (_, index) => index);

  readonly files = input.required<MediaFile[]>();
  readonly loading = input(false);
  readonly mode = input<'browse' | 'pick'>('browse');
  /** `browse` only; `pick` is always a grid. */
  readonly view = input<MediaView>('grid');
  /** Checked files (selected in the library, chosen in the picker). */
  readonly selection = input<ReadonlySet<number>>(new Set());
  /** `browse`: files with a checkbox. */
  readonly canSelect = input<(file: MediaFile) => boolean>(() => false);
  /** `pick`: files already in the field (shown checked, not picked again). */
  readonly locked = input<number[]>([]);
  /** `pick`: several files may be chosen (tiles show a check box). */
  readonly multiple = input(false);

  readonly opened = output<MediaFile>();
  readonly toggled = output<MediaToggle>();
  readonly picked = output<MediaFile>();

  protected size(file: MediaFile): string {
    return formatSize(this.i18n, file.size);
  }

  protected kindLabel(file: MediaFile): MessageKey {
    return KIND_LABELS[fileKind(file)];
  }

  protected describe(file: MediaFile): string {
    return [this.size(file), dimensions(file)].filter(Boolean).join(' · ');
  }
}
