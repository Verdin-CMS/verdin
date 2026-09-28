import { describe, expect, it } from 'vitest';

import {
  compactDisabled,
  disabledSetting,
  emptySsoForm,
  expandDisabled,
  mcpCommand,
  mcpUrl,
  normalizeOrigin,
  readDisabled,
  readOrigins,
  toggleOperations,
  previewSettingsFrom,
  previewTemplate,
  previewTtlProblem,
  readPreviewSettings,
  secureIssuer,
  splitList,
  ssoFormsFrom,
  ssoProblems,
  ssoRedirectUri,
  ssoSecretVariable,
  ssoSettingsFrom,
  ssoStartUrl,
  validPreviewTemplate,
} from './feature-settings';

describe('preview settings', () => {
  it('reads templates and the lifetime, dropping anything else', () => {
    expect(
      readPreviewSettings({ urls: { 'api::a': 'https://x/{slug}', 'api::b': 3 }, ttlMinutes: 5 }),
    ).toEqual({ urls: { 'api::a': 'https://x/{slug}' }, ttlMinutes: 5 });
    expect(readPreviewSettings(null)).toEqual({ urls: {} });
    expect(previewTemplate({ urls: { 'api::a': ' https://x ' } }, 'api::a')).toBe('https://x');
    expect(previewTemplate({ urls: { 'api::a': '  ' } }, 'api::a')).toBeNull();
    expect(previewTemplate(null, 'api::a')).toBeNull();
  });

  it('checks templates like the server', () => {
    expect(validPreviewTemplate('https://site/{locale}/blog/{slug}')).toBe(true);
    expect(validPreviewTemplate('{origin}/blog')).toBe(false);
    expect(validPreviewTemplate('javascript:alert(1)')).toBe(false);
    expect(validPreviewTemplate('/relative')).toBe(false);
  });

  it('builds settings from the form', () => {
    expect(
      previewSettingsFrom(
        [
          { uid: 'api::a', template: ' https://x/{slug} ' },
          { uid: 'api::b', template: '' },
        ],
        '30',
      ),
    ).toEqual({ urls: { 'api::a': 'https://x/{slug}' }, ttlMinutes: 30 });
    expect(previewSettingsFrom([], ' ')).toEqual({ urls: {} });
  });

  it('bounds the lifetime', () => {
    expect(previewTtlProblem('')).toBeNull();
    expect(previewTtlProblem('60')).toBeNull();
    expect(previewTtlProblem('0')).toBe('invalid');
    expect(previewTtlProblem('1.5')).toBe('invalid');
    expect(previewTtlProblem('100000')).toBe('invalid');
  });
});

