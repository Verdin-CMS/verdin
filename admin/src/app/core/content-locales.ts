import { Injectable, computed, inject, signal } from '@angular/core';

import { Api } from './api';
import { Attribute, ContentType } from './types';

/** A content locale (Settings → Internationalization), as `/i18n/locales` lists it. */
export interface ContentLocale {
  code: string;
  name: string;
  isDefault: boolean;
}

/** Which versions a document has in one locale (`GET /content/{uid}/{id}/locales`). */
export interface LocaleVersion {
  locale: string;
  draft: boolean;
  published: boolean;
}

/** A locale version's state, for switchers: `missing` when the document has none. */
export type LocaleState = 'published' | 'draft' | 'missing';

/** Locale codes like `fr`, `pt-BR`, `zh-Hans` or `es-419` (the server's rule). */
export const LOCALE_CODE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const MAX_CODE_LENGTH = 35;

export function isLocaleCode(code: string): boolean {
  return code.length <= MAX_CODE_LENGTH && LOCALE_CODE.test(code);
}

/** Codes offered when adding a locale. */
export const COMMON_LOCALE_CODES = [
  'ar',
  'bg',
  'ca',
  'cs',
  'da',
  'de',
  'el',
  'en',
  'en-GB',
  'en-US',
  'es',
  'es-419',
  'es-MX',
  'et',
  'eu',
  'fi',
  'fr',
  'fr-CA',
  'ga',
  'gl',
  'he',
  'hi',
  'hr',
  'hu',
  'id',
  'it',
  'ja',
  'ko',
  'lt',
  'lv',
  'ms',
  'nb',
  'nl',
  'pl',
  'pt',
  'pt-BR',
  'ro',
  'ru',
  'sk',
  'sl',
  'sr',
  'sv',
  'th',
  'tr',
  'uk',
  'vi',
  'zh-Hans',
  'zh-Hant',
] as const;

/**
 * The name of the language `code` in `displayLocale` (`fr` in English → `French`), or
 * `null` when the code is invalid or unknown to the browser.
 */
export function localeDisplayName(code: string, displayLocale: string): string | null {
  if (!isLocaleCode(code)) return null;
  try {
    const names = new Intl.DisplayNames([displayLocale], { type: 'language', fallback: 'none' });
    const name = names.of(code);
    if (!name || name.toLowerCase() === code.toLowerCase()) return null;
    return name.charAt(0).toLocaleUpperCase(displayLocale) + name.slice(1);
  } catch {
    return null;
  }
}

/** Whether documents of `type` have one version per locale. */
export function isLocalized(type: Pick<ContentType, 'pluginOptions'> | null | undefined): boolean {
  return type?.pluginOptions?.i18n?.localized === true;
}

/** Whether an attribute of a localized type holds one value shared by every locale. */
export function isShared(attribute: Attribute): boolean {
  return attribute.pluginOptions?.i18n?.localized === false;
}

/** The state of `code` among a document's versions. */
export function localeState(versions: readonly LocaleVersion[], code: string): LocaleState {
  const version = versions.find((item) => item.locale === code);
  if (!version || (!version.draft && !version.published)) return 'missing';
  return version.published ? 'published' : 'draft';
}

/** Input of `POST /i18n/locales`. */
export interface NewLocale {
  code: string;
  name: string;
  isDefault?: boolean;
}

/**
 * The content locales, loaded once for the whole admin (later calls share the request)
 * and refreshed after every change.
 */
@Injectable({ providedIn: 'root' })
export class ContentLocales {
  private readonly api = inject(Api);

  /** `null` until loaded. */
  readonly list = signal<ContentLocale[] | null>(null);
  readonly loaded = computed(() => this.list() !== null);
  readonly defaultLocale = computed(() => {
    const list = this.list() ?? [];
    return list.find((locale) => locale.isDefault) ?? list[0] ?? null;
  });
  readonly defaultCode = computed(() => this.defaultLocale()?.code ?? null);

  private loading: Promise<ContentLocale[]> | null = null;

  /** Fetches the locales once; a failure lets the next call try again. */
  load(): Promise<ContentLocale[]> {
    this.loading ??= this.fetch().catch((error) => {
      this.loading = null;
      throw error;
    });
    return this.loading;
  }

  refresh(): Promise<ContentLocale[]> {
    this.loading = this.fetch();
    return this.loading;
  }

  private async fetch(): Promise<ContentLocale[]> {
    const list = await this.api.get<ContentLocale[]>('/i18n/locales');
    this.list.set(list ?? []);
    return list ?? [];
  }

  async create(input: NewLocale): Promise<ContentLocale[]> {
    const list = await this.api.post<ContentLocale[] | null>('/i18n/locales', input);
    await this.set(list);
    return this.list() ?? [];
  }

  async update(
    code: string,
    changes: { name?: string; isDefault?: boolean },
  ): Promise<ContentLocale[]> {
    const list = await this.api.put<ContentLocale[] | null>(
      `/i18n/locales/${encodeURIComponent(code)}`,
      changes,
    );
    await this.set(list);
    return this.list() ?? [];
  }

  async remove(code: string): Promise<void> {
    await this.api.delete(`/i18n/locales/${encodeURIComponent(code)}`);
    await this.refresh();
  }

  /** Takes a returned list, or fetches it when the response had none. */
  private async set(list: ContentLocale[] | null | undefined): Promise<void> {
    if (Array.isArray(list)) {
      this.list.set(list);
      this.loading = Promise.resolve(list);
    } else {
      await this.refresh();
    }
  }

  /** The locale's name, else its code. */
  name(code: string | null | undefined): string {
    if (!code) return '';
    return this.list()?.find((locale) => locale.code === code)?.name ?? code;
  }

  /** `code` when it is a known locale, else the default. */
  resolve(code: string | null | undefined): string | null {
    const list = this.list() ?? [];
    return code && list.some((locale) => locale.code === code) ? code : this.defaultCode();
  }
}
