import { Injectable, inject } from '@angular/core';

import { Api, ListResponse, toQuery } from './api';
import { Grant } from './types';

/** The role of an end user, as the users list embeds it. */
export interface EndUserRoleRef {
  id: number;
  name: string;
  type: string;
}

/** A user of the content API (Strapi's users-permissions user). */
export interface EndUser {
  id: number;
  documentId: string;
  username: string;
  email: string;
  /** `local`, or the OAuth provider the user signed up with. */
  provider: string;
  confirmed: boolean;
  blocked: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  role: EndUserRoleRef | null;
}

/** Body of `POST /end-users` and `PUT /end-users/{id}` (an empty password keeps it on update). */
export interface EndUserInput {
  username?: string;
  email?: string;
  password?: string;
  confirmed?: boolean;
  blocked?: boolean;
  role?: number | null;
}

/** An end-user role with its content API grants. */
export interface EndUserRole {
  id: number;
  name: string;
  description: string | null;
  type: string;
  /** How many users have the role. */
  users: number;
  permissions: Grant[];
}

export interface EndUserRoleInput {
  name: string;
  description?: string;
  permissions: Grant[];
}

/** The role every new user gets unless settings say otherwise; it cannot be deleted. */
export const AUTHENTICATED_ROLE = 'authenticated';

/** The response of `POST /email/test`. */
export interface EmailTestResult {
  sent: boolean;
  provider: string;
  from?: string | null;
  error?: string | null;
}

/** One OAuth provider in the `users` feature settings. */
export interface ProviderSettings {
  enabled: boolean;
  clientId: string;
  redirectUri: string;
  scope?: string[];
  authorizeUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
}

export interface EmailTemplate {
  subject: string;
  text: string;
}

/** The settings object of the `users` feature. */
export interface UsersSettings {
  allowRegister: boolean;
  emailConfirmation: boolean;
  /** A role `type`. */
  defaultRole: string;
  jwtExpiresInDays: number;
  emailConfirmationRedirection?: string;
  resetPasswordUrl?: string;
  providers: Record<string, ProviderSettings>;
  templates: { confirmation: EmailTemplate; resetPassword: EmailTemplate };
}

export type TemplateName = keyof UsersSettings['templates'];

/** Providers Verdin knows the endpoints of; any other name is a generic OAuth 2 provider. */
export const PRESET_PROVIDERS = ['github', 'google'] as const;

/** Placeholders the email templates understand. */
export const TEMPLATE_PLACEHOLDERS = ['{{username}}', '{{email}}', '{{url}}'] as const;

/** The server's defaults. */
export const DEFAULT_TEMPLATES: UsersSettings['templates'] = {
  confirmation: {
    subject: 'Confirm your account',
    text: 'Hello {{username}},\n\nConfirm your account: {{url}}\n\nIf you did not sign up, ignore this email.',
  },
  resetPassword: {
    subject: 'Reset your password',
    text: 'Hello {{username}},\n\nReset your password: {{url}}\n\nThe link expires in one hour. If you did not ask for it, ignore this email.',
  },
};

export const DEFAULT_JWT_DAYS = 30;

/** Provider names as the server accepts them in URLs and env variable names. */
const PROVIDER_NAME = /^[a-z][a-z0-9_-]*$/;

export function isPresetProvider(name: string): boolean {
  return (PRESET_PROVIDERS as readonly string[]).includes(name.trim().toLowerCase());
}

/** The env variable holding a provider's client secret (never stored in the database). */
export function secretEnvVar(name: string): string {
  const slug = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_');
  return `VERDIN_OAUTH_${slug || '<PROVIDER>'}_SECRET`;
}

/**
 * The redirect URL to register at the provider: `{content API}/connect/{name}/callback`.
 * `contentApiBase` is a path (`/api`) or an absolute URL.
 */
export function callbackUrl(origin: string, contentApiBase: string, name: string): string {
  const base = /^https?:\/\//.test(contentApiBase)
    ? contentApiBase
    : `${origin.replace(/\/+$/, '')}/${contentApiBase.replace(/^\/+/, '')}`;
  const provider = name.trim().toLowerCase() || '{provider}';
  return `${base.replace(/\/+$/, '')}/connect/${provider}/callback`;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function days(value: unknown): number {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number >= 1
    ? Math.round(number)
    : DEFAULT_JWT_DAYS;
}

function template(value: unknown, fallback: EmailTemplate): EmailTemplate {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    subject: typeof source['subject'] === 'string' ? source['subject'] : fallback.subject,
    text: typeof source['text'] === 'string' ? source['text'] : fallback.text,
  };
}

