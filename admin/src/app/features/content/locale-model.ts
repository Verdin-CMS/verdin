/** Pure helpers for editing a localized document: shared fields and copies between locales. */
import { isShared } from '../../core/content-locales';
import { Attribute, Attributes } from '../../core/types';
import { ComponentLookup, FormModel, isEditable, keyed, toModel } from './fields/model';

/** Names of the attributes shared by every locale (`pluginOptions.i18n.localized: false`). */
export function sharedFields(attributes: Attributes): string[] {
  return Object.entries(attributes)
    .filter(([, attribute]) => isShared(attribute))
    .map(([name]) => name);
}

/**
 * A copy of a form value for another locale's version: component items lose their `id`
 * (they belong to the source row) and get fresh rendering keys; ids of related documents
 * and files are kept.
 */
export function copyValue(
  attribute: Attribute,
  value: unknown,
  components: ComponentLookup,
): unknown {
  if (value === null || value === undefined) return value;
  switch (attribute.type) {
    case 'component': {
      const component = components(attribute.component ?? '');
      const item = (entry: unknown) =>
        copyItem(component?.attributes ?? {}, entry as FormModel, components);
      return Array.isArray(value) ? value.map((entry) => keyed(item(entry))) : item(value);
    }
    case 'dynamiczone':
      return (value as FormModel[]).map((entry) => {
        const component = components(String(entry['__component']));
        return keyed({
          __component: entry['__component'],
          ...copyItem(component?.attributes ?? {}, entry, components),
        });
      });
    default:
      return structuredClone(value);
  }
}

function copyItem(attributes: Attributes, item: FormModel, components: ComponentLookup): FormModel {
  const copy: FormModel = {};
  for (const [name, attribute] of Object.entries(attributes)) {
    if (name in item) copy[name] = copyValue(attribute, item[name], components);
  }
  return copy;
}

/**
 * The form of a locale the document has no version in yet: empty, except the shared
 * fields, which take their values from `source` (another locale's version).
 */
export function prefillShared(
  attributes: Attributes,
  source: Record<string, unknown> | null,
  components: ComponentLookup,
): FormModel {
  const model = toModel(attributes, null, components);
  if (!source) return model;
  const values = toModel(attributes, source, components);
  for (const name of sharedFields(attributes)) {
    model[name] = copyValue(attributes[name], values[name], components);
  }
  return model;
}

/**
 * `current` with its localized fields replaced by those of `source` (another locale's
 * version, as a form model); shared fields and read-only relations are left alone.
 */
export function fillFromLocale(
  attributes: Attributes,
  current: FormModel,
  source: FormModel,
  components: ComponentLookup,
): FormModel {
  const next: FormModel = { ...current };
  for (const [name, attribute] of Object.entries(attributes)) {
    if (isShared(attribute) || !isEditable(attribute) || !(name in source)) continue;
    next[name] = copyValue(attribute, source[name], components);
  }
  return next;
}
