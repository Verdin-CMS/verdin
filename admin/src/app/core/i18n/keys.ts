/**
 * Message keys, typed from the English catalog (`public/i18n/en.json`): a key missing
 * there is a compile error. Messages use ICU MessageFormat (`{name}`, and
 * `{count, plural, one {# entry} other {# entries}}`); see docs/translating.md.
 */
export type Catalog = typeof import('../../../../public/i18n/en.json');
export type MessageKey = keyof Catalog;
export type Params = Record<string, string | number | null | undefined>;
