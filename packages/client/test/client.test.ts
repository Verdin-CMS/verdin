import assert from 'node:assert/strict';
import { test } from 'node:test';

import { VerdinError, createClient, stringify } from '../src/index.ts';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function fakeFetch(respond: (call: Call) => { status?: number; body?: unknown }) {
  const calls: Call[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
    };
    calls.push(call);
    const { status = 200, body } = respond(call);
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  };
  return { calls, fetcher: fetcher as typeof fetch };
}

test('serializes Strapi query parameters', () => {
  const query = stringify({
    filters: { title: { $containsi: 'rust & go' }, $or: [{ views: { $gt: 3 } }, { featured: { $eq: true } }] },
    populate: { category: { fields: ['name'] } },
    sort: ['publishedAt:desc', 'title'],
    pagination: { page: 2, pageSize: 10 },
    status: 'draft',
    skipped: undefined,
  });
  assert.equal(
    decodeURIComponent(query),
    'filters[title][$containsi]=rust & go&filters[$or][0][views][$gt]=3&filters[$or][1][featured][$eq]=true' +
      '&populate[category][fields][0]=name&sort[0]=publishedAt:desc&sort[1]=title' +
      '&pagination[page]=2&pagination[pageSize]=10&status=draft',
  );
  assert.ok(query.includes('rust%20%26%20go'), 'values are encoded');
});

test('collections, singles, tokens and errors', async () => {
  const { calls, fetcher } = fakeFetch((call) => {
    if (call.url.endsWith('/api/articles/missing')) {
      return { status: 404, body: { data: null, error: { status: 404, name: 'NotFoundError', message: 'Not Found', details: {} } } };
    }
    if (call.method === 'DELETE') return { status: 204 };
    return { body: { data: [{ documentId: 'a1', title: 'Hi' }], meta: { pagination: { total: 1 } } } };
  });
  const verdin = createClient({ url: 'https://cms.example.com/', token: 'secret', fetch: fetcher });

  const list = await verdin.collection('articles').find({ filters: { title: { $eq: 'Hi' } }, populate: '*' });
  assert.equal(list.data.length, 1);
  assert.equal(calls[0]?.url, 'https://cms.example.com/api/articles?filters%5Btitle%5D%5B%24eq%5D=Hi&populate=*');
  assert.equal(calls[0]?.headers['authorization'], 'Bearer secret');

  await verdin.collection('articles').create({ title: 'New' }, { status: 'draft' });
  assert.equal(calls[1]?.method, 'POST');
  assert.equal(calls[1]?.url, 'https://cms.example.com/api/articles?status=draft');
  assert.deepEqual(calls[1]?.body, { data: { title: 'New' } });

  await verdin.collection('articles').publish('a1');
  assert.equal(calls[2]?.url, 'https://cms.example.com/api/articles/a1/actions/publish');
  await verdin.single('homepage').update({ headline: 'Hello' });
  assert.equal(calls[3]?.method, 'PUT');
  assert.equal(await verdin.collection('articles').delete('a1'), undefined);

  await assert.rejects(verdin.collection('articles').findOne('missing'), (error: unknown) => {
    assert.ok(error instanceof VerdinError);
    assert.equal(error.status, 404);
    assert.equal(error.name, 'NotFoundError');
    return true;
  });
});

test('graphql and custom prefixes', async () => {
  const { calls, fetcher } = fakeFetch((call) =>
    call.url.endsWith('/graphql')
      ? { body: (call.body as { query: string }).query.includes('boom') ? { errors: [{ message: 'boom' }] } : { data: { articles: [] } } }
      : { body: { data: [], meta: { pagination: {} } } },
  );
  const verdin = createClient({ url: 'http://localhost:1337', prefix: '/content', fetch: fetcher });
  assert.deepEqual(await verdin.graphql('{ articles { title } }'), { articles: [] });
  assert.equal(calls[0]?.url, 'http://localhost:1337/graphql');
  assert.equal(calls[0]?.headers['authorization'], undefined, 'public role without a token');
  await assert.rejects(verdin.graphql('{ boom }'), /boom/);
  await verdin.collection('tags').find();
  assert.equal(calls[2]?.url, 'http://localhost:1337/content/tags');
});
