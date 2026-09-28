import { describe, expect, it } from 'vitest';

import { toQuery } from '../../core/api';
import { ContentType } from '../../core/types';
import {
  FilterCondition,
  blankCondition,
  filterParams,
  filterTree,
  filterableFields,
  isComplete,
  isFilterParam,
  operatorsFor,
  parseFilterParams,
  withOperator,
} from './list-filters';

const article: ContentType = {
  uid: 'api::article',
  kind: 'collectionType',
  singularName: 'article',
  pluralName: 'articles',
  displayName: 'Article',
  draftAndPublish: true,
  attributes: {
    title: { type: 'string' },
    views: { type: 'integer' },
    featured: { type: 'boolean' },
    kind: { type: 'enumeration', enum: ['news', 'guide', 'review'] },
    day: { type: 'date' },
    at: { type: 'datetime' },
    secret: { type: 'password', private: true },
    notes: { type: 'string', private: true },
    body: { type: 'blocks' },
    author: { type: 'relation', relation: 'manyToOne', target: 'api::author' },
    tags: { type: 'relation', relation: 'manyToMany', target: 'api::tag' },
    // Polymorphic relations: the API rejects filters on them.
    related: { type: 'relation', relation: 'morphToMany' },
    comments: { type: 'relation', relation: 'morphMany', target: 'api::comment', morphBy: 'on' },
  },
};

const mainField = (target: string) => (target === 'api::author' ? 'name' : null);
const fields = filterableFields(article, mainField);

/** URL parameters → conditions → parameters again. */
function roundTrip(conditions: FilterCondition[]): FilterCondition[] {
  return parseFilterParams(filterParams(conditions), fields);
}

describe('filterableFields', () => {
  it('offers public scalars, relations by main field or documentId, and system fields', () => {
    expect(fields.map((field) => field.key)).toEqual([
      'title',
      'views',
      'featured',
      'kind',
      'day',
      'at',
      'author.name',
      'author.documentId',
      'tags.documentId',
      'id',
      'createdAt',
      'updatedAt',
    ]);
  });

  it('leaves out polymorphic relations, even from the URL', () => {
    expect(fields.some((field) => field.field === 'related' || field.field === 'comments')).toBe(
      false,
    );
    expect(parseFilterParams({ 'filters[$and][0][related][$null]': 'true' }, fields)).toEqual([]);
  });

  it('picks operators by kind', () => {
    const byKey = (key: string) => fields.find((field) => field.key === key)!;
    expect(operatorsFor(byKey('title'))).toContain('$startsWith');
    expect(operatorsFor(byKey('views'))).toContain('$gte');
    expect(operatorsFor(byKey('views'))).not.toContain('$contains');
    expect(operatorsFor(byKey('kind'))).toContain('$in');
    expect(operatorsFor(byKey('at'))).not.toContain('$eq');
    expect(operatorsFor(byKey('featured'))).toEqual(['$eq', '$null', '$notNull']);
    expect(operatorsFor(byKey('author.documentId'))).toEqual(['$eq', '$ne', '$null', '$notNull']);
  });
});

