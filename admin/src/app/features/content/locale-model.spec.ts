import { describe, expect, it } from 'vitest';

import { Attributes, Component } from '../../core/types';
import { FormModel, toModel, toPayload } from './fields/model';
import { fillFromLocale, prefillShared, sharedFields } from './locale-model';

const seo: Component = {
  uid: 'shared.seo',
  category: 'shared',
  displayName: 'SEO',
  attributes: { metaTitle: { type: 'string' } },
};
const components = (uid: string) => (uid === seo.uid ? seo : undefined);
const shared = { i18n: { localized: false } };

const attributes: Attributes = {
  title: { type: 'string' },
  price: { type: 'integer', pluginOptions: shared },
  category: {
    type: 'relation',
    relation: 'manyToOne',
    target: 'api::category',
    pluginOptions: shared,
  },
  tags: { type: 'relation', relation: 'manyToMany', target: 'api::tag' },
  cover: { type: 'media', pluginOptions: shared },
  gallery: { type: 'media', multiple: true },
  seo: { type: 'component', component: 'shared.seo' },
  specs: { type: 'component', component: 'shared.seo', repeatable: true, pluginOptions: shared },
  articles: {
    type: 'relation',
    relation: 'oneToMany',
    target: 'api::article',
    mappedBy: 'category',
  },
};

const english = {
  id: 1,
  documentId: 'doc1',
  locale: 'en',
  title: 'Hello',
  price: 10,
  category: { id: 3, documentId: 'cat1', name: 'News' },
  tags: [{ id: 4, documentId: 'tag1' }],
  cover: { id: 7, url: '/a.png' },
  gallery: [{ id: 8 }, { id: 9 }],
  seo: { id: 11, metaTitle: 'Hello SEO' },
  specs: [{ id: 12, metaTitle: 'Spec' }],
  articles: [{ id: 5, documentId: 'art1' }],
};

describe('localized documents', () => {
  it('lists the shared attributes', () => {
    expect(sharedFields(attributes)).toEqual(['price', 'category', 'cover', 'specs']);
  });

  it('prefills a new locale with the shared values only', () => {
    const model = prefillShared(attributes, english, components);
    expect(model).toMatchObject({
      title: '',
      price: 10,
      category: 'cat1',
      tags: [],
      cover: 7,
      gallery: [],
      seo: null,
    });
    // Component items are copies without the source row ids.
    const specs = model['specs'] as Record<string, unknown>[];
    expect(specs).toHaveLength(1);
    expect(specs[0]['metaTitle']).toBe('Spec');
    expect(specs[0]['id']).toBeUndefined();
    expect(specs[0]['__key']).toBeTruthy();
  });

  it('prefills an empty form without a source', () => {
    expect(prefillShared(attributes, null, components)).toEqual(
      toModel(attributes, null, components),
    );
  });

  it('fills the localized fields from another locale, keeping the shared ones', () => {
    const current: FormModel = { ...prefillShared(attributes, english, components), price: 12 };
    const source = toModel(attributes, english, components);
    const filled = fillFromLocale(attributes, current, source, components);
    expect(filled).toMatchObject({
      title: 'Hello',
      price: 12,
      tags: ['tag1'],
      gallery: [8, 9],
      seo: { metaTitle: 'Hello SEO' },
    });
    expect((filled['seo'] as Record<string, unknown>)['id']).toBeUndefined();
    expect(filled['specs']).toBe(current['specs']);
    // The payload sends ids of relations and files, and no component row ids.
    const payload = toPayload(attributes, filled, components);
    expect(payload).toMatchObject({
      title: 'Hello',
      tags: ['tag1'],
      seo: { metaTitle: 'Hello SEO' },
    });
    expect(payload['articles']).toBeUndefined();
  });

  it('does not share nested values with the source model', () => {
    const source = toModel(attributes, english, components);
    const filled = fillFromLocale(attributes, {}, source, components);
    (filled['tags'] as string[]).push('tag2');
    expect(source['tags']).toEqual(['tag1']);
  });
});
