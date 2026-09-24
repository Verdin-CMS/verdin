/**
 * The source catalog. Keys are `namespace.name`; every other locale must translate all of
 * them (the `Catalog` type enforces it). Placeholders use `{name}`; a message that depends
 * on `{count}` is an object keyed by plural category (`one`, `other`, and `few`/`many`
 * where the language needs them).
 */
import auth from './en/auth';
import builder from './en/builder';
import common from './en/common';
import content from './en/content';
import engagement from './en/engagement';
import media from './en/media';
import settings from './en/settings';
import shell from './en/shell';

export type PluralMessage = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
export type Message = string | PluralMessage;
export type Params = Record<string, string | number | null | undefined>;

export const en = {
  ...common,
  ...shell,
  ...auth,
  ...content,
  ...builder,
  ...settings,
  ...engagement,
  ...media,
};

export type MessageKey = keyof typeof en;
export type Catalog = { readonly [K in MessageKey]: Message };

export default en satisfies Catalog;
