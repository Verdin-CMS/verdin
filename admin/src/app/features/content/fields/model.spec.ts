import { describe, expect, it } from 'vitest';

import { Component } from '../../../core/types';
import { toModel, toPayload } from './model';

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
});
