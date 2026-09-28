import { describe, expect, it } from 'vitest';

import { ContentType } from '../../core/types';
import {
  ImportReport,
  TransferFileError,
  csvColumns,
  defaultMapping,
  duplicateTargets,
  formatOf,
  importableAttributes,
  jsonColumns,
  mapsSomething,
  parseCsv,
  reportLines,
  unlistedFailures,
} from './transfer';

const problem = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof TransferFileError ? error.problem : 'other';
  }
  return null;
};

describe('formatOf', () => {
  it('reads the extension', () => {
    expect(formatOf('Articles.CSV')).toBe('csv');
    expect(formatOf('export.json')).toBe('json');
    expect(formatOf('notes.txt')).toBeNull();
    expect(formatOf('csv')).toBeNull();
  });
});

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, line breaks in cells, CRLF and a BOM', () => {
    const text = '\uFEFFtitle,"body, long","say ""hi"""\r\n"two\nlines",b,\r\n\r\nx,y,z';
    expect(parseCsv(text)).toEqual([
      ['title', 'body, long', 'say "hi"'],
      ['two\nlines', 'b', ''],
      ['x', 'y', 'z'],
    ]);
  });

  it('refuses an unterminated quote', () => {
    expect(problem(() => parseCsv('a,"open\n1,2'))).toBe('csv');
  });
});

describe('csvColumns', () => {
  it('reads the trimmed header (once per name) and counts the data rows', () => {
    expect(csvColumns('\uFEFF documentId ,"title" ,title\n1,a,b\n2,c,d\n')).toEqual({
      columns: ['documentId', 'title'],
      rows: 2,
    });
  });

  it('treats a header without rows as empty', () => {
    expect(problem(() => csvColumns('title,body\n'))).toBe('empty');
    expect(problem(() => csvColumns(''))).toBe('empty');
  });
});

describe('jsonColumns', () => {
  it('collects the keys of every object in first-seen order', () => {
    expect(jsonColumns('[{"title":"a"},{"body":"b","title":"c"}]')).toEqual({
      columns: ['title', 'body'],
      rows: 2,
    });
  });

  it('says what is wrong with the file', () => {
    expect(problem(() => jsonColumns('{'))).toBe('json');
    expect(problem(() => jsonColumns('{"title":"a"}'))).toBe('notList');
    expect(problem(() => jsonColumns('[1, 2]'))).toBe('notList');
    expect(problem(() => jsonColumns('[]'))).toBe('empty');
  });
});

const article: ContentType = {
  uid: 'api::article.article',
  kind: 'collectionType',
  singularName: 'article',
  pluralName: 'articles',
  displayName: 'Article',
  draftAndPublish: true,
  attributes: {
    title: { type: 'string' },
    publishDate: { type: 'date' },
    secret: { type: 'password' },
    author: { type: 'relation', relation: 'manyToOne', target: 'api::author.author' },
    comments: {
      type: 'relation',
      relation: 'oneToMany',
      target: 'api::comment.comment',
      mappedBy: 'article',
    },
    mentions: { type: 'relation', relation: 'morphMany', target: 'api::note.note' },
    seo: { type: 'component', component: 'shared.seo' },
  },
};

describe('importableAttributes', () => {
  it('leaves out passwords and inverse relations', () => {
    expect(importableAttributes(article)).toEqual(['title', 'publishDate', 'author', 'seo']);
  });
});

describe('defaultMapping', () => {
  const attributes = importableAttributes(article);

  it('matches same-named columns, then loosely, and skips the others', () => {
    expect(
      defaultMapping(['documentId', 'Title', 'publish_date', 'author', 'extra'], attributes),
    ).toEqual({
      documentId: 'documentId',
      Title: 'title',
      publish_date: 'publishDate',
      author: 'author',
      extra: null,
    });
  });

  it('prefers the exact name and maps an attribute once', () => {
    expect(defaultMapping(['TITLE', 'title'], attributes)).toEqual({ TITLE: null, title: 'title' });
    expect(defaultMapping(['Title', 'TITLE'], attributes)).toEqual({ Title: 'title', TITLE: null });
  });

  it('never maps a skipped password column', () => {
    expect(defaultMapping(['secret'], attributes)).toEqual({ secret: null });
  });
});

describe('duplicateTargets and mapsSomething', () => {
  it('finds attributes chosen twice', () => {
    expect(duplicateTargets({ a: 'title', b: 'title', c: null, d: 'seo' })).toEqual(['title']);
    expect(duplicateTargets({ a: null, b: null })).toEqual([]);
  });

  it('needs one column mapped to a field', () => {
    expect(mapsSomething({ id: 'documentId', other: null })).toBe(false);
    expect(mapsSomething({ id: 'documentId', name: 'title' })).toBe(true);
  });
});

describe('reportLines', () => {
  const report: ImportReport = {
    dryRun: true,
    created: 1,
    updated: 0,
    failed: 104,
    ignoredColumns: [],
    errors: [
      {
        row: 7,
        documentId: 'doc7',
        errors: [
          { path: ['title'], message: 'required' },
          { path: ['seo', 'metaTitle'], message: 'too long' },
        ],
      },
      { row: 2, documentId: null, errors: [] },
    ],
  };

  it('lists each row once, in order, with its problems together', () => {
    expect(reportLines(report)).toEqual([
      { row: 2, documentId: null, path: '', message: '', first: true },
      { row: 7, documentId: 'doc7', path: 'title', message: 'required', first: true },
      { row: 7, documentId: 'doc7', path: 'seo.metaTitle', message: 'too long', first: false },
    ]);
  });

  it('counts the failing rows left out of the report', () => {
    expect(unlistedFailures(report)).toBe(102);
    expect(unlistedFailures({ ...report, failed: 1 })).toBe(0);
  });
});
