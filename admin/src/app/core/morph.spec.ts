import { describe, expect, it } from 'vitest';

import {
  addMorphRefs,
  isMorph,
  isMorphOwner,
  morphKey,
  morphLinks,
  morphRefs,
  morphSearchLocale,
  morphSearchQuery,
  morphTargetTypes,
  morphValue,
  toggleMorphPick,
} from './morph';
import { Attribute, ContentType } from './types';

const owner: Attribute = { type: 'relation', relation: 'morphToMany' };
const inverse: Attribute = {
  type: 'relation',
  relation: 'morphMany',
  target: 'api::comment.comment',
  morphBy: 'related',
};

describe('polymorphic relations', () => {
  it('recognises morph kinds, owners and inverse sides', () => {
    expect(isMorph(owner)).toBe(true);
    expect(isMorph(inverse)).toBe(true);
    expect(isMorph({ type: 'relation', relation: 'morphToOne' })).toBe(true);
    expect(isMorph({ type: 'relation', relation: 'manyToOne', target: 'api::tag.tag' })).toBe(
      false,
    );
    expect(isMorph({ type: 'string' })).toBe(false);
    expect(isMorph(null)).toBe(false);
    expect(isMorphOwner(owner)).toBe(true);
    expect(isMorphOwner(inverse)).toBe(false);
  });

  it('reads populated links from lists, objects and null', () => {
    const article = { __type: 'api::article.article', documentId: 'a1', title: 'Hello' };
    expect(morphLinks([article, { __type: 'api::page.page', documentId: 'p1' }])).toEqual([
      { uid: 'api::article.article', documentId: 'a1', entry: article },
      {
        uid: 'api::page.page',
        documentId: 'p1',
        entry: { __type: 'api::page.page', documentId: 'p1' },
      },
    ]);
    expect(morphLinks(article)).toHaveLength(1);
    expect(morphLinks(null)).toEqual([]);
    expect(morphLinks(undefined)).toEqual([]);
    // Inverse sides: items without `__type` are of the owner type.
    expect(morphLinks([{ documentId: 'c1', body: 'Hi' }], 'api::comment.comment')).toEqual([
      { uid: 'api::comment.comment', documentId: 'c1', entry: { documentId: 'c1', body: 'Hi' } },
    ]);
    // Unpopulated or malformed items are skipped.
    expect(morphLinks(['a1', { documentId: 'x' }, { __type: 'api::a.a' }, 3])).toEqual([]);
  });
});

describe('editing polymorphic owners', () => {
  const a1 = { __type: 'api::article', documentId: 'x1' };
  const p1 = { __type: 'api::page', documentId: 'x1' };
  const p2 = { __type: 'api::page', documentId: 'p2' };

  it('keys links by type and documentId', () => {
    expect(morphKey(a1)).toBe('api::article:x1');
    expect(morphKey({ uid: 'api::page', documentId: 'x1' })).toBe(morphKey(p1));
    expect(morphKey(a1)).not.toBe(morphKey(p1));
  });

  it('reads form values and writes them back per kind', () => {
    expect(morphRefs([{ ...a1, title: 'Hi' }, p2])).toEqual([a1, p2]);
    expect(morphRefs(p1)).toEqual([p1]);
    expect(morphRefs(null)).toEqual([]);
    expect(morphValue([a1, p2], true)).toEqual([a1, p2]);
    expect(morphValue([a1, p2], false)).toEqual(a1);
    expect(morphValue([], false)).toBeNull();
    expect(morphValue([], true)).toEqual([]);
  });

  it('adds picked links: to-many appends new ones, to-one replaces', () => {
    expect(addMorphRefs([a1], [p1, a1, p2, p1], true)).toEqual([a1, p1, p2]);
    expect(addMorphRefs([a1], [p2], false)).toEqual([p2]);
    expect(addMorphRefs([a1], [], false)).toEqual([a1]);
  });

  it('toggles picker choices, never picking a linked entry again', () => {
    // To-many: in and out, in pick order.
    let chosen = toggleMorphPick([], p1, true, [a1]);
    chosen = toggleMorphPick(chosen, p2, true, [a1]);
    expect(chosen).toEqual([p1, p2]);
    expect(toggleMorphPick(chosen, p1, true, [a1])).toEqual([p2]);
    // Linked entries are skipped (same documentId in another type is not linked).
    expect(toggleMorphPick(chosen, a1, true, [a1])).toEqual([p1, p2]);
    // To-one: a single choice.
    expect(toggleMorphPick([p1], p2, false, [])).toEqual([p2]);
    expect(toggleMorphPick([p2], p2, false, [])).toEqual([]);
    expect(toggleMorphPick([], a1, false, [a1])).toEqual([]);
  });

  it('offers the readable types by name and searches them with _q', () => {
    const type = (uid: string, displayName: string, localized = false): ContentType => ({
      uid,
      kind: 'collectionType',
      singularName: uid,
      pluralName: uid,
      displayName,
      draftAndPublish: false,
      attributes: {},
      pluginOptions: localized ? { i18n: { localized: true } } : undefined,
    });
    const types = [
      type('api::page', 'Page'),
      type('api::secret', 'Secret'),
      type('api::art', 'Art'),
    ];
    expect(
      morphTargetTypes(types, (uid) => uid !== 'api::secret').map((item) => item.displayName),
    ).toEqual(['Art', 'Page']);

    const localized = type('api::post', 'Post', true);
    expect(morphSearchLocale(localized, 'fr', 'en')).toBe('fr');
    expect(morphSearchLocale(localized, null, 'en')).toBe('en');
    expect(morphSearchLocale(types[0], 'fr', 'en')).toBeNull();
    expect(morphSearchQuery('  rust ', 'fr')).toEqual({
      pagination: { pageSize: 10 },
      sort: 'updatedAt:desc',
      _q: 'rust',
      locale: 'fr',
    });
    expect(morphSearchQuery('', null)).toEqual({
      pagination: { pageSize: 10 },
      sort: 'updatedAt:desc',
    });
  });
});
