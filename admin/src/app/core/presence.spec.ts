import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { Api } from './api';
import { Auth } from './auth';
import { EntryPresence, heartbeatBody, initialsOf, lockHolder, othersOf } from './presence';
import { Realtime, RealtimeMessage, Viewer, isAbout } from './realtime';

const ada: Viewer = { userId: 1, name: 'Ada Lovelace', editing: true, holdsLock: true };
const bob: Viewer = { userId: 2, name: 'Bob', editing: false, holdsLock: false };
const cy: Viewer = { userId: 3, name: 'Cy', editing: true, holdsLock: false };

describe('presence', () => {
  it('lists the others, editors first', () => {
    expect(othersOf([bob, ada, cy], 3).map((viewer) => viewer.userId)).toEqual([1, 2]);
    expect(othersOf([bob, ada, cy], null).map((viewer) => viewer.userId)).toEqual([1, 3, 2]);
  });

  it('names who else holds the lock', () => {
    expect(lockHolder([ada, bob, cy], 2)).toBe(ada);
    expect(lockHolder([ada, bob, cy], 1)).toBeNull();
    expect(lockHolder([bob, cy], 2)).toBeNull();
  });

  it('takes initials from names or emails', () => {
    expect(initialsOf('Ada Lovelace')).toBe('AL');
    expect(initialsOf('ada.lovelace@example.com')).toBe('AL');
    expect(initialsOf('bob')).toBe('B');
    expect(initialsOf('Ana María de la Cruz')).toBe('AC');
  });

  it('builds heartbeats; leaving is never editing', () => {
    expect(heartbeatBody({ uid: 'api::a.a', documentId: 'd1', locale: 'en' }, true, false)).toEqual(
      { uid: 'api::a.a', documentId: 'd1', locale: 'en', editing: true, leave: false },
    );
    expect(heartbeatBody({ uid: 'api::a.a', documentId: 'd1', locale: null }, true, true)).toEqual({
      uid: 'api::a.a',
      documentId: 'd1',
      editing: false,
      leave: true,
    });
  });
});

describe('EntryPresence', () => {
  function setup() {
    const posts: unknown[] = [];
    const answers: Viewer[][] = [];
    const messages = new Subject<RealtimeMessage>();
    let retained = 0;
    const api = {
      post: async (_path: string, body: unknown) => {
        posts.push(body);
        return answers.shift() ?? [];
      },
    };
    const realtime = {
      retain: () => {
        retained++;
        return () => retained--;
      },
      entry: (entry: Parameters<typeof isAbout>[1]) => ({
        subscribe: (next: (message: RealtimeMessage) => void) => {
          const subscription = messages.subscribe((message) => {
            if (isAbout(message, entry)) next(message);
          });
          return subscription;
        },
      }),
      resync: new Subject<void>(),
    };
    TestBed.configureTestingModule({
      providers: [
        EntryPresence,
        { provide: Api, useValue: api },
        { provide: Auth, useValue: { user: signal({ id: 2 }), fetch: async () => new Response() } },
        { provide: Realtime, useValue: realtime },
      ],
    });
    return {
      presence: TestBed.inject(EntryPresence),
      posts,
      answers,
      messages,
      retained: () => retained,
    };
  }

  const entry = { uid: 'api::a.a', documentId: 'd1', locale: 'en' };
  const flush = () => new Promise((resolve) => setTimeout(resolve));

  it('beats, follows presence events, and leaves', async () => {
    const { presence, posts, answers, messages, retained } = setup();
    answers.push([ada, bob], [ada, bob]);
    presence.track(entry);
    await flush();
    expect(retained()).toBe(1);
    expect(posts).toEqual([{ ...entry, editing: false, leave: false }]);
    expect(presence.holder()).toEqual(ada);
    expect(presence.others().map((viewer) => viewer.userId)).toEqual([1]);

    presence.setEditing(true);
    presence.setEditing(true);
    await flush();
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual({ ...entry, editing: true, leave: false });

    // Presence of another locale is not this entry's.
    messages.next({ event: 'presence', ...entry, locale: 'fr', presence: [] });
    expect(presence.viewers()).toHaveLength(2);
    messages.next({ event: 'presence', ...entry, presence: [{ ...ada, holdsLock: false }] });
    expect(presence.holder()).toBeNull();

    presence.track(null);
    await flush();
    expect(posts[2]).toEqual({ ...entry, editing: false, leave: true });
    expect(retained()).toBe(0);
    expect(presence.viewers()).toEqual([]);
  });
});
