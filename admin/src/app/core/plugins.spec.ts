import { describe, expect, it } from 'vitest';

import {
  PluginSettingField,
  capabilityGroups,
  customFieldId,
  parseCustomField,
  parseSettings,
  pluginRouteUrl,
  settingProblem,
  settingsFormValues,
  settingsFromForm,
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

function field(overrides: Partial<PluginSettingField>): PluginSettingField {
  return {
    key: 'k',
    label: 'K',
    type: 'string',
    required: false,
    options: [],
    default: null,
    min: null,
    max: null,
    ...overrides,
  };
}

describe('plugin settings forms', () => {
  const fields = [
    field({ key: 'greeting', max: 5 }),
    field({ key: 'times', type: 'integer', min: 1, max: 5, default: 1 }),
    field({ key: 'loud', type: 'boolean' }),
    field({ key: 'mode', type: 'select', options: ['a', 'b'], default: 'a' }),
    field({ key: 'site', type: 'url' }),
  ];

  it('starts from the stored settings, then the defaults', () => {
    expect(settingsFormValues(fields, { greeting: 'hi', loud: true })).toEqual({
      greeting: 'hi',
      times: '1',
      loud: true,
      mode: 'a',
      site: '',
    });
  });

  it('saves typed values and leaves empty ones to their defaults', () => {
    expect(
      settingsFromForm(fields, { greeting: '', times: ' 3 ', loud: false, mode: 'b', site: '' }),
    ).toEqual({ times: 3, loud: false, mode: 'b' });
  });

  it('checks values like the server', () => {
    const [greeting, times, , mode, site] = fields;
    expect(settingProblem(greeting, 'hello')).toBeNull();
    expect(settingProblem(greeting, 'hello!')).toEqual({ kind: 'max', bound: 5, length: true });
    expect(settingProblem(times, '0')).toEqual({ kind: 'min', bound: 1, length: false });
    expect(settingProblem(times, '2.5')).toEqual({ kind: 'integer' });
    expect(settingProblem(times, 'x')).toEqual({ kind: 'number' });
    expect(settingProblem(mode, 'c')).toEqual({ kind: 'option' });
    expect(settingProblem(site, 'ftp://x')).toEqual({ kind: 'url' });
    expect(settingProblem(site, 'https://x.example')).toBeNull();
  });

  it('requires values without a default', () => {
    expect(settingProblem(field({ required: true }), ' ')).toEqual({ kind: 'required' });
    expect(settingProblem(field({ required: true, default: 'x' }), '')).toBeNull();
    expect(settingProblem(field({}), '')).toBeNull();
  });
});
