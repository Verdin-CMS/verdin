import { describe, expect, it } from 'vitest';

import {
  cleanSettings,
  clampSize,
  layoutRows,
  mainFieldOptions,
  moveItem,
  orderedFields,
  packRows,
  viewPayload,
} from './edit-view';
import { Attributes, ContentType } from './types';

const attributes: Attributes = {
  title: { type: 'string' },
  body: { type: 'text' },
  rank: { type: 'integer' },
  author: { type: 'relation', relation: 'manyToOne', target: 'api::person' },
};

describe('edit view layout', () => {
  it('lays every field on its own row without a configuration', () => {
    expect(layoutRows(attributes, null)).toEqual([
      [{ name: 'title', size: 12 }],
      [{ name: 'body', size: 12 }],
      [{ name: 'rank', size: 12 }],
      [{ name: 'author', size: 12 }],
    ]);
  });

  it('keeps configured rows and appends the rest in schema order', () => {
    const view = {
      layout: [
        [
          { name: 'rank', size: 4 },
          { name: 'title', size: 8 },
        ],
        [
          { name: 'gone', size: 6 },
          { name: 'rank', size: 6 },
        ],
      ],
      fields: {},
    };
    expect(layoutRows(attributes, view)).toEqual([
      [
        { name: 'rank', size: 4 },
        { name: 'title', size: 8 },
      ],
      [{ name: 'body', size: 12 }],
      [{ name: 'author', size: 12 }],
    ]);
    // Hidden fields leave their row; emptied rows disappear.
    expect(layoutRows(attributes, view, (name) => name !== 'title' && name !== 'body')).toEqual([
      [{ name: 'rank', size: 4 }],
      [{ name: 'author', size: 12 }],
    ]);
    expect(orderedFields(attributes, view).map((item) => item.name)).toEqual([
      'rank',
      'title',
      'body',
      'author',
    ]);
  });

  it('packs fields into rows of at most 12 columns', () => {
    expect(
      packRows([
        { name: 'a', size: 6 },
        { name: 'b', size: 4 },
        { name: 'c', size: 4 },
        { name: 'd', size: 8 },
        { name: 'e', size: 20 },
      ]),
    ).toEqual([
      [
        { name: 'a', size: 6 },
        { name: 'b', size: 4 },
      ],
      [
        { name: 'c', size: 4 },
        { name: 'd', size: 8 },
      ],
      [{ name: 'e', size: 12 }],
    ]);
    expect(packRows([])).toEqual([]);
    expect(clampSize(0)).toBe(1);
    expect(clampSize(Number.NaN)).toBe(12);
  });

  it('moves items within bounds', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, -5)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });

  it('cleans settings and offers main fields like the server', () => {
    expect(
      cleanSettings(attributes, {
        title: { label: '  Headline ', description: ' ', editable: true },
        rank: { editable: false, mainField: 'x' },
        author: { mainField: 'name' },
        gone: { label: 'x' },
        body: {},
      }),
    ).toEqual({
      title: { label: 'Headline' },
      rank: { editable: false },
      author: { mainField: 'name' },
    });
    const person = {
      uid: 'api::person',
      attributes: {
        name: { type: 'string' },
        secret: { type: 'string', private: true },
        bio: { type: 'blocks' },
        age: { type: 'integer' },
      },
    } as unknown as ContentType;
    expect(mainFieldOptions(person)).toEqual(['name', 'age', 'id', 'documentId']);
    expect(
      viewPayload(
        attributes,
        [
          { name: 'title', size: 8 },
          { name: 'rank', size: 4 },
        ],
        {},
      ),
    ).toEqual({
      layout: [
        [
          { name: 'title', size: 8 },
          { name: 'rank', size: 4 },
        ],
      ],
      fields: {},
    });
  });
});
