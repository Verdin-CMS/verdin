import { describe, expect, it } from 'vitest';

import { Usage, firstPlaces, groupUsages, mergeUsages, usageEntryCount } from './usage';

const usage = (overrides: Partial<Usage>): Usage => ({
  uid: 'api::article.article',
  documentId: 'a1',
  status: 'draft',
  field: 'cover',
  ...overrides,
});

const names: Record<string, string> = {
  'api::article.article': 'Articles',
  'api::page.page': 'Pages',
};
const label = (uid: string) => names[uid] ?? uid;

describe('groupUsages', () => {
  it('merges the versions and fields of one entry and groups entries by type name', () => {
    const groups = groupUsages(
      [
        usage({ uid: 'api::page.page', documentId: 'p1', field: 'hero', title: 'Home' }),
        usage({ status: 'published', title: 'Old title' }),
        usage({ title: 'Hello' }),
        usage({ field: 'seo.image', title: 'Hello' }),
        usage({ documentId: 'a2', title: '  ' }),
      ],
      label,
    );
    expect(groups.map((group) => group.uid)).toEqual(['api::article.article', 'api::page.page']);
    expect(groups[0].entries).toEqual([
      {
        uid: 'api::article.article',
        documentId: 'a1',
        locale: null,
        title: 'Hello',
        fields: ['cover', 'seo.image'],
        statuses: ['draft', 'published'],
      },
      {
        uid: 'api::article.article',
        documentId: 'a2',
        locale: null,
        title: null,
        fields: ['cover'],
        statuses: ['draft'],
      },
    ]);
    expect(groups[1].entries[0].title).toBe('Home');
  });

  it('keeps the locales of a document apart', () => {
    const [group] = groupUsages([usage({ locale: 'en' }), usage({ locale: 'fr' })]);
    expect(group.entries.map((entry) => entry.locale)).toEqual(['en', 'fr']);
  });

  it('names an entry by its published title when the draft has none', () => {
    const [group] = groupUsages([usage({ status: 'published', title: 'Live' }), usage({})]);
    expect(group.entries[0].title).toBe('Live');
  });
});

describe('mergeUsages', () => {
  it('drops duplicates and excluded usages and adds up the hidden counts', () => {
    const merged = mergeUsages(
      [
        { data: [usage({}), usage({ documentId: 'gone' })], hidden: 2 },
        { data: [usage({}), usage({ field: 'gallery' })], hidden: 1 },
      ],
      (item) => item.documentId === 'gone',
    );
    expect(merged.hidden).toBe(3);
    expect(merged.data.map((item) => item.field)).toEqual(['cover', 'gallery']);
    expect(usageEntryCount(merged)).toBe(1);
  });
});

describe('firstPlaces', () => {
  it('lists the first entries, type by type', () => {
    const result = {
      data: [
        usage({ uid: 'api::page.page', documentId: 'p1' }),
        usage({ documentId: 'a1' }),
        usage({ documentId: 'a2' }),
        usage({ documentId: 'a3' }),
      ],
      hidden: 0,
    };
    expect(firstPlaces(result, 3, label).map((entry) => entry.documentId)).toEqual([
      'a1',
      'a2',
      'a3',
    ]);
    expect(usageEntryCount(result)).toBe(4);
  });
});
