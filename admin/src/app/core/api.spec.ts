import { describe, expect, it } from 'vitest';

import { attachmentName, collectPages } from './api';

describe('attachmentName', () => {
  it('reads the quoted, plain and encoded forms', () => {
    expect(attachmentName('attachment; filename="articles-2026-09-29.csv"')).toBe(
      'articles-2026-09-29.csv',
    );
    expect(attachmentName('attachment; filename=export.json')).toBe('export.json');
    expect(
      attachmentName(`attachment; filename="fallback.csv"; filename*=UTF-8''caf%C3%A9.csv`),
    ).toBe('café.csv');
  });

  it('has nothing without a header or a name', () => {
    expect(attachmentName(null)).toBeNull();
    expect(attachmentName('attachment')).toBeNull();
  });
});

describe('collectPages', () => {
  const page = (data: number[], pageCount: number) => ({
    data,
    meta: { pagination: { pageCount } },
  });

  it('walks every page', async () => {
    const pages = [page([1, 2], 3), page([3, 4], 3), page([5], 3)];
    const asked: number[] = [];
    const rows = await collectPages(async (n) => {
      asked.push(n);
      return pages[n - 1];
    });
    expect(rows).toEqual([1, 2, 3, 4, 5]);
    expect(asked).toEqual([1, 2, 3]);
  });

  it('stops on an empty page, without pagination, or at the cap', async () => {
    expect(await collectPages(async () => page([], 5))).toEqual([]);
    expect(await collectPages(async () => ({ data: [1], meta: {} }))).toEqual([1]);
    expect(await collectPages(async (n) => page([n], 1000), 3)).toEqual([1, 2, 3]);
  });
});
