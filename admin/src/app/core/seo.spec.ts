import { describe, expect, it } from 'vitest';

import {
  examplePattern,
  patternProblem,
  placeholderHints,
  placeholders,
  readSeoSettings,
  samplePath,
  seoSettingsFrom,
  validBaseUrl,
  validPriority,
} from './seo';
import { Attributes } from './types';

const article: Attributes = {
  title: { type: 'string' },
  slug: { type: 'uid', targetField: 'title' },
  body: { type: 'richtext' },
  cover: { type: 'media' },
  year: { type: 'integer' },
  author: { type: 'relation', relation: 'manyToOne', target: 'api::author.author' },
};

describe('placeholders', () => {
  it('lists the names between braces', () => {
    expect(placeholders('/{locale}/blog/{slug}')).toEqual(['locale', 'slug']);
    expect(placeholders('/about')).toEqual([]);
  });

  it('suggests locale (localized types) and the attributes that fill a path, slugs first', () => {
    expect(placeholderHints(article, true)).toEqual(['locale', 'slug', 'title', 'year']);
    expect(placeholderHints(article, false)).toEqual(['slug', 'title', 'year']);
    expect(placeholderHints({}, false)).toEqual([]);
  });

  it('builds an example from the uid field', () => {
    expect(examplePattern('articles', article, true)).toBe('/{locale}/articles/{slug}');
    expect(examplePattern('pages', { name: { type: 'string' } }, false)).toBe('/pages/{name}');
  });

  it('fills a sample path', () => {
    expect(samplePath('/{locale}/blog/{slug}', { locale: 'en', slug: 'hello' })).toBe(
      '/en/blog/hello',
    );
    expect(samplePath('/{x}', {})).toBe('/{x}');
  });
});

describe('patternProblem', () => {
  it('accepts patterns of attributes and locale', () => {
    expect(patternProblem('/{locale}/blog/{slug}', article)).toBeNull();
    expect(patternProblem('/', article)).toBeNull();
  });

  it('reports what the server refuses', () => {
    expect(patternProblem('blog/{slug}', article)).toEqual({ kind: 'slash' });
    expect(patternProblem('/blog/{slug', article)).toEqual({ kind: 'braces' });
    expect(patternProblem('/blog/slug}', article)).toEqual({ kind: 'braces' });
    expect(patternProblem('/blog/{{slug}}', article)).toEqual({ kind: 'braces' });
    expect(patternProblem('/blog/{}', article)).toEqual({ kind: 'empty' });
    expect(patternProblem('/blog/{nope}', article)).toEqual({ kind: 'unknown', name: 'nope' });
  });
});

describe('settings', () => {
  it('reads stored settings, dropping what does not fit', () => {
    const settings = readSeoSettings({
      baseUrl: 'https://www.example.com',
      types: {
        'api::article.article': { pattern: '/{slug}', changefreq: 'weekly', priority: 0.7 },
        'api::page.page': { pattern: '/{slug}', changefreq: 'sometimes' },
        'api::bad.bad': { changefreq: 'daily' },
      },
    });
    expect(settings).toEqual({
      baseUrl: 'https://www.example.com',
      types: {
        'api::article.article': { pattern: '/{slug}', changefreq: 'weekly', priority: 0.7 },
        'api::page.page': { pattern: '/{slug}' },
      },
    });
    expect(readSeoSettings(null)).toEqual({ baseUrl: '', types: {} });
  });

  it('writes rows with a pattern, and trims the base URL', () => {
    expect(
      seoSettingsFrom('https://x.io/ ', [
        { uid: 'a', pattern: ' /{slug} ', changefreq: 'daily', priority: '0.5' },
        { uid: 'b', pattern: '', changefreq: 'daily', priority: '1' },
        { uid: 'c', pattern: '/c', changefreq: '', priority: '' },
      ]),
    ).toEqual({
      baseUrl: 'https://x.io',
      types: {
        a: { pattern: '/{slug}', changefreq: 'daily', priority: 0.5 },
        c: { pattern: '/c' },
      },
    });
  });

  it('checks priorities and base URLs', () => {
    expect(validPriority('')).toBe(true);
    expect(validPriority('0.5')).toBe(true);
    expect(validPriority('1.5')).toBe(false);
    expect(validPriority('high')).toBe(false);
    expect(validBaseUrl('')).toBe(true);
    expect(validBaseUrl('https://www.example.com')).toBe(true);
    expect(validBaseUrl('www.example.com')).toBe(false);
  });
});
