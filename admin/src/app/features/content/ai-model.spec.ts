import { describe, expect, it } from 'vitest';

import { Attributes, Component } from '../../core/types';
import {
  applySeo,
  blocksText,
  isSeoComponent,
  isSummaryField,
  mergeTranslation,
  sameValue,
  sourceText,
  summarySource,
  summaryWords,
  translatableFields,
} from './ai-model';
import { toModel } from './fields/model';

const seo: Component = {
  uid: 'shared.seo',
  category: 'shared',
  displayName: 'SEO',
  attributes: {
    metaTitle: { type: 'string' },
    metaDescription: { type: 'text' },
    keywords: { type: 'string' },
  },
};
const quote: Component = {
  uid: 'blocks.quote',
  category: 'blocks',
  displayName: 'Quote',
  attributes: { text: { type: 'text' }, rating: { type: 'integer' } },
};
const components = (uid: string) => [seo, quote].find((component) => component.uid === uid);
const shared = { i18n: { localized: false } };

const attributes: Attributes = {
  title: { type: 'string' },
  slug: { type: 'uid', targetField: 'title' },
  summary: { type: 'text' },
  body: { type: 'blocks' },
  code: { type: 'string', pluginOptions: shared },
  secret: { type: 'string', private: true },
  price: { type: 'integer' },
  seo: { type: 'component', component: 'shared.seo' },
  quotes: { type: 'component', component: 'blocks.quote', repeatable: true },
  sections: { type: 'dynamiczone', components: ['blocks.quote'] },
};

const french = toModel(
  attributes,
  {
    title: 'Bonjour',
    slug: 'bonjour',
    summary: 'Résumé',
    code: 'A1',
    price: 3,
    seo: { id: 20, metaTitle: 'Bonjour', metaDescription: 'Desc', keywords: 'a' },
    quotes: [{ id: 21, text: 'Oui', rating: 5 }],
    sections: [],
  },
  components,
);

describe('AI translations', () => {
  it('translates localized, editable text only', () => {
    expect(translatableFields(attributes)).toEqual([
      'title',
      'summary',
      'body',
      'seo',
      'quotes',
      'sections',
    ]);
  });

  it('merges translated values into the form and names what changed', () => {
    const { model, changed } = mergeTranslation(
      attributes,
      french,
      {
        title: 'Hello',
        summary: 'Résumé',
        code: 'B2',
        price: 9,
        slug: 'hello',
        body: [{ type: 'paragraph', children: [{ type: 'text', text: 'Hi' }] }],
        seo: { id: 20, metaTitle: 'Hello', metaDescription: 'Desc', keywords: 'a' },
        quotes: [{ id: 99, text: 'Yes', rating: 5 }],
        sections: [
          { __component: 'blocks.quote', text: 'One' },
          { __component: 'blocks.unknown', text: 'Two' },
        ],
      },
      components,
    );
    expect(changed).toEqual(['title', 'body', 'seo', 'quotes', 'sections']);
    expect(model['title']).toBe('Hello');
    // Unchanged, shared, non-text and unknown attributes stay.
    expect(model['summary']).toBe(french['summary']);
    expect(model['code']).toBe('A1');
    expect(model['price']).toBe(3);
    expect(model['slug']).toBe('bonjour');
    // Component rows lose their ids (they belong to the source) and get rendering keys.
    expect(model['seo']).toEqual({ metaTitle: 'Hello', metaDescription: 'Desc', keywords: 'a' });
    const quotes = model['quotes'] as Record<string, unknown>[];
    expect(quotes[0]).toMatchObject({ text: 'Yes', rating: 5 });
    expect(quotes[0]['id']).toBeUndefined();
    expect(quotes[0]['__key']).toBeTruthy();
    // Dynamic zone items of components the zone does not allow are dropped.
    expect((model['sections'] as unknown[]).length).toBe(1);
    // The current model is not modified.
    expect(french['title']).toBe('Bonjour');
  });

  it('ignores values of the wrong shape', () => {
    const { model, changed } = mergeTranslation(
      attributes,
      french,
      { title: 42, body: 'text', seo: 'x', quotes: {}, sections: [1] },
      components,
    );
    expect(changed).toEqual([]);
    expect(model).toEqual(french);
    expect(mergeTranslation(attributes, french, {}, components).changed).toEqual([]);
  });

  it('keeps component rows whose translation did not change', () => {
    const { model, changed } = mergeTranslation(
      attributes,
      french,
      { seo: { metaTitle: 'Bonjour', metaDescription: 'Desc', keywords: 'a' } },
      components,
    );
    expect(changed).toEqual([]);
    expect((model['seo'] as Record<string, unknown>)['id']).toBe(20);
    expect(sameValue({ id: 1, __key: 'k1', a: [1] }, { a: [1] })).toBe(true);
  });
});

