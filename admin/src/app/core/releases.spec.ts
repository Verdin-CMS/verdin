import { describe, expect, it } from 'vitest';

import {
  Release,
  fromLocalInput,
  hasEntry,
  isEditable,
  sortReleases,
  toLocalInput,
} from './releases';

function release(id: number, status: Release['status'], scheduledAt: string | null = null) {
  return {
    id,
    name: `R${id}`,
    scheduledAt,
    status,
    releasedAt: null,
    error: null,
    createdBy: 1,
    createdAt: null,
    updatedAt: null,
    actions: [],
  } satisfies Release;
}

describe('release dates', () => {
  it('round-trips datetime-local values', () => {
    const iso = fromLocalInput('2026-10-01T08:30')!;
    expect(new Date(iso).getTime()).toBe(new Date(2026, 9, 1, 8, 30).getTime());
    expect(toLocalInput(iso)).toBe('2026-10-01T08:30');
  });

  it('treats empty or invalid values as no date', () => {
    expect(fromLocalInput('')).toBeNull();
    expect(fromLocalInput('tomorrow')).toBeNull();
    expect(toLocalInput(null)).toBe('');
    expect(toLocalInput('nope')).toBe('');
  });
});

describe('releases', () => {
  it('can change only while pending', () => {
    expect(isEditable({ status: 'pending' })).toBe(true);
    for (const status of ['running', 'done', 'failed'] as const)
      expect(isEditable({ status })).toBe(false);
  });

  it('sorts pending releases first, soonest first, then the latest', () => {
    const sorted = sortReleases([
      release(1, 'done'),
      release(2, 'pending'),
      release(3, 'pending', '2026-10-02T00:00:00Z'),
      release(4, 'pending', '2026-10-01T00:00:00Z'),
      release(5, 'failed'),
      release(6, 'running'),
    ]);
    expect(sorted.map((item) => item.id)).toEqual([4, 3, 2, 6, 5, 1]);
  });

  it('finds an entry by type, document and locale', () => {
    const item: Release = {
      ...release(1, 'pending'),
      actions: [
        {
          id: 1,
          uid: 'api::page',
          documentId: 'a',
          locale: 'fr',
          action: 'publish',
          status: 'pending',
          error: null,
        },
        {
          id: 2,
          uid: 'api::article',
          documentId: 'b',
          locale: '',
          action: 'unpublish',
          status: 'pending',
          error: null,
        },
      ],
    };
    expect(hasEntry(item, 'api::page', 'a', 'fr')?.id).toBe(1);
    expect(hasEntry(item, 'api::page', 'a', 'en')).toBeUndefined();
    expect(hasEntry(item, 'api::article', 'b', null)?.id).toBe(2);
  });
});