function provider(value: unknown): ProviderSettings {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const result: ProviderSettings = {
    enabled: flag(source['enabled'], false),
    clientId: typeof source['clientId'] === 'string' ? source['clientId'] : '',
    redirectUri: typeof source['redirectUri'] === 'string' ? source['redirectUri'] : '',
  };
  const scope = source['scope'];
  if (Array.isArray(scope)) result.scope = scope.filter((item) => typeof item === 'string');
  else if (typeof scope === 'string') result.scope = splitScope(scope);
  for (const key of ['authorizeUrl', 'tokenUrl', 'userInfoUrl'] as const) {
    const url = text(source[key]);
    if (url) result[key] = url;
  }
  return result;
}

/** The feature's settings with every default filled in (the stored object may be partial). */
export function usersSettings(raw: Record<string, unknown> | null | undefined): UsersSettings {
  const source = raw ?? {};
  const templates = (source['templates'] ?? {}) as Record<string, unknown>;
  const providers = source['providers'];
  const settings: UsersSettings = {
    allowRegister: flag(source['allowRegister'], true),
    emailConfirmation: flag(source['emailConfirmation'], false),
    defaultRole: text(source['defaultRole']) ?? AUTHENTICATED_ROLE,
    jwtExpiresInDays: days(source['jwtExpiresInDays']),
    providers: Object.fromEntries(
      Object.entries(providers && typeof providers === 'object' ? providers : {}).map(
        ([name, value]) => [name, provider(value)],
      ),
    ),
    templates: {
      confirmation: template(templates['confirmation'], DEFAULT_TEMPLATES.confirmation),
      resetPassword: template(templates['resetPassword'], DEFAULT_TEMPLATES.resetPassword),
    },
  };
  const redirection = text(source['emailConfirmationRedirection']);
  if (redirection) settings.emailConfirmationRedirection = redirection;
  const reset = text(source['resetPasswordUrl']);
  if (reset) settings.resetPasswordUrl = reset;
  return settings;
}

/** A provider in the editor: its name is editable and its scope is free text. */
export interface ProviderRow {
  name: string;
  enabled: boolean;
  clientId: string;
  redirectUri: string;
  scope: string;
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
}

/** The settings page's editable state. */
export interface UsersSettingsForm {
  allowRegister: boolean;
  emailConfirmation: boolean;
  defaultRole: string;
  jwtExpiresInDays: number;
  emailConfirmationRedirection: string;
  resetPasswordUrl: string;
  providers: ProviderRow[];
  templates: UsersSettings['templates'];
}

export function splitScope(scope: string): string[] {
  return scope.split(/[\s,]+/).filter((item) => !!item);
}

export function providerRow(name = '', settings?: ProviderSettings): ProviderRow {
  return {
    name,
    enabled: settings?.enabled ?? true,
    clientId: settings?.clientId ?? '',
    redirectUri: settings?.redirectUri ?? '',
    scope: (settings?.scope ?? []).join(' '),
    authorizeUrl: settings?.authorizeUrl ?? '',
    tokenUrl: settings?.tokenUrl ?? '',
    userInfoUrl: settings?.userInfoUrl ?? '',
  };
}

export function settingsForm(settings: UsersSettings): UsersSettingsForm {
  return {
    allowRegister: settings.allowRegister,
    emailConfirmation: settings.emailConfirmation,
    defaultRole: settings.defaultRole,
    jwtExpiresInDays: settings.jwtExpiresInDays,
    emailConfirmationRedirection: settings.emailConfirmationRedirection ?? '',
    resetPasswordUrl: settings.resetPasswordUrl ?? '',
    providers: Object.entries(settings.providers)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => providerRow(name, value)),
    templates: {
      confirmation: { ...settings.templates.confirmation },
      resetPassword: { ...settings.templates.resetPassword },
    },
  };
}

/**
 * The settings object to store. Keys the page does not edit are kept from `previous`,
 * empty URLs are dropped, and presets carry no endpoint URLs.
 */
