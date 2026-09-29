import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideIcons } from '@ng-icons/core';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Api } from '../../core/api';
import { Auth } from '../../core/auth';
import { ContentLocales } from '../../core/content-locales';
import { EntryDuplicates } from '../../core/duplicate';
import { Features } from '../../core/features';
import { I18n } from '../../core/i18n/i18n';
import { Realtime } from '../../core/realtime';
import { ReviewWorkflows } from '../../core/review';
import { Schema } from '../../core/schema';
import { ContentType, Document } from '../../core/types';
import { Usages } from '../../core/usage';
import { UserPreferences } from '../../core/user-preferences';
import { ICONS } from '../../icons';
import { ContentList } from './list';

const ARTICLE: ContentType = {
  uid: 'api::article.article',
  kind: 'collectionType',
  singularName: 'article',
  pluralName: 'articles',
  displayName: 'Article',
  draftAndPublish: false,
  attributes: {
    title: { type: 'string' },
    views: { type: 'integer' },
    slug: { type: 'uid' },
  },
} as unknown as ContentType;

const doc = (id: number): Document =>
  ({
    id,
    documentId: `doc${id}`,
    title: `Entry ${id}`,
    views: id * 10,
    slug: `entry-${id}`,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
  }) as unknown as Document;

/** A message key with its parameters, so assertions can read what was shown. */
function t(key: string, params?: Record<string, unknown>): string {
  return params ? `${key} ${JSON.stringify(params)}` : key;
}

async function setup(
  options: { total?: number; pageSize?: number; views?: Record<string, unknown> } = {},
) {
  const total = options.total ?? 3;
  const pageSize = options.pageSize ?? 20;
  const all = Array.from({ length: total }, (_, index) => doc(index + 1));
  const queries: URLSearchParams[] = [];
  const deleted: string[] = [];
  const api = {
    list: vi.fn(async (_path: string, query = '') => {
      const params = new URLSearchParams(query);
      queries.push(params);
      const page = Number(params.get('pagination[page]') ?? 1);
      const size = Number(params.get('pagination[pageSize]') ?? pageSize);
      const data = all.slice((page - 1) * size, page * size);
      return {
        data,
        meta: {
          pagination: { page, pageSize: size, total, pageCount: Math.ceil(total / size) || 1 },
        },
      };
    }),
    delete: vi.fn(async (path: string) => {
      deleted.push(path);
    }),
    post: vi.fn(async () => ({})),
    download: vi.fn(),
  };
  const preferences = {
    value: signal<Record<string, unknown>>({ listViews: options.views ?? {} }),
    loaded: signal(true),
    load: async () => undefined,
    set: vi.fn(async (path: string[], value: unknown) => {
      // Stores like the service: `listViews[uid]`.
      const [group, key] = path;
      const current = (preferences.value()[group] ?? {}) as Record<string, unknown>;
      preferences.value.set({ ...preferences.value(), [group]: { ...current, [key]: value } });
    }),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter(
        [{ path: 'content/:uid', component: ContentList }],
        withComponentInputBinding(),
      ),
      provideIcons(ICONS),
      { provide: Api, useValue: api },
      {
        provide: Auth,
        useValue: {
          canInLocale: () => true,
          permissions: signal([]),
        },
      },
      {
        provide: Schema,
        useValue: {
          type: (uid: string) => (uid === ARTICLE.uid ? ARTICLE : undefined),
          titleField: () => 'title',
        },
      },
      { provide: UserPreferences, useValue: preferences },
      {
        provide: ContentLocales,
        useValue: {
          list: signal(null),
          loaded: signal(true),
          load: async () => undefined,
          resolve: () => null,
          defaultCode: () => null,
          name: (code: string) => code,
        },
      },
      { provide: Features, useValue: { enabled: () => false } },
      { provide: ReviewWorkflows, useValue: { entries: vi.fn() } },
      {
        provide: Realtime,
        useValue: { retain: () => () => undefined, messages: new Subject(), isOwn: () => false },
      },
      { provide: EntryDuplicates, useValue: { duplicate: vi.fn() } },
      {
        provide: Usages,
        useValue: { many: async () => ({ data: [], hidden: 0 }), forEntry: vi.fn() },
      },
      {
        provide: I18n,
        useValue: {
          t,
          formatDate: (value: string) => value,
          formatRelative: (value: string) => value,
          formatNumber: (value: unknown) => String(value),
          formatList: (values: string[]) => values.join(', '),
          endSide: () => 'right',
        },
      },
    ],
  });
  const harness = await RouterTestingHarness.create();
  const router = TestBed.inject(Router);
  const element = () => harness.routeNativeElement as HTMLElement;
  const settle = async () => {
    for (let round = 0; round < 3; round++) {
      await harness.fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve));
      harness.detectChanges();
    }
  };
  const open = async (url = `/content/${ARTICLE.uid}`) => {
    await harness.navigateByUrl(url);
    await settle();
  };
  const headers = () =>
    [...element().querySelectorAll('thead th')].map((cell) => cell.textContent!.trim());
  const rows = () => [...element().querySelectorAll('tbody tr')];
  const button = (text: string) =>
    [...element().querySelectorAll('button')].find((item) => item.textContent!.trim() === text) as
      HTMLButtonElement | undefined;
  const checkbox = (label: string) =>
    element().querySelector<HTMLElement>(`hlm-checkbox [aria-label^="${label}"]`) ??
    element().querySelector<HTMLElement>(`[aria-label^="${label}"]`);
  const lastQuery = () => queries[queries.length - 1];
  return {
    harness,
    router,
    api,
    preferences,
    queries,
    deleted,
    element,
    settle,
    open,
    headers,
    rows,
    button,
    checkbox,
    lastQuery,
  };
}

