import { describe, expect, it } from 'vitest';

import { isMorph, isMorphOwner, morphLinks } from './morph';
import { Attribute } from './types';

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
