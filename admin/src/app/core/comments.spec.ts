import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { Api } from './api';
import {
  CommentsApi,
  Task,
  Thread,
  fieldLabel,
  groupThreads,
  insertMention,
  isOverdue,
  matchPeople,
  mentionNames,
  mentionQuery,
  mentionToken,
  mentionedIds,
  openCountsByField,
  parseBody,
  personName,
  plainBody,
  sortTasks,
} from './comments';

function thread(id: number, overrides: Partial<Thread> = {}): Thread {
  return {
    id,
    uid: 'api::a.a',
    documentId: 'd1',
    locale: '',
    field: null,
    parentId: null,
    body: `comment ${id}`,
    authorId: 1,
    mentions: [],
    resolvedAt: null,
    resolvedBy: null,
    createdAt: `2026-01-0${id}T10:00:00.000Z`,
    updatedAt: `2026-01-0${id}T10:00:00.000Z`,
    replies: [],
    ...overrides,
  };
}

function task(id: number, overrides: Partial<Task> = {}): Task {
  return {
    id,
    uid: 'api::a.a',
    documentId: 'd1',
    locale: '',
    title: `Task ${id}`,
    description: null,
    assigneeId: null,
    dueDate: null,
    status: 'open',
    createdBy: 1,
    completedAt: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

describe('mentions', () => {
  it('splits bodies into text and mentions', () => {
    expect(parseBody('Hi @[Ada Lovelace](user:12), see @[Bob](user:3).')).toEqual([
      { kind: 'text', text: 'Hi ' },
      { kind: 'mention', name: 'Ada Lovelace', userId: 12 },
      { kind: 'text', text: ', see ' },
      { kind: 'mention', name: 'Bob', userId: 3 },
      { kind: 'text', text: '.' },
    ]);
    expect(parseBody('@[x](user:abc) plain')).toEqual([
      { kind: 'text', text: '@[x](user:abc) plain' },
    ]);
    expect(parseBody('')).toEqual([]);
  });

  it('lists mentioned admins once, and their names', () => {
    const body = '@[Ada](user:12) and @[Ada L.](user:12) and @[Bob](user:3)';
    expect(mentionedIds(body)).toEqual([12, 3]);
    expect(mentionNames([body, '@[Cy](user:4)'])).toEqual(
      new Map([
        [12, 'Ada L.'],
        [3, 'Bob'],
        [4, 'Cy'],
      ]),
    );
    expect(plainBody(body)).toBe('@Ada and @Ada L. and @Bob');
  });

  it('writes tokens the server reads back', () => {
    expect(mentionToken('Ada (admin) [x]', 12)).toBe('@[Ada admin x](user:12)');
    expect(mentionToken(' ', 5)).toBe('@[#5](user:5)');
    expect(mentionedIds(`hey ${mentionToken('Ada', 12)}`)).toEqual([12]);
  });

  it('finds the @query being typed', () => {
    expect(mentionQuery('Hello @ad', 9)).toEqual({ start: 6, query: 'ad' });
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionQuery('(@Zoë', 5)).toEqual({ start: 1, query: 'Zoë' });
    expect(mentionQuery('mail me@example', 15)).toBeNull();
    expect(mentionQuery('Hello @ad more', 14)).toBeNull();
    expect(mentionQuery('Hello @ad more', 9)).toEqual({ start: 6, query: 'ad' });
  });

  it('replaces the query with the token and a space', () => {
    expect(insertMention('Hi @ad!', 3, 6, '@[Ada](user:1)')).toEqual({
      text: 'Hi @[Ada](user:1) !',
      caret: 18,
    });
    expect(insertMention('Hi @ad there', 3, 6, '@[Ada](user:1)')).toEqual({
      text: 'Hi @[Ada](user:1) there',
      caret: 18,
    });
  });

  it('matches people by name or email, best first', () => {
    const people = [
      { id: 1, name: 'Ada Lovelace', email: 'ada@example.com' },
      { id: 2, name: 'Bob Adams', email: 'bob@example.com' },
      { id: 3, name: 'Élodie', email: 'elodie@example.com' },
    ];
    expect(matchPeople(people, 'ad').map((person) => person.id)).toEqual([1, 2]);
    expect(matchPeople(people, 'elo').map((person) => person.id)).toEqual([3]);
    expect(matchPeople(people, '').map((person) => person.id)).toEqual([1, 2, 3]);
    expect(matchPeople(people, 'zz')).toEqual([]);
  });

  it('names admins like the server', () => {
    expect(personName({ email: 'a@x.io', firstname: 'Ada', lastname: 'Lovelace' })).toBe(
      'Ada Lovelace',
    );
    expect(personName({ email: 'a@x.io', firstname: null, lastname: null })).toBe('a@x.io');
  });
});

describe('threads', () => {
  it('puts open threads first by latest activity, resolved ones apart', () => {
    const threads = [
      thread(1, { replies: [{ ...thread(9), parentId: 1, createdAt: '2026-01-09T00:00:00Z' }] }),
      thread(2),
      thread(3, { resolvedAt: '2026-02-01T00:00:00Z' }),
      thread(4, { resolvedAt: '2026-03-01T00:00:00Z' }),
    ];
    const { open, resolved } = groupThreads(threads);
    expect(open.map((item) => item.id)).toEqual([1, 2]);
    expect(resolved.map((item) => item.id)).toEqual([4, 3]);
  });

  it('narrows to a field, and counts open threads per field', () => {
    const threads = [
      thread(1, { field: 'title' }),
      thread(2, { field: 'title' }),
      thread(3, { field: 'title', resolvedAt: '2026-02-01T00:00:00Z' }),
      thread(4, { field: 'seo.metaTitle' }),
      thread(5),
    ];
    expect(groupThreads(threads, 'title').open.map((item) => item.id)).toEqual([2, 1]);
    expect(groupThreads(threads, null).open.map((item) => item.id)).toEqual([5]);
    expect(openCountsByField(threads)).toEqual(
      new Map([
        ['title', 2],
        ['seo.metaTitle', 1],
      ]),
    );
  });

  it('labels field paths, items by position', () => {
    const label = (name: string) => name.toUpperCase();
    expect(fieldLabel('seo.metaTitle', label)).toBe('SEO › METATITLE');
    expect(fieldLabel('blocks.0.heading', label)).toBe('BLOCKS › #1 › HEADING');
  });
});

describe('tasks', () => {
  it('sorts open tasks by due date, then done ones by completion', () => {
    const tasks = [
      task(1, { status: 'done', completedAt: '2026-01-01T00:00:00Z' }),
      task(2),
      task(3, { dueDate: '2026-05-01' }),
      task(4, { dueDate: '2026-04-01' }),
      task(5, { status: 'done', completedAt: '2026-02-01T00:00:00Z' }),
    ];
    expect(sortTasks(tasks).map((item) => item.id)).toEqual([4, 3, 2, 5, 1]);
  });

  it('flags open tasks past their due date', () => {
    expect(isOverdue(task(1, { dueDate: '2026-01-01' }), '2026-01-02')).toBe(true);
    expect(isOverdue(task(1, { dueDate: '2026-01-02' }), '2026-01-02')).toBe(false);
    expect(isOverdue(task(1, { dueDate: '2026-01-01', status: 'done' }), '2026-01-02')).toBe(false);
    expect(isOverdue(task(1), '2026-01-02')).toBe(false);
  });
});

describe('CommentsApi', () => {
  function setup() {
    const calls: { method: string; path: string; body?: unknown; query?: string }[] = [];
    const api = {
      get: async (path: string, query?: string) => (calls.push({ method: 'GET', path, query }), []),
      post: async (path: string, body?: unknown) => (
        calls.push({ method: 'POST', path, body }),
        {}
      ),
      put: async (path: string, body: unknown) => (calls.push({ method: 'PUT', path, body }), {}),
      delete: async (path: string) => void calls.push({ method: 'DELETE', path }),
    };
    TestBed.configureTestingModule({ providers: [{ provide: Api, useValue: api }] });
    return { comments: TestBed.inject(CommentsApi), calls };
  }

  it('sends the entry, and leaves out what is not set', async () => {
    const { comments, calls } = setup();
    const entry = { uid: 'api::a.a', documentId: 'd1', locale: null };
    await comments.threads({ ...entry, locale: 'fr' });
    await comments.add(entry, { body: 'Hi', field: 'title' });
    await comments.add(entry, { body: 'Re', parentId: 7, field: null });
    await comments.addTask(entry, { title: 'Check', assigneeId: null, dueDate: '2026-05-01' });
    await comments.mine();
    await comments.updateTask(3, { assigneeId: null });
    expect(calls).toEqual([
      { method: 'GET', path: '/comments', query: 'uid=api%3A%3Aa.a&documentId=d1&locale=fr' },
      {
        method: 'POST',
        path: '/comments',
        body: { uid: 'api::a.a', documentId: 'd1', body: 'Hi', field: 'title' },
      },
      {
        method: 'POST',
        path: '/comments',
        body: { uid: 'api::a.a', documentId: 'd1', body: 'Re', parentId: 7 },
      },
      {
        method: 'POST',
        path: '/tasks',
        body: { uid: 'api::a.a', documentId: 'd1', title: 'Check', dueDate: '2026-05-01' },
      },
      { method: 'GET', path: '/tasks', query: 'mine=true&status=open' },
      { method: 'PUT', path: '/tasks/3', body: { assigneeId: null } },
    ]);
  });
});
