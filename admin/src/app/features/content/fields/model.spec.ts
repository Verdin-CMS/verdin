import { describe, expect, it } from 'vitest';

import { Component } from '../../../core/types';
import { mediaFilesOf, referencesOf, toModel, toPayload } from './model';

const seo: Component = {
  uid: 'shared.seo',
  category: 'shared',
  displayName: 'SEO',
  attributes: { metaTitle: { type: 'string' }, noIndex: { type: 'boolean', default: false } },
};
const hero: Component = {
  uid: 'blocks.hero',
  category: 'blocks',
  displayName: 'Hero',
  attributes: { title: { type: 'string' } },
};
const components = (uid: string) => [seo, hero].find((component) => component.uid === uid);

const attributes = {
  title: { type: 'string' as const, required: true },
  slug: { type: 'uid' as const, unique: true },
  views: { type: 'integer' as const },
  starts: { type: 'time' as const },
  category: { type: 'relation' as const, relation: 'manyToOne' as const, target: 'api::category' },
  tags: { type: 'relation' as const, relation: 'manyToMany' as const, target: 'api::tag' },
  articles: {
    type: 'relation' as const,
    relation: 'oneToMany' as const,
    target: 'api::article',
    mappedBy: 'category',
  },
  seo: { type: 'component' as const, component: 'shared.seo' },
  blocks: { type: 'dynamiczone' as const, components: ['blocks.hero'] },
};

