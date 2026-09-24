/** Languages the admin is translated into. `tag` is a BCP 47 language tag. */
export const LOCALES = [
  { tag: 'en', name: 'English' },
  { tag: 'es', name: 'Español' },
  { tag: 'ca', name: 'Català' },
  { tag: 'fr', name: 'Français' },
  { tag: 'de', name: 'Deutsch' },
  { tag: 'it', name: 'Italiano' },
  { tag: 'pt-BR', name: 'Português (Brasil)' },
  { tag: 'nl', name: 'Nederlands' },
  { tag: 'pl', name: 'Polski' },
  { tag: 'tr', name: 'Türkçe' },
  { tag: 'ru', name: 'Русский' },
  { tag: 'uk', name: 'Українська' },
  { tag: 'ja', name: '日本語' },
  { tag: 'ko', name: '한국어' },
  { tag: 'zh-Hans', name: '简体中文' },
] as const;

export type LocaleTag = (typeof LOCALES)[number]['tag'];

export const DEFAULT_LOCALE: LocaleTag = 'en';

/** The supported locale that best matches the browser's preferences. */
export function matchLocale(preferences: readonly string[]): LocaleTag {
  const tags = LOCALES.map((locale) => locale.tag as string);
  for (const preference of preferences) {
    if (tags.includes(preference)) return preference as LocaleTag;
    let language: string;
    let script: string | undefined;
    try {
      const locale = new Intl.Locale(preference).maximize();
      language = locale.language;
      script = locale.script;
    } catch {
      continue;
    }
    // zh-CN, zh-SG… are Simplified; zh-TW and zh-HK are Traditional (not translated yet).
    if (language === 'zh') {
      if (script === 'Hans') return 'zh-Hans';
      continue;
    }
    if (language === 'pt') return 'pt-BR';
    const match = tags.find((tag) => tag === language);
    if (match) return match as LocaleTag;
  }
  return DEFAULT_LOCALE;
}
