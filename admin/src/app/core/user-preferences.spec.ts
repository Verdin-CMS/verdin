import { describe, expect, it } from 'vitest';

import { asObject, setPreference } from './user-preferences';

describe('preferences', () => {
  const stored = {
    theme: 'dark',
    dashboard: { version: 1, widgets: [] },
    listViews: { 'api::tag.tag': { pageSize: 50 } },
  };

  it('sets a nested key and keeps every other key', () => {
    const next = setPreference(stored, ['listViews', 'api::article.article'], { pageSize: 10 });
    expect(next).toEqual({
      theme: 'dark',
      dashboard: { version: 1, widgets: [] },
      listViews: { 'api::tag.tag': { pageSize: 50 }, 'api::article.article': { pageSize: 10 } },
    });
    expect(stored.listViews).toEqual({ 'api::tag.tag': { pageSize: 50 } });
  });

  it('removes a key with undefined and drops emptied parents', () => {
    expect(setPreference(stored, ['listViews', 'api::tag.tag'], undefined)).toEqual({
      theme: 'dark',
      dashboard: { version: 1, widgets: [] },
    });
    expect(setPreference(stored, ['dashboard'], undefined)).not.toHaveProperty('dashboard');
  });

  it('replaces a malformed parent', () => {
    expect(setPreference({ listViews: 'oops' }, ['listViews', 'a'], { pageSize: 10 })).toEqual({
      listViews: { a: { pageSize: 10 } },
    });
  });

  it('reads only plain objects', () => {
    expect(asObject(null)).toEqual({});
    expect(asObject([1])).toEqual({});
    expect(asObject('x')).toEqual({});
    expect(asObject({ a: 1 })).toEqual({ a: 1 });
  });
});
