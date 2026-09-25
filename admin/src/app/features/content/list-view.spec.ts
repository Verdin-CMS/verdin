import { describe, expect, it } from 'vitest';

import { ContentType } from '../../core/types';
import {
  availableColumns,
  defaultView,
  isDefaultView,
  mainColumn,
  moveColumn,
  resolveView,
} from './list-view';

const article: ContentType = {
  uid: 'api::article.article',
  kind: 'collectionType',
  singularName: 'article',
  pluralName: 'articles',
  displayName: 'Article',
  draftAndPublish: true,
  attributes: {
    title: { type: 'string' },
    body: { type: 'richtext' },
    slug: { type: 'uid' },
    views: { type: 'integer' },
    secret: { type: 'string', private: true },
    featured: { type: 'boolean' },
    rating: { type: 'decimal' },
    cover: { type: 'media' },
  },
};
const plain: ContentType = { ...article, uid: 'api::tag.tag', draftAndPublish: false };

describe('columns', () => {
  it('lists scalar, non-private attributes then the built-in columns', () => {
    expect(availableColumns(article).map((column) => column.name)).toEqual([
      'title',
      'slug',
      'views',
      'featured',
      'rating',
      'id',
      'status',
      'createdAt',
      'updatedAt',
      'publishedAt',
    ]);
    expect(availableColumns(plain).map((column) => column.name)).not.toContain('status');
    expect(availableColumns(plain).map((column) => column.name)).not.toContain('publishedAt');
    expect(availableColumns(article).find((column) => column.name === 'status')?.sortable).toBe(
      false,
    );
  });

  it('picks the title field as the main column, else the first attribute, else id', () => {
    expect(mainColumn(article, 'title')).toBe('title');
    expect(mainColumn(article, 'body')).toBe('title');
    expect(mainColumn(article, null)).toBe('title');
    expect(mainColumn({ ...article, attributes: { cover: { type: 'media' } } }, null)).toBe('id');
  });

  it('defaults to the main column, three more attributes, status and updated', () => {
    expect(defaultView(article, 'title')).toEqual({
      columns: ['title', 'slug', 'views', 'featured', 'status', 'updatedAt'],
      sort: { field: 'updatedAt', descending: true },
      pageSize: 20,
    });
    expect(defaultView(plain, 'title').columns).toEqual([
      'title',
      'slug',
      'views',
      'featured',
      'updatedAt',
    ]);
  });
});

describe('resolveView', () => {
  it('uses the default for anything that is not an object', () => {
    for (const saved of [undefined, null, 'x', 3]) {
      expect(resolveView(saved, article, 'title')).toEqual(defaultView(article, 'title'));
    }
  });

  it('keeps a valid saved view as is', () => {
    const saved = {
      columns: ['rating', 'title', 'id'],
      sort: { field: 'rating', descending: false },
      pageSize: 50,
    };
    expect(resolveView(saved, article, 'title')).toEqual(saved);
  });

  it('drops columns the schema no longer has, duplicates and private ones', () => {
    const view = resolveView(
      { columns: ['views', 'removed', 'secret', 'body', 'views', 7, 'title'] },
      article,
      'title',
    );
    expect(view.columns).toEqual(['views', 'title']);
  });

  it('always shows the main column', () => {
    expect(resolveView({ columns: ['views'] }, article, 'title').columns).toEqual([
      'title',
      'views',
    ]);
    expect(resolveView({ columns: [] }, article, 'title').columns).toEqual(['title']);
  });

  it('drops draft & publish columns from a type without it', () => {
    expect(
      resolveView({ columns: ['title', 'status', 'publishedAt'] }, plain, 'title').columns,
    ).toEqual(['title']);
  });

  it('falls back on an unknown or unsortable sort and an unsupported page size', () => {
    const fallback = defaultView(article, 'title');
    for (const sort of [
      { field: 'removed', descending: true },
      { field: 'status', descending: true },
      { field: 'title' },
      'title:asc',
    ]) {
      expect(resolveView({ sort }, article, 'title').sort).toEqual(fallback.sort);
    }
    expect(resolveView({ pageSize: 25 }, article, 'title').pageSize).toBe(20);
    expect(resolveView({ pageSize: '50' }, article, 'title').pageSize).toBe(20);
    expect(resolveView({ pageSize: 100 }, article, 'title').pageSize).toBe(100);
  });

  it('keeps the default columns when only the sort was saved', () => {
    const view = resolveView({ sort: { field: 'id', descending: false } }, article, 'title');
    expect(view.columns).toEqual(defaultView(article, 'title').columns);
    expect(view.sort).toEqual({ field: 'id', descending: false });
  });
});

describe('helpers', () => {
  it('recognises the default view', () => {
    const view = defaultView(article, 'title');
    expect(isDefaultView(view, article, 'title')).toBe(true);
    expect(isDefaultView({ ...view, pageSize: 50 }, article, 'title')).toBe(false);
    expect(isDefaultView({ ...view, columns: [...view.columns].reverse() }, article, 'title')).toBe(
      false,
    );
  });

  it('moves a column up or down, clamped to the ends', () => {
    expect(moveColumn(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveColumn(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    expect(moveColumn(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveColumn(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });
});
