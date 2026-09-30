import { Signal, computed, linkedSignal, resource, signal } from '@angular/core';

import { ListResponse } from './api';
import { loadErrorOf } from './loading';

/** Rows a page on the settings lists. */
export const PAGE_SIZE = 25;

/**
 * A paged admin list: `page` drives the load (and `params`, when given: set `page` back to 1
 * when they change; `undefined` keeps the list idle, e.g. until the page may be used). The rows and page count of the last load that succeeded stay while the
 * next page loads or fails. Call in an injection context.
 */
export function pagedList<T, P = null>(
  load: (page: number, params: P) => Promise<ListResponse<T>>,
  params: () => P | undefined = () => null as P,
) {
  const page = signal(1);
  const list = resource({
    params: () => {
      const value = params();
      return value === undefined ? undefined : { page: page(), params: value };
    },
    loader: ({ params }) => load(params.page, params.params),
  });
  const loaded = computed(() => (list.hasValue() && !list.isLoading() ? list.value() : undefined));
  /** `null` until the first page arrives. */
  const rows = linkedSignal<ListResponse<T> | undefined, T[] | null>({
    source: loaded,
    computation: (response, previous) => response?.data ?? previous?.value ?? null,
  });
  const meta = linkedSignal<
    ListResponse<T> | undefined,
    NonNullable<ListResponse<T>['meta']['pagination']>
  >({
    source: loaded,
    computation: (response, previous) =>
      response ? (response.meta.pagination ?? {}) : (previous?.value ?? {}),
  });
  const pageCount: Signal<number> = computed(() => meta().pageCount ?? 1);
  const total: Signal<number> = computed(() => meta().total ?? rows()?.length ?? 0);
  const error = loadErrorOf(list);
  return {
    page,
    list,
    rows,
    pageCount,
    total,
    loading: list.isLoading,
    /** The load failed and nothing was loaded before. */
    error: computed(() => (rows() === null ? error() : null)),
    reload: () => list.reload(),
    /** After deleting a row: steps back when it was the last one of its page. */
    removed: () => {
      if ((rows()?.length ?? 0) <= 1 && page() > 1) page.update((value) => value - 1);
      else list.reload();
    },
  };
}
