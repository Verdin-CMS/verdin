import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { Api } from './api';
import { ContentDocuments } from './documents';

function setup() {
  const calls: unknown[][] = [];
  const record =
    (method: string) =>
    async (...args: unknown[]) => {
      calls.push([method, ...args]);
      return method === 'list' ? { data: [], meta: {} } : null;
    };
  const api = {
    get: record('get'),
    list: record('list'),
    post: record('post'),
    put: record('put'),
    delete: record('delete'),
  };
  TestBed.configureTestingModule({ providers: [{ provide: Api, useValue: api }] });
  return { documents: TestBed.inject(ContentDocuments), calls };
}

describe('ContentDocuments', () => {
  const uid = 'api::article.article';

  it('reads documents and lists with Strapi’s query shapes', async () => {
    const { documents, calls } = setup();
    await documents.get(uid, 'd1', { populate: '*', status: 'draft', locale: 'fr' });
    await documents.get(uid, 'd1', { status: 'published', fields: 'updatedAt' });
    await documents.get(uid, 'd1');
    await documents.list(uid, { pagination: { pageSize: 10 }, _q: 'rust' });
    await documents.list(uid, 'sort=title:asc');
    expect(calls).toEqual([
      ['get', `/content/${uid}/d1`, 'populate=*&status=draft&locale=fr'],
      ['get', `/content/${uid}/d1`, 'status=published&fields=updatedAt'],
      ['get', `/content/${uid}/d1`, undefined],
      ['list', `/content/${uid}`, 'pagination%5BpageSize%5D=10&_q=rust'],
      ['list', `/content/${uid}`, 'sort=title:asc'],
    ]);
  });

  it('writes, runs publication actions and deletes in a locale', async () => {
    const { documents, calls } = setup();
    await documents.create(uid, { title: 'A' }, { populate: '*', locale: 'en' });
    await documents.update(uid, 'd1', { title: 'B' }, { populate: '*', locale: null });
    await documents.publish(uid, 'd1', 'en');
    await documents.unpublish(uid, 'd1', null);
    await documents.discardDraft(uid, 'd1', 'fr');
    await documents.delete(uid, 'd1', 'fr');
    await documents.locales(uid, 'd1', 'fr');
    await documents.preview(uid, 'd1');
    expect(calls).toEqual([
      ['post', `/content/${uid}`, { data: { title: 'A' } }, 'populate=*&locale=en'],
      ['put', `/content/${uid}/d1`, { data: { title: 'B' } }, 'populate=*'],
      ['post', `/content/${uid}/d1/actions/publish`, {}, 'locale=en'],
      ['post', `/content/${uid}/d1/actions/unpublish`, {}, undefined],
      ['post', `/content/${uid}/d1/actions/discard-draft`, {}, 'locale=fr'],
      ['delete', `/content/${uid}/d1`, 'locale=fr'],
      ['get', `/content/${uid}/d1/locales`, 'locale=fr'],
      ['get', `/content/${uid}/d1/preview`, undefined],
    ]);
  });
});