describe('ContentList', () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.useRealTimers());

  it('lists the first page, sorted by the default view', async () => {
    const list = await setup();
    await list.open();
    expect(list.rows()).toHaveLength(3);
    expect(list.rows()[0].textContent).toContain('Entry 1');
    const query = list.lastQuery();
    expect(query.get('sort')).toBe('updatedAt:desc');
    expect(query.get('pagination[page]')).toBe('1');
    expect(query.get('pagination[pageSize]')).toBe('20');
  });

  it('searches through the URL once typing pauses', async () => {
    const list = await setup();
    await list.open();
    vi.useFakeTimers();
    const input = list.element().querySelector<HTMLInputElement>('input[type="search"]')!;
    input.value = '  news ';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(300);
    vi.useRealTimers();
    await list.settle();
    expect(list.router.url).toContain('_q=news');
    // Searching without a chosen sort lists by rank.
    expect(list.lastQuery().get('_q')).toBe('news');
    expect(list.lastQuery().get('sort')).toBeNull();
  });

  it('sends the URL filters and removes a chip', async () => {
    const list = await setup();
    await list.open(
      `/content/${ARTICLE.uid}?filters[$and][0][title][$contains]=hello&filters[$and][1][views][$gt]=5`,
    );
    const query = list.lastQuery();
    expect(query.get('filters[$and][0][title][$contains]')).toBe('hello');
    expect(query.get('filters[$and][1][views][$gt]')).toBe('5');
    const chips = list.element().querySelectorAll('[role="region"] li');
    expect(chips).toHaveLength(2);

    const remove = chips[0].querySelector('button')!;
    remove.click();
    await list.settle();
    expect(list.router.url).not.toContain('title');
    expect(list.lastQuery().get('filters[$and][0][views][$gt]')).toBe('5');
    expect(list.lastQuery().has('filters[$and][1][views][$gt]')).toBe(false);
  });

  it('applies the conditions built in the filter sheet', async () => {
    const list = await setup();
    await list.open();
    list
      .element()
      .querySelector<HTMLButtonElement>('[aria-label="content.filters.button"]')!
      .click();
    await list.settle();
    const sheet = document.querySelector('hlm-sheet-content')!;
    const value = sheet.querySelector<HTMLInputElement>(
      'input[aria-label="content.filters.value"]',
    )!;
    value.value = 'rust';
    value.dispatchEvent(new Event('input'));
    await list.settle();
    sheet.querySelector('form')!.dispatchEvent(new Event('submit'));
    await list.settle();
    const sent = [...list.lastQuery().entries()].filter(([key]) => key.startsWith('filters'));
    expect(sent).toEqual([['filters[$and][0][title][$eq]', 'rust']]);
    expect(decodeURIComponent(list.router.url)).toContain('filters[$and][0][title][$eq]=rust');
    expect(list.element().querySelectorAll('[role="region"] li')).toHaveLength(1);
  });

  it('pages with the pagination control and back to page 1 on a new sort', async () => {
    const list = await setup({ total: 45 });
    await list.open();
    const nav = () => list.element().querySelector('vd-pagination')!;
    expect(nav().textContent).toContain('common.page {"page":1,"count":3}');
    list.button('common.next')!.click();
    await list.settle();
    expect(list.lastQuery().get('pagination[page]')).toBe('2');
    expect(list.rows()[0].textContent).toContain('Entry 21');
    expect(nav().textContent).toContain('"page":2');

    list.button('common.next')!.click();
    await list.settle();
    expect(list.button('common.next')!.disabled).toBe(true);

    // Sorting by a column starts over.
    const sortTitle = [...list.element().querySelectorAll<HTMLButtonElement>('thead button')].find(
      (item) => item.textContent!.includes('Title'),
    )!;
    sortTitle.click();
    await list.settle();
    expect(list.lastQuery().get('sort')).toBe('title:asc');
    expect(list.lastQuery().get('pagination[page]')).toBe('1');
  });

  it('has no pagination for a single page', async () => {
    const list = await setup({ total: 3 });
    await list.open();
    expect(list.element().querySelector('vd-pagination')).toBeNull();
  });

  it('selects rows, the whole page, and deletes the selection after confirming', async () => {
    const list = await setup({ total: 3 });
    await list.open();
    const rowBox = (index: number) =>
      list.rows()[index].querySelector<HTMLElement>('button[role="checkbox"]')!;
    rowBox(0).click();
    await list.settle();
    expect(list.element().textContent).toContain('content.list.bulk.selected {"count":1}');
    expect(list.rows()[0].getAttribute('data-state')).toBe('selected');

    const pageBox = list.element().querySelector<HTMLElement>('thead button[role="checkbox"]')!;
    // From "some", the header checkbox selects the whole page.
    pageBox.click();
    await list.settle();
    expect(list.element().textContent).toContain('content.list.bulk.selected {"count":3}');

    list.button('common.delete')!.click();
    await list.settle();
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain('content.list.bulk.deleteTitle {"count":3}');
    const confirm = [...dialog.querySelectorAll('button')].find(
      (item) => item.textContent!.trim() === 'common.delete',
    )!;
    confirm.click();
    await list.settle();
    expect(list.deleted).toEqual([
      `/content/${ARTICLE.uid}/doc1`,
      `/content/${ARTICLE.uid}/doc2`,
      `/content/${ARTICLE.uid}/doc3`,
    ]);
    // The list reloads with nothing selected.
    expect(list.element().textContent).not.toContain('content.list.bulk.selected');
  });

  it('clears the selection when the page changes', async () => {
    const list = await setup({ total: 30 });
    await list.open();
    list.rows()[0].querySelector<HTMLElement>('button[role="checkbox"]')!.click();
    await list.settle();
    expect(list.element().textContent).toContain('content.list.bulk.selected {"count":1}');
    list.button('common.next')!.click();
    await list.settle();
    expect(list.element().textContent).not.toContain('content.list.bulk.selected');
  });

  it('shows the columns of the saved view, in its order, with its page size', async () => {
    const list = await setup({
      total: 30,
      views: {
        [ARTICLE.uid]: {
          columns: ['title', 'id', 'views'],
          sort: { field: 'views', descending: false },
          pageSize: 10,
        },
      },
    });
    await list.open();
    const headers = list.headers().slice(1, -1);
    expect(headers).toEqual(['Title', 'content.list.column.id', 'Views']);
    expect(list.lastQuery().get('sort')).toBe('views:asc');
    expect(list.lastQuery().get('pagination[pageSize]')).toBe('10');
    expect(list.rows()).toHaveLength(10);
  });

  it('shows the default columns without a saved view', async () => {
    const list = await setup();
    await list.open();
    // Selection and row actions around: title, the other attributes, then updatedAt.
    expect(list.headers().slice(1, -1)).toEqual(['Title', 'Views', 'Slug', 'content.list.updated']);
  });

  it('hides a column from the view settings and saves the view', async () => {
    const list = await setup();
    await list.open();
    list
      .element()
      .querySelector<HTMLButtonElement>('[aria-label="content.list.view.configure"]')!
      .click();
    await list.settle();
    const sheet = document.querySelector('hlm-sheet-content')!;
    sheet.querySelector<HTMLElement>('#list-column-views')!.click();
    await list.settle();
    [...sheet.querySelectorAll('button')]
      .find((item) => item.textContent!.trim() === 'common.save')!
      .click();
    await list.settle();
    expect(list.preferences.set).toHaveBeenCalledWith(['listViews', ARTICLE.uid], {
      columns: ['title', 'slug', 'updatedAt'],
      sort: { field: 'updatedAt', descending: true },
      pageSize: 20,
    });
    expect(list.headers().slice(1, -1)).toEqual(['Title', 'Slug', 'content.list.updated']);
  });
});
