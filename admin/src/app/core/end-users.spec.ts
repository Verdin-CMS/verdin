import { describe, expect, it } from 'vitest';

import {
  DEFAULT_JWT_DAYS,
  DEFAULT_TEMPLATES,
  addProvider,
  callbackUrl,
  isPresetProvider,
  providerProblem,
  providerRow,
  removeProvider,
  secretEnvVar,
  settingsForm,
  settingsFromForm,
  updateProvider,
  usersSettings,
} from './end-users';

describe('usersSettings', () => {
  it('fills every default in', () => {
    expect(usersSettings(null)).toEqual({
      allowRegister: true,
      emailConfirmation: false,
      defaultRole: 'authenticated',
      jwtExpiresInDays: DEFAULT_JWT_DAYS,
      providers: {},
      templates: DEFAULT_TEMPLATES,
    });
  });

  it('keeps stored values and coerces odd ones', () => {
    const settings = usersSettings({
      allowRegister: false,
      emailConfirmation: true,
      defaultRole: 'editor',
      jwtExpiresInDays: '7',
      resetPasswordUrl: ' https://app.test/reset ',
      emailConfirmationRedirection: '',
      providers: {
        github: {
          enabled: true,
          clientId: 'abc',
          redirectUri: 'https://app.test/cb',
          scope: 'a b',
        },
        acme: { authorizeUrl: 'https://acme/a', tokenUrl: 'https://acme/t' },
      },
      templates: { confirmation: { subject: 'Hi' } },
    });
    expect(settings.allowRegister).toBe(false);
    expect(settings.emailConfirmation).toBe(true);
    expect(settings.defaultRole).toBe('editor');
    expect(settings.jwtExpiresInDays).toBe(7);
    expect(settings.resetPasswordUrl).toBe('https://app.test/reset');
    expect(settings.emailConfirmationRedirection).toBeUndefined();
    expect(settings.providers['github']).toEqual({
      enabled: true,
      clientId: 'abc',
      redirectUri: 'https://app.test/cb',
      scope: ['a', 'b'],
    });
    expect(settings.providers['acme']).toEqual({
      enabled: false,
      clientId: '',
      redirectUri: '',
      authorizeUrl: 'https://acme/a',
      tokenUrl: 'https://acme/t',
    });
    expect(settings.templates.confirmation).toEqual({
      subject: 'Hi',
      text: DEFAULT_TEMPLATES.confirmation.text,
    });
    expect(usersSettings({ jwtExpiresInDays: 0 }).jwtExpiresInDays).toBe(DEFAULT_JWT_DAYS);
  });
});

describe('settings form', () => {
  it('round-trips through the form and keeps unknown keys', () => {
    const stored = {
      custom: 1,
      allowRegister: true,
      emailConfirmation: false,
      defaultRole: 'authenticated',
      jwtExpiresInDays: 30,
      providers: {
        google: { enabled: true, clientId: 'g', redirectUri: 'https://app/cb' },
        github: { enabled: false, clientId: 'h', redirectUri: '', scope: ['user:email'] },
      },
      templates: DEFAULT_TEMPLATES,
    };
    const form = settingsForm(usersSettings(stored));
    expect(form.providers.map((row) => row.name)).toEqual(['github', 'google']);
    expect(form.providers[0].scope).toBe('user:email');
    expect(settingsFromForm(form, stored)).toEqual(stored);
  });

  it('drops empty URLs, preset endpoints and unnamed providers', () => {
    const form = settingsForm(usersSettings({ resetPasswordUrl: 'https://x' }));
    form.resetPasswordUrl = ' ';
    form.jwtExpiresInDays = -3;
    form.providers = [
      { ...providerRow('GitHub'), clientId: ' id ', scope: 'read:user, user:email', tokenUrl: 'x' },
      { ...providerRow('acme'), authorizeUrl: ' https://a ', tokenUrl: '', userInfoUrl: '' },
      providerRow(''),
    ];
    const settings = settingsFromForm(form, { resetPasswordUrl: 'https://x' });
    expect(settings['resetPasswordUrl']).toBeUndefined();
    expect(settings['jwtExpiresInDays']).toBe(DEFAULT_JWT_DAYS);
    expect(settings['providers']).toEqual({
      github: {
        enabled: true,
        clientId: 'id',
        redirectUri: '',
        scope: ['read:user', 'user:email'],
      },
      acme: { enabled: true, clientId: '', redirectUri: '', authorizeUrl: 'https://a' },
    });
  });
});

describe('providers', () => {
  it('adds, edits and removes rows', () => {
    let rows = addProvider([], 'github');
    rows = addProvider(rows, 'GitHub');
    expect(rows.length).toBe(1);
    rows = addProvider(rows);
    rows = addProvider(rows);
    expect(rows.map((row) => row.name)).toEqual(['github', '', '']);
    rows = updateProvider(rows, 1, { name: 'acme' });
    expect(rows[1].name).toBe('acme');
    expect(rows[0].name).toBe('github');
    rows = removeProvider(rows, 0);
    expect(rows.map((row) => row.name)).toEqual(['acme', '']);
  });

  it('flags the first problem', () => {
    const github = { ...providerRow('github'), clientId: 'id' };
    expect(providerProblem([github])).toBeNull();
    expect(providerProblem([providerRow('')])).toEqual({ kind: 'name', index: 0 });
    expect(providerProblem([providerRow('bad name')])).toEqual({ kind: 'name', index: 0 });
    expect(providerProblem([github, { ...github }])).toEqual({
      kind: 'duplicate',
      index: 1,
      name: 'github',
    });
    expect(providerProblem([providerRow('google')])).toEqual({ kind: 'clientId', index: 0 });
    const acme = { ...providerRow('acme'), clientId: 'id', authorizeUrl: 'a', tokenUrl: 't' };
    expect(providerProblem([acme])).toEqual({ kind: 'urls', index: 0 });
    expect(providerProblem([{ ...acme, userInfoUrl: 'u' }])).toBeNull();
    // A switched-off provider may be incomplete.
    expect(providerProblem([{ ...providerRow('acme'), enabled: false }])).toBeNull();
  });

  it('knows presets, env variables and callback URLs', () => {
    expect(isPresetProvider('GitHub')).toBe(true);
    expect(isPresetProvider('acme')).toBe(false);
    expect(secretEnvVar('github')).toBe('VERDIN_OAUTH_GITHUB_SECRET');
    expect(secretEnvVar('my-idp')).toBe('VERDIN_OAUTH_MY_IDP_SECRET');
    expect(callbackUrl('https://cms.test/', '/api', 'github')).toBe(
      'https://cms.test/api/connect/github/callback',
    );
    expect(callbackUrl('https://cms.test', 'https://api.test/v1/', 'acme')).toBe(
      'https://api.test/v1/connect/acme/callback',
    );
  });
});
