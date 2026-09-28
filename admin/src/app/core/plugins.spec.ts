import { describe, expect, it } from 'vitest';

import {
  capabilityGroups,
  customFieldId,
  parseCustomField,
  parseSettings,
  pluginRouteUrl,
} from './plugins';

describe('custom fields', () => {
  it('parses plugin::<plugin>.<field>', () => {
    expect(parseCustomField('plugin::colors.color')).toEqual({ plugin: 'colors', field: 'color' });
    expect(parseCustomField('plugin::my-plugin.field.v2')).toEqual({
      plugin: 'my-plugin',
      field: 'field.v2',
    });
    expect(customFieldId('colors', 'color')).toBe('plugin::colors.color');
  });

  it('rejects anything else', () => {
    for (const value of [
      undefined,
      null,
      '',
      'colors.color',
      'plugin::colors',
      'plugin::.x',
      'global::a.b',
    ]) {
      expect(parseCustomField(value)).toBeNull();
    }
  });
});

describe('plugin routes', () => {
  it('builds the URL under the content API base', () => {
    expect(pluginRouteUrl('/api', '/plugins/sample', 'https://cms.example.com/admin/')).toBe(
      'https://cms.example.com/api/plugins/sample',
    );
    expect(pluginRouteUrl('/api/', 'plugins/sample', 'https://cms.example.com/')).toBe(
      'https://cms.example.com/api/plugins/sample',
    );
    expect(
      pluginRouteUrl('https://api.example.com/v1', '/plugins/x', 'https://cms.example.com/'),
    ).toBe('https://api.example.com/v1/plugins/x');
  });
});

describe('settings', () => {
  it('accepts JSON objects and empty text', () => {
    expect(parseSettings('{ "a": 1 }')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseSettings('  ')).toEqual({ ok: true, value: {} });
  });

  it('rejects invalid JSON and non-objects', () => {
    expect(parseSettings('{ a: 1 }').ok).toBe(false);
    expect(parseSettings('[1]')).toEqual({ ok: false, error: 'object' });
    expect(parseSettings('null')).toEqual({ ok: false, error: 'object' });
    expect(parseSettings('"x"')).toEqual({ ok: false, error: 'object' });
  });
});

describe('capabilities', () => {
  it('lists risky access first and drops reads implied by writes', () => {
    expect(
      capabilityGroups({
        read: ['api::article', 'api::tag', 'api::tag'],
        write: ['api::tag'],
        http: ['api.example.com'],
        kv: true,
      }),
    ).toEqual([
      { kind: 'write', items: ['api::tag'], risky: true },
      { kind: 'http', items: ['api.example.com'], risky: true },
      { kind: 'read', items: ['api::article'], risky: false },
      { kind: 'kv', items: [], risky: false },
    ]);
  });

  it('treats a wildcard write as covering every read', () => {
    expect(capabilityGroups({ read: ['api::a'], write: ['*'] })).toEqual([
      { kind: 'write', items: ['*'], risky: true },
    ]);
  });

  it('is empty for a sandboxed plugin', () => {
    expect(capabilityGroups({ read: [], write: [], http: [], kv: false })).toEqual([]);
    expect(capabilityGroups(null)).toEqual([]);
  });
});
