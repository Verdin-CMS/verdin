/** `pluginOptions.i18n` in schema files: localized types and their shared attributes. */
import { Attribute } from '../../core/types';

type Json = Record<string, unknown>;

function object(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
}

/**
 * `owner` with `pluginOptions.i18n.localized` set to `localized`, or removed when it is
 * `undefined` (the default). Other plugin options are kept; emptied objects are dropped.
 */
function withLocalizedOption<T extends object>(owner: T, localized: boolean | undefined): T {
  const record = owner as Json;
  const pluginOptions = { ...object(record['pluginOptions']) };
  const i18n = { ...object(pluginOptions['i18n']) };
  if (localized === undefined) delete i18n['localized'];
  else i18n['localized'] = localized;
  if (Object.keys(i18n).length) pluginOptions['i18n'] = i18n;
  else delete pluginOptions['i18n'];
  const next: Json = { ...record };
  if (Object.keys(pluginOptions).length) next['pluginOptions'] = pluginOptions;
  else delete next['pluginOptions'];
  return next as T;
}

/** Whether a content type schema file is localized (`pluginOptions.i18n.localized: true`). */
export function typeLocalized(file: Json | null | undefined): boolean {
  return object(object(file?.['pluginOptions'])['i18n'])['localized'] === true;
}

/** The schema file with localization turned on or off (off: the option is omitted). */
export function setTypeLocalized<T extends object>(file: T, localized: boolean): T {
  return withLocalizedOption(file, localized ? true : undefined);
}

/** Whether an attribute of a localized type is localized (the default) or shared. */
export function attributeLocalized(attribute: Attribute): boolean {
  return attribute.pluginOptions?.i18n?.localized !== false;
}

/** The attribute localized (the option is omitted) or shared (`localized: false`). */
export function setAttributeLocalized(attribute: Attribute, localized: boolean): Attribute {
  return withLocalizedOption(attribute, localized ? undefined : false);
}
