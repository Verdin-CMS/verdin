/** Settings forms of the `preview` and `sso` features (Settings → Features). */

// ---------------------------------------------------------------------------------------
// Preview

export interface PreviewSettings {
  /** Content type uid → URL template. */
  urls: Record<string, string>;
  ttlMinutes?: number;
}

export const PREVIEW_MAX_TTL = 7 * 24 * 60;

/** The preview settings in a feature's stored settings (anything unexpected is dropped). */
export function readPreviewSettings(settings: Record<string, unknown> | null | undefined) {
  const urls: Record<string, string> = {};
  const raw = settings?.['urls'];
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [uid, template] of Object.entries(raw)) {
      if (typeof template === 'string') urls[uid] = template;
    }
  }
  const ttl = settings?.['ttlMinutes'];
  const result: PreviewSettings = { urls };
  if (typeof ttl === 'number') result.ttlMinutes = ttl;
  return result;
}

/** The URL template of a content type, or `null`. */
export function previewTemplate(
  settings: Record<string, unknown> | null | undefined,
  uid: string,
): string | null {
  const template = readPreviewSettings(settings).urls[uid]?.trim();
  return template ? template : null;
}

/** Whether a template is an http(s) URL once its placeholders are removed (as the server checks). */
export function validPreviewTemplate(template: string): boolean {
  try {
    const url = new URL(template.replace(/[{}]/g, ''));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** The form's rows (one per content type) and TTL text, as settings. */
export function previewSettingsFrom(
  rows: { uid: string; template: string }[],
  ttl: string,
): PreviewSettings {
  const urls: Record<string, string> = {};
  for (const row of rows) {
    const template = row.template.trim();
    if (template) urls[row.uid] = template;
  }
  const settings: PreviewSettings = { urls };
  const minutes = ttl.trim();
  if (minutes) settings.ttlMinutes = Number(minutes);
  return settings;
}

/** A TTL problem: `invalid` unless empty or a whole number of minutes in range. */
export function previewTtlProblem(ttl: string): 'invalid' | null {
  const text = ttl.trim();
  if (!text) return null;
  const minutes = Number(text);
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= PREVIEW_MAX_TTL ? null : 'invalid';
}

// ---------------------------------------------------------------------------------------
// Single sign-on

export interface SsoProvider {
  id: string;
  name: string;
  issuer: string;
  clientId: string;
  scopes: string[];
  autoCreate: boolean;
  defaultRoles: string[];
  roleClaim?: string;
  roleMap: Record<string, string>;
  allowedDomains: string[];
}

/** A provider in the form: lists as text, the role map as rows. */
export interface SsoProviderForm {
  id: string;
  name: string;
  issuer: string;
  clientId: string;
  /** Space or comma separated. */
  scopes: string;
  autoCreate: boolean;
  defaultRoles: string[];
  roleClaim: string;
  roleMap: { claim: string; role: string }[];
  /** Space or comma separated. */
  allowedDomains: string;
}

export const DEFAULT_SCOPES = ['openid', 'email', 'profile'];

/** Splits a space or comma separated list, dropping empty items and duplicates. */
export function splitList(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** The providers of stored SSO settings, as form rows. */
export function ssoFormsFrom(
  settings: Record<string, unknown> | null | undefined,
): SsoProviderForm[] {
  const providers = settings?.['providers'];
  if (!Array.isArray(providers)) return [];
  return providers
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => {
      const map = item['roleMap'];
      const roleMap =
        map && typeof map === 'object' && !Array.isArray(map)
          ? Object.entries(map as Record<string, unknown>).map(([claim, role]) => ({
              claim,
              role: text(role),
            }))
          : [];
      const scopes = strings(item['scopes']);
      return {
        id: text(item['id']),
        name: text(item['name']),
        issuer: text(item['issuer']),
        clientId: text(item['clientId']),
        scopes: (scopes.length ? scopes : DEFAULT_SCOPES).join(' '),
        autoCreate: item['autoCreate'] === true,
        defaultRoles: strings(item['defaultRoles']),
        roleClaim: text(item['roleClaim']),
        roleMap,
        allowedDomains: strings(item['allowedDomains']).join(' '),
      };
    });
}

export function emptySsoForm(): SsoProviderForm {
  return {
    id: '',
    name: '',
    issuer: '',
    clientId: '',
    scopes: DEFAULT_SCOPES.join(' '),
    autoCreate: false,
    defaultRoles: [],
    roleClaim: '',
    roleMap: [],
    allowedDomains: '',
  };
}

/** Form rows as the `sso` feature settings. */
export function ssoSettingsFrom(forms: SsoProviderForm[]): { providers: SsoProvider[] } {
  return {
    providers: forms.map((form) => {
      const roleMap: Record<string, string> = {};
      for (const row of form.roleMap) {
        const claim = row.claim.trim();
        const role = row.role.trim();
        if (claim && role) roleMap[claim] = role;
      }
      const scopes = splitList(form.scopes);
      const provider: SsoProvider = {
        id: form.id.trim(),
        name: form.name.trim(),
        issuer: form.issuer.trim(),
        clientId: form.clientId.trim(),
        scopes: scopes.length ? scopes : [...DEFAULT_SCOPES],
        autoCreate: form.autoCreate,
        defaultRoles: [...new Set(form.defaultRoles.map((role) => role.trim()).filter(Boolean))],
        roleMap,
        allowedDomains: splitList(form.allowedDomains).map((domain) => domain.toLowerCase()),
      };
      const claim = form.roleClaim.trim();
      if (claim) provider.roleClaim = claim;
      return provider;
    }),
  };
}

export type SsoProblem = 'id' | 'duplicate' | 'name' | 'clientId' | 'issuer' | 'openid' | 'roles';

/** Problems of each provider (mirroring the server's checks), by field. */
export function ssoProblems(
  forms: SsoProviderForm[],
): Partial<Record<keyof SsoProviderForm, SsoProblem>>[] {
  return forms.map((form, index) => {
    const problems: Partial<Record<keyof SsoProviderForm, SsoProblem>> = {};
    const id = form.id.trim();
    if (!/^[a-z0-9-]{1,32}$/.test(id)) problems.id = 'id';
    else if (forms.slice(0, index).some((other) => other.id.trim() === id))
      problems.id = 'duplicate';
    if (!form.name.trim()) problems.name = 'name';
    if (!form.clientId.trim()) problems.clientId = 'clientId';
    if (!secureIssuer(form.issuer.trim())) problems.issuer = 'issuer';
    const scopes = splitList(form.scopes);
    if (scopes.length && !scopes.includes('openid')) problems.scopes = 'openid';
    const mapped = form.roleMap.some((row) => row.claim.trim() && row.role.trim());
    if (form.autoCreate && !form.defaultRoles.length && !mapped) problems.defaultRoles = 'roles';
    return problems;
  });
}

/** An https URL, or http on localhost. */
export function secureIssuer(issuer: string): boolean {
  try {
    const url = new URL(issuer);
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

/** The environment variable holding a provider's client secret. */
export function ssoSecretVariable(id: string): string {
  return `VERDIN_SSO_${id.toUpperCase().replace(/-/g, '_')}_SECRET`;
}

/** The redirect URI to register at the provider. */
export function ssoRedirectUri(apiBase: string, id: string, origin: string): string {
  const base = apiBase.replace(/\/+$/, '');
  const path = `${base}/auth/sso/${encodeURIComponent(id)}/callback`;
  try {
    return new URL(path, origin).href;
  } catch {
    return `${origin}${path}`;
  }
}

/** Where the login button of a provider goes. */
export function ssoStartUrl(apiBase: string, id: string): string {
  return `${apiBase.replace(/\/+$/, '')}/auth/sso/${encodeURIComponent(id)}`;
}