export function settingsFromForm(
  form: UsersSettingsForm,
  previous: Record<string, unknown> | null = null,
): Record<string, unknown> {
  const providers: Record<string, ProviderSettings> = {};
  for (const row of form.providers) {
    const name = row.name.trim().toLowerCase();
    if (!name) continue;
    const value: ProviderSettings = {
      enabled: row.enabled,
      clientId: row.clientId.trim(),
      redirectUri: row.redirectUri.trim(),
    };
    const scope = splitScope(row.scope);
    if (scope.length) value.scope = scope;
    if (!isPresetProvider(name)) {
      for (const key of ['authorizeUrl', 'tokenUrl', 'userInfoUrl'] as const) {
        const url = row[key].trim();
        if (url) value[key] = url;
      }
    }
    providers[name] = value;
  }
  const settings: Record<string, unknown> = {
    ...(previous ?? {}),
    allowRegister: form.allowRegister,
    emailConfirmation: form.emailConfirmation,
    defaultRole: form.defaultRole || AUTHENTICATED_ROLE,
    jwtExpiresInDays: days(form.jwtExpiresInDays),
    providers,
    templates: {
      confirmation: { ...form.templates.confirmation },
      resetPassword: { ...form.templates.resetPassword },
    },
  };
  for (const key of ['emailConfirmationRedirection', 'resetPasswordUrl'] as const) {
    const url = form[key].trim();
    if (url) settings[key] = url;
    else delete settings[key];
  }
  return settings;
}

/** Adds a provider row; a preset name that is already present is not added twice. */
export function addProvider(rows: ProviderRow[], name = ''): ProviderRow[] {
  const normalized = name.trim().toLowerCase();
  if (normalized && rows.some((row) => row.name.trim().toLowerCase() === normalized)) return rows;
  return [...rows, providerRow(normalized)];
}

export function updateProvider(
  rows: ProviderRow[],
  index: number,
  changes: Partial<ProviderRow>,
): ProviderRow[] {
  return rows.map((row, position) => (position === index ? { ...row, ...changes } : row));
}

export function removeProvider(rows: ProviderRow[], index: number): ProviderRow[] {
  return rows.filter((_, position) => position !== index);
}

export type ProviderProblem =
  | { kind: 'name'; index: number }
  | { kind: 'duplicate'; index: number; name: string }
  | { kind: 'clientId'; index: number }
  | { kind: 'urls'; index: number };

/** The first problem with the provider rows, or null. */
export function providerProblem(rows: ProviderRow[]): ProviderProblem | null {
  const seen = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const name = row.name.trim().toLowerCase();
    if (!PROVIDER_NAME.test(name)) return { kind: 'name', index };
    if (seen.has(name)) return { kind: 'duplicate', index, name };
    seen.add(name);
    if (row.enabled && !row.clientId.trim()) return { kind: 'clientId', index };
    if (
      row.enabled &&
      !isPresetProvider(name) &&
      !(row.authorizeUrl.trim() && row.tokenUrl.trim() && row.userInfoUrl.trim())
    ) {
      return { kind: 'urls', index };
    }
  }
  return null;
}

/** Admin API for end users, their roles and the test email. */
@Injectable({ providedIn: 'root' })
export class EndUsers {
  private readonly api = inject(Api);

  list(page: number, pageSize: number, search: string): Promise<ListResponse<EndUser>> {
    return this.api.list<EndUser>('/end-users', toQuery({ page, pageSize, search: search.trim() }));
  }

  get(id: number): Promise<EndUser> {
    return this.api.get<EndUser>(`/end-users/${id}`);
  }

  create(input: EndUserInput): Promise<EndUser> {
    return this.api.post<EndUser>('/end-users', input);
  }

  update(id: number, input: EndUserInput): Promise<EndUser> {
    return this.api.put<EndUser>(`/end-users/${id}`, input);
  }

  remove(id: number): Promise<void> {
    return this.api.delete(`/end-users/${id}`);
  }

  roles(): Promise<EndUserRole[]> {
    return this.api.get<EndUserRole[]>('/end-user-roles');
  }

  /** Returns the whole list. */
  createRole(input: EndUserRoleInput): Promise<EndUserRole[]> {
    return this.api.post<EndUserRole[]>('/end-user-roles', input);
  }

  updateRole(id: number, input: EndUserRoleInput): Promise<unknown> {
    return this.api.put<unknown>(`/end-user-roles/${id}`, input);
  }

  removeRole(id: number): Promise<void> {
    return this.api.delete(`/end-user-roles/${id}`);
  }

  testEmail(to: string): Promise<EmailTestResult> {
    return this.api.post<EmailTestResult>('/email/test', { to });
  }
}
