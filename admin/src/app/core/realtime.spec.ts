import { TestBed } from '@angular/core/testing';
import { firstValueFrom, take, toArray } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';

import { RUNTIME_CONFIG } from './api';
import { Auth } from './auth';
import {
  OWN_WRITE_WINDOW,
  REALTIME_OPTIONS,
  Realtime,
  RealtimeMessage,
  SseParser,
  backoffDelay,
  entryOfUrl,
  isAbout,
  toMessage,
} from './realtime';

describe('SseParser', () => {
  it('parses events with names, ids and multi-line data', () => {
    const parser = new SseParser();
    const events = parser.push(
      'event: entry.update\nid: 7\ndata: {"a":1,\ndata: "b":2}\n\n: keep-alive\n\ndata: plain\n\n',
    );
    expect(events).toEqual([
      { event: 'entry.update', data: '{"a":1,\n"b":2}', id: '7' },
      { event: 'message', data: 'plain', id: '7' },
    ]);
  });

  it('handles events split across chunks, and CRLF or CR line endings', () => {
    const parser = new SseParser();
    expect(parser.push('event: rea')).toEqual([]);
    expect(parser.push('dy\r')).toEqual([]);
    expect(parser.push('\ndata: {}\r\n\r')).toEqual([]);
    expect(parser.push('\n')).toEqual([{ event: 'ready', data: '{}', id: null }]);
    expect(parser.push('data:x\r\rdata:  y\n\n')).toEqual([
      { event: 'message', data: 'x', id: null },
      { event: 'message', data: ' y', id: null },
    ]);
  });

  it('ignores events without data and reads retry', () => {
    const parser = new SseParser();
    expect(parser.push('event: nothing\n\nretry: 3000\nretry: soon\n\n')).toEqual([]);
    expect(parser.retry).toBe(3000);
  });
});

describe('toMessage', () => {
  it('reads the JSON payload, and skips ready, lagged and malformed events', () => {
    expect(
      toMessage({
        event: 'entry.publish',
        data: '{"event":"entry.publish","uid":"api::a.a","documentId":"d1","locale":"en"}',
        id: null,
      }),
    ).toEqual({ event: 'entry.publish', uid: 'api::a.a', documentId: 'd1', locale: 'en' });
    expect(toMessage({ event: 'ready', data: '{}', id: null })).toBeNull();
    expect(toMessage({ event: 'lagged', data: '{"missed":3}', id: null })).toBeNull();
    expect(toMessage({ event: 'x', data: 'not json', id: null })).toBeNull();
    expect(toMessage({ event: 'x', data: '{"event":"x"}', id: null })).toBeNull();
  });
});

describe('backoffDelay', () => {
  const options = { baseDelay: 1000, maxDelay: 30_000 };

  it('doubles per failure, capped, with up to 25% less for jitter', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => backoffDelay(n, options, () => 1))).toEqual([
      1000, 2000, 4000, 8000, 16_000, 30_000, 30_000,
    ]);
    expect(backoffDelay(3, options, () => 0)).toBe(3000);
  });
});

describe('entries of events and URLs', () => {
  it('matches events to an entry, locale included', () => {
    const message: RealtimeMessage = { event: 'x', uid: 'api::a.a', documentId: 'd1' };
    expect(isAbout(message, { uid: 'api::a.a', documentId: 'd1', locale: null })).toBe(true);
    expect(isAbout(message, { uid: 'api::a.a', documentId: 'd1', locale: 'en' })).toBe(false);
    expect(
      isAbout({ ...message, locale: 'en' }, { uid: 'api::a.a', documentId: 'd1', locale: 'en' }),
    ).toBe(true);
    expect(isAbout(message, { uid: 'api::a.a', documentId: 'd2' })).toBe(false);
  });

  it('finds the entry of admin content URLs', () => {
    expect(
      entryOfUrl('/admin/api/content/api::a.a/d1/actions/publish?locale=en', '/admin/api'),
    ).toEqual({
      uid: 'api::a.a',
      documentId: 'd1',
    });
    expect(entryOfUrl('/admin/api/content/api::a.a?populate=*', '/admin/api')).toEqual({
      uid: 'api::a.a',
      documentId: null,
    });
    expect(entryOfUrl('/admin/api/comments', '/admin/api')).toBeNull();
    expect(entryOfUrl('/admin/api/content/types', '/admin/api')).toBeNull();
  });
});

/** A response whose body streams `chunks`, then ends (or stays open). */
function streamResponse(chunks: string[], end = true): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (end) controller.close();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

function setup(responses: (() => Promise<Response>)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  let index = 0;
  const auth = {
    fetch: (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const next = responses[Math.min(index++, responses.length - 1)];
      return next();
    },
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: Auth, useValue: auth },
      { provide: RUNTIME_CONFIG, useValue: { apiBase: '/admin/api', contentApiBase: '/api' } },
      { provide: REALTIME_OPTIONS, useValue: { baseDelay: 5, maxDelay: 20, reopenDelay: 1 } },
    ],
  });
  return { realtime: TestBed.inject(Realtime), calls };
}

describe('Realtime', () => {
  let release: (() => void) | null = null;
  afterEach(() => {
    release?.();
    release = null;
  });

  it('shares one stream, retries failures and reopens ended streams', async () => {
    const event = (documentId: string) =>
      `event: entry.update\ndata: {"event":"entry.update","uid":"api::a.a","documentId":"${documentId}"}\n\n`;
    const { realtime, calls } = setup([
      () => Promise.reject(new TypeError('offline')),
      () => Promise.resolve({ ok: false, status: 502, body: null } as unknown as Response),
      () => Promise.resolve(streamResponse(['event: ready\ndata: {}\n\n', event('d1')])),
      () => Promise.resolve(streamResponse([event('d2')], false)),
    ]);
    const received = firstValueFrom(realtime.messages.pipe(take(2), toArray()));
    const resynced = firstValueFrom(realtime.resync);
    release = realtime.retain();
    const second = realtime.retain();
    second();
    const messages = await received;
    expect(messages.map((message) => message.documentId)).toEqual(['d1', 'd2']);
    await resynced;
    expect(calls).toHaveLength(4);
    expect(calls[0].url).toBe('/admin/api/events');
    expect(new Headers(calls[0].init.headers).get('Accept')).toBe('text/event-stream');
    expect(realtime.status()).toBe('open');
  });

  it('closes the stream once nobody uses it', async () => {
    let signal: AbortSignal | undefined;
    const { realtime } = setup([
      () => Promise.resolve(streamResponse(['event: ready\ndata: {}\n\n'], false)),
    ]);
    const auth = TestBed.inject(Auth) as unknown as {
      fetch: (u: string, i: RequestInit) => unknown;
    };
    const original = auth.fetch;
    auth.fetch = (url, init) => {
      signal = init.signal ?? undefined;
      return original(url, init);
    };
    const stop = realtime.retain();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(realtime.status()).toBe('open');
    stop();
    expect(signal?.aborted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(realtime.status()).toBe('idle');
  });

  it('tells its own writes from other admins’ for a moment', () => {
    const { realtime } = setup([() => new Promise<Response>(() => undefined)]);
    const message: RealtimeMessage = { event: 'entry.update', uid: 'api::a.a', documentId: 'd1' };
    realtime.noteWrite('api::a.a', 'd1', 1000);
    expect(realtime.isOwn(message, 1000 + OWN_WRITE_WINDOW)).toBe(true);
    expect(realtime.isOwn(message, 1001 + OWN_WRITE_WINDOW)).toBe(false);
    expect(realtime.isOwn({ ...message, documentId: 'd2' }, 1000)).toBe(false);
  });
});