describe('AI SEO suggestions', () => {
  it('recognizes SEO components', () => {
    expect(isSeoComponent(seo)).toBe(true);
    expect(isSeoComponent(quote)).toBe(false);
    expect(isSeoComponent(undefined)).toBe(false);
  });

  it('fills metadata and keywords', () => {
    const item = { id: 3, __key: 'k', metaTitle: 'Old', metaDescription: '', keywords: '' };
    const { item: next, changed } = applySeo(seo, item, {
      metaTitle: 'New title',
      metaDescription: 'New description',
      keywords: ['cms', 'rust'],
    });
    expect(next).toEqual({
      id: 3,
      __key: 'k',
      metaTitle: 'New title',
      metaDescription: 'New description',
      keywords: 'cms, rust',
    });
    expect(changed).toEqual(['metaTitle', 'metaDescription', 'keywords']);
  });

  it('keeps fields the suggestion leaves empty, and JSON keywords as a list', () => {
    const json: Component = {
      ...seo,
      attributes: { ...seo.attributes, keywords: { type: 'json' } },
    };
    const { item, changed } = applySeo(
      json,
      { metaTitle: 'Kept', metaDescription: 'Same', keywords: null },
      { metaTitle: ' ', metaDescription: 'Same', keywords: ['a'] },
    );
    expect(item).toEqual({ metaTitle: 'Kept', metaDescription: 'Same', keywords: ['a'] });
    expect(changed).toEqual(['keywords']);
  });
});

describe('AI summaries', () => {
  it('finds summary fields and their source', () => {
    expect(isSummaryField('summary', { type: 'text' })).toBe(true);
    expect(isSummaryField('excerpt', { type: 'string' })).toBe(true);
    expect(isSummaryField('title', { type: 'string' })).toBe(false);
    expect(isSummaryField('description', { type: 'richtext' })).toBe(false);
    expect(summarySource(attributes, 'summary')).toBe('body');
    expect(summarySource({ summary: { type: 'text' }, content: { type: 'text' } }, 'summary')).toBe(
      'content',
    );
    expect(summarySource({ summary: { type: 'text' }, title: { type: 'string' } }, 'summary')).toBe(
      null,
    );
  });

  it('reads the text of blocks', () => {
    const blocks = [
      { type: 'heading', level: 2, children: [{ type: 'text', text: 'Title' }] },
      {
        type: 'paragraph',
        children: [
          { type: 'text', text: 'Hello ' },
          { type: 'link', url: 'https://a', children: [{ type: 'text', text: 'world' }] },
        ],
      },
      {
        type: 'list',
        format: 'unordered',
        children: [
          { type: 'list-item', children: [{ type: 'text', text: 'one' }] },
          { type: 'list-item', children: [{ type: 'text', text: 'two' }] },
        ],
      },
      { type: 'paragraph', children: [{ type: 'text', text: '' }] },
    ];
    expect(blocksText(blocks)).toBe('Title\nHello world\none\ntwo');
    expect(blocksText(null)).toBe('');
    expect(sourceText({ type: 'blocks' }, blocks)).toContain('Hello world');
    expect(sourceText({ type: 'richtext' }, '  **Bold**  ')).toBe('**Bold**');
    expect(sourceText({ type: 'text' }, null)).toBe('');
  });

  it('sizes summaries to the field', () => {
    expect(summaryWords({ type: 'string' })).toBe(36);
    expect(summaryWords({ type: 'string', maxLength: 50 })).toBe(10);
    expect(summaryWords({ type: 'text' })).toBe(60);
    expect(summaryWords({ type: 'text', maxLength: 2000 })).toBe(60);
  });
});
