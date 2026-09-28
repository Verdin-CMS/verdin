import { HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import { Observable, Subject, filter, tap } from 'rxjs';

import { RUNTIME_CONFIG } from './api';
import { Auth } from './auth';

/** Who is on an entry, as `presence` events and `/presence` report it. */
export interface Viewer {
  userId: number;
  name: string;
  /** Has unsaved changes. */
  editing: boolean;
  /** The first admin still editing holds the soft lock. */
  holdsLock: boolean;
}

/** One event of the admin stream (`GET /events`). Events carry ids, not content. */
export interface RealtimeMessage {
  /** `entry.update`, `media.create`, `presence`, `comment.create`, `task.update`… */
  event: string;
  uid: string;
  documentId?: string;
  /** Absent for types that are not localized. */
  locale?: string;
  /** Media events. */
  fileId?: number;
  /** Presence events: who is on the entry now. */
  presence?: Viewer[];
}

/** A parsed Server-Sent Event. */
export interface SseEvent {
  event: string;
  data: string;
  id: string | null;
}

/**
 * An incremental Server-Sent Events parser (the WHATWG algorithm): feed it text as it
 * arrives, in chunks of any size, and it returns the events completed so far.
 */
export class SseParser {
  private buffer = '';
  private data: string[] = [];
  private name = '';
  private lastId: string | null = null;
  /** The reconnection delay the server asked for (`retry:`), in ms. */
  retry: number | null = null;

  push(text: string): SseEvent[] {
    this.buffer += text;
    const events: SseEvent[] = [];
    for (;;) {
      const match = /\r\n|\r|\n/.exec(this.buffer);
      if (!match) break;
      // A lone `\r` at the end may be the first half of `\r\n`: wait for more.
      if (match[0] === '\r' && match.index === this.buffer.length - 1) break;
      const line = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const event = this.line(line);
      if (event) events.push(event);
    }
    return events;
  }

  private line(line: string): SseEvent | null {
    if (line === '') {
      const data = this.data;
      const name = this.name;
      this.data = [];
      this.name = '';
      if (!data.length) return null;
      return { event: name || 'message', data: data.join('\n'), id: this.lastId };
    }
    if (line.startsWith(':')) return null;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') this.data.push(value);
    else if (field === 'event') this.name = value;
    else if (field === 'id' && !value.includes('\0')) this.lastId = value;
    else if (field === 'retry' && /^\d+$/.test(value)) this.retry = Number(value);
    return null;
  }
}

/** The admin stream's event as a message (`null`: not one, e.g. `ready` or bad JSON). */
export function toMessage(event: SseEvent): RealtimeMessage | null {
  if (event.event === 'ready' || event.event === 'lagged') return null;
  try {
    const parsed = JSON.parse(event.data) as Partial<RealtimeMessage>;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.uid !== 'string') return null;
    return { ...parsed, event: parsed.event ?? event.event, uid: parsed.uid };
  } catch {
    return null;
  }
}

export interface RealtimeOptions {
  /** First retry delay after a failure, doubled on each failure (ms). */
  baseDelay: number;
  /** Longest retry delay (ms). */
  maxDelay: number;
  /** Delay before reopening a stream the server closed normally (ms). */
  reopenDelay: number;
}

export const REALTIME_OPTIONS = new InjectionToken<RealtimeOptions>('REALTIME_OPTIONS', {
  providedIn: 'root',
  factory: () => ({ baseDelay: 1_000, maxDelay: 30_000, reopenDelay: 250 }),
});

/**
 * The delay before retry number `attempt` (1-based): exponential, capped, with up to 25%
 * jitter so that clients do not all come back at once after a restart.
 */
export function backoffDelay(
  attempt: number,
  options: Pick<RealtimeOptions, 'baseDelay' | 'maxDelay'>,
  random: () => number = Math.random,
): number {
  const exponential = options.baseDelay * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(options.maxDelay, exponential);
  return Math.round(capped * (0.75 + random() * 0.25));
}

/** An entry, as events and presence identify it (`locale` empty or absent: not localized). */
export interface EntryKey {
  uid: string;
  documentId: string;
  locale?: string | null;
}

/** Whether `message` is about `entry` (same type, document and locale). */
export function isAbout(message: RealtimeMessage, entry: EntryKey): boolean {
  return (
    message.uid === entry.uid &&
    message.documentId === entry.documentId &&
    (message.locale ?? '') === (entry.locale ?? '')
  );
}

/** Writes by this tab count as its own for this long after they were sent or answered. */
export const OWN_WRITE_WINDOW = 5_000;

type Status = 'idle' | 'connecting' | 'open' | 'retrying';

/**
 * The admin's realtime channel: one shared `GET /events` stream per session, opened while
 * something uses it (`retain`) and reopened when it ends (the server closes it after 15
 * minutes) or fails (with backoff). The access token goes in `Authorization`, which
 * `EventSource` cannot send, so the stream is read with `fetch`.
 */
@Injectable({ providedIn: 'root' })
export class Realtime {
  private readonly auth = inject(Auth);
  private readonly config = inject(RUNTIME_CONFIG);
  private readonly options = inject(REALTIME_OPTIONS);

