import { afterEach, describe, expect, it } from 'vitest';

import { Attributes, Component } from '../../core/types';
import {
  editMessage,
  fieldIds,
  findFieldElement,
  parseEditHref,
  resolveFieldPath,
  validFieldPath,
} from './visual-editing';

const ADMIN = 'https://cms.example/admin/';
const SITE = 'https://site.example/blog/hello?preview=abc';

describe('visual editing links', () => {
  it('reads entries of this admin', () => {
    expect(
      parseEditHref(
        'https://cms.example/admin/content/api::article.article/abc123?locale=fr&field=seo.metaTitle',
        ADMIN,
      ),
    ).toEqual({
      uid: 'api::article.article',
      documentId: 'abc123',
      locale: 'fr',
      field: 'seo.metaTitle',
    });
    expect(parseEditHref('https://cms.example/admin/content/api::page.page/p1', ADMIN)).toEqual({
      uid: 'api::page.page',
      documentId: 'p1',
      locale: null,
      field: null,
    });
    // An admin served at the root.
    expect(
      parseEditHref(
        'https://cms.example/content/api::a.a/x?field=sections.2.title',
        'https://cms.example/',
      )?.field,
    ).toBe('sections.2.title');
  });

  it('refuses links elsewhere', () => {
    for (const href of [
      'https://evil.example/admin/content/api::a.a/x',
      'http://cms.example/admin/content/api::a.a/x',
      'https://cms.example/other/content/api::a.a/x',
      'https://cms.example/admin/settings/users',
      'https://cms.example/admin/content/api::a.a',
      'https://cms.example/admin/content/api::a.a/new',
      'https://cms.example/admin/content/api::a.a/configure-view',
      'https://cms.example/admin/content/api::a.a/x/history',
      'https://cms.example/admin/content/api::a.a/%E0%A4%A',
      'https://cms.example/admin/content/<script>/x',
      'javascript:alert(1)',
      '/admin/content/api::a.a/x',
    ])
      expect(parseEditHref(href, ADMIN), href).toBeNull();
    expect(parseEditHref(42, ADMIN)).toBeNull();
    expect(parseEditHref(undefined, ADMIN)).toBeNull();
  });

  it('drops odd locales and field paths', () => {
    const target = parseEditHref(
      'https://cms.example/admin/content/api::a.a/x?locale=../../x&field=a..b',
      ADMIN,
    );
    expect(target).toMatchObject({ locale: null, field: null });
    expect(validFieldPath('seo.metaTitle')).toBe('seo.metaTitle');
    expect(validFieldPath('sections.0.title')).toBe('sections.0.title');
    for (const path of ['', '.a', 'a.', 'a b', '0.a', 'a.<b>', null, undefined])
      expect(validFieldPath(path as string)).toBeNull();
  });
});

describe('visual editing messages', () => {
  const href = 'https://cms.example/admin/content/api::a.a/x?field=title';
  const message = (origin: string, data: unknown) => editMessage({ origin, data }, SITE, ADMIN);

  it('accepts edits from the preview site', () => {
    expect(message('https://site.example', { type: 'verdin:edit', href })).toMatchObject({
      uid: 'api::a.a',
      documentId: 'x',
      field: 'title',
    });
  });

  it('ignores other origins, types and links', () => {
    expect(message('https://evil.example', { type: 'verdin:edit', href })).toBeNull();
    expect(message('https://site.example:8443', { type: 'verdin:edit', href })).toBeNull();
    expect(message('null', { type: 'verdin:edit', href })).toBeNull();
    expect(message('https://site.example', { type: 'other', href })).toBeNull();
    expect(message('https://site.example', 'verdin:edit')).toBeNull();
    expect(message('https://site.example', null)).toBeNull();
    expect(
      message('https://site.example', {
        type: 'verdin:edit',
        href: 'https://evil.example/admin/content/api::a.a/x',
      }),
    ).toBeNull();
    expect(editMessage({ origin: 'https://site.example', data: {} }, null, ADMIN)).toBeNull();
  });
});