describe('single sign-on settings', () => {
  const stored = {
    providers: [
      {
        id: 'corp',
        name: 'Corp',
        issuer: 'https://login.example.com',
        clientId: 'abc',
        scopes: ['openid', 'email'],
        autoCreate: true,
        defaultRoles: ['author'],
        roleClaim: 'groups',
        roleMap: { g1: 'editor' },
        allowedDomains: ['corp.example'],
      },
    ],
  };

  it('round-trips providers through the form', () => {
    const forms = ssoFormsFrom(stored);
    expect(forms[0]).toMatchObject({
      scopes: 'openid email',
      roleMap: [{ claim: 'g1', role: 'editor' }],
      allowedDomains: 'corp.example',
    });
    expect(ssoSettingsFrom(forms)).toEqual(stored);
  });

  it('fills defaults and drops empty rows', () => {
    const form = {
      ...emptySsoForm(),
      id: ' x ',
      name: 'X',
      issuer: 'https://x',
      clientId: 'c',
      scopes: '',
      roleMap: [{ claim: '', role: 'editor' }],
      allowedDomains: 'A.example, b.example',
    };
    expect(ssoSettingsFrom([form]).providers[0]).toEqual({
      id: 'x',
      name: 'X',
      issuer: 'https://x',
      clientId: 'c',
      scopes: ['openid', 'email', 'profile'],
      autoCreate: false,
      defaultRoles: [],
      roleMap: {},
      allowedDomains: ['a.example', 'b.example'],
    });
  });

  it('mirrors the server checks', () => {
    const good = ssoFormsFrom(stored)[0];
    expect(ssoProblems([good])).toEqual([{}]);
    expect(
      ssoProblems([
        good,
        {
          ...good,
          name: ' ',
          clientId: '',
          issuer: 'http://login.example.com',
          scopes: 'email',
          defaultRoles: [],
          roleMap: [],
        },
      ])[1],
    ).toEqual({
      id: 'duplicate',
      name: 'name',
      clientId: 'clientId',
      issuer: 'issuer',
      scopes: 'openid',
      defaultRoles: 'roles',
    });
    expect(ssoProblems([{ ...good, id: 'Corp' }])[0].id).toBe('id');
    expect(secureIssuer('http://localhost:8080/realms/x')).toBe(true);
  });

  it('names the secret variable, the redirect URI and the start URL', () => {
    expect(ssoSecretVariable('my-corp')).toBe('VERDIN_SSO_MY_CORP_SECRET');
    expect(ssoRedirectUri('/admin/api', 'corp', 'https://cms.example.com')).toBe(
      'https://cms.example.com/admin/api/auth/sso/corp/callback',
    );
    expect(ssoStartUrl('/cms/admin/api/', 'corp')).toBe('/cms/admin/api/auth/sso/corp');
    expect(splitList('a, b  c,,a')).toEqual(['a', 'b', 'c']);
  });
});

describe('GraphQL disabled operations', () => {
  it('expands stored groups and compacts them back', () => {
    expect([...expandDisabled(['queries', 'delete', 'nope'])]).toEqual([
      'find',
      'findOne',
      'delete',
    ]);
    expect(expandDisabled(['*']).size).toBe(5);
    expect(compactDisabled(new Set(['find', 'findOne', 'create', 'update', 'delete']))).toEqual([
      '*',
    ]);
    expect(compactDisabled(new Set(['create', 'update', 'delete', 'find']))).toEqual([
      'find',
      'mutations',
    ]);
    expect(compactDisabled(new Set(['findOne', 'findOne']))).toEqual(['findOne']);
    expect(compactDisabled(new Set())).toEqual([]);
  });

  it('reads and writes settings.disabled', () => {
    const state = readDisabled({
      disabled: { 'api::a': ['mutations'], 'api::b': [], 'api::c': 'x', 'api::d': ['find', 3] },
    });
    expect(Object.keys(state)).toEqual(['api::a', 'api::d']);
    expect(readDisabled(null)).toEqual({});
    const next = {
      ...state,
      'api::a': toggleOperations(state['api::a'], ['find', 'findOne'], true),
      'api::d': toggleOperations(state['api::d'], ['find'], false),
    };
    expect(disabledSetting(next)).toEqual({ 'api::a': ['*'] });
  });
});

describe('MCP settings', () => {
  it('reads origins and builds the endpoint and command', () => {
    expect(readOrigins({ allowedOrigins: ['https://a.example', 4] })).toEqual([
      'https://a.example',
    ]);
    expect(readOrigins(null)).toEqual([]);
    expect(normalizeOrigin(' https://App.example:8443/path ')).toBe('https://app.example:8443');
    expect(normalizeOrigin('ftp://x')).toBeNull();
    expect(normalizeOrigin('nope')).toBeNull();
    expect(mcpUrl('/api', 'http://localhost:1337')).toBe('http://localhost:1337/mcp');
    expect(mcpUrl('https://api.example/api', 'http://localhost')).toBe('https://api.example/mcp');
    expect(mcpCommand('https://x/mcp')).toBe(
      'claude mcp add --transport http verdin https://x/mcp --header "Authorization: Bearer <token>"',
    );
  });
});