describe('filter query strings', () => {
  it('writes the API bracket syntax, ANDed', () => {
    const query = toQuery({
      filters: filterTree([
        { field: 'title', operator: '$contains', value: ' hello ' },
        { field: 'author', path: 'name', operator: '$eq', value: 'Ada' },
        { field: 'kind', operator: '$in', value: ['news', 'guide'] },
        { field: 'tags', path: 'documentId', operator: '$null', value: '' },
      ]),
    });
    expect(decodeURIComponent(query).split('&')).toEqual([
      'filters[$and][0][title][$contains]=hello',
      'filters[$and][1][author][name][$eq]=Ada',
      'filters[$and][2][kind][$in][0]=news',
      'filters[$and][2][kind][$in][1]=guide',
      'filters[$and][3][tags][$null]=true',
    ]);
  });

  it('leaves out incomplete conditions', () => {
    expect(isComplete({ field: 'title', operator: '$eq', value: '  ' })).toBe(false);
    expect(isComplete({ field: 'kind', operator: '$in', value: [] })).toBe(false);
    expect(isComplete({ field: 'title', operator: '$null', value: '' })).toBe(true);
    expect(filterTree([{ field: 'title', operator: '$eq', value: '' }])).toEqual({});
    expect(filterParams([])).toEqual({});
  });

  it('round-trips through the URL', () => {
    const conditions: FilterCondition[] = [
      { field: 'title', operator: '$startsWith', value: 'How' },
      { field: 'views', operator: '$gte', value: '10' },
      { field: 'featured', operator: '$eq', value: 'true' },
      { field: 'kind', operator: '$in', value: ['review', 'news'] },
      { field: 'day', operator: '$lt', value: '2026-09-01' },
      { field: 'at', operator: '$gt', value: '2026-09-01' },
      { field: 'author', path: 'name', operator: '$notContains', value: 'Bot' },
      { field: 'author', path: 'name', operator: '$notNull', value: '' },
      { field: 'tags', path: 'documentId', operator: '$eq', value: 'abc123' },
      { field: 'createdAt', operator: '$lte', value: '2026-01-01T00:00:00.000Z' },
      // Two conditions on the same field and operator do not collide.
      { field: 'title', operator: '$ne', value: 'A' },
      { field: 'title', operator: '$ne', value: 'B' },
    ];
    expect(roundTrip(conditions)).toEqual(conditions);
  });

  it('reads a relation null test back on its first field', () => {
    expect(
      roundTrip([{ field: 'author', path: 'documentId', operator: '$null', value: '' }]),
    ).toEqual([{ field: 'author', path: 'name', operator: '$null', value: '' }]);
  });

  it('keeps the order of the indexes and ignores other parameters', () => {
    const params = {
      page: '2',
      'filters[$and][10][views][$gt]': '1',
      'filters[$and][2][title][$eq]': 'x',
    };
    expect(parseFilterParams(params, fields)).toEqual([
      { field: 'title', operator: '$eq', value: 'x' },
      { field: 'views', operator: '$gt', value: '1' },
    ]);
    expect(Object.keys(params).filter(isFilterParam)).toHaveLength(2);
  });

  it('drops what does not fit the type', () => {
    const params = {
      'filters[$and][0][secret][$eq]': 'x', // private
      'filters[$and][1][nope][$eq]': 'x', // unknown field
      'filters[$and][2][title][$gt]': 'x', // text is not ordered
      'filters[$and][3][views][$eq]': 'ten', // not a number
      'filters[$and][4][kind][$in][0]': 'other', // not an option
      'filters[$and][5][author][$eq]': 'x', // a relation needs a field
      'filters[$and][6][title][$null]': 'false',
      'filters[$and][7][day][$eq]': '09/01/2026',
      'filters[$and][8][body][$null]': 'true', // blocks are not filterable
      'filters[title][$eq]': 'x', // not in $and
    };
    expect(parseFilterParams(params, fields)).toEqual([]);
  });
});

describe('editing conditions', () => {
  it('starts with the first operator', () => {
    const featured = fields.find((field) => field.key === 'featured')!;
    expect(blankCondition(featured)).toEqual({ field: 'featured', operator: '$eq', value: 'true' });
    const author = fields.find((field) => field.key === 'author.name')!;
    expect(blankCondition(author)).toEqual({
      field: 'author',
      path: 'name',
      operator: '$eq',
      value: '',
    });
  });

  it('converts the value between single and list operators', () => {
    const one: FilterCondition = { field: 'kind', operator: '$eq', value: 'news' };
    const list = withOperator(one, '$in');
    expect(list.value).toEqual(['news']);
    expect(withOperator(list, '$ne').value).toBe('news');
    expect(withOperator({ ...one, value: '' }, '$in').value).toEqual([]);
  });
});
