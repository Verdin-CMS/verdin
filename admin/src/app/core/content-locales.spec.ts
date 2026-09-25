import { describe, expect, it } from 'vitest';

import {
  COMMON_LOCALE_CODES,
  isLocaleCode,
  isLocalized,
  isShared,
  localeDisplayName,
  localeState,
} from './content-locales';

describe('locale codes', () => {
  it('accepts language codes with region or script parts', () => {
    for (const code of ['en', 'fr', 'ast', 'pt-BR', 'zh-Hans', 'es-419', 'sr-Latn-RS']) {
      expect(isLocaleCode(code), code).toBe(true);
    }
  });

  it('rejects anything else', () => {
    for (const code of ['', 'e', 'EN', 'en_US', 'en-', 'fr-$', 'english', 'en-toolongpart']) {
      expect(isLocaleCode(code), code).toBe(false);
    }
    expect(isLocaleCode(`en${'-abcd'.repeat(8)}`)).toBe(false);
  });

  it('offers only valid codes', () => {
    expect(COMMON_LOCALE_CODES.every(isLocaleCode)).toBe(true);
  });
});

describe('locale display names', () => {
  it('names a code in the admin language, capitalized', () => {
    expect(localeDisplayName('fr', 'en')).toBe('French');
    expect(localeDisplayName('fr', 'es')).toBe('Francés');
    expect(localeDisplayName('pt-BR', 'en')).toBe('Brazilian Portuguese');
  });

  it('has no name for invalid or unknown codes', () => {
    expect(localeDisplayName('EN', 'en')).toBeNull();
    expect(localeDisplayName('qq', 'en')).toBeNull();
    expect(localeDisplayName('', 'en')).toBeNull();
  });
});

describe('localization flags', () => {
  it('reads pluginOptions.i18n.localized', () => {
    expect(isLocalized({ pluginOptions: { i18n: { localized: true } } })).toBe(true);
    expect(isLocalized({ pluginOptions: {} })).toBe(false);
    expect(isLocalized(undefined)).toBe(false);
    expect(isShared({ type: 'string', pluginOptions: { i18n: { localized: false } } })).toBe(true);
    expect(isShared({ type: 'string' })).toBe(false);
  });

  it('gives each locale a state from the versions', () => {
    const versions = [
      { locale: 'en', draft: true, published: true },
      { locale: 'fr', draft: true, published: false },
    ];
    expect(localeState(versions, 'en')).toBe('published');
    expect(localeState(versions, 'fr')).toBe('draft');
    expect(localeState(versions, 'de')).toBe('missing');
  });
});
