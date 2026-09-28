import { Attribute, Attributes } from './types';

/** `changefreq` values of the sitemap protocol. */
export const CHANGEFREQS = [
  'always',
  'hourly',
  'daily',
  'weekly',
  'monthly',
  'yearly',
  'never',
] as const;
export type Changefreq = (typeof CHANGEFREQS)[number];

export interface SitemapType {
  pattern: string;
  changefreq?: Changefreq;
  priority?: number;
}

/** The `seo` feature settings. */
export interface SeoSettings {
  baseUrl: string;
  types: Record<string, SitemapType>;
}

/** A content type's row in the editor (strings, as typed). */
export interface SeoRow {
  uid: string;
  pattern: string;
  changefreq: Changefreq | '';
  priority: string;
}

/** The names between braces in a pattern: `/{locale}/blog/{slug}` → `locale`, `slug`. */
export function placeholders(pattern: string): string[] {
  const names: string[] = [];
  const found = pattern.matchAll(/\{([^{}]*)\}/g);
  for (const match of found) names.push(match[1]);
  return names;
}

/** Attribute types whose value can fill a path segment (text and numbers). */
const PATH_TYPES = new Set<Attribute['type']>([
  'uid',
  'string',
  'email',
  'text',
  'integer',
  'biginteger',
  'float',
  'decimal',
  'enumeration',
  'date',
]);

/**
 * The placeholders to suggest for a type: `{locale}` for localized types, then the
 * attributes that fill a path (`uid` fields first, as they hold slugs).
 */
export function placeholderHints(attributes: Attributes, localized: boolean): string[] {
  const names = Object.entries(attributes)
    .filter(([, attribute]) => PATH_TYPES.has(attribute.type))
    .sort(([, a], [, b]) => Number(b.type === 'uid') - Number(a.type === 'uid'))
    .map(([name]) => name);
  return [...(localized ? ['locale'] : []), ...names];
}

/** An example pattern for a type: `/{pluralName}/{slug}` (its first uid or string field). */
export function examplePattern(
  pluralName: string,
  attributes: Attributes,
  localized: boolean,
): string {
  const uid = Object.entries(attributes).find(([, attribute]) => attribute.type === 'uid')?.[0];
  const field =
    uid ??
    Object.entries(attributes).find(([, attribute]) => attribute.type === 'string')?.[0] ??
    'slug';
  return `${localized ? '/{locale}' : ''}/${pluralName}/{${field}}`;
}

export type PatternProblem =
  { kind: 'slash' } | { kind: 'braces' } | { kind: 'unknown'; name: string } | { kind: 'empty' };

/**
 * What the server would refuse in a pattern: it starts with `/`, its braces pair up, and
 * its placeholders are attributes of the type (or `locale`).
 */
export function patternProblem(pattern: string, attributes: Attributes): PatternProblem | null {
  const text = pattern.trim();
  if (!text.startsWith('/')) return { kind: 'slash' };
  let open = false;
  for (const char of text) {
    if (char === '{') {
      if (open) return { kind: 'braces' };
      open = true;
    } else if (char === '}') {
      if (!open) return { kind: 'braces' };
      open = false;
    }
  }
  if (open) return { kind: 'braces' };
  for (const name of placeholders(text)) {
    if (!name) return { kind: 'empty' };
    if (name !== 'locale' && !(name in attributes)) {
      return { kind: 'unknown', name };
    }
  }
  return null;
}

/** A path for a sample entry, to show next to the pattern. */
export function samplePath(pattern: string, sample: Record<string, string>): string {
  return pattern.replace(/\{([^{}]*)\}/g, (_, name: string) => sample[name] ?? `{${name}}`);
}

export function readSeoSettings(settings: Record<string, unknown> | null): SeoSettings {
  const baseUrl = typeof settings?.['baseUrl'] === 'string' ? settings['baseUrl'] : '';
  const types: Record<string, SitemapType> = {};
  const raw = settings?.['types'];
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [uid, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const spec = value as Record<string, unknown>;
      if (typeof spec['pattern'] !== 'string') continue;
      const type: SitemapType = { pattern: spec['pattern'] };
      if (CHANGEFREQS.includes(spec['changefreq'] as Changefreq)) {
        type.changefreq = spec['changefreq'] as Changefreq;
      }
      if (typeof spec['priority'] === 'number') type.priority = spec['priority'];
      types[uid] = type;
    }
  }
  return { baseUrl, types };
}

/** Whether the priority field holds a number from 0 to 1 (empty is fine). */
export function validPriority(text: string): boolean {
  if (!text.trim()) return true;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

/** Whether the base URL is empty or an http(s) URL. */
export function validBaseUrl(text: string): boolean {
  if (!text.trim()) return true;
  try {
    const url = new URL(text.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** The settings to save: rows without a pattern are left out of the sitemap. */
export function seoSettingsFrom(baseUrl: string, rows: readonly SeoRow[]): SeoSettings {
  const types: Record<string, SitemapType> = {};
  for (const row of rows) {
    const pattern = row.pattern.trim();
    if (!pattern) continue;
    const type: SitemapType = { pattern };
    if (row.changefreq) type.changefreq = row.changefreq;
    if (row.priority.trim()) type.priority = Number(row.priority);
    types[row.uid] = type;
  }
  return { baseUrl: baseUrl.trim().replace(/\/+$/, ''), types };
}