describe('form model', () => {
  it('fills empty values and defaults for a new document', () => {
    const model = toModel(attributes, null, components);
    expect(model).toMatchObject({
      title: '',
      slug: '',
      views: null,
      category: null,
      tags: [],
      seo: null,
      blocks: [],
    });
  });

  it('turns populated relations into documentIds and keeps component ids', () => {
    const model = toModel(
      attributes,
      {
        title: 'Hello',
        starts: '10:30:00.000',
        category: { id: 1, documentId: 'c1', name: 'News' },
        tags: [{ documentId: 't1' }, { documentId: 't2' }],
        seo: { id: 4, metaTitle: 'Meta' },
        blocks: [{ id: 5, __component: 'blocks.hero', title: 'Hi' }],
      },
      components,
    );
    expect(model['category']).toBe('c1');
    expect(model['tags']).toEqual(['t1', 't2']);
    expect(model['starts']).toBe('10:30:00');
    expect(model['seo']).toMatchObject({ id: 4, metaTitle: 'Meta', noIndex: false });
    expect(model['blocks']).toMatchObject([{ id: 5, __component: 'blocks.hero', title: 'Hi' }]);
  });

  it('builds the payload: empty strings are null, read-only sides and render keys are dropped', () => {
    const model = toModel(attributes, null, components);
    model['title'] = 'Hello';
    model['blocks'] = [{ __key: 'k1', __component: 'blocks.hero', title: 'Hero' }];
    model['seo'] = { __key: 'k2', id: 4, metaTitle: 'Meta', noIndex: true };
    const payload = toPayload(attributes, model, components);
    expect(payload).toEqual({
      title: 'Hello',
      slug: null,
      views: null,
      starts: null,
      category: null,
      tags: [],
      seo: { id: 4, metaTitle: 'Meta', noIndex: true },
      blocks: [{ __component: 'blocks.hero', title: 'Hero' }],
    });
    expect(payload).not.toHaveProperty('articles');
  });

  describe('media', () => {
    const media = {
      cover: { type: 'media' as const, allowedTypes: ['images' as const] },
      gallery: { type: 'media' as const, multiple: true },
    };
    const file = (id: number) => ({ id, documentId: `f${id}`, name: `photo-${id}.png` });

    it('is empty as null (single) or [] (multiple)', () => {
      expect(toModel(media, null, components)).toEqual({ cover: null, gallery: [] });
    });

    it('maps populated files to ids, keeping the order', () => {
      const model = toModel(media, { cover: file(3), gallery: [file(9), file(2)] }, components);
      expect(model).toEqual({ cover: 3, gallery: [9, 2] });
    });

    it('keeps the populated files for previews', () => {
      const files = mediaFilesOf(media, { cover: file(3), gallery: [file(9), file(2)] });
      expect(files['cover'].map((item) => item.id)).toEqual([3]);
      expect(files['gallery'].map((item) => item.id)).toEqual([9, 2]);
      expect(mediaFilesOf(media, null)).toEqual({ cover: [], gallery: [] });
    });

    it('sends ids in the payload', () => {
      expect(toPayload(media, { cover: 3, gallery: [9, 2] }, components)).toEqual({
        cover: 3,
        gallery: [9, 2],
      });
      expect(toPayload(media, { cover: null, gallery: [] }, components)).toEqual({
        cover: null,
        gallery: [],
      });
    });
  });

  describe('blocks', () => {
    const rich = { body: { type: 'blocks' as const } };
    const paragraph = [{ type: 'paragraph', children: [{ type: 'text', text: 'Hi' }] }];

    it('is empty as null and keeps the JSON as is', () => {
      expect(toModel(rich, null, components)).toEqual({ body: null });
      expect(toModel(rich, { body: paragraph }, components)).toEqual({ body: paragraph });
    });

    it('sends null for an empty editor', () => {
      expect(toPayload(rich, { body: null }, components)).toEqual({ body: null });
      expect(toPayload(rich, { body: [] }, components)).toEqual({ body: null });
      expect(toPayload(rich, { body: paragraph }, components)).toEqual({ body: paragraph });
    });
  });

  describe('relations and media inside components', () => {
    const card: Component = {
      uid: 'shared.card',
      category: 'shared',
      displayName: 'Card',
      attributes: {
        title: { type: 'string' },
        author: { type: 'relation', relation: 'oneWay', target: 'api::author' },
        tags: { type: 'relation', relation: 'manyWay', target: 'api::tag' },
        cover: { type: 'media' },
        gallery: { type: 'media', multiple: true },
      },
    };
    const lookup = (uid: string) => [card, seo, hero].find((component) => component.uid === uid);
    const nested = {
      card: { type: 'component' as const, component: 'shared.card' },
      cards: { type: 'component' as const, component: 'shared.card', repeatable: true },
      zone: { type: 'dynamiczone' as const, components: ['shared.card', 'blocks.hero'] },
    };
    const file = (id: number) => ({ id, documentId: `f${id}`, name: `photo-${id}.png` });
    const populated = {
      card: {
        id: 1,
        title: 'One',
        author: { id: 10, documentId: 'a1', name: 'Ada' },
        tags: [
          { id: 11, documentId: 't1', name: 'News' },
          { id: 12, documentId: 't2', name: '' },
        ],
        cover: file(3),
        gallery: [file(4), file(5)],
      },
      cards: [
        { id: 2, title: 'Two', author: null, tags: [], cover: null, gallery: [] },
        { id: 3, title: 'Three', author: { documentId: 'a2', name: 'Bob' }, cover: file(6) },
      ],
      zone: [
        {
          id: 4,
          __component: 'shared.card',
          author: { documentId: 'a3', name: 'Cy' },
          gallery: [file(7)],
        },
        { id: 5, __component: 'blocks.hero', title: 'Hero' },
      ],
    };

    it('maps populated relations and files to ids at any depth', () => {
      const model = toModel(nested, populated, lookup);
      expect(model['card']).toEqual({
        id: 1,
        title: 'One',
        author: 'a1',
        tags: ['t1', 't2'],
        cover: 3,
        gallery: [4, 5],
      });
      expect(model['cards']).toMatchObject([
        { id: 2, author: null, tags: [], cover: null, gallery: [] },
        { id: 3, author: 'a2', tags: [], cover: 6, gallery: [] },
      ]);
      expect(model['zone']).toMatchObject([
        { id: 4, __component: 'shared.card', author: 'a3', tags: [], cover: null, gallery: [7] },
        { id: 5, __component: 'blocks.hero', title: 'Hero' },
      ]);
    });

    it('accepts ids that are already unpopulated', () => {
      const model = toModel(
        nested,
        { card: { author: 'a9', tags: ['t9'], cover: 8, gallery: [9] } },
        lookup,
      );
      expect(model['card']).toMatchObject({ author: 'a9', tags: ['t9'], cover: 8, gallery: [9] });
    });

    it('sends documentIds and file ids in the payload', () => {
      const payload = toPayload(nested, toModel(nested, populated, lookup), lookup);
      expect(payload['card']).toEqual({
        id: 1,
        title: 'One',
        author: 'a1',
        tags: ['t1', 't2'],
        cover: 3,
        gallery: [4, 5],
      });
      expect(payload['cards']).toEqual([
        { id: 2, title: 'Two', author: null, tags: [], cover: null, gallery: [] },
        { id: 3, title: 'Three', author: 'a2', tags: [], cover: 6, gallery: [] },
      ]);
      expect(payload['zone']).toEqual([
        {
          id: 4,
          __component: 'shared.card',
          title: null,
          author: 'a3',
          tags: [],
          cover: null,
          gallery: [7],
        },
        { id: 5, __component: 'blocks.hero', title: 'Hero' },
      ]);
    });

    it('collects labels and files of nested references', () => {
      const refs = referencesOf(nested, populated, lookup, (target) =>
        target === 'api::author' || target === 'api::tag' ? 'name' : null,
      );
      expect(refs.labels).toEqual({ a1: 'Ada', t1: 'News', t2: 't2', a2: 'Bob', a3: 'Cy' });
      expect(refs.files.map((item) => item.id)).toEqual([3, 4, 5, 6, 7]);
      expect(referencesOf(nested, null, lookup, () => null)).toEqual({ labels: {}, files: [] });
    });
  });
});
