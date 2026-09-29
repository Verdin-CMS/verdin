import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AiActions } from '../../core/ai';
import { Auth } from '../../core/auth';
import { I18n } from '../../core/i18n/i18n';
import { Media, MediaQuery } from '../../core/media';
import { Schema } from '../../core/schema';
import { MediaFile, MediaFolder } from '../../core/types';
import { Usages } from '../../core/usage';
import { ICONS } from '../../icons';
import { MediaLibraryPage } from './library';
import { MediaPicker } from './picker';

const file = (id: number): MediaFile =>
  ({
    id,
    documentId: `f${id}`,
    name: `photo-${id}.png`,
    alternativeText: null,
    caption: null,
    width: 10,
    height: 10,
    focalPoint: null,
    formats: null,
    hash: `h${id}`,
    ext: '.png',
    mime: 'image/png',
    size: 12,
    url: `/uploads/photo-${id}.png`,
    previewUrl: null,
    provider: 'local',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    folder: null,
    createdBy: 1,
  }) as MediaFile;

const FOLDER: MediaFolder = {
  id: 7,
  name: 'Holidays',
  parent: null,
  childrenCount: 0,
  filesCount: 2,
} as unknown as MediaFolder;

function t(key: string, params?: Record<string, unknown>): string {
  return params ? `${key} ${JSON.stringify(params)}` : key;
}

function setup(total = 5, pageSize = 30) {
  const all = Array.from({ length: total }, (_, index) => file(index + 1));
  const queries: MediaQuery[] = [];
  const media = {
    list: vi.fn(async (query: MediaQuery) => {
      queries.push(query);
      const page = query.page ?? 1;
      const size = query.pageSize ?? pageSize;
      return {
        data: all.slice((page - 1) * size, page * size),
        meta: { pagination: { page, pageSize: size, total, pageCount: Math.ceil(total / size) } },
      };
    }),
    folders: vi.fn(async () => [FOLDER]),
    allFolders: vi.fn(async () => [FOLDER]),
    delete: vi.fn(async (_id: number) => undefined),
    url: (url: string) => url,
    preview: (item: MediaFile) => item.url,
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideIcons(ICONS),
      { provide: Media, useValue: media },
      {
        provide: Auth,
        useValue: {
          can: () => true,
          mediaGrant: () => 'all',
          user: signal({ id: 1 }),
        },
      },
      {
        provide: Usages,
        useValue: { many: async () => ({ data: [], hidden: 0 }), forFile: vi.fn() },
      },
      { provide: Schema, useValue: { type: () => undefined } },
      { provide: AiActions, useValue: { load: async () => undefined, enabled: () => false } },
      {
        provide: I18n,
        useValue: {
          t,
          formatDate: (value: string) => value,
          formatRelative: (value: string) => value,
          formatNumber: (value: unknown) => String(value),
          endSide: () => 'right',
        },
      },
    ],
  });
  const lastQuery = () => queries[queries.length - 1];
  return { media, queries, lastQuery };
}

async function settle(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) {
  for (let round = 0; round < 3; round++) {
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
  }
}

const buttonByText = (root: ParentNode, text: string) =>
  [...root.querySelectorAll('button')].find((item) => item.textContent!.trim() === text) as
    HTMLButtonElement | undefined;

