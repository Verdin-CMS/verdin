import { describe, expect, it } from 'vitest';

import {
  EVENTS,
  Webhook,
  headerProblem,
  headerRows,
  headersFromRows,
  isReservedHeader,
  prettyJson,
  toggleEvents,
  webhookForm,
  webhookInput,
} from './webhooks';

const hook: Webhook = {
  id: 7,
  name: 'Search index',
  url: 'https://example.com/hook',
  headers: { 'x-token': 'abc', authorization: 'Bearer 1' },
  events: ['entry.publish', 'media.delete'],
  contentTypes: ['api::article'],
  signed: false,
  enabled: false,
  createdAt: null,
  updatedAt: null,
};

describe('headers', () => {
  it('turns stored headers into sorted rows and back', () => {
    const rows = headerRows(hook.headers);
    expect(rows).toEqual([
      { name: 'authorization', value: 'Bearer 1' },
      { name: 'x-token', value: 'abc' },
    ]);
    expect(headersFromRows(rows)).toEqual(hook.headers);
    expect(headerRows(null)).toEqual([]);
  });

  it('trims and lower-cases names and drops empty rows', () => {
    expect(
      headersFromRows([
        { name: ' X-Api-Key ', value: ' secret ' },
        { name: '  ', value: 'ignored' },
      ]),
    ).toEqual({ 'x-api-key': ' secret ' });
  });

  it('flags reserved and duplicate names', () => {
    expect(isReservedHeader('Content-Type')).toBe(true);
    expect(isReservedHeader('x-verdin-event')).toBe(true);
    expect(isReservedHeader('x-custom')).toBe(false);
    expect(headerProblem([{ name: 'Host', value: 'a' }])).toEqual({
      kind: 'reserved',
      name: 'host',
    });
    expect(
      headerProblem([
        { name: 'X-A', value: '1' },
        { name: 'x-a ', value: '2' },
      ]),
    ).toEqual({ kind: 'duplicate', name: 'x-a' });
    expect(
      headerProblem([
        { name: '', value: '' },
        { name: 'x-a', value: '1' },
      ]),
    ).toBeNull();
  });
});

describe('events', () => {
  it('adds and removes events in catalog order', () => {
    expect(toggleEvents(['media.delete'], ['entry.create', 'entry.update'], true)).toEqual([
      'entry.create',
      'entry.update',
      'media.delete',
    ]);
    expect(
      toggleEvents([...EVENTS], ['media.create', 'media.update', 'media.delete'], false),
    ).toEqual(EVENTS.filter((event) => !event.startsWith('media.')));
  });
});

describe('payloads', () => {
  it('starts new webhooks enabled, signed and on entry events', () => {
    const form = webhookForm();
    expect(form.enabled).toBe(true);
    expect(form.signed).toBe(true);
    expect(form.events.every((event) => event.startsWith('entry.'))).toBe(true);
    expect(form.contentTypes).toEqual([]);
  });

  it('builds the create body with `signed`', () => {
    const form = {
      ...webhookForm(),
      name: '  Hook ',
      url: ' https://example.com ',
      events: ['media.create', 'entry.create'],
      contentTypes: ['api::b', 'api::a', 'api::a'],
      headers: [{ name: 'X-Key', value: 'v' }],
    };
    expect(webhookInput(form, true)).toEqual({
      name: 'Hook',
      url: 'https://example.com',
      headers: { 'x-key': 'v' },
      events: ['entry.create', 'media.create'],
      contentTypes: ['api::a', 'api::b'],
      enabled: true,
      signed: true,
    });
  });

  it('round-trips a stored webhook into the update body, without `signed`', () => {
    const input = webhookInput(webhookForm(hook), false);
    expect(input).toEqual({
      name: hook.name,
      url: hook.url,
      headers: hook.headers,
      events: hook.events,
      contentTypes: hook.contentTypes,
      enabled: false,
    });
    expect('signed' in input).toBe(false);
  });
});

describe('prettyJson', () => {
  it('indents values and JSON strings, keeps other text', () => {
    expect(prettyJson({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettyJson('plain text')).toBe('plain text');
    expect(prettyJson(null)).toBe('');
  });
});