  readonly status = signal<Status>('idle');
  private readonly subject = new Subject<RealtimeMessage>();
  private readonly resyncs = new Subject<void>();
  /** Every event, as it arrives. */
  readonly messages: Observable<RealtimeMessage> = this.subject.asObservable();
  /**
   * The stream reopened after a gap, or the server reported missed events (`lagged`):
   * whatever listens should refetch what it shows.
   */
  readonly resync: Observable<void> = this.resyncs.asObservable();

  private users = 0;
  private controller: AbortController | null = null;
  private running: Promise<void> | null = null;
  private wake: (() => void) | null = null;
  /** `uid|documentId` → when this tab last wrote to it. */
  private readonly writes = new Map<string, number>();

  /** Keeps the stream open until the returned function is called. */
  retain(): () => void {
    this.users++;
    if (this.users === 1) this.running ??= this.run();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.users--;
      if (this.users === 0) this.stop();
    };
  }

  /** Events about one entry. */
  entry(entry: EntryKey): Observable<RealtimeMessage> {
    return this.messages.pipe(filter((message) => isAbout(message, entry)));
  }

  /** Records a write to an entry by this tab (see `ownWritesInterceptor`). */
  noteWrite(uid: string, documentId: string, now = Date.now()): void {
    this.writes.set(`${uid}|${documentId}`, now);
    if (this.writes.size > 200) {
      for (const [key, at] of this.writes) if (now - at > OWN_WRITE_WINDOW) this.writes.delete(key);
    }
  }

  /**
   * Whether an entry event most likely comes from this tab's own write. Events do not say
   * who made the change, so writes this tab sent a moment ago are taken as the cause.
   */
  isOwn(message: RealtimeMessage, now = Date.now()): boolean {
    if (!message.documentId) return false;
    const at = this.writes.get(`${message.uid}|${message.documentId}`);
    return at !== undefined && now - at <= OWN_WRITE_WINDOW;
  }

  private stop(): void {
    this.controller?.abort();
    this.wake?.();
  }

  private async run(): Promise<void> {
    let failures = 0;
    let first = true;
    try {
      while (this.users > 0) {
        const controller = new AbortController();
        this.controller = controller;
        this.status.set(failures ? 'retrying' : 'connecting');
        let opened = false;
        try {
          const response = await this.auth.fetch(`${this.config.apiBase}/events`, {
            headers: { Accept: 'text/event-stream' },
            cache: 'no-store',
            signal: controller.signal,
          });
          if (response.ok && response.body) {
            opened = true;
            failures = 0;
            this.status.set('open');
            // Events may have been missed while the stream was closed.
            if (!first) this.resyncs.next();
            first = false;
            await this.read(response.body, controller.signal);
          } else {
            await response.body?.cancel().catch(() => undefined);
          }
        } catch {
          // Network errors and aborts: retried below unless stopped.
        }
        if (this.users === 0 || controller.signal.aborted) break;
        if (!opened) failures++;
        this.status.set('retrying');
        await this.sleep(opened ? this.options.reopenDelay : backoffDelay(failures, this.options));
      }
    } finally {
      this.controller = null;
      this.running = null;
      this.status.set('idle');
      // Retained again while stopping: start over.
      if (this.users > 0) this.running = this.run();
    }
  }

  private async read(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();
    const abort = () => void reader.cancel().catch(() => undefined);
    signal.addEventListener('abort', abort);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const event of parser.push(decoder.decode(value, { stream: true }))) {
          if (event.event === 'lagged') {
            this.resyncs.next();
            continue;
          }
          const message = toMessage(event);
          if (message) this.subject.next(message);
        }
      }
    } finally {
      signal.removeEventListener('abort', abort);
      reader.releaseLock?.();
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.wake = () => {
        this.wake = null;
        done();
      };
    });
  }
}

/** `/content/{uid}/{documentId}…` of the admin API, split (`null` otherwise). */
export function entryOfUrl(
  url: string,
  apiBase: string,
): { uid: string; documentId: string | null } | null {
  const path = url.split('?')[0];
  const base = apiBase.replace(/\/$/, '');
  const index = path.indexOf(`${base}/content/`);
  if (index < 0) return null;
  const [uid, documentId] = path
    .slice(index + base.length + '/content/'.length)
    .split('/')
    .map(decodeURIComponent);
  if (!uid || !uid.includes('::')) return null;
  return { uid, documentId: documentId || null };
}

/**
 * Remembers the entries this tab writes to, so that the editor and the list can tell
 * their own changes from other admins' when the realtime events come back.
 */
export const ownWritesInterceptor: HttpInterceptorFn = (request, next) => {
  if (request.method === 'GET' || request.method === 'HEAD') return next(request);
  const realtime = inject(Realtime);
  const target = entryOfUrl(request.url, inject(RUNTIME_CONFIG).apiBase);
  if (!target) return next(request);
  if (target.documentId) realtime.noteWrite(target.uid, target.documentId);
  return next(request).pipe(
    tap((event) => {
      if (!(event instanceof HttpResponse)) return;
      const documentId =
        target.documentId ??
        (event.body as { data?: { documentId?: unknown } } | null)?.data?.documentId;
      if (typeof documentId === 'string') realtime.noteWrite(target.uid, documentId);
    }),
  );
};