describe('MediaLibraryPage', () => {
  afterEach(() => {
    vi.useRealTimers();
    try {
      localStorage.clear();
    } catch {
      // No storage in this environment.
    }
  });

  async function open(total = 5) {
    const mocks = setup(total);
    const fixture = TestBed.createComponent(MediaLibraryPage);
    fixture.detectChanges();
    await settle(fixture);
    return { ...mocks, fixture, element: fixture.nativeElement as HTMLElement };
  }

  it('lists the root folder, its folders and files', async () => {
    const page = await open();
    expect(page.lastQuery()).toMatchObject({ folder: 'root', page: 1, pageSize: 30 });
    expect(page.element.textContent).toContain('Holidays');
    expect(page.element.querySelectorAll('[aria-label^="media.file.open"]')).toHaveLength(5);
  });

  it('searches once typing pauses, filters by kind and sorts', async () => {
    const page = await open();
    vi.useFakeTimers();
    const input = page.element.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.value = ' sunset ';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(300);
    vi.useRealTimers();
    await settle(page.fixture);
    expect(page.lastQuery()).toMatchObject({ search: 'sunset', page: 1 });
    // Searching hides the folders.
    expect(page.element.textContent).not.toContain('Holidays');

    const [kind, sort] = page.element.querySelectorAll('select');
    kind.value = 'images';
    kind.dispatchEvent(new Event('change'));
    await settle(page.fixture);
    expect(page.lastQuery()).toMatchObject({ search: 'sunset', types: ['images'] });

    sort.value = 'nameAsc';
    sort.dispatchEvent(new Event('change'));
    await settle(page.fixture);
    expect(page.lastQuery()).toMatchObject({ sort: 'nameAsc', types: ['images'] });
  });

  it('pages through the files', async () => {
    const page = await open(65);
    const pager = () => page.element.querySelector('vd-pagination')!;
    expect(pager().textContent).toContain(
      'media.total {"count":65} · common.page {"page":1,"count":3}',
    );
    buttonByText(page.element, 'common.next')!.click();
    await settle(page.fixture);
    expect(page.lastQuery().page).toBe(2);
    expect(page.element.textContent).toContain('photo-31.png');
    // Folders show on the first page only.
    expect(page.element.textContent).not.toContain('Holidays');
    buttonByText(page.element, 'common.previous')!.click();
    await settle(page.fixture);
    expect(page.lastQuery().page).toBe(1);
  });

  it('selects files and deletes the selection after confirming', async () => {
    const page = await open(3);
    const boxes = () =>
      [...page.element.querySelectorAll<HTMLElement>('button[role="checkbox"]')].filter((box) =>
        box.getAttribute('aria-label')?.startsWith('media.selection.select'),
      );
    boxes()[0].click();
    await settle(page.fixture);
    expect(page.element.textContent).toContain('media.selection.count {"count":1}');

    // "Select all" takes every file of the page.
    const all = page.element.querySelector<HTMLElement>('label button[role="checkbox"]')!;
    all.click();
    await settle(page.fixture);
    expect(page.element.textContent).toContain('media.selection.count {"count":3}');

    buttonByText(page.element, 'media.selection.delete {"count":3}')!.click();
    await settle(page.fixture);
    const dialog = document.querySelector('[role="alertdialog"]')!;
    buttonByText(dialog, 'common.delete')!.click();
    await settle(page.fixture);
    expect(page.media.delete.mock.calls.map(([id]) => id)).toEqual([1, 2, 3]);
    expect(page.element.textContent).not.toContain('media.selection.count');
  });

  it('switches between the grid and the list', async () => {
    const page = await open(2);
    expect(page.element.querySelector('table')).toBeNull();
    page.element.querySelector<HTMLElement>('[aria-label="media.view.list"]')!.click();
    await settle(page.fixture);
    const rows = page.element.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('photo-1.png');
  });
});

describe('MediaPicker', () => {
  it('shares the listing: search, paging and picking files', async () => {
    const mocks = setup(40);
    const fixture = TestBed.createComponent(MediaPicker);
    fixture.componentRef.setInput('allowedTypes', ['images']);
    fixture.componentRef.setInput('multiple', true);
    fixture.componentRef.setInput('selected', [2]);
    const picked: MediaFile[][] = [];
    fixture.componentInstance.picked.subscribe((files) => picked.push(files));
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await settle(fixture);
    const dialog = document.querySelector('hlm-dialog-content')!;
    expect(mocks.lastQuery()).toMatchObject({ folder: 'root', types: ['images'], pageSize: 24 });
    // One allowed kind: no kind filter.
    expect(dialog.querySelector('select')).toBeNull();

    const tiles = () => [...dialog.querySelectorAll<HTMLButtonElement>('ul button[aria-label]')];
    // Already in the field: shown checked, not picked again.
    expect(tiles()[1].disabled).toBe(true);
    tiles()[0].click();
    tiles()[2].click();
    await settle(fixture);
    expect(tiles()[0].getAttribute('aria-pressed')).toBe('true');

    const next = dialog.querySelector<HTMLButtonElement>('[aria-label="common.next"]')!;
    next.click();
    await settle(fixture);
    expect(mocks.lastQuery().page).toBe(2);

    buttonByText(dialog, 'media.picker.add {"count":2}')!.click();
    expect(picked).toEqual([[file(1), file(3)]]);
  });
});
