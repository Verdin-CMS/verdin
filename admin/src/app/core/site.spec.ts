import { describe, expect, it } from 'vitest';

import {
  Redirect,
  filterRedirects,
  parseCsv,
  redirectProblems,
  redirectsFromCsv,
  redirectsToCsv,
  slugify,
  validSlug,
} from './site';

const list: Redirect[] = [
  { id: 1, source: '/old', destination: '/new', status: 301, createdAt: null, updatedAt: null },
  {
    id: 2,
    source: '/blog',
    destination: 'https://blog.example.com',
    status: 302,
    createdAt: null,
    updatedAt: null,
  },
];

describe('redirects', () => {
  it('checks sources, destinations and statuses', () => {
    expect(redirectProblems({ source: '/a', destination: '/b', status: 301 })).toEqual([]);
    expect(
      redirectProblems({ source: 'a', destination: 'b', status: 200 as unknown as 301 }),
    ).toEqual(['source', 'destination', 'status']);
    expect(redirectProblems({ source: '/a', destination: '/a', status: 308 })).toEqual(['same']);
    expect(redirectProblems({ source: '/a', destination: 'ftp://x', status: 301 })).toEqual([
      'destination',
    ]);
  });

  it('reports duplicate sources, except the redirect itself', () => {
    const input = { source: '/old', destination: '/x', status: 301 as const };
    expect(redirectProblems(input, list)).toEqual(['duplicate']);
    expect(redirectProblems(input, list, 1)).toEqual([]);
  });

  it('filters by source or destination', () => {
    expect(filterRedirects(list, 'BLOG').map((r) => r.id)).toEqual([2]);
    expect(filterRedirects(list, 'new').map((r) => r.id)).toEqual([1]);
    expect(filterRedirects(list, ' ')).toHaveLength(2);
  });
});

describe('CSV', () => {
  it('writes and reads back redirects', () => {
    const csv = redirectsToCsv([...list, { source: '/a,b', destination: '/"q"', status: 307 }]);
    expect(csv.split('\r\n')[0]).toBe('source,destination,status');
    expect(csv).toContain('"/a,b","/""q""",307');
    const { redirects, invalid } = redirectsFromCsv(csv);
    expect(invalid).toEqual([]);
    expect(redirects).toEqual([
      { source: '/old', destination: '/new', status: 301 },
      { source: '/blog', destination: 'https://blog.example.com', status: 302 },
      { source: '/a,b', destination: '/"q"', status: 307 },
    ]);
  });

  it('parses quoted fields with new lines and LF endings', () => {
    expect(parseCsv('a,"b\nc"\nd,e')).toEqual([
      ['a', 'b\nc'],
      ['d', 'e'],
    ]);
    expect(parseCsv('\n\nx\n')).toEqual([['x']]);
  });

  it('defaults to 301 and reports unreadable lines', () => {
    const { redirects, invalid } = redirectsFromCsv('﻿/a,/b\nnope,/c\n/d,/e,200\n');
    expect(redirects).toEqual([{ source: '/a', destination: '/b', status: 301 }]);
    expect(invalid).toEqual([2, 3]);
  });
});

describe('slugs', () => {
  it('makes kebab-case slugs', () => {
    expect(slugify('Main menu')).toBe('main-menu');
    expect(slugify('  Pié de página! ')).toBe('pie-de-pagina');
    expect(validSlug('main-menu')).toBe(true);
    expect(validSlug('Main')).toBe(false);
    expect(validSlug('')).toBe(false);
  });
});
