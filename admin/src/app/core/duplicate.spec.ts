import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { describe, expect, it } from 'vitest';

import { Api, ApiFailure } from './api';
import { EntryDuplicates, clonePath } from './duplicate';
import { I18n } from './i18n/i18n';

describe('EntryDuplicates', () => {
  function service(answer: () => Promise<unknown>) {
    const calls: { path: string; query?: string }[] = [];
    const navigations: unknown[][] = [];
    const api = {
      postWithMeta: async (path: string, _body: unknown, query?: string) => {
        calls.push({ path, query });
        return answer();
      },
    };
    const i18n = {
      t: (key: string, params?: Record<string, unknown>) =>
        params ? `${key} ${JSON.stringify(params)}` : key,
      formatList: (items: string[]) => items.join(' + '),
    };
    const router = {
      navigate: async (...args: unknown[]) => {
        navigations.push(args);
        return true;
      },
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: Api, useValue: api },
        { provide: I18n, useValue: i18n },
        { provide: Router, useValue: router },
      ],
    });
    return { duplicates: TestBed.inject(EntryDuplicates), calls, navigations };
  }

  it('posts to the clone action with the locale and keeps meta.leftOut', async () => {
    const { duplicates, calls } = service(async () => ({
      data: { id: 2, documentId: 'copy' },
      meta: { leftOut: ['slug'] },
    }));
    expect(await duplicates.clone('api::article', 'abc', 'fr')).toEqual({
      document: { id: 2, documentId: 'copy' },
      leftOut: ['slug'],
    });
    expect(calls).toEqual([{ path: '/content/api::article/abc/clone', query: 'locale=fr' }]);
    expect(clonePath('api::a', 'x y')).toBe('/content/api::a/x%20y/clone');
  });

  it('opens the copy', async () => {
    const { duplicates, navigations } = service(async () => ({
      data: { id: 2, documentId: 'copy' },
      meta: {},
    }));
    expect(await duplicates.duplicate('api::article', 'abc', null, (name) => name)).toBe(true);
    expect(navigations).toEqual([[['/content', 'api::article', 'copy'], { queryParams: {} }]]);
  });

  it('reports a failure without navigating', async () => {
    const { duplicates, navigations } = service(async () => {
      throw new ApiFailure(403, 'ForbiddenError', 'Forbidden');
    });
    expect(await duplicates.duplicate('api::article', 'abc', 'en', (name) => name)).toBe(false);
    expect(navigations).toEqual([]);
  });
});
