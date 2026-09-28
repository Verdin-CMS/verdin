import { describe, expect, it } from 'vitest';

import { listChange } from './list-live';

describe('listChange', () => {
  const listed = new Set(['d1', 'd2']);

  it('marks listed rows, and the page for other entries', () => {
    const update = { event: 'entry.update', uid: 'api::a.a', documentId: 'd1', locale: 'en' };
    expect(listChange(update, 'api::a.a', 'en', listed)).toBe('row');
    expect(listChange({ ...update, documentId: 'd9' }, 'api::a.a', 'en', listed)).toBe('list');
    expect(
      listChange({ ...update, event: 'entry.create', documentId: 'd9' }, 'api::a.a', 'en', listed),
    ).toBe('list');
  });

  it('ignores other types, other locales and non-entry events', () => {
    const update = { event: 'entry.update', uid: 'api::a.a', documentId: 'd1', locale: 'en' };
    expect(listChange({ ...update, uid: 'api::b.b' }, 'api::a.a', 'en', listed)).toBeNull();
    expect(listChange({ ...update, locale: 'fr' }, 'api::a.a', 'en', listed)).toBeNull();
    expect(listChange({ ...update, event: 'comment.create' }, 'api::a.a', 'en', listed)).toBeNull();
    // Deleting a document removes it in every locale.
    expect(
      listChange({ ...update, event: 'entry.delete', locale: 'fr' }, 'api::a.a', 'en', listed),
    ).toBe('row');
    // Types that are not localized.
    expect(listChange({ ...update, locale: undefined }, 'api::a.a', null, listed)).toBe('row');
  });
});
