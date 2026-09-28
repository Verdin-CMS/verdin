import { describe, expect, it } from 'vitest';

import {
  emptySsoForm,
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