const seo: Component = {
  uid: 'shared.seo',
  category: 'shared',
  displayName: 'SEO',
  attributes: { metaTitle: { type: 'string' }, metaDescription: { type: 'text' } },
};
const hero: Component = {
  uid: 'blocks.hero',
  category: 'blocks',
  displayName: 'Hero',
  attributes: { title: { type: 'string' }, seo: { type: 'component', component: 'shared.seo' } },
};
const components = (uid: string) => [seo, hero].find((component) => component.uid === uid);
const attributes: Attributes = {
  title: { type: 'string' },
  body: { type: 'blocks' },
  seo: { type: 'component', component: 'shared.seo' },
  faqs: { type: 'component', component: 'blocks.hero', repeatable: true },
  sections: { type: 'dynamiczone', components: ['blocks.hero', 'shared.seo'] },
};
const model = {
  title: 'Hello',
  body: [],
  seo: { metaTitle: 'x', metaDescription: '' },
  faqs: [{ title: 'Q', seo: null }],
  sections: [
    { __component: 'shared.seo', metaTitle: '' },
    { __component: 'blocks.hero', title: 'Hi', seo: { metaTitle: '' } },
  ],
};
const resolve = (path: string) => resolveFieldPath(attributes, model, path, components);

describe('field paths', () => {
  it('follows components, repeatables and dynamic zones', () => {
    expect(resolve('title')).toEqual(['title']);
    expect(resolve('seo.metaTitle')).toEqual(['seo', 'metaTitle']);
    expect(resolve('faqs.0.title')).toEqual(['faqs', '0', 'title']);
    expect(resolve('sections.1.title')).toEqual(['sections', '1', 'title']);
    expect(resolve('sections.1.seo.metaTitle')).toEqual(['sections', '1', 'seo', 'metaTitle']);
    expect(resolve('sections.0.metaTitle')).toEqual(['sections', '0', 'metaTitle']);
  });

  it('stops at the deepest part that exists', () => {
    // A block of a blocks field: the field.
    expect(resolve('body.3')).toEqual(['body']);
    expect(resolve('sections.7.title')).toEqual(['sections']);
    expect(resolve('sections.title')).toEqual(['sections']);
    expect(resolve('seo.unknown')).toEqual(['seo']);
    // A component that is not added yet.
    expect(resolve('faqs.0.seo.metaTitle')).toEqual(['faqs', '0', 'seo']);
    expect(resolve('sections.0.title')).toEqual(['sections', '0']);
    expect(resolve('missing.title')).toEqual([]);
    expect(resolve('constructor')).toEqual([]);
  });

  it('turns paths into the ids of the rendered controls', () => {
    expect(fieldIds('doc', ['sections', '1', 'title'])).toEqual([
      'doc-sections-1-title',
      'doc-sections-1',
      'doc-sections',
    ]);
  });
});

describe('field elements', () => {
  afterEach(() => (document.body.innerHTML = ''));

  it('finds controls, groups and list items', () => {
    document.body.innerHTML = `
      <div data-field="title"><input id="doc-title" /></div>
      <section role="group" id="seo-group"><div id="doc-seo-label">SEO</div>
        <input id="doc-seo-metaTitle" /></section>
      <section role="group"><div id="doc-sections-label"></div>
        <input id="doc-sections-0-title" /></section>`;
    expect(findFieldElement(document, 'doc', ['title'])?.id).toBe('doc-title');
    expect(findFieldElement(document, 'doc', ['seo', 'metaTitle'])?.id).toBe('doc-seo-metaTitle');
    expect(findFieldElement(document, 'doc', ['seo'])?.id).toBe('seo-group');
    // A missing control falls back to its group.
    expect(findFieldElement(document, 'doc', ['seo', 'metaDescription'])?.id).toBe('seo-group');
    expect(findFieldElement(document, 'doc', ['sections', '0'])?.id).toBe('doc-sections-0-title');
    expect(findFieldElement(document, 'doc', ['other'])).toBeNull();
  });
});
