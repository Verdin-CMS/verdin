import {
  DestroyRef,
  Signal,
  WritableSignal,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';

import { ApiFailure } from '../../core/api';
import { Media, MediaSort } from '../../core/media';
import { MediaFile, MediaFolder, MediaKind, PageMeta } from '../../core/types';

export interface MediaListingOptions {
  /** The folder listed (`null`: the root). */
  folder: Signal<number | null>;
  pageSize: number;
  /** Kinds listed while no kind is picked (a media field may accept some only); all by default. */
  kinds?: () => MediaKind[];
  /** Called with the files of each page loaded. */
  loaded?: (files: MediaFile[]) => void;
  /** Called with the reason a page could not be loaded (also kept in `error`). */
  failed?: (message: string) => void;
}

/** What one request lists. */
interface MediaRequest {
  folder: number | null;
  search: string;
  kind: MediaKind | '';
  sort: MediaSort;
  page: number;
}

/**
 * One page of a folder's files (searched, filtered by kind, sorted) and its subfolders: the
 * state the media library and the media picker share. Create it in an injection context,
 * then call `watch` to load whenever what is listed changes.
 */
export class MediaListing {
  private readonly media = inject(Media);

  /** The search box's text; `search` follows once typing pauses. */
  readonly searchText = signal('');
  readonly search = signal('');
  readonly kind = signal<MediaKind | ''>('');
  readonly sort = signal<MediaSort>('createdAtDesc');
  /** Back to the first page when the folder changes. */
  readonly page: WritableSignal<number>;

  readonly files = signal<MediaFile[]>([]);
  readonly folders = signal<MediaFolder[]>([]);
  readonly meta = signal<PageMeta>({});
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly total = computed(() => this.meta().total ?? 0);
  readonly pageCount = computed(() => this.meta().pageCount ?? 1);
  /** A search or a kind narrows the files (empty states say so). */
  readonly filtered = computed(() => !!this.search() || !!this.kind());

  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private requestId = 0;

  constructor(private readonly options: MediaListingOptions) {
    this.page = linkedSignal({ source: options.folder, computation: () => 1 });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.searchTimer));
  }

  /** Loads the page whenever what is listed changes (and `active` holds). */
  watch(active: () => boolean = () => true): void {
    effect(() => {
      if (!active()) return;
      const request = this.request();
      untracked(() => void this.load(request));
    });
  }

  /** Loads the current page again (after an upload, a move, a delete…). */
  reload(): Promise<void> {
    return this.load(untracked(() => this.request()));
  }

  /** Back to an unsearched, unfiltered first page. */
  reset(): void {
    clearTimeout(this.searchTimer);
    this.clearSearch();
    this.kind.set('');
    this.page.set(1);
  }

  clearSearch(): void {
    this.searchText.set('');
    this.search.set('');
  }

  setSearch(value: string): void {
    this.searchText.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.search.set(value.trim());
      this.page.set(1);
    }, 250);
  }

  setKind(kind: MediaKind | ''): void {
    this.kind.set(kind);
    this.page.set(1);
  }

  setSort(sort: MediaSort | null | undefined): void {
    if (!sort) return;
    this.sort.set(sort);
    this.page.set(1);
  }

  private request(): MediaRequest {
    return {
      folder: this.options.folder(),
      search: this.search(),
      kind: this.kind(),
      sort: this.sort(),
      page: this.page(),
    };
  }

  private async load(request: MediaRequest): Promise<void> {
    const id = ++this.requestId;
    this.loading.set(true);
    this.error.set(null);
    try {
      const [files, folders] = await Promise.all([
        this.media.list({
          folder: request.folder ?? 'root',
          search: request.search || undefined,
          types: request.kind ? [request.kind] : this.options.kinds?.(),
          sort: request.sort,
          page: request.page,
          pageSize: this.options.pageSize,
        }),
        this.media.folders(request.folder ?? 'root'),
      ]);
      if (id !== this.requestId) return;
      this.files.set(files.data);
      this.meta.set(files.meta.pagination ?? {});
      this.folders.set(folders);
      this.options.loaded?.(files.data);
    } catch (error) {
      if (id !== this.requestId) return;
      const message = ApiFailure.from(error).message;
      this.error.set(message);
      this.options.failed?.(message);
      this.files.set([]);
      this.folders.set([]);
    } finally {
      if (id === this.requestId) this.loading.set(false);
    }
  }
}
